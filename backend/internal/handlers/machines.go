package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type MachinesHandler struct {
	db *database.DB
}

func NewMachinesHandler(db *database.DB) *MachinesHandler {
	return &MachinesHandler{db: db}
}

// ListMachines returns all machines with their agent info
func (h *MachinesHandler) ListMachines(w http.ResponseWriter, r *http.Request) {
	var machines []MachineWithAgent
	err := h.db.Select(&machines, `
		SELECT m.*, a.name as agent_name, a.version as agent_version, a.last_seen
		FROM machines m
		LEFT JOIN agents a ON m.agent_id = a.id
		ORDER BY m.created_at DESC
	`)
	if err != nil {
		log.Printf("Failed to list machines: %v", err)
		http.Error(w, "Failed to list machines", http.StatusInternalServerError)
		return
	}

	if machines == nil {
		machines = []MachineWithAgent{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(machines)
}

// MachineWithAgent includes agent info with machine
type MachineWithAgent struct {
	models.Machine
	AgentName    *string    `db:"agent_name" json:"agent_name"`
	AgentVersion *string    `db:"agent_version" json:"agent_version"`
	LastSeen     *time.Time `db:"last_seen" json:"last_seen"`
}

// GetMachine returns a single machine by ID
func (h *MachinesHandler) GetMachine(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var machine MachineWithAgent
	err = h.db.Get(&machine, `
		SELECT m.*, a.name as agent_name, a.version as agent_version, a.last_seen
		FROM machines m
		LEFT JOIN agents a ON m.agent_id = a.id
		WHERE m.id = $1
	`, id)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(machine)
}

// UpdateMachineNotes updates the notes for a machine
func (h *MachinesHandler) UpdateMachineNotes(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Notes string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec("UPDATE machines SET notes_md = $1, updated_at = NOW() WHERE id = $2", req.Notes, id)
	if err != nil {
		log.Printf("Failed to update machine notes: %v", err)
		http.Error(w, "Failed to update machine", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Notes updated"})
}

// DeleteMachine deletes a machine and its associated agent
func (h *MachinesHandler) DeleteMachine(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Get the agent_id first
	var agentID *uuid.UUID
	h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", id)

	// Delete the machine (agent will be cascade deleted)
	_, err = h.db.Exec("DELETE FROM machines WHERE id = $1", id)
	if err != nil {
		log.Printf("Failed to delete machine: %v", err)
		http.Error(w, "Failed to delete machine", http.StatusInternalServerError)
		return
	}

	// Delete the agent if exists
	if agentID != nil {
		h.db.Exec("DELETE FROM agents WHERE id = $1", agentID)
	}

	w.WriteHeader(http.StatusNoContent)
}

type CreateEnrollmentTokenRequest struct {
	Name string `json:"name"`
}

// CreateEnrollmentToken creates a new enrollment token
func (h *MachinesHandler) CreateEnrollmentToken(w http.ResponseWriter, r *http.Request) {
	var req CreateEnrollmentTokenRequest
	json.NewDecoder(r.Body).Decode(&req)

	// Generate random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Printf("Failed to generate token: %v", err)
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}
	token := base64.URLEncoding.EncodeToString(tokenBytes)

	// Token expires in 24 hours
	expiresAt := time.Now().Add(24 * time.Hour)

	var name *string
	if req.Name != "" {
		name = &req.Name
	}

	var enrollmentToken models.EnrollmentToken
	err := h.db.Get(&enrollmentToken, `
		INSERT INTO enrollment_tokens (name, token, expires_at)
		VALUES ($1, $2, $3)
		RETURNING id, name, token, expires_at, created_at
	`, name, token, expiresAt)
	if err != nil {
		log.Printf("Failed to create enrollment token: %v", err)
		http.Error(w, "Failed to create enrollment token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(enrollmentToken)
}

// ListEnrollmentTokens returns all active enrollment tokens
func (h *MachinesHandler) ListEnrollmentTokens(w http.ResponseWriter, r *http.Request) {
	var tokens []models.EnrollmentToken
	err := h.db.Select(&tokens, `
		SELECT id, name, expires_at, used_at, created_at
		FROM enrollment_tokens
		WHERE expires_at > NOW()
		ORDER BY created_at DESC
	`)
	if err != nil {
		log.Printf("Failed to list enrollment tokens: %v", err)
		http.Error(w, "Failed to list enrollment tokens", http.StatusInternalServerError)
		return
	}

	if tokens == nil {
		tokens = []models.EnrollmentToken{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tokens)
}

// DeleteEnrollmentToken deletes an enrollment token
func (h *MachinesHandler) DeleteEnrollmentToken(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid token ID", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec("DELETE FROM enrollment_tokens WHERE id = $1", id)
	if err != nil {
		log.Printf("Failed to delete enrollment token: %v", err)
		http.Error(w, "Failed to delete enrollment token", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// executeTemplate is a helper to create a job from a template
func (h *MachinesHandler) executeTemplate(w http.ResponseWriter, machineID uuid.UUID, templateID string, vars map[string]string) {
	// Get command template
	cmd := templates.GetCommand(templateID)
	if cmd == nil {
		http.Error(w, "Template not found: "+templateID, http.StatusInternalServerError)
		return
	}

	// Get agent_id for this machine
	var agentID uuid.UUID
	err := h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1 AND agent_id IS NOT NULL", machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}

	// Create job with run type using template
	payload := cmd.ToPayload(vars)

	var job models.Job
	err = h.db.Get(&job, `
		INSERT INTO jobs (agent_id, type, payload_json, status)
		VALUES ($1, 'run', $2, 'pending')
		RETURNING *
	`, agentID, payload)
	if err != nil {
		log.Printf("Failed to create job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

// ChangeSSHPort creates a job to change the SSH port
func (h *MachinesHandler) ChangeSSHPort(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Port int `json:"port"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Port < 1024 || req.Port > 65535 {
		http.Error(w, "Port must be between 1024 and 65535", http.StatusBadRequest)
		return
	}

	h.executeTemplate(w, machineID, "change_ssh_port", map[string]string{
		"port": fmt.Sprintf("%d", req.Port),
	})
}

// ChangeRootPassword creates a job to change the root password
func (h *MachinesHandler) ChangeRootPassword(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	// Mark password as set
	h.db.Exec("UPDATE machines SET root_password_set = true WHERE id = $1", machineID)

	h.executeTemplate(w, machineID, "change_root_password", map[string]string{
		"password": req.Password,
	})
}

// ToggleUFW creates a job to enable/disable UFW
func (h *MachinesHandler) ToggleUFW(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	h.executeTemplate(w, machineID, "toggle_ufw", map[string]string{
		"enabled": fmt.Sprintf("%t", req.Enabled),
	})
}

// ToggleFail2ban creates a job to enable/disable fail2ban
func (h *MachinesHandler) ToggleFail2ban(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Enabled bool   `json:"enabled"`
		Config  string `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Use default config if not provided
	config := req.Config
	if config == "" {
		config = models.DefaultFail2banConfig
	}

	// Store config in machine
	h.db.Exec("UPDATE machines SET fail2ban_config = $1 WHERE id = $2", config, machineID)

	h.executeTemplate(w, machineID, "toggle_fail2ban", map[string]string{
		"enabled": fmt.Sprintf("%t", req.Enabled),
		"config":  config,
	})
}

// AddUFWRule creates a job to add a UFW rule
func (h *MachinesHandler) AddUFWRule(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Port     string `json:"port"`
		Protocol string `json:"protocol"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	protocol := req.Protocol
	if protocol == "" {
		protocol = "tcp"
	}

	h.executeTemplate(w, machineID, "ufw_allow_port", map[string]string{
		"port":     req.Port,
		"protocol": protocol,
	})
}

// RemoveUFWRule creates a job to remove a UFW rule
func (h *MachinesHandler) RemoveUFWRule(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Port     string `json:"port"`
		Protocol string `json:"protocol"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	protocol := req.Protocol
	if protocol == "" {
		protocol = "tcp"
	}

	h.executeTemplate(w, machineID, "ufw_delete_port", map[string]string{
		"port":     req.Port,
		"protocol": protocol,
	})
}

// GetMachineLogs creates a job to fetch logs and returns them
func (h *MachinesHandler) GetMachineLogs(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	logType := r.URL.Query().Get("type")
	if logType == "" {
		logType = "syslog"
	}

	lines := r.URL.Query().Get("lines")
	if lines == "" {
		lines = "100"
	}

	// Get agent_id for this machine
	var agentID uuid.UUID
	err = h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1 AND agent_id IS NOT NULL", machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}

	// Map log types to file paths
	logPaths := map[string]string{
		"nginx_access": "/var/log/nginx/access.log",
		"nginx_error":  "/var/log/nginx/error.log",
		"syslog":       "/var/log/syslog",
		"auth":         "/var/log/auth.log",
		"fail2ban":     "/var/log/fail2ban.log",
	}

	logPath, ok := logPaths[logType]
	if !ok {
		http.Error(w, "Invalid log type", http.StatusBadRequest)
		return
	}

	// Create a synchronous job to get logs
	command := fmt.Sprintf("tail -n %s %s 2>/dev/null || echo 'Log file not found or empty'", lines, logPath)

	payload, _ := json.Marshal(map[string]interface{}{
		"steps": []map[string]interface{}{
			{"action": "exec", "command": command, "timeout": 30},
		},
		"on_error": "stop",
	})

	var job models.Job
	err = h.db.Get(&job, `
		INSERT INTO jobs (agent_id, type, payload_json, status)
		VALUES ($1, 'run', $2, 'pending')
		RETURNING *
	`, agentID, payload)
	if err != nil {
		log.Printf("Failed to create job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	// Wait for job to complete (poll for up to 30 seconds)
	for i := 0; i < 60; i++ {
		time.Sleep(500 * time.Millisecond)
		err = h.db.Get(&job, "SELECT * FROM jobs WHERE id = $1", job.ID)
		if err != nil {
			break
		}
		if job.Status == "completed" || job.Status == "failed" {
			break
		}
	}

	logs := ""
	if job.Logs != nil {
		logs = *job.Logs
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"logs": logs})
}

// ExecTerminalCommand creates a job to execute a terminal command
func (h *MachinesHandler) ExecTerminalCommand(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	machineID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Command == "" {
		http.Error(w, "Command is required", http.StatusBadRequest)
		return
	}

	// Get agent_id for this machine
	var agentID uuid.UUID
	err = h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1 AND agent_id IS NOT NULL", machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}

	// Create job
	payload, _ := json.Marshal(map[string]interface{}{
		"steps": []map[string]interface{}{
			{"action": "exec", "command": req.Command, "timeout": 60},
		},
		"on_error": "stop",
	})

	var job models.Job
	err = h.db.Get(&job, `
		INSERT INTO jobs (agent_id, type, payload_json, status)
		VALUES ($1, 'run', $2, 'pending')
		RETURNING *
	`, agentID, payload)
	if err != nil {
		log.Printf("Failed to create job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	// Wait for job to complete (poll for up to 60 seconds)
	for i := 0; i < 120; i++ {
		time.Sleep(500 * time.Millisecond)
		err = h.db.Get(&job, "SELECT * FROM jobs WHERE id = $1", job.ID)
		if err != nil {
			break
		}
		if job.Status == "completed" || job.Status == "failed" {
			break
		}
	}

	output := ""
	exitCode := 0
	if job.Logs != nil {
		output = *job.Logs
	}
	if job.Status == "failed" {
		exitCode = 1
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"output":    output,
		"exit_code": exitCode,
	})
}

