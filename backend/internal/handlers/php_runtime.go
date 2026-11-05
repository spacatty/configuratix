package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strings"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

type PHPRuntimeHandler struct {
	db *database.DB
}

func NewPHPRuntimeHandler(db *database.DB) *PHPRuntimeHandler {
	return &PHPRuntimeHandler{db: db}
}

// GetPHPRuntime returns the PHP runtime for a machine
func (h *PHPRuntimeHandler) GetPHPRuntime(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canAccessMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var runtime models.PHPRuntime
	err = h.db.Get(&runtime, `
		SELECT id, machine_id, version, extensions, status, socket_path, 
		       error_message, installed_at, created_at, updated_at
		FROM php_runtimes 
		WHERE machine_id = $1
	`, machineID)
	if err == sql.ErrNoRows {
		// Return empty response indicating no runtime installed
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"installed": false,
		})
		return
	}
	if err != nil {
		log.Printf("Failed to get PHP runtime: %v", err)
		http.Error(w, "Failed to get PHP runtime", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"installed": true,
		"runtime":   runtime,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

type InstallPHPRequest struct {
	Version    string   `json:"version"`
	Extensions []string `json:"extensions"`
}

func isValidPHPVersion(version string) bool {
	for _, v := range models.PHPVersions {
		if v == version {
			return true
		}
	}
	return false
}

func normalizeExtensions(extensions []string) []string {
	seen := make(map[string]struct{}, len(extensions))
	result := make([]string, 0, len(extensions))

	for _, ext := range extensions {
		normalized := strings.ToLower(strings.TrimSpace(ext))
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}

	sort.Strings(result)
	return result
}

func diffExtensions(current, requested []string) (added []string, removed []string) {
	currentSet := make(map[string]struct{}, len(current))
	requestedSet := make(map[string]struct{}, len(requested))

	for _, ext := range current {
		currentSet[ext] = struct{}{}
	}
	for _, ext := range requested {
		requestedSet[ext] = struct{}{}
		if _, exists := currentSet[ext]; !exists {
			added = append(added, ext)
		}
	}
	for _, ext := range current {
		if _, exists := requestedSet[ext]; !exists {
			removed = append(removed, ext)
		}
	}

	sort.Strings(added)
	sort.Strings(removed)
	return added, removed
}

// InstallPHPRuntime installs PHP on a machine
func (h *PHPRuntimeHandler) InstallPHPRuntime(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canManageMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req InstallPHPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	h.installPHP(w, r, machineID, req)
}

// installPHP is the body of InstallPHPRuntime after the request was decoded (also used by
// UpdatePHPRuntime when no runtime exists yet, since the body cannot be read twice).
func (h *PHPRuntimeHandler) installPHP(w http.ResponseWriter, r *http.Request, machineID uuid.UUID, req InstallPHPRequest) {
	var err error
	req.Extensions = normalizeExtensions(req.Extensions)

	// Validate version
	if !isValidPHPVersion(req.Version) {
		http.Error(w, "Invalid PHP version", http.StatusBadRequest)
		return
	}

	// Get machine to find agent_id
	var machine models.Machine
	err = h.db.Get(&machine, "SELECT id, agent_id FROM machines WHERE id = $1", machineID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}
	if machine.AgentID == nil {
		http.Error(w, "Machine has no agent", http.StatusBadRequest)
		return
	}

	// Check if runtime already exists
	var existingID uuid.UUID
	err = h.db.Get(&existingID, "SELECT id FROM php_runtimes WHERE machine_id = $1", machineID)
	if err == nil {
		// Update existing runtime status to installing
		_, err = h.db.Exec(`
			UPDATE php_runtimes 
			SET version = $1, extensions = $2, status = 'installing', 
			    error_message = NULL, updated_at = NOW()
			WHERE machine_id = $3
		`, req.Version, pq.Array(req.Extensions), machineID)
		if err != nil {
			log.Printf("Failed to update PHP runtime: %v", err)
			http.Error(w, "Failed to update PHP runtime", http.StatusInternalServerError)
			return
		}
	} else if err == sql.ErrNoRows {
		// Create new runtime record
		socketPath := models.GetPHPSocketPath(req.Version)
		_, err = h.db.Exec(`
			INSERT INTO php_runtimes (machine_id, version, extensions, status, socket_path)
			VALUES ($1, $2, $3, 'installing', $4)
		`, machineID, req.Version, pq.Array(req.Extensions), socketPath)
		if err != nil {
			log.Printf("Failed to create PHP runtime: %v", err)
			http.Error(w, "Failed to create PHP runtime", http.StatusInternalServerError)
			return
		}
	} else {
		log.Printf("Failed to check PHP runtime: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	template := templates.GetCommand("install_php_runtime")
	payload := template.ToPayload(map[string]string{
		"version":    req.Version,
		"extensions": strings.Join(req.Extensions, ","),
	})

	jobID, err := h.createPHPJob(r, *machine.AgentID, machineID, "install_php_runtime", payload)
	if err != nil {
		log.Printf("Failed to create install job: %v", err)
		http.Error(w, "Failed to create install job", http.StatusInternalServerError)
		return
	}
	// Runtime status is updated by jobhooks.OnJobFinished when the job finishes.

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "PHP installation started",
		"job_id":  jobID,
		"version": req.Version,
	})
}

// RemovePHPRuntime removes PHP from a machine
func (h *PHPRuntimeHandler) RemovePHPRuntime(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canManageMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	// Get runtime
	var runtime models.PHPRuntime
	err = h.db.Get(&runtime, "SELECT * FROM php_runtimes WHERE machine_id = $1", machineID)
	if err == sql.ErrNoRows {
		http.Error(w, "No PHP runtime installed", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// Get machine agent
	var machine models.Machine
	err = h.db.Get(&machine, "SELECT id, agent_id FROM machines WHERE id = $1", machineID)
	if err != nil || machine.AgentID == nil {
		http.Error(w, "Machine or agent not found", http.StatusNotFound)
		return
	}

	// Update status
	h.db.Exec(`UPDATE php_runtimes SET status = 'removing', updated_at = NOW() WHERE machine_id = $1`, machineID)

	// Create remove job
	template := templates.GetCommand("remove_php_runtime")
	payload := template.ToPayload(map[string]string{
		"version": runtime.Version,
	})

	jobID, err := h.createPHPJob(r, *machine.AgentID, machineID, "remove_php_runtime", payload)
	if err != nil {
		http.Error(w, "Failed to create remove job", http.StatusInternalServerError)
		return
	}
	// The runtime row is deleted by jobhooks.OnJobFinished when the job finishes.

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "PHP removal started",
		"job_id":  jobID,
	})
}

// UpdatePHPRuntime updates PHP version or extensions
func (h *PHPRuntimeHandler) UpdatePHPRuntime(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canManageMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req InstallPHPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	req.Extensions = normalizeExtensions(req.Extensions)

	if !isValidPHPVersion(req.Version) {
		http.Error(w, "Invalid PHP version", http.StatusBadRequest)
		return
	}

	// Get current runtime
	var current models.PHPRuntime
	err = h.db.Get(&current, "SELECT * FROM php_runtimes WHERE machine_id = $1", machineID)
	if err == sql.ErrNoRows {
		// No existing runtime, redirect to install
		h.installPHP(w, r, machineID, req)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// Get machine agent
	var machine models.Machine
	err = h.db.Get(&machine, "SELECT id, agent_id FROM machines WHERE id = $1", machineID)
	if err != nil || machine.AgentID == nil {
		http.Error(w, "Machine or agent not found", http.StatusNotFound)
		return
	}

	templateName := "install_php_runtime"
	payloadVars := map[string]string{
		"version":    req.Version,
		"extensions": strings.Join(req.Extensions, ","),
	}

	currentExtensions := normalizeExtensions([]string(current.Extensions))
	if req.Version == current.Version {
		added, removed := diffExtensions(currentExtensions, req.Extensions)
		if len(added) == 0 && len(removed) == 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message": "No PHP extension changes detected",
				"job_id":  "",
			})
			return
		}

		templateName = "sync_php_extensions"
		payloadVars = map[string]string{
			"version":           req.Version,
			"extensions":        strings.Join(added, ","),
			"remove_extensions": strings.Join(removed, ","),
		}
	}

	template := templates.GetCommand(templateName)
	payload := template.ToPayload(payloadVars)

	jobID, err := h.createPHPJob(r, *machine.AgentID, machineID, templateName, payload)
	if err != nil {
		log.Printf("Failed to create PHP update job: %v", err)
		http.Error(w, "Failed to create update job", http.StatusInternalServerError)
		return
	}

	_, err = h.db.Exec(`
		UPDATE php_runtimes 
		SET version = $1, extensions = $2, status = 'installing', error_message = NULL, updated_at = NOW()
		WHERE machine_id = $3
	`, req.Version, pq.Array(req.Extensions), machineID)
	if err != nil {
		log.Printf("Failed to update PHP runtime status: %v", err)
		http.Error(w, "Failed to update PHP runtime", http.StatusInternalServerError)
		return
	}


	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "PHP update started",
		"job_id":  jobID,
	})
}

// GetPHPRuntimeInfo gets detailed info about installed PHP
func (h *PHPRuntimeHandler) GetPHPRuntimeInfo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canAccessMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	// Get machine agent
	var machine models.Machine
	err = h.db.Get(&machine, "SELECT id, agent_id FROM machines WHERE id = $1", machineID)
	if err != nil || machine.AgentID == nil {
		http.Error(w, "Machine or agent not found", http.StatusNotFound)
		return
	}

	// Create info job
	template := templates.GetCommand("get_php_runtime_info")
	payload := template.ToPayload(map[string]string{})

	jobID, err := h.createPHPJob(r, *machine.AgentID, machineID, "get_php_runtime_info", payload)
	if err != nil {
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Getting PHP info",
		"job_id":  jobID,
	})
}

// ListExtensionTemplates returns all PHP extension templates
func (h *PHPRuntimeHandler) ListExtensionTemplates(w http.ResponseWriter, r *http.Request) {
	var templates []models.PHPExtensionTemplate
	err := h.db.Select(&templates, `
		SELECT id, name, description, extensions, is_default, created_at 
		FROM php_extension_templates 
		ORDER BY is_default DESC, name ASC
	`)
	if err != nil {
		log.Printf("Failed to list extension templates: %v", err)
		http.Error(w, "Failed to list templates", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(templates)
}

// ListAvailableExtensions returns all available PHP extensions
func (h *PHPRuntimeHandler) ListAvailableExtensions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"extensions": models.PHPExtensions,
		"versions":   models.PHPVersions,
	})
}


// createPHPJob creates a PHP runtime job linked to the machine's php_runtime entity.
func (h *PHPRuntimeHandler) createPHPJob(r *http.Request, agentID, machineID uuid.UUID, action string, payload json.RawMessage) (uuid.UUID, error) {
	var p struct {
		Vars map[string]string `json:"vars"`
	}
	_ = json.Unmarshal(payload, &p)
	job, err := jobs.Create(r.Context(), h.db, jobs.Spec{
		AgentID:    agentID,
		Payload:    payload,
		Action:     action,
		Title:      jobs.TemplateTitle(action, p.Vars),
		EntityType: jobs.EntityPHPRuntime,
		EntityID:   machineID.String(),
		CreatedBy:  jobs.UserID(r),
	})
	if err != nil {
		return uuid.Nil, err
	}
	return job.ID, nil
}
