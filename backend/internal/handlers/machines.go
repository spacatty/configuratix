package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"configuratix/backend/internal/auth"
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

// MachineWithDetails includes agent and owner info with machine
// Note: Explicitly list all fields instead of embedding to avoid sqlx scanning issues
type MachineWithDetails struct {
	// Machine fields
	ID              uuid.UUID       `db:"id" json:"id"`
	AgentID         *uuid.UUID      `db:"agent_id" json:"agent_id"`
	OwnerID         *uuid.UUID      `db:"owner_id" json:"owner_id"`
	ProjectID       *uuid.UUID      `db:"project_id" json:"project_id"`
	Title           *string         `db:"title" json:"title"`
	Hostname        *string         `db:"hostname" json:"hostname"`
	IPAddress       *string         `db:"ip_address" json:"ip_address"`
	DetectedIPs     json.RawMessage `db:"detected_ips" json:"detected_ips"`
	PrimaryIP       *string         `db:"primary_ip" json:"primary_ip"`
	UbuntuVersion   *string         `db:"ubuntu_version" json:"ubuntu_version"`
	NotesMD         *string    `db:"notes_md" json:"notes_md"`
	CreatedAt       time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at" json:"updated_at"`
	AccessTokenHash *string         `db:"access_token_hash" json:"-"` // Hidden from API
	AccessTokenSet  bool            `db:"access_token_set" json:"access_token_set"`
	SSHPort         int             `db:"ssh_port" json:"ssh_port"`
	UFWEnabled      bool            `db:"ufw_enabled" json:"ufw_enabled"`
	UFWRulesJSON    json.RawMessage `db:"ufw_rules_json" json:"ufw_rules"`
	Fail2banEnabled bool            `db:"fail2ban_enabled" json:"fail2ban_enabled"`
	Fail2banConfig  *string         `db:"fail2ban_config" json:"fail2ban_config"`
	RootPasswordSet bool            `db:"root_password_set" json:"root_password_set"`
	PHPInstalled    bool       `db:"php_installed" json:"php_installed"`
	PHPVersion      *string    `db:"php_version" json:"php_version"`
	CPUPercent      float64    `db:"cpu_percent" json:"cpu_percent"`
	MemoryUsed      int64      `db:"memory_used" json:"memory_used"`
	MemoryTotal     int64      `db:"memory_total" json:"memory_total"`
	DiskUsed        int64      `db:"disk_used" json:"disk_used"`
	DiskTotal       int64      `db:"disk_total" json:"disk_total"`
	// Join fields
	AgentName    *string    `db:"agent_name" json:"agent_name"`
	AgentVersion *string    `db:"agent_version" json:"agent_version"`
	LastSeen     *time.Time `db:"last_seen" json:"last_seen"`
	OwnerEmail   *string    `db:"owner_email" json:"owner_email"`
	OwnerName    *string    `db:"owner_name" json:"owner_name"`
	ProjectName  *string    `db:"project_name" json:"project_name"`
}

// ListMachines returns machines the user can access
func (h *MachinesHandler) ListMachines(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	// Get optional filters
	search := r.URL.Query().Get("search")
	projectID := r.URL.Query().Get("project_id")

	var machines []MachineWithDetails
	var err error

	baseQuery := `
		SELECT m.*, 
			a.name as agent_name, 
			a.version as agent_version, 
			a.last_seen,
			u.email as owner_email,
			COALESCE(u.name, u.email) as owner_name,
			p.name as project_name
		FROM machines m
		LEFT JOIN agents a ON m.agent_id = a.id
		LEFT JOIN users u ON m.owner_id = u.id
		LEFT JOIN projects p ON m.project_id = p.id
	`

	// Superadmin sees all machines
	if claims.IsSuperAdmin() {
		whereClause := "WHERE 1=1"
		args := []interface{}{}
		argNum := 1

		if search != "" {
			whereClause += fmt.Sprintf(` AND (
				m.title ILIKE $%d OR 
				m.hostname ILIKE $%d OR 
				m.ip_address ILIKE $%d
			)`, argNum, argNum, argNum)
			args = append(args, "%"+search+"%")
			argNum++
		}

		if projectID != "" {
			pid, _ := uuid.Parse(projectID)
			whereClause += fmt.Sprintf(" AND m.project_id = $%d", argNum)
			args = append(args, pid)
			argNum++
		}

		err = h.db.Select(&machines, baseQuery+whereClause+" ORDER BY m.created_at DESC", args...)
	} else {
		// Regular users see their own machines and machines in projects they have access to
		whereClause := `WHERE (
			m.owner_id = $1 
			OR m.project_id IN (
				SELECT id FROM projects WHERE owner_id = $1
				UNION
				SELECT project_id FROM project_members WHERE user_id = $1 AND status = 'approved'
			)
		)`
		args := []interface{}{userID}
		argNum := 2

		if search != "" {
			whereClause += fmt.Sprintf(` AND (
				m.title ILIKE $%d OR 
				m.hostname ILIKE $%d OR 
				m.ip_address ILIKE $%d
			)`, argNum, argNum, argNum)
			args = append(args, "%"+search+"%")
			argNum++
		}

		if projectID != "" {
			pid, _ := uuid.Parse(projectID)
			whereClause += fmt.Sprintf(" AND m.project_id = $%d", argNum)
			args = append(args, pid)
			argNum++
		}

		err = h.db.Select(&machines, baseQuery+whereClause+" ORDER BY m.created_at DESC", args...)
	}

	if err != nil {
		log.Printf("Failed to list machines: %v", err)
		http.Error(w, "Failed to list machines", http.StatusInternalServerError)
		return
	}

	if machines == nil {
		machines = []MachineWithDetails{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(machines)
}

// GetMachine returns a single machine by ID
func (h *MachinesHandler) GetMachine(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Check access (machine token verification happens elsewhere if needed)
	if !h.canAccessMachine(userID, machineID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var machine MachineWithDetails
	err = h.db.Get(&machine, `
		SELECT m.*, 
			a.name as agent_name, 
			a.version as agent_version, 
			a.last_seen,
			u.email as owner_email,
			COALESCE(u.name, u.email) as owner_name,
			p.name as project_name
		FROM machines m
		LEFT JOIN agents a ON m.agent_id = a.id
		LEFT JOIN users u ON m.owner_id = u.id
		LEFT JOIN projects p ON m.project_id = p.id
		WHERE m.id = $1
	`, machineID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(machine)
}

// UpdateMachine updates machine settings (title, project, notes)
func (h *MachinesHandler) UpdateMachine(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	if !h.canManageMachine(userID, machineID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req struct {
		Title     *string    `json:"title"`
		ProjectID *uuid.UUID `json:"project_id"`
		NotesMD   *string    `json:"notes_md"`
		PrimaryIP *string    `json:"primary_ip"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// If linking to a project, verify user can manage that project
	if req.ProjectID != nil {
		if !h.canLinkToProject(userID, *req.ProjectID, claims.IsSuperAdmin()) {
			http.Error(w, "Cannot link to this project", http.StatusForbidden)
			return
		}
	}

	_, err = h.db.Exec(`
		UPDATE machines SET 
			title = COALESCE($1, title),
			project_id = $2,
			notes_md = COALESCE($3, notes_md),
			primary_ip = COALESCE($4, primary_ip),
			updated_at = NOW()
		WHERE id = $5
	`, req.Title, req.ProjectID, req.NotesMD, req.PrimaryIP, machineID)
	if err != nil {
		http.Error(w, "Failed to update machine", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Machine updated"})
}

// UpdateMachineNotes updates just the notes for a machine
func (h *MachinesHandler) UpdateMachineNotes(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Check if user can edit notes (owner, project owner/manager, or member with notes permission)
	if !h.canEditMachineNotes(userID, machineID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req struct {
		Notes string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec("UPDATE machines SET notes_md = $1, updated_at = NOW() WHERE id = $2", req.Notes, machineID)
	if err != nil {
		log.Printf("Failed to update machine notes: %v", err)
		http.Error(w, "Failed to update machine", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Notes updated"})
}

// SetAccessToken sets a machine access token
func (h *MachinesHandler) SetAccessToken(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Only owner can set token
	if !h.isMachineOwner(userID, machineID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only owner can set access token", http.StatusForbidden)
		return
	}

	var req struct {
		CurrentToken string `json:"current_token"`
		NewToken     string `json:"new_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.NewToken == "" || len(req.NewToken) < 8 {
		http.Error(w, "Token must be at least 8 characters", http.StatusBadRequest)
		return
	}

	// Check current token if one is set
	var machine models.Machine
	err = h.db.Get(&machine, "SELECT * FROM machines WHERE id = $1", machineID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	if machine.AccessTokenSet && machine.AccessTokenHash != nil {
		// Verify current token
		if !auth.CheckPassword(req.CurrentToken, *machine.AccessTokenHash) {
			http.Error(w, "Current token is incorrect", http.StatusUnauthorized)
			return
		}
	}

	// Hash new token
	newHash, err := auth.HashPassword(req.NewToken)
	if err != nil {
		http.Error(w, "Failed to set token", http.StatusInternalServerError)
		return
	}

	_, err = h.db.Exec(`
		UPDATE machines SET access_token_hash = $1, access_token_set = true, updated_at = NOW()
		WHERE id = $2
	`, newHash, machineID)
	if err != nil {
		http.Error(w, "Failed to set token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Access token set"})
}

// VerifyAccessToken verifies machine access token
func (h *MachinesHandler) VerifyAccessToken(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var machine models.Machine
	err = h.db.Get(&machine, "SELECT * FROM machines WHERE id = $1", machineID)
	if err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}

	if !machine.AccessTokenSet || machine.AccessTokenHash == nil {
		// No token required
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"valid": true})
		return
	}

	valid := auth.CheckPassword(req.Token, *machine.AccessTokenHash)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"valid": valid})
}

// DeleteMachine deletes a machine and its associated agent
func (h *MachinesHandler) DeleteMachine(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Only owner or superadmin can delete
	if !h.isMachineOwner(userID, machineID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only owner can delete machine", http.StatusForbidden)
		return
	}

	// Get the agent_id first
	var agentID *uuid.UUID
	h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID)

	// Delete the machine
	_, err = h.db.Exec("DELETE FROM machines WHERE id = $1", machineID)
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

// ============================================
// Enrollment Tokens
// ============================================

type CreateEnrollmentTokenRequest struct {
	Name string `json:"name"`
}

// CreateEnrollmentToken creates a new enrollment token
func (h *MachinesHandler) CreateEnrollmentToken(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

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
		INSERT INTO enrollment_tokens (name, token, expires_at, owner_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, token, expires_at, created_at
	`, name, token, expiresAt, userID)
	if err != nil {
		log.Printf("Failed to create enrollment token: %v", err)
		http.Error(w, "Failed to create enrollment token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(enrollmentToken)
}

// ListEnrollmentTokens returns active enrollment tokens for the user
func (h *MachinesHandler) ListEnrollmentTokens(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var tokens []models.EnrollmentToken
	var err error

	if claims.IsSuperAdmin() {
		err = h.db.Select(&tokens, `
			SELECT id, name, expires_at, used_at, created_at, owner_id
			FROM enrollment_tokens
			WHERE expires_at > NOW()
			ORDER BY created_at DESC
		`)
	} else {
		err = h.db.Select(&tokens, `
			SELECT id, name, expires_at, used_at, created_at, owner_id
			FROM enrollment_tokens
			WHERE expires_at > NOW() AND owner_id = $1
			ORDER BY created_at DESC
		`, userID)
	}

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
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	tokenID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid token ID", http.StatusBadRequest)
		return
	}

	// Check ownership (superadmin can delete any)
	var ownerID uuid.UUID
	err = h.db.Get(&ownerID, "SELECT owner_id FROM enrollment_tokens WHERE id = $1", tokenID)
	if err != nil {
		http.Error(w, "Token not found", http.StatusNotFound)
		return
	}

	if ownerID != userID && !claims.IsSuperAdmin() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	_, err = h.db.Exec("DELETE FROM enrollment_tokens WHERE id = $1", tokenID)
	if err != nil {
		log.Printf("Failed to delete enrollment token: %v", err)
		http.Error(w, "Failed to delete enrollment token", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============================================
// Machine Commands (SSH, UFW, Fail2ban, etc.)
// ============================================

// executeTemplate is a helper to create a job from a template
func (h *MachinesHandler) executeTemplate(w http.ResponseWriter, claims *auth.Claims, machineID uuid.UUID, templateID string, vars map[string]string) {
	userID, _ := uuid.Parse(claims.UserID)

	// Check machine access
	if !h.canManageMachine(userID, machineID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

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
	claims := r.Context().Value("claims").(*auth.Claims)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
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

	h.executeTemplate(w, claims, machineID, "change_ssh_port", map[string]string{
		"port": fmt.Sprintf("%d", req.Port),
	})
}

// ChangeRootPassword creates a job to change the root password
func (h *MachinesHandler) ChangeRootPassword(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
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

	h.executeTemplate(w, claims, machineID, "change_root_password", map[string]string{
		"password": req.Password,
	})
}

// ToggleUFW creates a job to enable/disable UFW
func (h *MachinesHandler) ToggleUFW(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
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

	h.executeTemplate(w, claims, machineID, "toggle_ufw", map[string]string{
		"enabled": fmt.Sprintf("%t", req.Enabled),
	})
}

// ToggleFail2ban creates a job to enable/disable fail2ban
func (h *MachinesHandler) ToggleFail2ban(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
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

	h.executeTemplate(w, claims, machineID, "toggle_fail2ban", map[string]string{
		"enabled": fmt.Sprintf("%t", req.Enabled),
		"config":  config,
	})
}

// AddUFWRule creates a job to add a UFW rule
func (h *MachinesHandler) AddUFWRule(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
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

	h.executeTemplate(w, claims, machineID, "ufw_allow_port", map[string]string{
		"port":     req.Port,
		"protocol": protocol,
	})
}

// RemoveUFWRule creates a job to remove a UFW rule
func (h *MachinesHandler) RemoveUFWRule(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
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

	h.executeTemplate(w, claims, machineID, "ufw_delete_port", map[string]string{
		"port":     req.Port,
		"protocol": protocol,
	})
}

// GetMachineLogs creates a job to fetch logs
func (h *MachinesHandler) GetMachineLogs(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	if !h.canAccessMachine(userID, machineID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
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
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	if !h.canManageMachine(userID, machineID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
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

	// Basic command sanitization - block dangerous patterns
	dangerous := []string{"rm -rf /", "mkfs", "dd if=", ":(){:|:&};:"}
	for _, d := range dangerous {
		if strings.Contains(req.Command, d) {
			http.Error(w, "Command blocked for safety", http.StatusForbidden)
			return
		}
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

	// Wait for job to complete
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

// ============================================
// Speed Test / Tools Handlers
// ============================================

// SpeedTestRequest represents a speed test request
type SpeedTestRequest struct {
	Type       string `json:"type"`       // public, download, upload, iperf, latency, network_info
	URL        string `json:"url"`        // For download/upload tests
	TargetIP   string `json:"target_ip"`  // For machine-to-machine or iperf tests
	Port       int    `json:"port"`       // Port for iperf/m2m tests
	SizeMB     int    `json:"size_mb"`    // Size for upload tests
	Duration   int    `json:"duration"`   // Duration for iperf tests
	Reverse    bool   `json:"reverse"`    // Reverse mode for iperf
	Count      int    `json:"count"`      // Ping count for latency tests
}

// RunSpeedTest runs a speed test on a machine
func (h *MachinesHandler) RunSpeedTest(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var req SpeedTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Map test type to template and variables
	var templateID string
	vars := make(map[string]string)

	switch req.Type {
	case "public":
		templateID = "speedtest_public"

	case "download":
		if req.URL == "" {
			// Default to a common test file
			req.URL = "https://speed.hetzner.de/100MB.bin"
		}
		templateID = "speedtest_download"
		vars["url"] = req.URL
		vars["size_mb"] = "100"
		if req.SizeMB > 0 {
			vars["size_mb"] = fmt.Sprintf("%d", req.SizeMB)
		}

	case "upload":
		if req.URL == "" {
			req.URL = "https://temp.sh/upload"
		}
		templateID = "speedtest_upload"
		vars["url"] = req.URL
		vars["size_mb"] = "10"
		if req.SizeMB > 0 {
			vars["size_mb"] = fmt.Sprintf("%d", req.SizeMB)
		}

	case "iperf_server":
		templateID = "speedtest_iperf_server"
		vars["port"] = "5201"
		if req.Port > 0 {
			vars["port"] = fmt.Sprintf("%d", req.Port)
		}
		vars["duration"] = "60"
		if req.Duration > 0 {
			vars["duration"] = fmt.Sprintf("%d", req.Duration)
		}

	case "iperf_client":
		if req.TargetIP == "" {
			http.Error(w, "target_ip is required for iperf client", http.StatusBadRequest)
			return
		}
		templateID = "speedtest_iperf_client"
		vars["server_ip"] = req.TargetIP
		vars["port"] = "5201"
		if req.Port > 0 {
			vars["port"] = fmt.Sprintf("%d", req.Port)
		}
		vars["duration"] = "10"
		if req.Duration > 0 {
			vars["duration"] = fmt.Sprintf("%d", req.Duration)
		}
		vars["reverse"] = "false"
		if req.Reverse {
			vars["reverse"] = "true"
		}

	case "latency":
		if req.TargetIP == "" {
			http.Error(w, "target_ip is required for latency test", http.StatusBadRequest)
			return
		}
		templateID = "speedtest_latency"
		vars["host"] = req.TargetIP
		vars["count"] = "10"
		if req.Count > 0 {
			vars["count"] = fmt.Sprintf("%d", req.Count)
		}

	case "network_info":
		templateID = "network_info"

	case "machine_download":
		if req.TargetIP == "" {
			http.Error(w, "target_ip is required for machine download test", http.StatusBadRequest)
			return
		}
		templateID = "speedtest_machine_download"
		vars["source_ip"] = req.TargetIP
		vars["port"] = "8765"
		if req.Port > 0 {
			vars["port"] = fmt.Sprintf("%d", req.Port)
		}
		vars["size_mb"] = "100"
		if req.SizeMB > 0 {
			vars["size_mb"] = fmt.Sprintf("%d", req.SizeMB)
		}

	case "serve":
		templateID = "speedtest_serve"
		vars["port"] = "8765"
		if req.Port > 0 {
			vars["port"] = fmt.Sprintf("%d", req.Port)
		}
		vars["size_mb"] = "100"
		if req.SizeMB > 0 {
			vars["size_mb"] = fmt.Sprintf("%d", req.SizeMB)
		}
		vars["duration"] = "60"
		if req.Duration > 0 {
			vars["duration"] = fmt.Sprintf("%d", req.Duration)
		}

	default:
		http.Error(w, "Invalid test type. Valid types: public, download, upload, iperf_server, iperf_client, latency, network_info, machine_download, serve", http.StatusBadRequest)
		return
	}

	h.executeTemplate(w, claims, machineID, templateID, vars)
}

// RunSpeedTestAndWait runs a speed test and waits for the result
func (h *MachinesHandler) RunSpeedTestAndWait(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	if !h.canAccessMachine(userID, machineID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req SpeedTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Map test type to template and variables
	var templateID string
	vars := make(map[string]string)

	switch req.Type {
	case "public":
		templateID = "speedtest_public"

	case "download":
		if req.URL == "" {
			req.URL = "https://speed.hetzner.de/100MB.bin"
		}
		templateID = "speedtest_download"
		vars["url"] = req.URL
		vars["size_mb"] = "100"
		if req.SizeMB > 0 {
			vars["size_mb"] = fmt.Sprintf("%d", req.SizeMB)
		}

	case "upload":
		if req.URL == "" {
			req.URL = "https://temp.sh/upload"
		}
		templateID = "speedtest_upload"
		vars["url"] = req.URL
		vars["size_mb"] = "10"
		if req.SizeMB > 0 {
			vars["size_mb"] = fmt.Sprintf("%d", req.SizeMB)
		}

	case "iperf_client":
		if req.TargetIP == "" {
			http.Error(w, "target_ip is required for iperf client", http.StatusBadRequest)
			return
		}
		templateID = "speedtest_iperf_client"
		vars["server_ip"] = req.TargetIP
		vars["port"] = "5201"
		if req.Port > 0 {
			vars["port"] = fmt.Sprintf("%d", req.Port)
		}
		vars["duration"] = "10"
		if req.Duration > 0 {
			vars["duration"] = fmt.Sprintf("%d", req.Duration)
		}
		vars["reverse"] = "false"
		if req.Reverse {
			vars["reverse"] = "true"
		}

	case "latency":
		if req.TargetIP == "" {
			http.Error(w, "target_ip is required for latency test", http.StatusBadRequest)
			return
		}
		templateID = "speedtest_latency"
		vars["host"] = req.TargetIP
		vars["count"] = "10"
		if req.Count > 0 {
			vars["count"] = fmt.Sprintf("%d", req.Count)
		}

	case "network_info":
		templateID = "network_info"

	case "iperf_server":
		templateID = "speedtest_iperf_server"
		vars["port"] = "5201"
		if req.Port > 0 {
			vars["port"] = fmt.Sprintf("%d", req.Port)
		}
		vars["duration"] = "60"
		if req.Duration > 0 {
			vars["duration"] = fmt.Sprintf("%d", req.Duration)
		}

	case "machine_download":
		if req.TargetIP == "" {
			http.Error(w, "target_ip is required for machine download test", http.StatusBadRequest)
			return
		}
		templateID = "speedtest_machine_download"
		vars["source_ip"] = req.TargetIP
		vars["port"] = "8765"
		if req.Port > 0 {
			vars["port"] = fmt.Sprintf("%d", req.Port)
		}
		vars["size_mb"] = "100"
		if req.SizeMB > 0 {
			vars["size_mb"] = fmt.Sprintf("%d", req.SizeMB)
		}

	case "serve":
		templateID = "speedtest_serve"
		vars["port"] = "8765"
		if req.Port > 0 {
			vars["port"] = fmt.Sprintf("%d", req.Port)
		}
		vars["size_mb"] = "100"
		if req.SizeMB > 0 {
			vars["size_mb"] = fmt.Sprintf("%d", req.SizeMB)
		}
		vars["duration"] = "60"
		if req.Duration > 0 {
			vars["duration"] = fmt.Sprintf("%d", req.Duration)
		}

	default:
		http.Error(w, "Invalid test type for sync execution", http.StatusBadRequest)
		return
	}

	// Get command template
	cmd := templates.GetCommand(templateID)
	if cmd == nil {
		http.Error(w, "Template not found: "+templateID, http.StatusInternalServerError)
		return
	}

	// Get agent_id for this machine
	var agentID uuid.UUID
	err = h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1 AND agent_id IS NOT NULL", machineID)
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

	// Wait for job to complete (poll for up to 2 minutes)
	maxWait := 240 // 120 seconds
	for i := 0; i < maxWait; i++ {
		time.Sleep(500 * time.Millisecond)
		err = h.db.Get(&job, "SELECT * FROM jobs WHERE id = $1", job.ID)
		if err != nil {
			break
		}
		if job.Status == "completed" || job.Status == "failed" {
			break
		}
	}

	result := map[string]interface{}{
		"job_id":   job.ID,
		"status":   job.Status,
		"type":     req.Type,
		"logs":     "",
		"finished": job.FinishedAt != nil,
	}

	if job.Logs != nil {
		result["logs"] = *job.Logs
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// GetMachineForSpeedTest returns minimal machine info for speed test selection
func (h *MachinesHandler) GetMachinesForSpeedTest(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	type MinimalMachine struct {
		ID        uuid.UUID `db:"id" json:"id"`
		Title     *string   `db:"title" json:"title"`
		Hostname  *string   `db:"hostname" json:"hostname"`
		IPAddress *string   `db:"ip_address" json:"ip_address"`
		IsOnline  bool      `db:"is_online" json:"is_online"`
	}

	var machines []MinimalMachine
	var err error

	query := `
		SELECT m.id, m.title, m.hostname, COALESCE(m.primary_ip, m.ip_address) as ip_address,
			(a.last_seen IS NOT NULL AND a.last_seen > NOW() - INTERVAL '5 minutes') as is_online
		FROM machines m
		LEFT JOIN agents a ON m.agent_id = a.id
	`

	if claims.IsSuperAdmin() {
		err = h.db.Select(&machines, query+" ORDER BY m.title, m.hostname")
	} else {
		err = h.db.Select(&machines, query+`
			WHERE m.owner_id = $1 
			OR m.project_id IN (
				SELECT id FROM projects WHERE owner_id = $1
				UNION
				SELECT project_id FROM project_members WHERE user_id = $1 AND status = 'approved'
			)
			ORDER BY m.title, m.hostname
		`, userID)
	}

	if err != nil {
		log.Printf("Failed to list machines for speed test: %v", err)
		http.Error(w, "Failed to list machines", http.StatusInternalServerError)
		return
	}

	if machines == nil {
		machines = []MinimalMachine{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(machines)
}

// ============================================
// Permission Helper Functions
// ============================================

func (h *MachinesHandler) canAccessMachine(userID, machineID uuid.UUID, isSuperAdmin bool) bool {
	if isSuperAdmin {
		return true
	}

	var count int
	h.db.Get(&count, `
		SELECT COUNT(*) FROM machines m
		WHERE m.id = $1 AND (
			m.owner_id = $2
			OR m.project_id IN (
				SELECT id FROM projects WHERE owner_id = $2
				UNION
				SELECT project_id FROM project_members WHERE user_id = $2 AND status = 'approved'
			)
		)
	`, machineID, userID)
	return count > 0
}

func (h *MachinesHandler) canManageMachine(userID, machineID uuid.UUID, isSuperAdmin bool) bool {
	if isSuperAdmin {
		return true
	}

	// Owner can always manage
	if h.isMachineOwner(userID, machineID) {
		return true
	}

	// Project owner or manager can manage
	var count int
	h.db.Get(&count, `
		SELECT COUNT(*) FROM machines m
		WHERE m.id = $1 AND m.project_id IN (
			SELECT id FROM projects WHERE owner_id = $2
			UNION
			SELECT project_id FROM project_members 
			WHERE user_id = $2 AND status = 'approved' AND role = 'manager'
		)
	`, machineID, userID)
	return count > 0
}

func (h *MachinesHandler) canEditMachineNotes(userID, machineID uuid.UUID, isSuperAdmin bool) bool {
	// Manager permissions cover notes editing
	if h.canManageMachine(userID, machineID, isSuperAdmin) {
		return true
	}

	// Check if member with can_view_notes permission (which also implies edit for now)
	var count int
	h.db.Get(&count, `
		SELECT COUNT(*) FROM machines m
		JOIN project_members pm ON m.project_id = pm.project_id
		WHERE m.id = $1 AND pm.user_id = $2 AND pm.status = 'approved' AND pm.can_view_notes = true
	`, machineID, userID)
	return count > 0
}

func (h *MachinesHandler) isMachineOwner(userID, machineID uuid.UUID) bool {
	var ownerID uuid.UUID
	err := h.db.Get(&ownerID, "SELECT owner_id FROM machines WHERE id = $1", machineID)
	return err == nil && ownerID == userID
}

func (h *MachinesHandler) canLinkToProject(userID, projectID uuid.UUID, isSuperAdmin bool) bool {
	if isSuperAdmin {
		return true
	}

	// Project owner can link
	var ownerID uuid.UUID
	err := h.db.Get(&ownerID, "SELECT owner_id FROM projects WHERE id = $1", projectID)
	if err == nil && ownerID == userID {
		return true
	}

	// Manager can also link
	var role string
	err = h.db.Get(&role, `
		SELECT role FROM project_members 
		WHERE project_id = $1 AND user_id = $2 AND status = 'approved'
	`, projectID, userID)
	return err == nil && role == "manager"
}
