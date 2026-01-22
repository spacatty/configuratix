package handlers

import (
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type ConfigsHandler struct {
	db *database.DB
}

func NewConfigsHandler(db *database.DB) *ConfigsHandler {
	return &ConfigsHandler{db: db}
}

// ReadFileRequest is the request body for reading a file
type ReadFileRequest struct {
	Path string `json:"path"`
}

// WriteFileRequest is the request body for writing a file
type WriteFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// ListConfigsResponse lists available config files on a machine
type ConfigFile struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"` // nginx, nginx_site, php, ssh
	Readonly bool   `json:"readonly"`
}

// ReadConfig reads a configuration file from the machine
func (h *ConfigsHandler) ReadConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req ReadFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate path - only allow certain config paths
	if !isAllowedConfigPath(req.Path) {
		http.Error(w, "Path not allowed", http.StatusForbidden)
		return
	}

	// Get agent ID for this machine
	var agentID uuid.UUID
	err = h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	// Create a read_file job
	template := templates.Commands["read_file"]
	payload := template.ToPayload(map[string]string{"path": req.Path})

	jobID := uuid.New()
	_, err = h.db.Exec(`
		INSERT INTO jobs (id, agent_id, type, payload_json, status, created_at, updated_at)
		VALUES ($1, $2, 'run', $3, 'pending', NOW(), NOW())
	`, jobID, agentID, payload)
	if err != nil {
		log.Printf("Failed to create read job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	// Poll for job completion (max 30 seconds)
	content, err := h.waitForJobResult(jobID, 30*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"content": content,
		"path":    req.Path,
	})
}

// WriteConfig writes a configuration file to the machine
func (h *ConfigsHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req WriteFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate path
	if !isAllowedConfigPath(req.Path) {
		http.Error(w, "Path not allowed", http.StatusForbidden)
		return
	}

	// Get agent ID for this machine
	var agentID uuid.UUID
	err = h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	// Determine which template to use based on path
	var templateID string
	var vars_map map[string]string

	if strings.HasPrefix(req.Path, "/etc/nginx/") {
		templateID = "write_nginx_config"
		vars_map = map[string]string{"path": req.Path, "content": req.Content}
	} else if req.Path == "/etc/ssh/sshd_config" {
		templateID = "write_sshd_config"
		vars_map = map[string]string{"content": req.Content}
	} else {
		templateID = "write_file"
		vars_map = map[string]string{"path": req.Path, "content": req.Content, "mode": "0644"}
	}

	template := templates.Commands[templateID]
	payload := template.ToPayload(vars_map)

	jobID := uuid.New()
	_, err = h.db.Exec(`
		INSERT INTO jobs (id, agent_id, type, payload_json, status, created_at, updated_at)
		VALUES ($1, $2, 'run', $3, 'pending', NOW(), NOW())
	`, jobID, agentID, payload)
	if err != nil {
		log.Printf("Failed to create write job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	// Poll for job completion (max 60 seconds for writes with reload)
	result, err := h.waitForJobResult(jobID, 60*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"path":    req.Path,
		"logs":    result,
	})
}

// ListConfigs returns a list of available config files on the machine
func (h *ConfigsHandler) ListConfigs(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Get agent ID for this machine
	var agentID uuid.UUID
	err = h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	// Create a job to list configs
	template := templates.Commands["list_nginx_configs"]
	payload := template.ToPayload(map[string]string{})

	jobID := uuid.New()
	_, err = h.db.Exec(`
		INSERT INTO jobs (id, agent_id, type, payload_json, status, created_at, updated_at)
		VALUES ($1, $2, 'run', $3, 'pending', NOW(), NOW())
	`, jobID, agentID, payload)
	if err != nil {
		log.Printf("Failed to create list job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	// Poll for job completion
	result, err := h.waitForJobResult(jobID, 30*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Parse the result to extract config files
	configs := parseConfigList(result)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configs)
}

// waitForJobResult polls until a job completes and returns the logs
func (h *ConfigsHandler) waitForJobResult(jobID uuid.UUID, timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		var job models.Job
		err := h.db.Get(&job, "SELECT * FROM jobs WHERE id = $1", jobID)
		if err != nil {
			return "", err
		}

		switch job.Status {
		case "completed":
			return nullStringToString(job.Logs), nil
		case "failed":
			return "", &ConfigError{Message: "Job failed: " + nullStringToString(job.Logs)}
		case "pending", "running":
			time.Sleep(500 * time.Millisecond)
			continue
		}
	}

	return "", &ConfigError{Message: "Job timeout"}
}

type ConfigError struct {
	Message string
}

func (e *ConfigError) Error() string {
	return e.Message
}

func nullStringToString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// isAllowedConfigPath checks if a path is allowed for reading/writing
func isAllowedConfigPath(path string) bool {
	allowedPrefixes := []string{
		"/etc/nginx/",
		"/etc/ssh/sshd_config",
		"/etc/php/",
		"/etc/fail2ban/",
	}

	for _, prefix := range allowedPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// parseConfigList extracts config file info from the ls output
func parseConfigList(output string) []ConfigFile {
	configs := []ConfigFile{
		{Name: "nginx.conf", Path: "/etc/nginx/nginx.conf", Type: "nginx", Readonly: false},
		{Name: "sshd_config", Path: "/etc/ssh/sshd_config", Type: "ssh", Readonly: false},
	}

	// Parse configuratix site configs from output
	lines := strings.Split(output, "\n")
	inSiteConfigs := false
	for _, line := range lines {
		if strings.Contains(line, "Site Configs") {
			inSiteConfigs = true
			continue
		}
		if strings.Contains(line, "===") {
			inSiteConfigs = false
			continue
		}
		if inSiteConfigs && strings.HasSuffix(strings.TrimSpace(line), ".conf") {
			// Extract filename from ls -la output (last field is the filename/path)
			parts := strings.Fields(line)
			if len(parts) > 0 {
				lastPart := parts[len(parts)-1]
				if strings.HasSuffix(lastPart, ".conf") {
					// lastPart might be full path or just filename
					var filename, fullPath string
					if strings.HasPrefix(lastPart, "/") {
						// Full path - extract just the filename
						fullPath = lastPart
						pathParts := strings.Split(lastPart, "/")
						filename = pathParts[len(pathParts)-1]
					} else {
						// Just filename - construct full path
						filename = lastPart
						fullPath = "/etc/nginx/conf.d/configuratix/" + filename
					}
					configs = append(configs, ConfigFile{
						Name:     filename,
						Path:     fullPath,
						Type:     "nginx_site",
						Readonly: false,
					})
				}
			}
		}
	}

	return configs
}

