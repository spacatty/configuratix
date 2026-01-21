package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"configuratix/backend/internal/audit"
	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type AdminHandler struct {
	db *database.DB
}

func NewAdminHandler(db *database.DB) *AdminHandler {
	return &AdminHandler{db: db}
}

// UserWithDetails includes extra user info
type UserWithDetails struct {
	models.User
	MachineCount int `db:"machine_count" json:"machine_count"`
	ProjectCount int `db:"project_count" json:"project_count"`
}

// ListUsers returns all users (admin only)
func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsAdmin() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	var users []UserWithDetails
	err := h.db.Select(&users, `
		SELECT u.id, u.email, u.name, u.role, u.totp_enabled, u.password_changed_at, 
		       u.created_at, u.updated_at,
		       COALESCE(mc.cnt, 0) as machine_count,
		       COALESCE(pc.cnt, 0) as project_count
		FROM users u
		LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM machines WHERE owner_id = u.id) mc ON true
		LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM projects WHERE owner_id = u.id) pc ON true
		ORDER BY u.created_at DESC
	`)
	if err != nil {
		log.Printf("Failed to list users: %v", err)
		http.Error(w, "Failed to list users", http.StatusInternalServerError)
		return
	}

	if users == nil {
		users = []UserWithDetails{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// GetUser returns a single user
func (h *AdminHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsAdmin() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	userID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	var user UserWithDetails
	err = h.db.Get(&user, `
		SELECT u.id, u.email, u.name, u.role, u.totp_enabled, u.password_changed_at, 
		       u.created_at, u.updated_at,
		       COALESCE(mc.cnt, 0) as machine_count,
		       COALESCE(pc.cnt, 0) as project_count
		FROM users u
		LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM machines WHERE owner_id = u.id) mc ON true
		LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM projects WHERE owner_id = u.id) pc ON true
		WHERE u.id = $1
	`, userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// CreateAdmin creates a new admin user (superadmin only)
func (h *AdminHandler) CreateAdmin(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsSuperAdmin() {
		http.Error(w, "Only superadmin can create admin users", http.StatusForbidden)
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Role     string `json:"role"` // admin or user
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" {
		http.Error(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	// Only allow admin or user roles (not superadmin)
	if req.Role != "admin" && req.Role != "user" {
		req.Role = "user"
	}

	// Check if email exists
	var count int
	h.db.Get(&count, "SELECT COUNT(*) FROM users WHERE email = $1", req.Email)
	if count > 0 {
		http.Error(w, "Email already exists", http.StatusConflict)
		return
	}

	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	var user models.User
	err = h.db.Get(&user, `
		INSERT INTO users (email, name, password_hash, role)
		VALUES ($1, $2, $3, $4)
		RETURNING id, email, name, role, totp_enabled, created_at, updated_at
	`, req.Email, req.Name, passwordHash, req.Role)
	if err != nil {
		log.Printf("Failed to create admin: %v", err)
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	// Audit log
	audit.Log(audit.EventUserCreated, claims.UserID, user.ID.String(), map[string]interface{}{
		"email": req.Email,
		"role":  req.Role,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(user)
}

// UpdateUserRole updates a user's role (superadmin only for admin role)
func (h *AdminHandler) UpdateUserRole(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsAdmin() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	userID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Only superadmin can set admin role
	if req.Role == "admin" && !claims.IsSuperAdmin() {
		http.Error(w, "Only superadmin can set admin role", http.StatusForbidden)
		return
	}

	// Cannot set superadmin role
	if req.Role == "superadmin" {
		http.Error(w, "Cannot set superadmin role", http.StatusForbidden)
		return
	}

	// Cannot change own role
	if userID.String() == claims.UserID {
		http.Error(w, "Cannot change your own role", http.StatusBadRequest)
		return
	}

	// Get current role for audit
	var oldRole string
	h.db.Get(&oldRole, "SELECT role FROM users WHERE id = $1", userID)

	_, err = h.db.Exec("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2", req.Role, userID)
	if err != nil {
		http.Error(w, "Failed to update role", http.StatusInternalServerError)
		return
	}

	// Audit log
	audit.Log(audit.EventRoleChange, claims.UserID, userID.String(), map[string]interface{}{
		"old_role": oldRole,
		"new_role": req.Role,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Role updated"})
}

// ChangeUserPassword changes another user's password (admin/superadmin)
func (h *AdminHandler) ChangeUserPassword(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsAdmin() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	userID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	var req struct {
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if len(req.NewPassword) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	// Check target user's role - cannot change superadmin's password unless you are superadmin
	var targetRole string
	err = h.db.Get(&targetRole, "SELECT role FROM users WHERE id = $1", userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	if targetRole == "superadmin" && !claims.IsSuperAdmin() {
		http.Error(w, "Cannot change superadmin password", http.StatusForbidden)
		return
	}

	passwordHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}

	_, err = h.db.Exec(`
		UPDATE users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
		WHERE id = $2
	`, passwordHash, userID)
	if err != nil {
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}

	// Audit log - don't log the actual password!
	audit.Log(audit.EventAdminPasswordChange, claims.UserID, userID.String(), map[string]interface{}{
		"target_role": targetRole,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Password updated"})
}

// Reset2FA resets a user's 2FA (admin/superadmin)
func (h *AdminHandler) Reset2FA(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsAdmin() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	userID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// Check target user's role
	var targetRole string
	err = h.db.Get(&targetRole, "SELECT role FROM users WHERE id = $1", userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	if targetRole == "superadmin" && !claims.IsSuperAdmin() {
		http.Error(w, "Cannot reset superadmin 2FA", http.StatusForbidden)
		return
	}

	_, err = h.db.Exec(`
		UPDATE users SET totp_enabled = false, totp_secret = NULL, updated_at = NOW()
		WHERE id = $1
	`, userID)
	if err != nil {
		http.Error(w, "Failed to reset 2FA", http.StatusInternalServerError)
		return
	}

	// Audit log
	audit.Log(audit.Event2FAReset, claims.UserID, userID.String(), map[string]interface{}{
		"target_role": targetRole,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "2FA reset successfully"})
}

// ResetMachineToken resets a user's machine access token (superadmin only)
func (h *AdminHandler) ResetMachineToken(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsSuperAdmin() {
		http.Error(w, "Superadmin access required", http.StatusForbidden)
		return
	}

	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Get machine owner for audit
	var ownerID *uuid.UUID
	h.db.Get(&ownerID, "SELECT owner_id FROM machines WHERE id = $1", machineID)

	// Clear the machine's access token
	_, err = h.db.Exec(`
		UPDATE machines SET access_token_hash = NULL, access_token_set = false, updated_at = NOW()
		WHERE id = $1
	`, machineID)
	if err != nil {
		http.Error(w, "Failed to reset token", http.StatusInternalServerError)
		return
	}

	// Audit log
	targetOwner := ""
	if ownerID != nil {
		targetOwner = ownerID.String()
	}
	audit.Log(audit.EventMachineTokenReset, claims.UserID, machineID.String(), map[string]interface{}{
		"machine_owner": targetOwner,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Machine access token reset"})
}

// DeleteUser deletes a user (superadmin only for admins)
func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsAdmin() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	userID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// Cannot delete self
	if userID.String() == claims.UserID {
		http.Error(w, "Cannot delete yourself", http.StatusBadRequest)
		return
	}

	// Check target user's role
	var targetRole string
	err = h.db.Get(&targetRole, "SELECT role FROM users WHERE id = $1", userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	// Only superadmin can delete admins
	if (targetRole == "admin" || targetRole == "superadmin") && !claims.IsSuperAdmin() {
		http.Error(w, "Only superadmin can delete admin users", http.StatusForbidden)
		return
	}

	// Cannot delete superadmin
	if targetRole == "superadmin" {
		http.Error(w, "Cannot delete superadmin", http.StatusForbidden)
		return
	}

	// Get email for audit before deletion
	var targetEmail string
	h.db.Get(&targetEmail, "SELECT email FROM users WHERE id = $1", userID)

	_, err = h.db.Exec("DELETE FROM users WHERE id = $1", userID)
	if err != nil {
		http.Error(w, "Failed to delete user", http.StatusInternalServerError)
		return
	}

	// Audit log
	audit.Log(audit.EventUserDeleted, claims.UserID, userID.String(), map[string]interface{}{
		"target_email": targetEmail,
		"target_role":  targetRole,
	})

	w.WriteHeader(http.StatusNoContent)
}

// AdminStats returns overview stats for admin dashboard
func (h *AdminHandler) AdminStats(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)

	if !claims.IsSuperAdmin() {
		http.Error(w, "Superadmin access required", http.StatusForbidden)
		return
	}

	var stats struct {
		TotalUsers     int `json:"total_users"`
		TotalMachines  int `json:"total_machines"`
		TotalProjects  int `json:"total_projects"`
		OnlineMachines int `json:"online_machines"`
		TotalDomains   int `json:"total_domains"`
	}

	h.db.Get(&stats.TotalUsers, "SELECT COUNT(*) FROM users")
	h.db.Get(&stats.TotalMachines, "SELECT COUNT(*) FROM machines")
	h.db.Get(&stats.TotalProjects, "SELECT COUNT(*) FROM projects")
	h.db.Get(&stats.OnlineMachines, `
		SELECT COUNT(*) FROM machines m 
		JOIN agents a ON m.agent_id = a.id 
		WHERE a.last_seen > NOW() - INTERVAL '5 minutes'
	`)
	h.db.Get(&stats.TotalDomains, "SELECT COUNT(*) FROM domains")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

