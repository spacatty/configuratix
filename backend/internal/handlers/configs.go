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
	ID            string  `json:"id,omitempty"`      // Only for custom paths
	Name          string  `json:"name"`
	Path          string  `json:"path"`
	Type          string  `json:"type"`              // nginx, nginx_site, php, ssh, text
	FileType      string  `json:"file_type,omitempty"` // Alias for type (custom paths)
	Readonly      bool    `json:"readonly"`
	ReloadCommand *string `json:"reload_command,omitempty"`
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

	// Validate path - check built-in paths and custom paths
	if !isAllowedConfigPath(req.Path) && !h.isCustomAllowedPath(machineID, req.Path) {
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
	rawLogs, err := h.waitForJobResult(jobID, 30*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Extract just the file content from job logs
	content := extractFileContent(rawLogs)

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

	// Validate path - check built-in paths and custom paths
	if !isAllowedConfigPath(req.Path) && !h.isCustomAllowedPath(machineID, req.Path) {
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

	// Determine which template to use based on path and build reload command
	var templateID string
	var vars_map map[string]string
	var reloadCommand string

	if strings.HasPrefix(req.Path, "/etc/nginx/") {
		templateID = "write_nginx_config"
		vars_map = map[string]string{"path": req.Path, "content": req.Content}
		reloadCommand = ""  // Template handles nginx reload
	} else if req.Path == "/etc/ssh/sshd_config" {
		// SSH config - need proper reload
		templateID = "write_file"
		vars_map = map[string]string{"path": req.Path, "content": req.Content, "mode": "0600"}
		reloadCommand = "sshd -t && systemctl daemon-reload && systemctl restart sshd"
	} else if strings.HasPrefix(req.Path, "/etc/php/") {
		// PHP config - extract version and reload that specific fpm
		templateID = "write_file"
		vars_map = map[string]string{"path": req.Path, "content": req.Content, "mode": "0644"}
		// Extract PHP version from path like /etc/php/8.2/fpm/php.ini
		parts := strings.Split(req.Path, "/")
		if len(parts) >= 4 {
			phpVersion := parts[3]
			reloadCommand = "systemctl reload php" + phpVersion + "-fpm || systemctl restart php" + phpVersion + "-fpm"
		}
	} else if req.Path == "/root/.ssh/authorized_keys" {
		templateID = "write_file"
		vars_map = map[string]string{"path": req.Path, "content": req.Content, "mode": "0600"}
		reloadCommand = ""  // No reload needed for authorized_keys
	} else {
		// Custom path - check if it has a reload command
		var customReload *string
		h.db.Get(&customReload, `
			SELECT cp.reload_command FROM config_paths cp
			JOIN config_categories cc ON cp.category_id = cc.id
			WHERE cc.machine_id = $1 AND cp.path = $2
		`, machineID, req.Path)
		
		templateID = "write_file"
		vars_map = map[string]string{"path": req.Path, "content": req.Content, "mode": "0644"}
		if customReload != nil {
			reloadCommand = *customReload
		}
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

	// Poll for job completion (max 60 seconds for writes)
	result, err := h.waitForJobResult(jobID, 60*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Run reload command if specified and different from template
	if reloadCommand != "" {
		reloadJobID := uuid.New()
		reloadPayload := `{"description":"Reload service","steps":[{"action":"exec","command":"` + reloadCommand + `","timeout":60}]}`
		h.db.Exec(`
			INSERT INTO jobs (id, agent_id, type, payload_json, status, created_at, updated_at)
			VALUES ($1, $2, 'run', $3, 'pending', NOW(), NOW())
		`, reloadJobID, agentID, reloadPayload)
		
		if reloadResult, err := h.waitForJobResult(reloadJobID, 60*time.Second); err == nil {
			result = result + "\n\n=== Reload Output ===\n" + reloadResult
		} else {
			result = result + "\n\n=== Reload Failed ===\n" + err.Error()
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"path":    req.Path,
		"logs":    result,
	})
}

// ConfigCategoryResponse for the new API
type ConfigCategoryResponse struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Emoji       string              `json:"emoji"`
	Color       string              `json:"color"`
	Description string              `json:"description,omitempty"`
	IsBuiltIn   bool                `json:"is_built_in"`
	Subcategories []SubcategoryResponse `json:"subcategories,omitempty"`
	Files       []ConfigFile        `json:"files,omitempty"`
}

type SubcategoryResponse struct {
	ID    string       `json:"id"`
	Name  string       `json:"name"`
	Files []ConfigFile `json:"files"`
}

// ListConfigs returns config files organized by categories
// This is now FAST - returns static structure immediately without waiting for jobs
func (h *ConfigsHandler) ListConfigs(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Just verify machine exists, don't need agent ID for static list
	var exists bool
	err = h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM machines WHERE id = $1)", machineID)
	if err != nil || !exists {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	// Return STATIC built-in categories immediately (no job polling)
	builtInCategories := []ConfigCategoryResponse{}

	// 1. Nginx Category - static paths that exist on most servers
	nginxCategory := ConfigCategoryResponse{
		ID:          "nginx",
		Name:        "Nginx",
		Emoji:       "🌐",
		Color:       "#22c55e",
		Description: "Nginx web server configuration",
		IsBuiltIn:   true,
		Subcategories: []SubcategoryResponse{
			{
				ID:   "nginx_main",
				Name: "Main Config",
				Files: []ConfigFile{
					{Name: "nginx.conf", Path: "/etc/nginx/nginx.conf", Type: "nginx", Readonly: false},
				},
			},
			{
				ID:   "nginx_sites_enabled",
				Name: "Sites Enabled",
				Files: []ConfigFile{
					{Name: "default", Path: "/etc/nginx/sites-enabled/default", Type: "nginx_site", Readonly: false},
				},
			},
			{
				ID:   "nginx_configuratix",
				Name: "Configuratix Sites",
				Files: []ConfigFile{}, // Will be populated when reading
			},
		},
	}

	// 2. PHP Category - will be populated dynamically via file module
	// For now, create empty category - frontend will scan for PHP versions
	phpCategory := ConfigCategoryResponse{
		ID:          "php",
		Name:        "PHP",
		Emoji:       "🐘",
		Color:       "#8b5cf6",
		Description: "PHP-FPM configuration (scan /etc/php for versions)",
		IsBuiltIn:   true,
		Subcategories: []SubcategoryResponse{},
		// Hint to frontend to scan /etc/php directory
	}

	// Add built-in categories (no job waiting - instant response!)
	builtInCategories = append(builtInCategories, nginxCategory)
	builtInCategories = append(builtInCategories, phpCategory)

	// 3. SSH Category
	sshCategory := ConfigCategoryResponse{
		ID:          "ssh",
		Name:        "SSH",
		Emoji:       "🔐",
		Color:       "#f59e0b",
		Description: "SSH daemon configuration",
		IsBuiltIn:   true,
		Files: []ConfigFile{
			{Name: "sshd_config", Path: "/etc/ssh/sshd_config", Type: "ssh", Readonly: false},
			{Name: "authorized_keys", Path: "/root/.ssh/authorized_keys", Type: "text", Readonly: false},
		},
	}
	builtInCategories = append(builtInCategories, sshCategory)

	// 4. Get custom categories from database
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
				Readonly:      false,
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

	// Return combined response
	response := struct {
		Categories []ConfigCategoryResponse `json:"categories"`
	}{
		Categories: append(builtInCategories, customCategoryResponses...),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
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
		// Start capturing after the "$ cat" or "$ " command line
		if strings.HasPrefix(line, "$ ") {
			inContent = true
			continue
		}
		// Stop at the end marker or next step
		if strings.HasPrefix(line, "===") {
			inContent = false
			continue
		}
		// Skip metadata lines
		if line == "Starting..." || strings.HasPrefix(line, "ERROR:") {
			continue
		}
		// Capture content
		if inContent {
			content = append(content, line)
		}
	}

	return strings.Join(content, "\n")
}

// isAllowedConfigPath checks if a path is allowed for reading/writing
func isAllowedConfigPath(path string) bool {
	allowedPrefixes := []string{
		"/etc/nginx/",
		"/etc/ssh/sshd_config",
		"/etc/php/",
		"/etc/fail2ban/",
		"/root/.ssh/authorized_keys",
	}

	for _, prefix := range allowedPrefixes {
		if strings.HasPrefix(path, prefix) || path == prefix {
			return true
		}
	}
	return false
}

// isCustomAllowedPath checks if a path is in the custom config paths for this machine
func (h *ConfigsHandler) isCustomAllowedPath(machineID uuid.UUID, path string) bool {
	var count int
	err := h.db.Get(&count, `
		SELECT COUNT(*) FROM config_paths cp
		JOIN config_categories cc ON cp.category_id = cc.id
		WHERE cc.machine_id = $1 AND cp.path = $2
	`, machineID, path)
	return err == nil && count > 0
}

// parseSiteConfigs extracts Configuratix site configs from output
func parseSiteConfigs(output string) []ConfigFile {
	configs := []ConfigFile{}
	lines := strings.Split(output, "\n")
	inSiteConfigs := false
	
	for _, line := range lines {
		if strings.Contains(line, "Site Configs") || strings.Contains(line, "configuratix") {
			inSiteConfigs = true
			continue
		}
		if strings.Contains(line, "===") || strings.Contains(line, "Sites Enabled") {
			inSiteConfigs = false
			continue
		}
		if inSiteConfigs && strings.HasSuffix(strings.TrimSpace(line), ".conf") {
			parts := strings.Fields(line)
			if len(parts) > 0 {
				lastPart := parts[len(parts)-1]
				if strings.HasSuffix(lastPart, ".conf") {
					var filename, fullPath string
					if strings.HasPrefix(lastPart, "/") {
						fullPath = lastPart
						pathParts := strings.Split(lastPart, "/")
						filename = pathParts[len(pathParts)-1]
					} else {
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

// parseSitesEnabled extracts sites-enabled configs from output
func parseSitesEnabled(output string) []ConfigFile {
	configs := []ConfigFile{}
	lines := strings.Split(output, "\n")
	inSitesEnabled := false
	
	for _, line := range lines {
		if strings.Contains(line, "Sites Enabled") {
			inSitesEnabled = true
			continue
		}
		if strings.Contains(line, "===") {
			inSitesEnabled = false
			continue
		}
		trimmed := strings.TrimSpace(line)
		
		// Skip empty lines, command lines, total lines, metadata
		if !inSitesEnabled || trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "$") || strings.HasPrefix(trimmed, "total") {
			continue
		}
		if strings.HasPrefix(trimmed, "d") && strings.Contains(line, " . ") {
			continue // Skip directory entries like . and ..
		}
		
		// For ls -la output, get the filename (last part, or part before ->)
		// Example: lrwxrwxrwx 1 root root 34 Jan 22 15:43 default -> /etc/nginx/sites-available/default
		parts := strings.Fields(line)
		if len(parts) < 9 {
			continue // Not a valid ls -la line
		}
		
		// Find the filename - it's after the date/time fields
		// Format: permissions links owner group size month day time filename [-> target]
		filename := ""
		for i := 8; i < len(parts); i++ {
			if parts[i] == "->" {
				break
			}
			filename = parts[i]
		}
		
		if filename == "" || filename == "." || filename == ".." {
			continue
		}
		
		fullPath := "/etc/nginx/sites-enabled/" + filename
		configs = append(configs, ConfigFile{
			Name:     filename,
			Path:     fullPath,
			Type:     "nginx_site",
			Readonly: false,
		})
	}
	return configs
}

// parsePHPVersions extracts PHP versions from ls /etc/php output
func parsePHPVersions(output string) []string {
	versions := []string{}
	lines := strings.Split(output, "\n")
	
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		
		// Skip metadata lines from job output
		if trimmed == "" || strings.HasPrefix(trimmed, "Starting") || 
		   strings.HasPrefix(trimmed, "===") || strings.HasPrefix(trimmed, "$") ||
		   strings.HasPrefix(trimmed, "ERROR") {
			continue
		}
		
		// Look for version patterns like 8.1, 8.2, 8.3
		// Must match pattern X.Y where X and Y are digits
		if len(trimmed) >= 3 && len(trimmed) <= 4 {
			parts := strings.Split(trimmed, ".")
			if len(parts) == 2 {
				major := parts[0]
				minor := parts[1]
				if len(major) >= 1 && len(minor) >= 1 &&
				   major[0] >= '5' && major[0] <= '9' &&
				   minor[0] >= '0' && minor[0] <= '9' {
					versions = append(versions, trimmed)
				}
			}
		}
	}
	return versions
}

// parseConfigList is kept for backward compatibility
func parseConfigList(output string) []ConfigFile {
	configs := []ConfigFile{
		{Name: "nginx.conf", Path: "/etc/nginx/nginx.conf", Type: "nginx", Readonly: false},
		{Name: "sshd_config", Path: "/etc/ssh/sshd_config", Type: "ssh", Readonly: false},
	}
	configs = append(configs, parseSiteConfigs(output)...)
	return configs
}

// ==================== Custom Config Categories ====================

type CreateConfigCategoryRequest struct {
	Name  string `json:"name"`
	Emoji string `json:"emoji"`
	Color string `json:"color"`
}

// CreateConfigCategory creates a new custom config category for a machine
func (h *ConfigsHandler) CreateConfigCategory(w http.ResponseWriter, r *http.Request) {
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

