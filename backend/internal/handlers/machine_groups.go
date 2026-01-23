package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type MachineGroupsHandler struct {
	db *database.DB
}

func NewMachineGroupsHandler(db *database.DB) *MachineGroupsHandler {
	return &MachineGroupsHandler{db: db}
}

// ListMachineGroups returns all groups for the current user with machine counts
func (h *MachineGroupsHandler) ListMachineGroups(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var groups []models.MachineGroupWithCount
	err := h.db.Select(&groups, `
		SELECT g.*, 
			COALESCE((SELECT COUNT(*) FROM machine_group_members WHERE group_id = g.id), 0) as machine_count
		FROM machine_groups g
		WHERE g.owner_id = $1
		ORDER BY g.position, g.created_at
	`, userID)
	if err != nil {
		log.Printf("Failed to list machine groups: %v", err)
		http.Error(w, "Failed to list groups", http.StatusInternalServerError)
		return
	}

	if groups == nil {
		groups = []models.MachineGroupWithCount{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

type CreateMachineGroupRequest struct {
	Name  string `json:"name"`
	Emoji string `json:"emoji"`
	Color string `json:"color"`
}

// CreateMachineGroup creates a new machine group
func (h *MachineGroupsHandler) CreateMachineGroup(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateMachineGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	// Set defaults
	if req.Emoji == "" {
		req.Emoji = "📁"
	}
	if req.Color == "" {
		req.Color = "#6366f1"
	}

	// Get next position
	var maxPos int
	h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM machine_groups WHERE owner_id = $1", userID)

	var group models.MachineGroup
	err := h.db.Get(&group, `
		INSERT INTO machine_groups (owner_id, name, emoji, color, position)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING *
	`, userID, req.Name, req.Emoji, req.Color, maxPos+1)
	if err != nil {
		log.Printf("Failed to create machine group: %v", err)
		http.Error(w, "Failed to create group (name may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(group)
}

type UpdateMachineGroupRequest struct {
	Name     *string `json:"name"`
	Emoji    *string `json:"emoji"`
	Color    *string `json:"color"`
	Position *int    `json:"position"`
}

// UpdateMachineGroup updates a machine group
func (h *MachineGroupsHandler) UpdateMachineGroup(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	var req UpdateMachineGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM machine_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	// Build update query
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

	query := fmt.Sprintf("UPDATE machine_groups SET %s WHERE id = $%d AND owner_id = $%d", updates, argNum, argNum+1)
	args = append(args, groupID, userID)

	_, err = h.db.Exec(query, args...)
	if err != nil {
		log.Printf("Failed to update machine group: %v", err)
		http.Error(w, "Failed to update group", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Group updated"})
}

// DeleteMachineGroup deletes a machine group
func (h *MachineGroupsHandler) DeleteMachineGroup(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec("DELETE FROM machine_groups WHERE id = $1 AND owner_id = $2", groupID, userID)
	if err != nil {
		log.Printf("Failed to delete machine group: %v", err)
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

// ReorderMachineGroups reorders all groups
func (h *MachineGroupsHandler) ReorderMachineGroups(w http.ResponseWriter, r *http.Request) {
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
		tx.Exec("UPDATE machine_groups SET position = $1 WHERE id = $2 AND owner_id = $3", i, groupID, userID)
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to reorder groups", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Groups reordered"})
}

// ==================== Group Members ====================

// GetGroupMembers returns all machines in a group
func (h *MachineGroupsHandler) GetGroupMembers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM machine_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	type MachineWithPosition struct {
		ID         uuid.UUID  `db:"id" json:"id"`
		Title      *string    `db:"title" json:"title"`
		Hostname   *string    `db:"hostname" json:"hostname"`
		IPAddress  *string    `db:"ip_address" json:"ip_address"`
		LastSeen   *time.Time `db:"last_seen" json:"last_seen"`
		Position   int        `db:"position" json:"position"`
	}

	var machines []MachineWithPosition
	err = h.db.Select(&machines, `
		SELECT m.id, m.title, m.hostname, m.ip_address, 
			   a.last_seen_at as last_seen,
			   mgm.position
		FROM machines m
		JOIN machine_group_members mgm ON m.id = mgm.machine_id
		LEFT JOIN agents a ON m.agent_id = a.id
		WHERE mgm.group_id = $1
		ORDER BY mgm.position, m.hostname
	`, groupID)
	if err != nil {
		log.Printf("Failed to get group members: %v", err)
		http.Error(w, "Failed to get members", http.StatusInternalServerError)
		return
	}

	if machines == nil {
		machines = []MachineWithPosition{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(machines)
}

type AddGroupMembersRequest struct {
	MachineIDs []string `json:"machine_ids"`
}

// AddGroupMembers adds machines to a group
func (h *MachineGroupsHandler) AddGroupMembers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	var req AddGroupMembersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM machine_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	// Get max position
	var maxPos int
	h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM machine_group_members WHERE group_id = $1", groupID)

	added := 0
	for _, machineIDStr := range req.MachineIDs {
		machineID, err := uuid.Parse(machineIDStr)
		if err != nil {
			continue
		}

		// Check machine exists and belongs to user (or user is superadmin)
		var machineExists bool
		if claims.IsSuperAdmin() {
			h.db.Get(&machineExists, "SELECT EXISTS(SELECT 1 FROM machines WHERE id = $1)", machineID)
		} else {
			h.db.Get(&machineExists, "SELECT EXISTS(SELECT 1 FROM machines WHERE id = $1 AND owner_id = $2)", machineID, userID)
		}
		if !machineExists {
			continue
		}

		maxPos++
		_, err = h.db.Exec(`
			INSERT INTO machine_group_members (group_id, machine_id, position)
			VALUES ($1, $2, $3)
			ON CONFLICT (group_id, machine_id) DO NOTHING
		`, groupID, machineID, maxPos)
		if err == nil {
			added++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"added":   added,
		"message": "Machines added to group",
	})
}

// RemoveGroupMember removes a machine from a group
func (h *MachineGroupsHandler) RemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	groupID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}
	machineID, err := uuid.Parse(vars["machineId"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM machine_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
	if !exists {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	_, err = h.db.Exec("DELETE FROM machine_group_members WHERE group_id = $1 AND machine_id = $2", groupID, machineID)
	if err != nil {
		http.Error(w, "Failed to remove machine from group", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ReorderGroupMembers reorders machines within a group
func (h *MachineGroupsHandler) ReorderGroupMembers(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	groupID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}

	var req struct {
		MachineIDs []string `json:"machine_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM machine_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
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

	for i, machineIDStr := range req.MachineIDs {
		machineID, err := uuid.Parse(machineIDStr)
		if err != nil {
			continue
		}
		tx.Exec("UPDATE machine_group_members SET position = $1 WHERE group_id = $2 AND machine_id = $3", i, groupID, machineID)
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to reorder members", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Members reordered"})
}

// GetMachineGroups returns all groups a machine belongs to
func (h *MachineGroupsHandler) GetMachineGroups(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	machineID, err := uuid.Parse(mux.Vars(r)["machineId"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var groups []models.MachineGroup
	err = h.db.Select(&groups, `
		SELECT g.*
		FROM machine_groups g
		JOIN machine_group_members mgm ON g.id = mgm.group_id
		WHERE mgm.machine_id = $1 AND g.owner_id = $2
		ORDER BY g.position, g.name
	`, machineID, userID)
	if err != nil {
		log.Printf("Failed to get machine groups: %v", err)
		http.Error(w, "Failed to get groups", http.StatusInternalServerError)
		return
	}

	if groups == nil {
		groups = []models.MachineGroup{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

// SetMachineGroups sets all groups for a machine (replaces existing)
func (h *MachineGroupsHandler) SetMachineGroups(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	machineID, err := uuid.Parse(mux.Vars(r)["machineId"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

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

	// Remove from all groups owned by this user
	tx.Exec(`
		DELETE FROM machine_group_members 
		WHERE machine_id = $1 
		AND group_id IN (SELECT id FROM machine_groups WHERE owner_id = $2)
	`, machineID, userID)

	// Add to new groups
	for _, groupIDStr := range req.GroupIDs {
		groupID, err := uuid.Parse(groupIDStr)
		if err != nil {
			continue
		}

		// Verify group belongs to user
		var groupExists bool
		h.db.Get(&groupExists, "SELECT EXISTS(SELECT 1 FROM machine_groups WHERE id = $1 AND owner_id = $2)", groupID, userID)
		if !groupExists {
			continue
		}

		// Get max position for this group
		var maxPos int
		h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM machine_group_members WHERE group_id = $1", groupID)

		tx.Exec(`
			INSERT INTO machine_group_members (group_id, machine_id, position)
			VALUES ($1, $2, $3)
			ON CONFLICT (group_id, machine_id) DO NOTHING
		`, groupID, machineID, maxPos+1)
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to set groups", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Groups updated"})
}

