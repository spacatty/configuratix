package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"configuratix/backend/internal/database"
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

// InstallPHPRuntime installs PHP on a machine
func (h *PHPRuntimeHandler) InstallPHPRuntime(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req InstallPHPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate version
	validVersion := false
	for _, v := range models.PHPVersions {
		if v == req.Version {
			validVersion = true
			break
		}
	}
	if !validVersion {
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

	// Create install job
	extensionsStr := ""
	for i, ext := range req.Extensions {
		if i > 0 {
			extensionsStr += ","
		}
		extensionsStr += ext
	}

	template := templates.GetCommand("install_php_runtime")
	payload := template.ToPayload(map[string]string{
		"version":    req.Version,
		"extensions": extensionsStr,
	})

	jobID := uuid.New()
	_, err = h.db.Exec(`
		INSERT INTO jobs (id, agent_id, type, payload_json, status)
		VALUES ($1, $2, 'run', $3, 'pending')
	`, jobID, machine.AgentID, payload)
	if err != nil {
		log.Printf("Failed to create install job: %v", err)
		http.Error(w, "Failed to create install job", http.StatusInternalServerError)
		return
	}

	// Start goroutine to update runtime status when job completes
	go h.watchJobCompletion(jobID, machineID, req.Version)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "PHP installation started",
		"job_id":  jobID,
		"version": req.Version,
	})
}

// watchJobCompletion monitors job status and updates runtime accordingly
func (h *PHPRuntimeHandler) watchJobCompletion(jobID, machineID uuid.UUID, version string) {
	timeout := time.After(15 * time.Minute)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			h.db.Exec(`
				UPDATE php_runtimes 
				SET status = 'failed', error_message = 'Installation timed out', updated_at = NOW()
				WHERE machine_id = $1
			`, machineID)
			return
		case <-ticker.C:
			var status string
			var logs sql.NullString
			err := h.db.QueryRow(`
				SELECT status, logs FROM jobs WHERE id = $1
			`, jobID).Scan(&status, &logs)
			if err != nil {
				continue
			}

			switch status {
			case "completed":
				socketPath := models.GetPHPSocketPath(version)
				h.db.Exec(`
					UPDATE php_runtimes 
					SET status = 'installed', socket_path = $1, installed_at = NOW(), updated_at = NOW()
					WHERE machine_id = $2
				`, socketPath, machineID)
				return
			case "failed":
				errorMsg := "Installation failed"
				if logs.Valid {
					errorMsg = logs.String
					if len(errorMsg) > 1000 {
						errorMsg = errorMsg[len(errorMsg)-1000:]
					}
				}
				h.db.Exec(`
					UPDATE php_runtimes 
					SET status = 'failed', error_message = $1, updated_at = NOW()
					WHERE machine_id = $2
				`, errorMsg, machineID)
				return
			}
		}
	}
}

// RemovePHPRuntime removes PHP from a machine
func (h *PHPRuntimeHandler) RemovePHPRuntime(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
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

	jobID := uuid.New()
	_, err = h.db.Exec(`
		INSERT INTO jobs (id, agent_id, type, payload_json, status)
		VALUES ($1, $2, 'run', $3, 'pending')
	`, jobID, machine.AgentID, payload)
	if err != nil {
		http.Error(w, "Failed to create remove job", http.StatusInternalServerError)
		return
	}

	// Watch for completion and delete record
	go func() {
		timeout := time.After(10 * time.Minute)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-timeout:
				return
			case <-ticker.C:
				var status string
				h.db.QueryRow("SELECT status FROM jobs WHERE id = $1", jobID).Scan(&status)
				if status == "completed" || status == "failed" {
					h.db.Exec("DELETE FROM php_runtimes WHERE machine_id = $1", machineID)
					return
				}
			}
		}
	}()

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

	var req InstallPHPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get current runtime
	var current models.PHPRuntime
	err = h.db.Get(&current, "SELECT * FROM php_runtimes WHERE machine_id = $1", machineID)
	if err == sql.ErrNoRows {
		// No existing runtime, redirect to install
		h.InstallPHPRuntime(w, r)
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

	// If version changed, need to reinstall
	if req.Version != current.Version {
		// Remove old version first
		removeTemplate := templates.GetCommand("remove_php_runtime")
		removePayload := removeTemplate.ToPayload(map[string]string{
			"version": current.Version,
		})

		removeJobID := uuid.New()
		h.db.Exec(`
			INSERT INTO jobs (id, agent_id, type, payload_json, status)
			VALUES ($1, $2, 'run', $3, 'pending')
		`, removeJobID, machine.AgentID, removePayload)
	}

	// Update status and install new version
	h.db.Exec(`
		UPDATE php_runtimes 
		SET version = $1, extensions = $2, status = 'installing', updated_at = NOW()
		WHERE machine_id = $3
	`, req.Version, pq.Array(req.Extensions), machineID)

	// Create install job
	extensionsStr := ""
	for i, ext := range req.Extensions {
		if i > 0 {
			extensionsStr += ","
		}
		extensionsStr += ext
	}

	template := templates.GetCommand("install_php_runtime")
	payload := template.ToPayload(map[string]string{
		"version":    req.Version,
		"extensions": extensionsStr,
	})

	jobID := uuid.New()
	h.db.Exec(`
		INSERT INTO jobs (id, agent_id, type, payload_json, status)
		VALUES ($1, $2, 'run', $3, 'pending')
	`, jobID, machine.AgentID, payload)

	go h.watchJobCompletion(jobID, machineID, req.Version)

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

	jobID := uuid.New()
	_, err = h.db.Exec(`
		INSERT INTO jobs (id, agent_id, type, payload_json, status)
		VALUES ($1, $2, 'run', $3, 'pending')
	`, jobID, machine.AgentID, payload)
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

