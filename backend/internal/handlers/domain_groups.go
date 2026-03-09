package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type DomainGroupsHandler struct {
	db *database.DB
}

func NewDomainGroupsHandler(db *database.DB) *DomainGroupsHandler {
	return &DomainGroupsHandler{db: db}
}

// ListDomainGroups returns all groups for the current user with domain counts
func (h *DomainGroupsHandler) ListDomainGroups(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var groups []models.DomainGroupWithCount
	err := h.db.Select(&groups, `
		SELECT g.*,
			COALESCE((SELECT COUNT(*) FROM domain_group_members WHERE group_id = g.id), 0) as domain_count
		FROM domain_groups g
		WHERE g.owner_id = $1
		ORDER BY g.position, g.created_at
	`, userID)
	if err != nil {
		log.Printf("Failed to list domain groups: %v", err)
		http.Error(w, "Failed to list groups", http.StatusInternalServerError)
		return
	}

	if groups == nil {
		groups = []models.DomainGroupWithCount{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

type CreateDomainGroupRequest struct {
	Name  string `json:"name"`
	Emoji string `json:"emoji"`
	Color string `json:"color"`
}

// CreateDomainGroup creates a new domain group
func (h *DomainGroupsHandler) CreateDomainGroup(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateDomainGroupRequest
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
	h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM domain_groups WHERE owner_id = $1", userID)

	var group models.DomainGroup
	err := h.db.Get(&group, `
		INSERT INTO domain_groups (owner_id, name, emoji, color, position)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING *
	`, userID, req.Name, req.Emoji, req.Color, maxPos+1)
	if err != nil {
		log.Printf("Failed to create domain group: %v", err)
		http.Error(w, "Failed to create group (name may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(group)
}

type UpdateDomainGroupRequest struct {
	Name     *string `json:"name"`
	Emoji    *string `json:"emoji"`
	Color    *string `json:"color"`
	Position *int    `json:"position"`
}

// UpdateDomainGroup updates a domain group
func (h *DomainGroupsHandler) UpdateDomainGroup(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	var req UpdateDomainGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM domain_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	updates := "updated_at = NOW()"
	args := []interface{}{}
	argNum := 1

	if req.Name != nil {
		updates += fmt.Sprintf(", name = $%d", argNum)
		args = append(args, *req.Name)
		argNum++
	}
	if req.Emoji != nil {
		updates += fmt.Sprintf(", emoji = $%d", argNum)
		args = append(args, *req.Emoji)
		argNum++
	}
	if req.Color != nil {
		updates += fmt.Sprintf(", color = $%d", argNum)
		args = append(args, *req.Color)
		argNum++
	}
	if req.Position != nil {
		updates += fmt.Sprintf(", position = $%d", argNum)
		args = append(args, *req.Position)
		argNum++
	}

	query := fmt.Sprintf("UPDATE domain_groups SET %s WHERE id = $%d AND owner_id = $%d", updates, argNum, argNum+1)
	args = append(args, groupID, userID)

	_, err = h.db.Exec(query, args...)
	if err != nil {
		log.Printf("Failed to update domain group: %v", err)
		http.Error(w, "Failed to update group", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Group updated"})
}

// DeleteDomainGroup deletes a domain group
func (h *DomainGroupsHandler) DeleteDomainGroup(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec("DELETE FROM domain_groups WHERE id = $1 AND owner_id = $2", groupID, userID)
	if err != nil {
		log.Printf("Failed to delete domain group: %v", err)
		http.Error(w, "Failed to delete group", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ReorderDomainGroups reorders all groups
func (h *DomainGroupsHandler) ReorderDomainGroups(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req struct {
		GroupIDs []string `json:"group_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	tx, err := h.db.Beginx()
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	for i, groupIDStr := range req.GroupIDs {
		groupID, err := uuid.Parse(groupIDStr)
		if err != nil {
			continue
		}
		tx.Exec("UPDATE domain_groups SET position = $1 WHERE id = $2 AND owner_id = $3", i, groupID, userID)
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to reorder groups", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Groups reordered"})
}

// domainAccess returns whether the user can access the domain (for adding to group etc)
func (h *DomainGroupsHandler) domainAccess(claims *auth.Claims, domainID uuid.UUID) bool {
	userID, _ := uuid.Parse(claims.UserID)
	if claims.IsSuperAdmin() {
		var exists bool
		h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM domains WHERE id = $1)", domainID)
		return exists
	}
	var exists bool
	h.db.Get(&exists, `
		SELECT EXISTS(SELECT 1 FROM domains WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL))
	`, domainID, userID)
	return exists
}

// GetGroupMembers returns all domains in a group
func (h *DomainGroupsHandler) GetGroupMembers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM domain_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	type DomainWithPosition struct {
		ID       uuid.UUID `db:"id" json:"id"`
		FQDN     string    `db:"fqdn" json:"fqdn"`
		Status   string    `db:"status" json:"status"`
		Position int       `db:"position" json:"position"`
	}

	var domains []DomainWithPosition
	err = h.db.Select(&domains, `
		SELECT d.id, d.fqdn, d.status, dgm.position
		FROM domains d
		JOIN domain_group_members dgm ON d.id = dgm.domain_id
		WHERE dgm.group_id = $1
		ORDER BY dgm.position, d.fqdn
	`, groupID)
	if err != nil {
		log.Printf("Failed to get group members: %v", err)
		http.Error(w, "Failed to get members", http.StatusInternalServerError)
		return
	}

	if domains == nil {
		domains = []DomainWithPosition{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(domains)
}

type SetGroupMembersRequest struct {
	DomainIDs []string `json:"domain_ids"`
}

// SetGroupMembers replaces all domains in a group
func (h *DomainGroupsHandler) SetGroupMembers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	var req SetGroupMembersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM domain_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	_, _ = h.db.Exec("DELETE FROM domain_group_members WHERE group_id = $1", groupID)

	added := 0
	for i, domainIDStr := range req.DomainIDs {
		domainID, err := uuid.Parse(domainIDStr)
		if err != nil {
			continue
		}
		if !h.domainAccess(claims, domainID) {
			continue
		}
		_, err = h.db.Exec(`
			INSERT INTO domain_group_members (group_id, domain_id, position)
			VALUES ($1, $2, $3)
			ON CONFLICT (group_id, domain_id) DO NOTHING
		`, groupID, domainID, i+1)
		if err == nil {
			added++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"count":   added,
		"message": "Group members updated",
	})
}

// AddGroupMembers adds domains to a group
func (h *DomainGroupsHandler) AddGroupMembers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	var req SetGroupMembersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM domain_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	var maxPos int
	h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM domain_group_members WHERE group_id = $1", groupID)

	added := 0
	for _, domainIDStr := range req.DomainIDs {
		domainID, err := uuid.Parse(domainIDStr)
		if err != nil {
			continue
		}
		if !h.domainAccess(claims, domainID) {
			continue
		}
		maxPos++
		_, err = h.db.Exec(`
			INSERT INTO domain_group_members (group_id, domain_id, position)
			VALUES ($1, $2, $3)
			ON CONFLICT (group_id, domain_id) DO NOTHING
		`, groupID, domainID, maxPos)
		if err == nil {
			added++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"added":   added,
		"message": "Domains added to group",
	})
}

// RemoveGroupMember removes a domain from a group
func (h *DomainGroupsHandler) RemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	groupID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}
	domainID, err := uuid.Parse(vars["domainId"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM domain_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	_, err = h.db.Exec("DELETE FROM domain_group_members WHERE group_id = $1 AND domain_id = $2", groupID, domainID)
	if err != nil {
		http.Error(w, "Failed to remove domain from group", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ReorderGroupMembers reorders domains within a group
func (h *DomainGroupsHandler) ReorderGroupMembers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	var req struct {
		DomainIDs []string `json:"domain_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM domain_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	tx, err := h.db.Beginx()
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	for i, domainIDStr := range req.DomainIDs {
		domainID, err := uuid.Parse(domainIDStr)
		if err != nil {
			continue
		}
		tx.Exec("UPDATE domain_group_members SET position = $1 WHERE group_id = $2 AND domain_id = $3", i, groupID, domainID)
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to reorder members", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Members reordered"})
}

// GetDomainGroups returns all groups a domain belongs to
func (h *DomainGroupsHandler) GetDomainGroups(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	domainID, err := uuid.Parse(mux.Vars(r)["domainId"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	if !h.domainAccess(claims, domainID) {
		http.Error(w, "Domain not found or access denied", http.StatusNotFound)
		return
	}

	var groups []models.DomainGroup
	err = h.db.Select(&groups, `
		SELECT g.*
		FROM domain_groups g
		JOIN domain_group_members dgm ON g.id = dgm.group_id
		WHERE dgm.domain_id = $1 AND g.owner_id = $2
		ORDER BY g.position, g.name
	`, domainID, userID)
	if err != nil {
		log.Printf("Failed to get domain groups: %v", err)
		http.Error(w, "Failed to get groups", http.StatusInternalServerError)
		return
	}

	if groups == nil {
		groups = []models.DomainGroup{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

// SetDomainGroups sets all groups for a domain (replaces existing)
func (h *DomainGroupsHandler) SetDomainGroups(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	domainID, err := uuid.Parse(mux.Vars(r)["domainId"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var req struct {
		GroupIDs []string `json:"group_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if !h.domainAccess(claims, domainID) {
		http.Error(w, "Domain not found or access denied", http.StatusNotFound)
		return
	}

	_, _ = h.db.Exec(`
		DELETE FROM domain_group_members
		WHERE domain_id = $1
		AND group_id IN (SELECT id FROM domain_groups WHERE owner_id = $2)
	`, domainID, userID)

	for _, groupIDStr := range req.GroupIDs {
		groupID, err := uuid.Parse(groupIDStr)
		if err != nil {
			continue
		}
		var groupExists bool
		h.db.Get(&groupExists, "SELECT EXISTS(SELECT 1 FROM domain_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
		if !groupExists {
			continue
		}
		var maxPos int
		h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM domain_group_members WHERE group_id = $1", groupID)
		_, _ = h.db.Exec(`
			INSERT INTO domain_group_members (group_id, domain_id, position)
			VALUES ($1, $2, $3)
			ON CONFLICT (group_id, domain_id) DO NOTHING
		`, groupID, domainID, maxPos+1)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Groups updated"})
}
