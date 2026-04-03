package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

type TrackerHandler struct {
	db *database.DB
}

func NewTrackerHandler(db *database.DB) *TrackerHandler {
	return &TrackerHandler{db: db}
}

var defaultCategories = []struct {
	Name            string
	Icon            string
	Color           string
	IdentifierLabel string
}{
	{"Servers", "🖥️", "#6366f1", "IP"},
	{"Domains", "🌐", "#22c55e", "Domain"},
	{"Subscriptions", "📋", "#f59e0b", ""},
}

func (h *TrackerHandler) ensureDefaultCategories(userID uuid.UUID) error {
	var count int
	err := h.db.Get(&count, "SELECT COUNT(*) FROM tracker_categories WHERE owner_id = $1", userID)
	if err != nil || count > 0 {
		return err
	}
	for i, d := range defaultCategories {
		_, err = h.db.Exec(`
			INSERT INTO tracker_categories (owner_id, name, icon, color, position, notify_days_before, identifier_label)
			VALUES ($1, $2, $3, $4, $5, 3, $6)
		`, userID, d.Name, d.Icon, d.Color, i, d.IdentifierLabel)
		if err != nil {
			return err
		}
	}
	return nil
}

// ListCategories returns all categories for the current user (ensures defaults exist)
func (h *TrackerHandler) ListCategories(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	if err := h.ensureDefaultCategories(userID); err != nil {
		log.Printf("Tracker: ensure default categories: %v", err)
		http.Error(w, "Failed to load categories", http.StatusInternalServerError)
		return
	}

	var categories []models.TrackerCategoryWithCount
	err := h.db.Select(&categories, `
		SELECT c.*, COALESCE((SELECT COUNT(*) FROM tracker_items WHERE category_id = c.id), 0) as item_count
		FROM tracker_categories c
		WHERE c.owner_id = $1
		ORDER BY c.position, c.created_at
	`, userID)
	if err != nil {
		log.Printf("Failed to list tracker categories: %v", err)
		http.Error(w, "Failed to list categories", http.StatusInternalServerError)
		return
	}
	if categories == nil {
		categories = []models.TrackerCategoryWithCount{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(categories)
}

type CreateTrackerCategoryRequest struct {
	Name              string `json:"name"`
	Icon              string `json:"icon"`
	Color             string `json:"color"`
	NotifyDaysBefore  *int   `json:"notify_days_before"`
	IdentifierLabel   string `json:"identifier_label"`
}

func (h *TrackerHandler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateTrackerCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if req.Icon == "" {
		req.Icon = "📁"
	}
	if req.Color == "" {
		req.Color = "#6366f1"
	}
	notifyDays := 3
	if req.NotifyDaysBefore != nil && *req.NotifyDaysBefore >= 0 {
		notifyDays = *req.NotifyDaysBefore
	}
	identifierLabel := req.IdentifierLabel

	var maxPos int
	h.db.Get(&maxPos, "SELECT COALESCE(MAX(position), 0) FROM tracker_categories WHERE owner_id = $1", userID)

	var cat models.TrackerCategory
	err := h.db.Get(&cat, `
		INSERT INTO tracker_categories (owner_id, name, icon, color, position, notify_days_before, identifier_label)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING *
	`, userID, req.Name, req.Icon, req.Color, maxPos+1, notifyDays, identifierLabel)
	if err != nil {
		log.Printf("Failed to create tracker category: %v", err)
		http.Error(w, "Failed to create category (name may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(cat)
}

type UpdateTrackerCategoryRequest struct {
	Name              *string `json:"name"`
	Icon              *string `json:"icon"`
	Color             *string `json:"color"`
	Position          *int    `json:"position"`
	NotifyDaysBefore  *int    `json:"notify_days_before"`
	IdentifierLabel   *string `json:"identifier_label"`
}

func (h *TrackerHandler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	var req UpdateTrackerCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_categories WHERE id = $1 AND owner_id = $2)", id, userID)
	if !exists {
		http.Error(w, "Category not found", http.StatusNotFound)
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
	if req.Icon != nil {
		updates += fmt.Sprintf(", icon = $%d", argNum)
		args = append(args, *req.Icon)
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
	if req.NotifyDaysBefore != nil && *req.NotifyDaysBefore >= 0 {
		updates += fmt.Sprintf(", notify_days_before = $%d", argNum)
		args = append(args, *req.NotifyDaysBefore)
		argNum++
	}
	if req.IdentifierLabel != nil {
		updates += fmt.Sprintf(", identifier_label = $%d", argNum)
		args = append(args, *req.IdentifierLabel)
		argNum++
	}

	query := fmt.Sprintf("UPDATE tracker_categories SET %s WHERE id = $%d AND owner_id = $%d", updates, argNum, argNum+1)
	args = append(args, id, userID)
	_, err = h.db.Exec(query, args...)
	if err != nil {
		log.Printf("Failed to update tracker category: %v", err)
		http.Error(w, "Failed to update category", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Category updated"})
}

func (h *TrackerHandler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	res, err := h.db.Exec("DELETE FROM tracker_categories WHERE id = $1 AND owner_id = $2", id, userID)
	if err != nil {
		log.Printf("Failed to delete tracker category: %v", err)
		http.Error(w, "Failed to delete category", http.StatusInternalServerError)
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Category not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *TrackerHandler) ReorderCategories(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req struct {
		CategoryIDs []string `json:"category_ids"`
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

	for i, idStr := range req.CategoryIDs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			continue
		}
		tx.Exec("UPDATE tracker_categories SET position = $1 WHERE id = $2 AND owner_id = $3", i, id, userID)
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to reorder categories", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Categories reordered"})
}

// ListItems returns tracker items for the current user (optional category_id query)
func (h *TrackerHandler) ListItems(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	categoryID := r.URL.Query().Get("category_id")

	query := `
		SELECT i.*, c.name as category_name, c.icon as category_icon, c.color as category_color, c.identifier_label as category_identifier_label,
			r.name as resource_name, r.url as resource_url,
			(SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)), '[]'::json)
			FROM tracker_item_tags it JOIN tracker_tags t ON t.id = it.tag_id WHERE it.item_id = i.id) as tags
		FROM tracker_items i
		LEFT JOIN tracker_categories c ON i.category_id = c.id
		LEFT JOIN tracker_resources r ON i.resource_id = r.id
		WHERE i.owner_id = $1
	`
	args := []interface{}{userID}
	argNum := 2
	if categoryID != "" {
		catID, err := uuid.Parse(categoryID)
		if err == nil {
			query += fmt.Sprintf(" AND i.category_id = $%d", argNum)
			args = append(args, catID)
			argNum++
		}
	}
	query += " ORDER BY i.expiry_at ASC NULLS LAST, i.created_at DESC"

	var items []models.TrackerItemWithCategory
	err := h.db.Select(&items, query, args...)
	if err != nil {
		log.Printf("Failed to list tracker items: %v", err)
		http.Error(w, "Failed to list items", http.StatusInternalServerError)
		return
	}
	if items == nil {
		items = []models.TrackerItemWithCategory{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// ListResources returns all resources for the current user, optionally filtered by name (q=).
func (h *TrackerHandler) ListResources(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	q := strings.TrimSpace(r.URL.Query().Get("q"))

	query := `SELECT * FROM tracker_resources WHERE owner_id = $1`
	args := []interface{}{userID}
	if q != "" {
		query += ` AND name ILIKE $2`
		args = append(args, "%"+q+"%")
	}
	query += ` ORDER BY name LIMIT 50`

	var resources []models.TrackerResource
	err := h.db.Select(&resources, query, args...)
	if err != nil {
		log.Printf("ListResources: %v", err)
		http.Error(w, "Failed to list resources", http.StatusInternalServerError)
		return
	}
	if resources == nil {
		resources = []models.TrackerResource{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resources)
}

func (h *TrackerHandler) GetResource(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid resource ID", http.StatusBadRequest)
		return
	}

	var res models.TrackerResource
	err = h.db.Get(&res, "SELECT * FROM tracker_resources WHERE id = $1 AND owner_id = $2", id, userID)
	if err != nil {
		http.Error(w, "Resource not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

type CreateTrackerResourceRequest struct {
	Name   string  `json:"name"`
	URL    *string `json:"url"`
	NotesMD *string `json:"notes_md"`
}

func (h *TrackerHandler) CreateResource(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateTrackerResourceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)

	var res models.TrackerResource
	err := h.db.Get(&res, `
		INSERT INTO tracker_resources (owner_id, name, url, notes_md)
		VALUES ($1, $2, $3, $4)
		RETURNING *
	`, userID, req.Name, req.URL, req.NotesMD)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			http.Error(w, "A resource with this name already exists", http.StatusBadRequest)
			return
		}
		log.Printf("CreateResource: %v", err)
		http.Error(w, "Failed to create resource", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(res)
}

type UpdateTrackerResourceRequest struct {
	Name   *string `json:"name"`
	URL    *string `json:"url"`
	NotesMD *string `json:"notes_md"`
}

func (h *TrackerHandler) UpdateResource(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid resource ID", http.StatusBadRequest)
		return
	}

	var req UpdateTrackerResourceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_resources WHERE id = $1 AND owner_id = $2)", id, userID)
	if !exists {
		http.Error(w, "Resource not found", http.StatusNotFound)
		return
	}

	updates := "updated_at = NOW()"
	args := []interface{}{}
	argNum := 1
	if req.Name != nil {
		updates += fmt.Sprintf(", name = $%d", argNum)
		args = append(args, strings.TrimSpace(*req.Name))
		argNum++
	}
	if req.URL != nil {
		updates += fmt.Sprintf(", url = $%d", argNum)
		args = append(args, *req.URL)
		argNum++
	}
	if req.NotesMD != nil {
		updates += fmt.Sprintf(", notes_md = $%d", argNum)
		args = append(args, *req.NotesMD)
		argNum++
	}
	if argNum == 1 {
		w.Header().Set("Content-Type", "application/json")
		var res models.TrackerResource
		h.db.Get(&res, "SELECT * FROM tracker_resources WHERE id = $1 AND owner_id = $2", id, userID)
		json.NewEncoder(w).Encode(res)
		return
	}
	args = append(args, id, userID)
	_, err = h.db.Exec(`UPDATE tracker_resources SET `+updates+` WHERE id = $`+fmt.Sprint(argNum)+` AND owner_id = $`+fmt.Sprint(argNum+1), args...)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			http.Error(w, "A resource with this name already exists", http.StatusBadRequest)
			return
		}
		log.Printf("UpdateResource: %v", err)
		http.Error(w, "Failed to update resource", http.StatusInternalServerError)
		return
	}

	var res models.TrackerResource
	h.db.Get(&res, "SELECT * FROM tracker_resources WHERE id = $1 AND owner_id = $2", id, userID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func (h *TrackerHandler) DeleteResource(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid resource ID", http.StatusBadRequest)
		return
	}

	res, err := h.db.Exec("DELETE FROM tracker_resources WHERE id = $1 AND owner_id = $2", id, userID)
	if err != nil {
		log.Printf("DeleteResource: %v", err)
		http.Error(w, "Failed to delete resource", http.StatusInternalServerError)
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Resource not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *TrackerHandler) GetItem(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	var item models.TrackerItemWithCategory
	err = h.db.Get(&item, `
		SELECT i.*, c.name as category_name, c.icon as category_icon, c.color as category_color, c.identifier_label as category_identifier_label,
			r.name as resource_name, r.url as resource_url,
			(SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)), '[]'::json)
			FROM tracker_item_tags it JOIN tracker_tags t ON t.id = it.tag_id WHERE it.item_id = i.id) as tags
		FROM tracker_items i
		LEFT JOIN tracker_categories c ON i.category_id = c.id
		LEFT JOIN tracker_resources r ON i.resource_id = r.id
		WHERE i.id = $1 AND i.owner_id = $2
	`, id, userID)
	if err != nil {
		http.Error(w, "Item not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(item)
}

// ListCategoryTags returns all tags for a category (owner-only)
func (h *TrackerHandler) ListCategoryTags(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	catID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_categories WHERE id = $1 AND owner_id = $2)", catID, userID)
	if !exists {
		http.Error(w, "Category not found", http.StatusNotFound)
		return
	}

	var tags []models.TrackerTag
	err = h.db.Select(&tags, "SELECT * FROM tracker_tags WHERE category_id = $1 AND owner_id = $2 ORDER BY name", catID, userID)
	if err != nil {
		log.Printf("Failed to list category tags: %v", err)
		http.Error(w, "Failed to list tags", http.StatusInternalServerError)
		return
	}
	if tags == nil {
		tags = []models.TrackerTag{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tags)
}

type CreateTrackerTagRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (h *TrackerHandler) CreateCategoryTag(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	catID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	var req CreateTrackerTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	name := trimSpace(req.Name)
	if name == "" {
		http.Error(w, "Tag name is required", http.StatusBadRequest)
		return
	}
	color := req.Color
	if color == "" {
		color = "#6366f1"
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_categories WHERE id = $1 AND owner_id = $2)", catID, userID)
	if !exists {
		http.Error(w, "Category not found", http.StatusNotFound)
		return
	}

	var tag models.TrackerTag
	err = h.db.Get(&tag, `
		INSERT INTO tracker_tags (owner_id, category_id, name, color)
		VALUES ($1, $2, $3, $4)
		RETURNING *
	`, userID, catID, name, color)
	if err != nil {
		log.Printf("Failed to create tracker tag: %v", err)
		http.Error(w, "Tag with this name already exists in category or failed to create", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(tag)
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[len(s)-1] == ' ') {
		if s[0] == ' ' {
			s = s[1:]
		} else {
			s = s[:len(s)-1]
		}
	}
	return s
}

// validateTagIDsForCategory checks all tagIDs belong to categoryID and userID; returns valid UUIDs or error.
func (h *TrackerHandler) validateTagIDsForCategory(tx *sqlx.Tx, tagIDs []string, categoryID, userID uuid.UUID) ([]uuid.UUID, error) {
	if len(tagIDs) == 0 {
		return nil, nil
	}
	var uuids []uuid.UUID
	for _, idStr := range tagIDs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			return nil, fmt.Errorf("invalid tag id %q", idStr)
		}
		uuids = append(uuids, id)
	}
	var count int
	err := tx.Get(&count, `
		SELECT COUNT(*) FROM tracker_tags
		WHERE id = ANY($1::uuid[]) AND category_id = $2 AND owner_id = $3
	`, pq.Array(uuids), categoryID, userID)
	if err != nil {
		return nil, err
	}
	if count != len(uuids) {
		return nil, fmt.Errorf("one or more tag ids do not belong to this category or user")
	}
	return uuids, nil
}

type UpdateTrackerTagRequest struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

func (h *TrackerHandler) UpdateTag(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	tagID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid tag ID", http.StatusBadRequest)
		return
	}

	var req UpdateTrackerTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_tags WHERE id = $1 AND owner_id = $2)", tagID, userID)
	if !exists {
		http.Error(w, "Tag not found", http.StatusNotFound)
		return
	}

	updates := "updated_at = NOW()"
	args := []interface{}{}
	argNum := 1
	if req.Name != nil {
		name := trimSpace(*req.Name)
		if name == "" {
			http.Error(w, "Tag name cannot be empty", http.StatusBadRequest)
			return
		}
		updates += fmt.Sprintf(", name = $%d", argNum)
		args = append(args, name)
		argNum++
	}
	if req.Color != nil {
		updates += fmt.Sprintf(", color = $%d", argNum)
		args = append(args, *req.Color)
		argNum++
	}
	if len(args) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "No changes"})
		return
	}

	query := fmt.Sprintf("UPDATE tracker_tags SET %s WHERE id = $%d AND owner_id = $%d RETURNING *", updates, argNum, argNum+1)
	args = append(args, tagID, userID)
	var tag models.TrackerTag
	err = h.db.Get(&tag, query, args...)
	if err != nil {
		log.Printf("Failed to update tracker tag: %v", err)
		http.Error(w, "Failed to update tag (name may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tag)
}

func (h *TrackerHandler) DeleteTag(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	tagID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid tag ID", http.StatusBadRequest)
		return
	}

	res, err := h.db.Exec("DELETE FROM tracker_tags WHERE id = $1 AND owner_id = $2", tagID, userID)
	if err != nil {
		log.Printf("Failed to delete tracker tag: %v", err)
		http.Error(w, "Failed to delete tag", http.StatusInternalServerError)
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Tag not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type CreateTrackerItemRequest struct {
	Name                 string     `json:"name"`
	IdentifierValue      string     `json:"identifier_value"`
	ResourceID           *string    `json:"resource_id"`
	ResourceName         *string    `json:"resource_name"`
	CategoryID           *string    `json:"category_id"`
	TagIDs               []string   `json:"tag_ids"`
	PurchaseTime         *time.Time `json:"purchase_time"`
	OrderDate            *time.Time `json:"order_date"`
	ExpiryAt             *time.Time `json:"expiry_at"`
	RecurringPeriodType  *string    `json:"recurring_period_type"`
	RecurringPeriodDays  *int       `json:"recurring_period_days"`
	PriceUsd             *float64   `json:"price_usd"`
	NotesMD              *string    `json:"notes_md"`
}

func (h *TrackerHandler) CreateItem(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateTrackerItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	resourceNameForCreate := req.ResourceName != nil && strings.TrimSpace(*req.ResourceName) != ""
	if (req.ResourceID == nil || *req.ResourceID == "") && !resourceNameForCreate {
		http.Error(w, "Either resource_id or resource_name is required", http.StatusBadRequest)
		return
	}

	var categoryID *uuid.UUID
	if req.CategoryID != nil && *req.CategoryID != "" {
		cid, err := uuid.Parse(*req.CategoryID)
		if err == nil {
			var exists bool
			h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_categories WHERE id = $1 AND owner_id = $2)", cid, userID)
			if exists {
				categoryID = &cid
			}
		}
	}

	var resourceID *uuid.UUID
	if req.ResourceID != nil && *req.ResourceID != "" {
		rid, err := uuid.Parse(*req.ResourceID)
		if err == nil {
			var exists bool
			h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_resources WHERE id = $1 AND owner_id = $2)", rid, userID)
			if exists {
				resourceID = &rid
			}
		}
	}

	tx, err := h.db.Beginx()
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if resourceID == nil && resourceNameForCreate {
		var res models.TrackerResource
		err = tx.Get(&res, `
			INSERT INTO tracker_resources (owner_id, name, url, notes_md)
			VALUES ($1, $2, NULL, NULL)
			ON CONFLICT (owner_id, name) DO UPDATE SET updated_at = NOW() RETURNING *
		`, userID, strings.TrimSpace(*req.ResourceName))
		if err != nil {
			log.Printf("CreateItem inline resource: %v", err)
			http.Error(w, "Failed to create resource", http.StatusInternalServerError)
			return
		}
		resourceID = &res.ID
	}

	var item models.TrackerItem
	err = tx.Get(&item, `
		INSERT INTO tracker_items (owner_id, category_id, name, identifier_value, resource_id, purchase_time, order_date, expiry_at, recurring_period_type, recurring_period_days, price_usd, notes_md)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING *
	`, userID, categoryID, req.Name, req.IdentifierValue, resourceID, req.PurchaseTime, req.OrderDate, req.ExpiryAt, req.RecurringPeriodType, req.RecurringPeriodDays, req.PriceUsd, req.NotesMD)
	if err != nil {
		log.Printf("Failed to create tracker item: %v", err)
		http.Error(w, "Failed to create item", http.StatusInternalServerError)
		return
	}

	if categoryID != nil && len(req.TagIDs) > 0 {
		validTagIDs, err := h.validateTagIDsForCategory(tx, req.TagIDs, *categoryID, userID)
		if err != nil {
			http.Error(w, "Invalid tag_ids: "+err.Error(), http.StatusBadRequest)
			return
		}
		for _, tagID := range validTagIDs {
			_, err = tx.Exec("INSERT INTO tracker_item_tags (item_id, tag_id) VALUES ($1, $2)", item.ID, tagID)
			if err != nil {
				log.Printf("Failed to link item to tag: %v", err)
				http.Error(w, "Failed to assign tags", http.StatusInternalServerError)
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to save item", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(item)
}

type UpdateTrackerItemRequest struct {
	Name                 *string    `json:"name"`
	IdentifierValue      *string    `json:"identifier_value"`
	ResourceID           *string    `json:"resource_id"`
	CategoryID           *string    `json:"category_id"`
	TagIDs               []string   `json:"tag_ids"`
	PurchaseTime         *time.Time `json:"purchase_time"`
	OrderDate            *time.Time `json:"order_date"`
	ExpiryAt             *time.Time `json:"expiry_at"`
	RecurringPeriodType  *string    `json:"recurring_period_type"`
	RecurringPeriodDays  *int       `json:"recurring_period_days"`
	PriceUsd             *float64   `json:"price_usd"`
	NotesMD              *string    `json:"notes_md"`
}

func (h *TrackerHandler) UpdateItem(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	var req UpdateTrackerItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var current models.TrackerItem
	err = h.db.Get(&current, "SELECT * FROM tracker_items WHERE id = $1 AND owner_id = $2", id, userID)
	if err != nil {
		http.Error(w, "Item not found", http.StatusNotFound)
		return
	}

	// Resolve effective category for tag validation (after update)
	var effectiveCategoryID *uuid.UUID
	if req.CategoryID != nil {
		if *req.CategoryID != "" {
			cidVal, err := uuid.Parse(*req.CategoryID)
			if err == nil {
				var catExists bool
				h.db.Get(&catExists, "SELECT EXISTS(SELECT 1 FROM tracker_categories WHERE id = $1 AND owner_id = $2)", cidVal, userID)
				if catExists {
					effectiveCategoryID = &cidVal
				}
			}
		}
	} else {
		effectiveCategoryID = current.CategoryID
	}

	if req.TagIDs != nil && effectiveCategoryID == nil && len(req.TagIDs) > 0 {
		http.Error(w, "Cannot assign tags without a category", http.StatusBadRequest)
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
	if req.IdentifierValue != nil {
		updates += fmt.Sprintf(", identifier_value = $%d", argNum)
		args = append(args, *req.IdentifierValue)
		argNum++
	}
	if req.ResourceID != nil {
		var rid *uuid.UUID
		if *req.ResourceID != "" {
			ridVal, err := uuid.Parse(*req.ResourceID)
			if err == nil {
				var exists bool
				h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_resources WHERE id = $1 AND owner_id = $2)", ridVal, userID)
				if exists {
					rid = &ridVal
				}
			}
		}
		updates += fmt.Sprintf(", resource_id = $%d", argNum)
		args = append(args, rid)
		argNum++
	}
	if req.CategoryID != nil {
		var cid *uuid.UUID
		if *req.CategoryID != "" {
			cidVal, err := uuid.Parse(*req.CategoryID)
			if err == nil {
				var catExists bool
				h.db.Get(&catExists, "SELECT EXISTS(SELECT 1 FROM tracker_categories WHERE id = $1 AND owner_id = $2)", cidVal, userID)
				if catExists {
					cid = &cidVal
				}
			}
		}
		updates += fmt.Sprintf(", category_id = $%d", argNum)
		args = append(args, cid)
		argNum++
	}
	if req.PurchaseTime != nil {
		updates += fmt.Sprintf(", purchase_time = $%d", argNum)
		args = append(args, *req.PurchaseTime)
		argNum++
	}
	if req.OrderDate != nil {
		updates += fmt.Sprintf(", order_date = $%d", argNum)
		args = append(args, *req.OrderDate)
		argNum++
	}
	if req.ExpiryAt != nil {
		updates += fmt.Sprintf(", expiry_at = $%d", argNum)
		args = append(args, *req.ExpiryAt)
		argNum++
	}
	if req.RecurringPeriodType != nil {
		updates += fmt.Sprintf(", recurring_period_type = $%d", argNum)
		args = append(args, *req.RecurringPeriodType)
		argNum++
	}
	if req.RecurringPeriodDays != nil {
		updates += fmt.Sprintf(", recurring_period_days = $%d", argNum)
		args = append(args, *req.RecurringPeriodDays)
		argNum++
	}
	if req.PriceUsd != nil {
		updates += fmt.Sprintf(", price_usd = $%d", argNum)
		args = append(args, *req.PriceUsd)
		argNum++
	}
	if req.NotesMD != nil {
		updates += fmt.Sprintf(", notes_md = $%d", argNum)
		args = append(args, *req.NotesMD)
		argNum++
	}

	tx, err := h.db.Beginx()
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	query := fmt.Sprintf("UPDATE tracker_items SET %s WHERE id = $%d AND owner_id = $%d", updates, argNum, argNum+1)
	args = append(args, id, userID)
	_, err = tx.Exec(query, args...)
	if err != nil {
		log.Printf("Failed to update tracker item: %v", err)
		http.Error(w, "Failed to update item", http.StatusInternalServerError)
		return
	}

	if req.TagIDs != nil {
		_, err = tx.Exec("DELETE FROM tracker_item_tags WHERE item_id = $1", id)
		if err != nil {
			log.Printf("Failed to clear item tags: %v", err)
			http.Error(w, "Failed to update tags", http.StatusInternalServerError)
			return
		}
		if effectiveCategoryID != nil && len(req.TagIDs) > 0 {
			validTagIDs, err := h.validateTagIDsForCategory(tx, req.TagIDs, *effectiveCategoryID, userID)
			if err != nil {
				http.Error(w, "Invalid tag_ids: "+err.Error(), http.StatusBadRequest)
				return
			}
			for _, tagID := range validTagIDs {
				_, err = tx.Exec("INSERT INTO tracker_item_tags (item_id, tag_id) VALUES ($1, $2)", id, tagID)
				if err != nil {
					log.Printf("Failed to assign tag to item: %v", err)
					http.Error(w, "Failed to update tags", http.StatusInternalServerError)
					return
				}
			}
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to update item", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Item updated"})
}

func (h *TrackerHandler) DeleteItem(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	res, err := h.db.Exec("DELETE FROM tracker_items WHERE id = $1 AND owner_id = $2", id, userID)
	if err != nil {
		log.Printf("Failed to delete tracker item: %v", err)
		http.Error(w, "Failed to delete item", http.StatusInternalServerError)
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Item not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// addPeriodToTime returns t + one period (1m, 3m, 6m, 12m, or custom days)
func addPeriodToTime(t time.Time, periodType string, periodDays *int) time.Time {
	switch periodType {
	case "1m":
		return t.AddDate(0, 1, 0)
	case "3m":
		return t.AddDate(0, 3, 0)
	case "6m":
		return t.AddDate(0, 6, 0)
	case "12m":
		return t.AddDate(1, 0, 0)
	case "custom":
		if periodDays != nil && *periodDays > 0 {
			return t.AddDate(0, 0, *periodDays)
		}
		return t.AddDate(0, 1, 0)
	default:
		return t.AddDate(0, 1, 0)
	}
}

type RecordPaidRequest struct {
	ExpiryAt            *time.Time `json:"expiry_at"`
	RecurringPeriodType  *string   `json:"recurring_period_type"`
	RecurringPeriodDays  *int      `json:"recurring_period_days"`
	AmountUsd           *float64  `json:"amount_usd"`
}

func (h *TrackerHandler) RecordPaid(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	var req RecordPaidRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var item models.TrackerItem
	err = h.db.Get(&item, "SELECT * FROM tracker_items WHERE id = $1 AND owner_id = $2", id, userID)
	if err != nil {
		http.Error(w, "Item not found", http.StatusNotFound)
		return
	}

	periodType := "1m"
	if item.RecurringPeriodType != nil && *item.RecurringPeriodType != "" {
		periodType = *item.RecurringPeriodType
	}
	if req.RecurringPeriodType != nil && *req.RecurringPeriodType != "" {
		periodType = *req.RecurringPeriodType
	}
	periodDays := item.RecurringPeriodDays
	if req.RecurringPeriodDays != nil {
		periodDays = req.RecurringPeriodDays
	}

	now := time.Now().UTC()
	expiryBefore := item.ExpiryAt
	startFrom := now
	if expiryBefore != nil && expiryBefore.After(now) {
		startFrom = *expiryBefore
	}
	computedExpiry := addPeriodToTime(startFrom, periodType, periodDays)

	var expiryAfter time.Time
	if req.ExpiryAt != nil {
		expiryAfter = *req.ExpiryAt
	} else {
		expiryAfter = computedExpiry
	}

	tx, err := h.db.Beginx()
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO tracker_renewals (item_id, renewed_at, expiry_before, expiry_after, amount_usd)
		VALUES ($1, $2, $3, $4, $5)
	`, id, now, expiryBefore, expiryAfter, req.AmountUsd)
	if err != nil {
		log.Printf("Failed to insert tracker renewal: %v", err)
		http.Error(w, "Failed to record payment", http.StatusInternalServerError)
		return
	}

	_, err = tx.Exec(`
		UPDATE tracker_items SET expiry_at = $1, updated_at = NOW(), last_notified_at = NULL, next_notification_at = NULL
		WHERE id = $2 AND owner_id = $3
	`, expiryAfter, id, userID)
	if err != nil {
		log.Printf("Failed to update tracker item expiry: %v", err)
		http.Error(w, "Failed to update item", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to save", http.StatusInternalServerError)
		return
	}

	var updated models.TrackerItem
	h.db.Get(&updated, "SELECT * FROM tracker_items WHERE id = $1 AND owner_id = $2", id, userID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (h *TrackerHandler) ListRenewals(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	var exists bool
	h.db.Get(&exists, "SELECT EXISTS(SELECT 1 FROM tracker_items WHERE id = $1 AND owner_id = $2)", id, userID)
	if !exists {
		http.Error(w, "Item not found", http.StatusNotFound)
		return
	}

	var renewals []models.TrackerRenewal
	err = h.db.Select(&renewals, "SELECT * FROM tracker_renewals WHERE item_id = $1 ORDER BY renewed_at DESC", id)
	if err != nil {
		log.Printf("Failed to list renewals: %v", err)
		http.Error(w, "Failed to list renewals", http.StatusInternalServerError)
		return
	}
	if renewals == nil {
		renewals = []models.TrackerRenewal{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(renewals)
}

// ListNotifications returns notifications for the current user
func (h *TrackerHandler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	unreadOnly := r.URL.Query().Get("unread_only") == "true"

	query := `
		SELECT n.*, i.name as item_name
		FROM tracker_notifications n
		LEFT JOIN tracker_items i ON n.item_id = i.id
		WHERE n.owner_id = $1
	`
	args := []interface{}{userID}
	if unreadOnly {
		query += " AND n.read_at IS NULL"
	}
	query += " ORDER BY n.created_at DESC LIMIT 200"

	var list []models.TrackerNotificationWithItem
	err := h.db.Select(&list, query, args...)
	if err != nil {
		log.Printf("Failed to list tracker notifications: %v", err)
		http.Error(w, "Failed to list notifications", http.StatusInternalServerError)
		return
	}
	if list == nil {
		list = []models.TrackerNotificationWithItem{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (h *TrackerHandler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid notification ID", http.StatusBadRequest)
		return
	}

	now := time.Now().UTC()
	res, err := h.db.Exec("UPDATE tracker_notifications SET read_at = $1 WHERE id = $2 AND owner_id = $3", now, id, userID)
	if err != nil {
		log.Printf("Failed to mark notification read: %v", err)
		http.Error(w, "Failed to update notification", http.StatusInternalServerError)
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Notification not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Marked as read"})
}

func (h *TrackerHandler) MarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	now := time.Now().UTC()
	_, err := h.db.Exec("UPDATE tracker_notifications SET read_at = $1 WHERE owner_id = $2 AND read_at IS NULL", now, userID)
	if err != nil {
		log.Printf("Failed to mark all notifications read: %v", err)
		http.Error(w, "Failed to update notifications", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "All marked as read"})
}

// DashboardSummary returns MRE, total spent, closest payment, due soon/overdue counts
func (h *TrackerHandler) DashboardSummary(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	summary := models.TrackerDashboardSummary{}

	now := time.Now().UTC()

	// Monthly recurring expense: sum of (price_usd normalized to monthly) for items with price and recurrence
	h.db.Get(&summary.MonthlyRecurringExpense, `
		SELECT COALESCE(SUM(
			CASE
				WHEN recurring_period_type = '1m'  THEN COALESCE(price_usd, 0)
				WHEN recurring_period_type = '3m'  THEN COALESCE(price_usd, 0) / 3
				WHEN recurring_period_type = '6m'  THEN COALESCE(price_usd, 0) / 6
				WHEN recurring_period_type = '12m' THEN COALESCE(price_usd, 0) / 12
				WHEN recurring_period_type = 'custom' AND recurring_period_days > 0 THEN COALESCE(price_usd, 0) * 30.0 / recurring_period_days
				ELSE 0
			END
		), 0)
		FROM tracker_items WHERE owner_id = $1 AND price_usd IS NOT NULL AND recurring_period_type IS NOT NULL
	`, userID)

	// Total spent: for each item, (periods from order_date to expiry_at) * price_usd
	var items []struct {
		OrderDate   *time.Time `db:"order_date"`
		ExpiryAt    *time.Time `db:"expiry_at"`
		PeriodType  *string    `db:"recurring_period_type"`
		PeriodDays  *int       `db:"recurring_period_days"`
		PriceUsd    *float64   `db:"price_usd"`
	}
	h.db.Select(&items, `
		SELECT order_date, expiry_at, recurring_period_type, recurring_period_days, price_usd
		FROM tracker_items
		WHERE owner_id = $1 AND price_usd IS NOT NULL AND order_date IS NOT NULL AND expiry_at IS NOT NULL AND recurring_period_type IS NOT NULL
	`, userID)

	for _, it := range items {
		if it.PriceUsd == nil || it.OrderDate == nil || it.ExpiryAt == nil || it.PeriodType == nil {
			continue
		}
		periods := countPeriodsBetween(*it.OrderDate, *it.ExpiryAt, it.PeriodType, it.PeriodDays)
		if periods > 0 {
			summary.TotalSpent += float64(periods) * *it.PriceUsd
		}
	}

	// Closest payment: next expiry in the future
	var closest models.TrackerItem
	err := h.db.Get(&closest, `
		SELECT * FROM tracker_items
		WHERE owner_id = $1 AND expiry_at IS NOT NULL AND expiry_at > $2
		ORDER BY expiry_at ASC LIMIT 1
	`, userID, now)
	if err == nil {
		summary.ClosestPayment = &closest
	}

	// Due soon: expiry within default 3 days
	dueSoonThreshold := now.AddDate(0, 0, 3)
	h.db.Get(&summary.DueSoonCount, `
		SELECT COUNT(*) FROM tracker_items
		WHERE owner_id = $1 AND expiry_at IS NOT NULL AND expiry_at > $2 AND expiry_at <= $3
	`, userID, now, dueSoonThreshold)

	h.db.Get(&summary.OverdueCount, `
		SELECT COUNT(*) FROM tracker_items
		WHERE owner_id = $1 AND expiry_at IS NOT NULL AND expiry_at <= $2
	`, userID, now)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}

// countPeriodsBetween returns number of billing periods from order_date to expiry_at (inclusive of initial payment).
// e.g. order 12.01, expiry 12.04, 1m period -> 4 payments (12.01, 12.02, 12.03, 12.04).
func countPeriodsBetween(from, to time.Time, periodType *string, periodDays *int) int {
	if periodType == nil {
		return 0
	}
	if !to.After(from) {
		return 0
	}
	diff := to.Sub(from)
	switch *periodType {
	case "1m": // calendar months from order to expiry inclusive
		months := (to.Year()-from.Year())*12 + int(to.Month()-from.Month()) + 1
		if months < 0 {
			return 0
		}
		return months
	case "3m":
		n := int(diff.Hours()/24/90) + 1
		if n < 0 {
			return 0
		}
		return n
	case "6m":
		n := int(diff.Hours()/24/182) + 1
		if n < 0 {
			return 0
		}
		return n
	case "12m":
		n := (to.Year()-from.Year()) + 1
		if to.Year() == from.Year() && to.Before(from.AddDate(1, 0, 0)) {
			n = 1
		}
		if n < 0 {
			return 0
		}
		return n
	case "custom":
		if periodDays != nil && *periodDays > 0 {
			n := int(diff.Hours()/24)/(*periodDays) + 1
			if n < 0 {
				return 0
			}
			return n
		}
		return 0
	default:
		months := (to.Year()-from.Year())*12 + int(to.Month()-from.Month()) + 1
		if months < 0 {
			return 0
		}
		return months
	}
}
