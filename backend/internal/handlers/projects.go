package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type ProjectsHandler struct {
	db *database.DB
}

func NewProjectsHandler(db *database.DB) *ProjectsHandler {
	return &ProjectsHandler{db: db}
}

// ListProjects returns projects the user can access
func (h *ProjectsHandler) ListProjects(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var projects []models.ProjectWithStats

	// Superadmin can see all projects
	if claims.IsSuperAdmin() {
		err := h.db.Select(&projects, `
			SELECT p.*, 
				u.email as owner_email, 
				COALESCE(u.name, u.email) as owner_name,
				COALESCE(mc.cnt, 0) as machine_count,
				COALESCE(mem.cnt, 0) as member_count,
				COALESCE(online.cnt, 0) as online_machines,
				COALESCE(offline.cnt, 0) as offline_machines
			FROM projects p
			LEFT JOIN users u ON p.owner_id = u.id
			LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM machines WHERE project_id = p.id) mc ON true
			LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM project_members WHERE project_id = p.id AND status = 'approved') mem ON true
			LEFT JOIN LATERAL (
				SELECT COUNT(*) as cnt FROM machines m 
				LEFT JOIN agents a ON m.agent_id = a.id 
				WHERE m.project_id = p.id AND a.last_seen > NOW() - INTERVAL '5 minutes'
			) online ON true
			LEFT JOIN LATERAL (
				SELECT COUNT(*) as cnt FROM machines m 
				LEFT JOIN agents a ON m.agent_id = a.id 
				WHERE m.project_id = p.id AND (a.last_seen IS NULL OR a.last_seen <= NOW() - INTERVAL '5 minutes')
			) offline ON true
			ORDER BY p.created_at DESC
		`)
		if err != nil {
			log.Printf("Failed to list projects: %v", err)
			http.Error(w, "Failed to list projects", http.StatusInternalServerError)
			return
		}
	} else {
		// Regular users see their own projects and projects they're members of
		err := h.db.Select(&projects, `
			SELECT p.*, 
				u.email as owner_email, 
				COALESCE(u.name, u.email) as owner_name,
				COALESCE(mc.cnt, 0) as machine_count,
				COALESCE(mem.cnt, 0) as member_count,
				COALESCE(online.cnt, 0) as online_machines,
				COALESCE(offline.cnt, 0) as offline_machines
			FROM projects p
			LEFT JOIN users u ON p.owner_id = u.id
			LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM machines WHERE project_id = p.id) mc ON true
			LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM project_members WHERE project_id = p.id AND status = 'approved') mem ON true
			LEFT JOIN LATERAL (
				SELECT COUNT(*) as cnt FROM machines m 
				LEFT JOIN agents a ON m.agent_id = a.id 
				WHERE m.project_id = p.id AND a.last_seen > NOW() - INTERVAL '5 minutes'
			) online ON true
			LEFT JOIN LATERAL (
				SELECT COUNT(*) as cnt FROM machines m 
				LEFT JOIN agents a ON m.agent_id = a.id 
				WHERE m.project_id = p.id AND (a.last_seen IS NULL OR a.last_seen <= NOW() - INTERVAL '5 minutes')
			) offline ON true
			WHERE p.owner_id = $1 
			   OR p.id IN (SELECT project_id FROM project_members WHERE user_id = $1 AND status = 'approved')
			ORDER BY p.created_at DESC
		`, userID)
		if err != nil {
			log.Printf("Failed to list projects: %v", err)
			http.Error(w, "Failed to list projects", http.StatusInternalServerError)
			return
		}
	}

	if projects == nil {
		projects = []models.ProjectWithStats{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(projects)
}

// GetProject returns a single project
func (h *ProjectsHandler) GetProject(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}

	// Check access
	if !h.canAccessProject(userID, projectID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var project models.ProjectWithStats
	err = h.db.Get(&project, `
		SELECT p.*, 
			u.email as owner_email, 
			COALESCE(u.name, u.email) as owner_name,
			COALESCE(mc.cnt, 0) as machine_count,
			COALESCE(mem.cnt, 0) as member_count,
			COALESCE(online.cnt, 0) as online_machines,
			COALESCE(offline.cnt, 0) as offline_machines
		FROM projects p
		LEFT JOIN users u ON p.owner_id = u.id
		LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM machines WHERE project_id = p.id) mc ON true
		LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM project_members WHERE project_id = p.id AND status = 'approved') mem ON true
		LEFT JOIN LATERAL (
			SELECT COUNT(*) as cnt FROM machines m 
			LEFT JOIN agents a ON m.agent_id = a.id 
			WHERE m.project_id = p.id AND a.last_seen > NOW() - INTERVAL '5 minutes'
		) online ON true
		LEFT JOIN LATERAL (
			SELECT COUNT(*) as cnt FROM machines m 
			LEFT JOIN agents a ON m.agent_id = a.id 
			WHERE m.project_id = p.id AND (a.last_seen IS NULL OR a.last_seen <= NOW() - INTERVAL '5 minutes')
		) offline ON true
		WHERE p.id = $1
	`, projectID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(project)
}

// CreateProject creates a new project
func (h *ProjectsHandler) CreateProject(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	var project models.Project
	err := h.db.Get(&project, `
		INSERT INTO projects (name, owner_id)
		VALUES ($1, $2)
		RETURNING *
	`, req.Name, userID)
	if err != nil {
		log.Printf("Failed to create project: %v", err)
		http.Error(w, "Failed to create project", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(project)
}

// UpdateProject updates a project
func (h *ProjectsHandler) UpdateProject(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}

	// Only project owner or superadmin can update project
	if !h.isProjectOwner(userID, projectID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only project owner can update project settings", http.StatusForbidden)
		return
	}

	var req struct {
		Name    *string `json:"name"`
		NotesMD *string `json:"notes_md"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE projects SET 
			name = COALESCE($1, name),
			notes_md = COALESCE($2, notes_md),
			updated_at = NOW()
		WHERE id = $3
	`, req.Name, req.NotesMD, projectID)
	if err != nil {
		http.Error(w, "Failed to update project", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Project updated"})
}

// DeleteProject deletes a project
func (h *ProjectsHandler) DeleteProject(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}

	// Only owner or superadmin can delete
	if !h.isProjectOwner(userID, projectID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only project owner can delete", http.StatusForbidden)
		return
	}

	// Unlink machines from project first
	h.db.Exec("UPDATE machines SET project_id = NULL WHERE project_id = $1", projectID)

	_, err = h.db.Exec("DELETE FROM projects WHERE id = $1", projectID)
	if err != nil {
		http.Error(w, "Failed to delete project", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ToggleSharing enables/disables project sharing
func (h *ProjectsHandler) ToggleSharing(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}

	if !h.isProjectOwner(userID, projectID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only project owner can manage sharing", http.StatusForbidden)
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Enabled {
		// Generate new invite token
		tokenBytes := make([]byte, 32)
		rand.Read(tokenBytes)
		token := base64.URLEncoding.EncodeToString(tokenBytes)
		expiresAt := time.Now().Add(7 * 24 * time.Hour) // 7 days

		_, err = h.db.Exec(`
			UPDATE projects SET 
				sharing_enabled = true,
				invite_token = $1,
				invite_expires_at = $2,
				updated_at = NOW()
			WHERE id = $3
		`, token, expiresAt, projectID)
	} else {
		_, err = h.db.Exec(`
			UPDATE projects SET 
				sharing_enabled = false,
				invite_token = NULL,
				invite_expires_at = NULL,
				updated_at = NOW()
			WHERE id = $1
		`, projectID)
	}

	if err != nil {
		http.Error(w, "Failed to update sharing", http.StatusInternalServerError)
		return
	}

	// Return updated project
	var project models.Project
	h.db.Get(&project, "SELECT * FROM projects WHERE id = $1", projectID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(project)
}

// RequestJoin requests to join a project via invite link
func (h *ProjectsHandler) RequestJoin(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req struct {
		InviteToken string `json:"invite_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Find project by invite token
	var project models.Project
	err := h.db.Get(&project, `
		SELECT * FROM projects 
		WHERE invite_token = $1 
		  AND sharing_enabled = true
		  AND (invite_expires_at IS NULL OR invite_expires_at > NOW())
	`, req.InviteToken)
	if err != nil {
		http.Error(w, "Invalid or expired invite link", http.StatusBadRequest)
		return
	}

	// Check if user is already owner
	if project.OwnerID == userID {
		http.Error(w, "You are the owner of this project", http.StatusBadRequest)
		return
	}

	// Check if already a member or has pending request
	var count int
	h.db.Get(&count, `
		SELECT COUNT(*) FROM project_members 
		WHERE project_id = $1 AND user_id = $2
	`, project.ID, userID)
	if count > 0 {
		http.Error(w, "You already have a pending request or are a member", http.StatusBadRequest)
		return
	}

	// Create pending membership request
	var member models.ProjectMember
	err = h.db.Get(&member, `
		INSERT INTO project_members (project_id, user_id, role, status)
		VALUES ($1, $2, 'member', 'pending')
		RETURNING *
	`, project.ID, userID)
	if err != nil {
		http.Error(w, "Failed to request join", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":      "Join request submitted",
		"project_name": project.Name,
	})
}

// ListMembers lists project members
func (h *ProjectsHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}

	if !h.canAccessProject(userID, projectID, claims.IsSuperAdmin()) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var members []models.ProjectMemberWithUser
	err = h.db.Select(&members, `
		SELECT pm.*, u.email as user_email, COALESCE(u.name, u.email) as user_name
		FROM project_members pm
		JOIN users u ON pm.user_id = u.id
		WHERE pm.project_id = $1
		ORDER BY pm.created_at DESC
	`, projectID)
	if err != nil {
		http.Error(w, "Failed to list members", http.StatusInternalServerError)
		return
	}

	if members == nil {
		members = []models.ProjectMemberWithUser{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(members)
}

// ApproveMember approves a pending member request
func (h *ProjectsHandler) ApproveMember(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["project_id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}
	memberID, err := uuid.Parse(mux.Vars(r)["member_id"])
	if err != nil {
		http.Error(w, "Invalid member ID", http.StatusBadRequest)
		return
	}

	// Only project owner or superadmin can approve members
	if !h.isProjectOwner(userID, projectID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only project owner can approve members", http.StatusForbidden)
		return
	}

	var req struct {
		Role         string `json:"role"`
		CanViewNotes bool   `json:"can_view_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Role = "member"
	}

	if req.Role != "member" && req.Role != "manager" {
		req.Role = "member"
	}

	_, err = h.db.Exec(`
		UPDATE project_members SET 
			status = 'approved',
			role = $1,
			can_view_notes = $2,
			updated_at = NOW()
		WHERE id = $3 AND project_id = $4
	`, req.Role, req.CanViewNotes, memberID, projectID)
	if err != nil {
		http.Error(w, "Failed to approve member", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Member approved"})
}

// DenyMember denies a pending member request
func (h *ProjectsHandler) DenyMember(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["project_id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}
	memberID, err := uuid.Parse(mux.Vars(r)["member_id"])
	if err != nil {
		http.Error(w, "Invalid member ID", http.StatusBadRequest)
		return
	}

	// Only project owner or superadmin can deny members
	if !h.isProjectOwner(userID, projectID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only project owner can deny members", http.StatusForbidden)
		return
	}

	_, err = h.db.Exec(`
		UPDATE project_members SET status = 'denied', updated_at = NOW()
		WHERE id = $1 AND project_id = $2
	`, memberID, projectID)
	if err != nil {
		http.Error(w, "Failed to deny member", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Member denied"})
}

// UpdateMember updates member role/permissions
func (h *ProjectsHandler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["project_id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}
	memberID, err := uuid.Parse(mux.Vars(r)["member_id"])
	if err != nil {
		http.Error(w, "Invalid member ID", http.StatusBadRequest)
		return
	}

	// Only project owner or superadmin can update member permissions
	if !h.isProjectOwner(userID, projectID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only project owner can update member permissions", http.StatusForbidden)
		return
	}

	var req struct {
		Role         *string `json:"role"`
		CanViewNotes *bool   `json:"can_view_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE project_members SET 
			role = COALESCE($1, role),
			can_view_notes = COALESCE($2, can_view_notes),
			updated_at = NOW()
		WHERE id = $3 AND project_id = $4
	`, req.Role, req.CanViewNotes, memberID, projectID)
	if err != nil {
		http.Error(w, "Failed to update member", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Member updated"})
}

// RemoveMember removes a member from project
func (h *ProjectsHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	projectID, err := uuid.Parse(mux.Vars(r)["project_id"])
	if err != nil {
		http.Error(w, "Invalid project ID", http.StatusBadRequest)
		return
	}
	memberID, err := uuid.Parse(mux.Vars(r)["member_id"])
	if err != nil {
		http.Error(w, "Invalid member ID", http.StatusBadRequest)
		return
	}

	// Check if user is trying to leave the project themselves
	var memberUserID uuid.UUID
	err = h.db.Get(&memberUserID, "SELECT user_id FROM project_members WHERE id = $1", memberID)
	if err != nil {
		http.Error(w, "Member not found", http.StatusNotFound)
		return
	}

	// Allow self-removal (leaving project)
	isSelfRemoval := memberUserID == userID

	// Only project owner, superadmin, or self can remove member
	if !isSelfRemoval && !h.isProjectOwner(userID, projectID) && !claims.IsSuperAdmin() {
		http.Error(w, "Only project owner can remove members", http.StatusForbidden)
		return
	}

	_, err = h.db.Exec("DELETE FROM project_members WHERE id = $1 AND project_id = $2", memberID, projectID)
	if err != nil {
		http.Error(w, "Failed to remove member", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Helper functions
func (h *ProjectsHandler) canAccessProject(userID, projectID uuid.UUID, isSuperAdmin bool) bool {
	if isSuperAdmin {
		return true
	}

	var count int
	h.db.Get(&count, `
		SELECT COUNT(*) FROM projects 
		WHERE id = $1 AND (
			owner_id = $2 
			OR id IN (SELECT project_id FROM project_members WHERE user_id = $2 AND status = 'approved')
		)
	`, projectID, userID)
	return count > 0
}

func (h *ProjectsHandler) canManageProject(userID, projectID uuid.UUID, isSuperAdmin bool) bool {
	if isSuperAdmin {
		return true
	}

	// Owner can always manage
	if h.isProjectOwner(userID, projectID) {
		return true
	}

	// Manager can also manage
	var role string
	err := h.db.Get(&role, `
		SELECT role FROM project_members 
		WHERE project_id = $1 AND user_id = $2 AND status = 'approved'
	`, projectID, userID)
	return err == nil && role == "manager"
}

func (h *ProjectsHandler) isProjectOwner(userID, projectID uuid.UUID) bool {
	var ownerID uuid.UUID
	err := h.db.Get(&ownerID, "SELECT owner_id FROM projects WHERE id = $1", projectID)
	return err == nil && ownerID == userID
}

