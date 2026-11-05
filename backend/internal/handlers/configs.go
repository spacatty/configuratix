package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"

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
	// Async: return {job_id} immediately instead of waiting for the result.
	Async bool `json:"async,omitempty"`
}

// ListConfigsResponse lists available config files on a machine
type ConfigFile struct {
	ID            string  `json:"id,omitempty"` // Only for custom paths
	Name          string  `json:"name"`
	Path          string  `json:"path"`
	Type          string  `json:"type"`                // nginx, nginx_site, php, ssh, text
	FileType      string  `json:"file_type,omitempty"` // Alias for type (custom paths)
	Readonly      bool    `json:"readonly"`
	ReloadCommand *string `json:"reload_command,omitempty"`
}

// authorize checks the {id} machine in the route against the requester's permissions.
// manage=true requires manage rights (writes / category changes).
func (h *ConfigsHandler) authorize(w http.ResponseWriter, r *http.Request, manage bool) (uuid.UUID, bool) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return uuid.Nil, false
	}
	allowed := false
	if manage {
		allowed = canManageMachineID(h.db, r, machineID)
	} else {
		allowed = canAccessMachineID(h.db, r, machineID)
	}
	if !allowed {
		http.Error(w, "Access denied", http.StatusForbidden)
		return uuid.Nil, false
	}
	return machineID, true
}

// resolveConfigPath cleans the path and checks it against the built-in allowlist and the
// machine's custom config paths. Returns the cleaned path.
func (h *ConfigsHandler) resolveConfigPath(machineID uuid.UUID, p string) (string, bool) {
	clean, ok := templates.CleanAbsPath(p)
	if !ok {
		return "", false
	}
	if isAllowedConfigPath(clean) || h.isCustomAllowedPath(machineID, clean) {
		return clean, true
	}
	return "", false
}

// ReadConfig reads a configuration file from the machine
func (h *ConfigsHandler) ReadConfig(w http.ResponseWriter, r *http.Request) {
	machineID, ok := h.authorize(w, r, false)
	if !ok {
		return
	}

	var req ReadFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	cleanPath, ok := h.resolveConfigPath(machineID, req.Path)
	if !ok {
		http.Error(w, "Path not allowed", http.StatusForbidden)
		return
	}

	agentID, err := machineAgentID(h.db, machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}

	spec, err := jobs.FromTemplate("read_file", map[string]string{"path": cleanPath})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	spec.AgentID = agentID
	spec.EntityType = jobs.EntityFile
	spec.EntityID = cleanPath
	spec.CreatedBy = jobs.UserID(r)
	job, err := jobs.Create(r.Context(), h.db, spec)
	if err != nil {
		log.Printf("Failed to create read job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	rawLogs, err := h.waitForJobResult(r.Context(), job.ID, 30*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"content": extractFileContent(rawLogs),
		"path":    cleanPath,
		"job_id":  job.ID.String(),
	})
}

// writeConfigSpec picks the transactional template for a path.
// nginx: staged write + nginx -t + restore on failure; php: php-fpm -t + restore;
// sshd: sshd -t with agent-side rollback; others: write_file (+ optional custom reload job).
func (h *ConfigsHandler) writeConfigSpec(machineID uuid.UUID, cleanPath, content string) (jobs.Spec, string, error) {
	switch {
	case strings.HasPrefix(cleanPath, "/etc/nginx/"):
		spec, err := jobs.FromTemplate("write_nginx_config", map[string]string{"path": cleanPath, "content": content})
		return spec, "", err
	case cleanPath == "/etc/ssh/sshd_config":
		spec, err := jobs.FromTemplate("write_sshd_config", map[string]string{"content": content})
		return spec, "", err
	case strings.HasPrefix(cleanPath, "/etc/php/"):
		// /etc/php/<version>/fpm/... → php-fpm<version> -t
		parts := strings.Split(cleanPath, "/")
		if len(parts) >= 4 {
			spec, err := jobs.FromTemplate("write_php_config", map[string]string{"path": cleanPath, "version": parts[3], "content": content})
			if err == nil {
				return spec, "", nil
			}
		}
		spec, err := jobs.FromTemplate("write_file", map[string]string{"path": cleanPath, "content": content, "mode": "0644"})
		return spec, "", err
	case cleanPath == "/root/.ssh/authorized_keys":
		spec, err := jobs.FromTemplate("write_file", map[string]string{"path": cleanPath, "content": content, "mode": "0600"})
		return spec, "", err
	}
	var customReload *string
	h.db.Get(&customReload, `
		SELECT cp.reload_command FROM config_paths cp
		JOIN config_categories cc ON cp.category_id = cc.id
		WHERE cc.machine_id = $1 AND cp.path = $2
	`, machineID, cleanPath)
	spec, err := jobs.FromTemplate("write_file", map[string]string{"path": cleanPath, "content": content, "mode": "0644"})
	reload := ""
	if customReload != nil {
		reload = strings.TrimSpace(*customReload)
	}
	return spec, reload, err
}

// WriteConfig writes a configuration file to the machine (transactional for nginx/php/sshd).
func (h *ConfigsHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	machineID, ok := h.authorize(w, r, true)
	if !ok {
		return
	}

	var req WriteFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	cleanPath, ok := h.resolveConfigPath(machineID, req.Path)
	if !ok {
		http.Error(w, "Path not allowed", http.StatusForbidden)
		return
	}

	agentID, err := machineAgentID(h.db, machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}

	spec, reloadCommand, err := h.writeConfigSpec(machineID, cleanPath, req.Content)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	spec.AgentID = agentID
	spec.EntityType = jobs.EntityFile
	spec.EntityID = cleanPath
	spec.Title = "Write file " + cleanPath
	spec.CreatedBy = jobs.UserID(r)
	job, err := jobs.Create(r.Context(), h.db, spec)
	if err != nil {
		log.Printf("Failed to create write job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	if req.Async {
		writeJSON(w, http.StatusAccepted, map[string]interface{}{"success": true, "path": cleanPath, "job_id": job.ID})
		return
	}

	result, err := h.waitForJobResult(r.Context(), job.ID, 90*time.Second)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"path":    cleanPath,
			"job_id":  job.ID,
			"error":   err.Error(),
			"logs":    err.Error(),
		})
		return
	}

	// Custom paths may define a reload command (user-configured; intentionally arbitrary).
	if reloadCommand != "" {
		payload, _ := json.Marshal(map[string]interface{}{
			"steps":    []map[string]interface{}{{"action": "exec", "command": reloadCommand, "timeout": 60}},
			"on_error": "stop",
		})
		reloadJob, err := jobs.Create(r.Context(), h.db, jobs.Spec{
			AgentID:    agentID,
			Payload:    payload,
			Action:     "reload_service",
			Title:      jobs.CommandTitle(reloadCommand),
			EntityType: jobs.EntityFile,
			EntityID:   cleanPath,
			CreatedBy:  jobs.UserID(r),
		})
		if err == nil {
			if reloadResult, err := h.waitForJobResult(r.Context(), reloadJob.ID, 60*time.Second); err == nil {
				result = result + "\n\n=== Reload Output ===\n" + reloadResult
			} else {
				result = result + "\n\n=== Reload Failed ===\n" + err.Error()
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"path":    cleanPath,
		"job_id":  job.ID,
		"logs":    result,
	})
}

// ConfigCategoryResponse for the new API
type ConfigCategoryResponse struct {
	ID            string                `json:"id"`
	Name          string                `json:"name"`
	Emoji         string                `json:"emoji"`
	Color         string                `json:"color"`
	Description   string                `json:"description,omitempty"`
	IsBuiltIn     bool                  `json:"is_built_in"`
	Subcategories []SubcategoryResponse `json:"subcategories,omitempty"`
	Files         []ConfigFile          `json:"files,omitempty"`
}

type SubcategoryResponse struct {
	ID    string       `json:"id"`
	Name  string       `json:"name"`
	Files []ConfigFile `json:"files"`
}

// ListConfigs returns config files organized by categories. Fast: no agent round trip.
// "Configuratix Sites" is filled from the domains assigned to this machine; the complete
// on-disk inventory is available from GET /api/machines/{id}/nginx.
func (h *ConfigsHandler) ListConfigs(w http.ResponseWriter, r *http.Request) {
	machineID, ok := h.authorize(w, r, false)
	if !ok {
		return
	}

	var exists bool
	err := h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM machines WHERE id = $1)", machineID)
	if err != nil || !exists {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	siteFiles := []ConfigFile{}
	var fqdns []string
	h.db.Select(&fqdns, `SELECT fqdn FROM domains WHERE assigned_machine_id = $1 ORDER BY fqdn`, machineID)
	for _, raw := range fqdns {
		fqdn, err := templates.NormalizeFQDN(raw)
		if err != nil {
			continue
		}
		siteFiles = append(siteFiles, ConfigFile{
			Name: fqdn + ".conf",
			Path: "/etc/nginx/conf.d/configuratix/" + fqdn + ".conf",
			Type: "nginx_site",
		})
	}

	builtInCategories := []ConfigCategoryResponse{
		{
			ID:          "nginx",
			Name:        "Nginx",
			Emoji:       "🌐",
			Color:       "#22c55e",
			Description: "Nginx web server configuration",
			IsBuiltIn:   true,
			Subcategories: []SubcategoryResponse{
				{ID: "nginx_main", Name: "Main Config", Files: []ConfigFile{
					{Name: "nginx.conf", Path: "/etc/nginx/nginx.conf", Type: "nginx"},
				}},
				{ID: "nginx_sites_enabled", Name: "Sites Enabled", Files: []ConfigFile{
					{Name: "default", Path: "/etc/nginx/sites-enabled/default", Type: "nginx_site"},
				}},
				{ID: "nginx_configuratix", Name: "Configuratix Sites", Files: siteFiles},
			},
		},
		{
			ID:            "php",
			Name:          "PHP",
			Emoji:         "🐘",
			Color:         "#8b5cf6",
			Description:   "PHP-FPM configuration (scan /etc/php for versions)",
			IsBuiltIn:     true,
			Subcategories: []SubcategoryResponse{},
		},
		{
			ID:          "ssh",
			Name:        "SSH",
			Emoji:       "🔐",
			Color:       "#f59e0b",
			Description: "SSH daemon configuration",
			IsBuiltIn:   true,
			Files: []ConfigFile{
				{Name: "sshd_config", Path: "/etc/ssh/sshd_config", Type: "ssh"},
				{Name: "authorized_keys", Path: "/root/.ssh/authorized_keys", Type: "text"},
			},
		},
	}

	var customCategories []models.ConfigCategory
	h.db.Select(&customCategories, `
		SELECT * FROM config_categories WHERE machine_id = $1 ORDER BY position, name
	`, machineID)

	customCategoryResponses := []ConfigCategoryResponse{}
	for _, cat := range customCategories {
		var paths []models.ConfigPath
		h.db.Select(&paths, `
			SELECT * FROM config_paths WHERE category_id = $1 ORDER BY position, name
		`, cat.ID)

		files := []ConfigFile{}
		for _, p := range paths {
			files = append(files, ConfigFile{
				ID:            p.ID.String(),
				Name:          p.Name,
				Path:          p.Path,
				Type:          p.FileType,
				FileType:      p.FileType,
				ReloadCommand: p.ReloadCommand,
			})
		}

		customCategoryResponses = append(customCategoryResponses, ConfigCategoryResponse{
			ID:        cat.ID.String(),
			Name:      cat.Name,
			Emoji:     cat.Emoji,
			Color:     cat.Color,
			IsBuiltIn: false,
			Files:     files,
		})
	}

	writeJSON(w, http.StatusOK, struct {
		Categories []ConfigCategoryResponse `json:"categories"`
	}{
		Categories: append(builtInCategories, customCategoryResponses...),
	})
}

// waitForJobResult waits for a job and returns its logs; failed/cancelled jobs and timeouts
// are returned as errors (the error text includes the logs for failed jobs).
func (h *ConfigsHandler) waitForJobResult(ctx context.Context, jobID uuid.UUID, timeout time.Duration) (string, error) {
	job, err := waitForJob(ctx, h.db, jobID, timeout)
	if err != nil && job == nil {
		return "", err
	}
	switch job.Status {
	case models.JobStatusCompleted:
		return nullStringToString(job.Logs), nil
	case models.JobStatusFailed, models.JobStatusCancelled:
		return "", &ConfigError{Message: "Job " + job.Status + ": " + nullStringToString(job.Logs)}
	}
	return "", &ConfigError{Message: "Job timeout (job " + jobID.String() + " is still " + job.Status + ")"}
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

// extractFileContent parses job logs to get just the file content
// Job logs format:
// Starting...
// === Step 1: exec ===
// $ cat /path/to/file
// <actual content>
// === All steps completed ===
func extractFileContent(logs string) string {
	lines := strings.Split(logs, "\n")
	var content []string
	inContent := false

	for _, line := range lines {
		if strings.HasPrefix(line, "$ ") {
			inContent = true
			continue
		}
		if strings.HasPrefix(line, "===") {
			inContent = false
			continue
		}
		if line == "Starting..." || strings.HasPrefix(line, "ERROR:") {
			continue
		}
		if inContent {
			content = append(content, line)
		}
	}

	return strings.Join(content, "\n")
}

// allowedConfigDirs are directories whose files may be read/written via the configs API.
var allowedConfigDirs = []string{
	"/etc/nginx",
	"/etc/php",
	"/etc/fail2ban",
	"/etc/letsencrypt/renewal",
}

// allowedConfigFiles are individual files that may be read/written.
var allowedConfigFiles = map[string]bool{
	"/etc/ssh/sshd_config":       true,
	"/root/.ssh/authorized_keys": true,
}

// isAllowedConfigPath checks a cleaned absolute path against the allowlist. The path is
// cleaned again here, so "/etc/nginx/../shadow" is rejected.
func isAllowedConfigPath(p string) bool {
	if p == "" || !strings.HasPrefix(p, "/") {
		return false
	}
	clean := path.Clean(p)
	if clean != p && clean+"/" != p {
		return false
	}
	if allowedConfigFiles[clean] {
		return true
	}
	for _, dir := range allowedConfigDirs {
		if strings.HasPrefix(clean, dir+"/") {
			return true
		}
	}
	return false
}

// isCustomAllowedPath checks if a path is in the custom config paths for this machine
func (h *ConfigsHandler) isCustomAllowedPath(machineID uuid.UUID, p string) bool {
	var count int
	err := h.db.Get(&count, `
		SELECT COUNT(*) FROM config_paths cp
		JOIN config_categories cc ON cp.category_id = cc.id
		WHERE cc.machine_id = $1 AND cp.path = $2
	`, machineID, p)
	return err == nil && count > 0
}

// ==================== Custom Config Categories ====================

type CreateConfigCategoryRequest struct {
	Name  string `json:"name"`
	Emoji string `json:"emoji"`
	Color string `json:"color"`
}

// CreateConfigCategory creates a new custom config category for a machine
func (h *ConfigsHandler) CreateConfigCategory(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.authorize(w, r, true); !ok {
		return
	}
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req CreateConfigCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if req.Emoji == "" {
		req.Emoji = "📁"
	}
	if req.Color == "" {
		req.Color = "#6366f1"
	}

	var maxPos int
	h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM config_categories WHERE machine_id = $1", machineID)

	var category models.ConfigCategory
	err = h.db.Get(&category, `
		INSERT INTO config_categories (machine_id, name, emoji, color, position)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING *
	`, machineID, req.Name, req.Emoji, req.Color, maxPos+1)
	if err != nil {
		log.Printf("Failed to create config category: %v", err)
		http.Error(w, "Failed to create category (name may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(category)
}

// DeleteConfigCategory deletes a custom config category
func (h *ConfigsHandler) DeleteConfigCategory(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.authorize(w, r, true); !ok {
		return
	}
	categoryID, err := uuid.Parse(mux.Vars(r)["categoryId"])
	if err != nil {
		http.Error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec("DELETE FROM config_categories WHERE id = $1", categoryID)
	if err != nil {
		http.Error(w, "Failed to delete category", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type AddConfigPathRequest struct {
	Name          string  `json:"name"`
	Path          string  `json:"path"`
	FileType      string  `json:"file_type"`
	ReloadCommand *string `json:"reload_command"`
}

// AddConfigPath adds a file path to a custom category
func (h *ConfigsHandler) AddConfigPath(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.authorize(w, r, true); !ok {
		return
	}
	categoryID, err := uuid.Parse(mux.Vars(r)["categoryId"])
	if err != nil {
		http.Error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	var req AddConfigPathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Path == "" {
		http.Error(w, "Name and path are required", http.StatusBadRequest)
		return
	}
	if req.FileType == "" {
		req.FileType = "text"
	}

	var maxPos int
	h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM config_paths WHERE category_id = $1", categoryID)

	var configPath models.ConfigPath
	err = h.db.Get(&configPath, `
		INSERT INTO config_paths (category_id, name, path, file_type, reload_command, position)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING *
	`, categoryID, req.Name, req.Path, req.FileType, req.ReloadCommand, maxPos+1)
	if err != nil {
		log.Printf("Failed to add config path: %v", err)
		http.Error(w, "Failed to add path (may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(configPath)
}

// RemoveConfigPath removes a file path from a category
func (h *ConfigsHandler) RemoveConfigPath(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.authorize(w, r, true); !ok {
		return
	}
	pathID, err := uuid.Parse(mux.Vars(r)["pathId"])
	if err != nil {
		http.Error(w, "Invalid path ID", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec("DELETE FROM config_paths WHERE id = $1", pathID)
	if err != nil {
		http.Error(w, "Failed to remove path", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type UpdateConfigCategoryRequest struct {
	Name  string `json:"name"`
	Emoji string `json:"emoji"`
	Color string `json:"color"`
}

// UpdateConfigCategory updates a custom config category
func (h *ConfigsHandler) UpdateConfigCategory(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.authorize(w, r, true); !ok {
		return
	}
	categoryID, err := uuid.Parse(mux.Vars(r)["categoryId"])
	if err != nil {
		http.Error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	var req UpdateConfigCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE config_categories SET name = $1, emoji = $2, color = $3, updated_at = NOW()
		WHERE id = $4
	`, req.Name, req.Emoji, req.Color, categoryID)
	if err != nil {
		http.Error(w, "Failed to update category", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

type UpdateConfigPathRequest struct {
	Name          string  `json:"name"`
	Path          string  `json:"path"`
	FileType      string  `json:"file_type"`
	ReloadCommand *string `json:"reload_command"`
}

// UpdateConfigPath updates a file path in a category
func (h *ConfigsHandler) UpdateConfigPath(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.authorize(w, r, true); !ok {
		return
	}
	pathID, err := uuid.Parse(mux.Vars(r)["pathId"])
	if err != nil {
		http.Error(w, "Invalid path ID", http.StatusBadRequest)
		return
	}

	var req UpdateConfigPathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Path == "" {
		http.Error(w, "Name and path are required", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE config_paths SET name = $1, path = $2, file_type = $3, reload_command = $4
		WHERE id = $5
	`, req.Name, req.Path, req.FileType, req.ReloadCommand, pathID)
	if err != nil {
		http.Error(w, "Failed to update path", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

