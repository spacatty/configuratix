package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/domainhealth"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

// HealthCheckPresetsHandler manages reusable health check rule sets that domains can point at.
type HealthCheckPresetsHandler struct {
	db *database.DB
}

func NewHealthCheckPresetsHandler(db *database.DB) *HealthCheckPresetsHandler {
	return &HealthCheckPresetsHandler{db: db}
}

type HealthCheckPreset struct {
	ID             uuid.UUID  `db:"id" json:"id"`
	OwnerID        *uuid.UUID `db:"owner_id" json:"owner_id"`
	Name           string     `db:"name" json:"name"`
	Description    *string    `db:"description" json:"description"`
	Path           string     `db:"path" json:"path"`
	ExpectedStatus string     `db:"expected_status" json:"expected_status"`
	BodyContains   *string    `db:"body_contains" json:"body_contains"`
	TimeoutSeconds int        `db:"timeout_seconds" json:"timeout_seconds"`
	CreatedAt      time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at" json:"updated_at"`
	DomainCount    int        `db:"domain_count" json:"domain_count"`
}

type healthCheckPresetRequest struct {
	Name           string  `json:"name"`
	Description    *string `json:"description"`
	Path           string  `json:"path"`
	ExpectedStatus string  `json:"expected_status"`
	BodyContains   string  `json:"body_contains"`
	TimeoutSeconds int     `json:"timeout_seconds"`
}

func (req healthCheckPresetRequest) validate() (domainhealth.Rules, string, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 100 {
		return domainhealth.Rules{}, "", errors.New("name is required (max 100 chars)")
	}
	rules, err := domainhealth.Rules{
		Path:           req.Path,
		Expected:       req.ExpectedStatus,
		BodyContains:   req.BodyContains,
		TimeoutSeconds: req.TimeoutSeconds,
	}.Normalize()
	return rules, name, err
}

const presetSelect = `
	SELECT p.*, (SELECT COUNT(*) FROM domains d WHERE d.health_check_preset_id = p.id) AS domain_count
	FROM health_check_presets p`

// presetAccessible mirrors domain ownership: super admins see all, others their own and shared (NULL owner).
func (h *HealthCheckPresetsHandler) presetAccessible(claims *auth.Claims, userID, id uuid.UUID) bool {
	return presetAccessible(h.db, claims, userID, id)
}

func presetAccessible(db *database.DB, claims *auth.Claims, userID, id uuid.UUID) bool {
	var ok bool
	if claims.IsSuperAdmin() {
		_ = db.Get(&ok, `SELECT EXISTS(SELECT 1 FROM health_check_presets WHERE id = $1)`, id)
	} else {
		_ = db.Get(&ok, `SELECT EXISTS(SELECT 1 FROM health_check_presets WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL))`, id, userID)
	}
	return ok
}

func (h *HealthCheckPresetsHandler) ListPresets(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	presets := []HealthCheckPreset{}
	var err error
	if claims.IsSuperAdmin() {
		err = h.db.Select(&presets, presetSelect+` ORDER BY p.name`)
	} else {
		err = h.db.Select(&presets, presetSelect+` WHERE p.owner_id = $1 OR p.owner_id IS NULL ORDER BY p.name`, userID)
	}
	if err != nil {
		log.Printf("list health check presets: %v", err)
		http.Error(w, "Failed to list presets", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, presets)
}

func (h *HealthCheckPresetsHandler) CreatePreset(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req healthCheckPresetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	rules, name, err := req.validate()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var id uuid.UUID
	err = h.db.Get(&id, `
		INSERT INTO health_check_presets (owner_id, name, description, path, expected_status, body_contains, timeout_seconds)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, NULLIF($6, ''), $7)
		RETURNING id
	`, userID, name, trimPtr(req.Description), rules.Path, rules.Expected, rules.BodyContains, rules.TimeoutSeconds)
	if err != nil {
		log.Printf("create health check preset: %v", err)
		http.Error(w, "Failed to create preset", http.StatusInternalServerError)
		return
	}
	h.writePreset(w, http.StatusCreated, id)
}

func (h *HealthCheckPresetsHandler) UpdatePreset(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid preset ID", http.StatusBadRequest)
		return
	}
	if !h.presetAccessible(claims, userID, id) {
		http.Error(w, "Preset not found", http.StatusNotFound)
		return
	}

	var req healthCheckPresetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	rules, name, err := req.validate()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE health_check_presets SET name = $2, description = NULLIF($3, ''), path = $4, expected_status = $5,
			body_contains = NULLIF($6, ''), timeout_seconds = $7, updated_at = NOW()
		WHERE id = $1
	`, id, name, trimPtr(req.Description), rules.Path, rules.Expected, rules.BodyContains, rules.TimeoutSeconds)
	if err != nil {
		log.Printf("update health check preset: %v", err)
		http.Error(w, "Failed to update preset", http.StatusInternalServerError)
		return
	}
	h.writePreset(w, http.StatusOK, id)
}

// DeletePreset removes a preset; its domains keep checking with their own (custom) rules.
func (h *HealthCheckPresetsHandler) DeletePreset(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid preset ID", http.StatusBadRequest)
		return
	}
	if !h.presetAccessible(claims, userID, id) {
		http.Error(w, "Preset not found", http.StatusNotFound)
		return
	}
	if _, err := h.db.Exec(`DELETE FROM health_check_presets WHERE id = $1`, id); err != nil {
		log.Printf("delete health check preset: %v", err)
		http.Error(w, "Failed to delete preset", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *HealthCheckPresetsHandler) writePreset(w http.ResponseWriter, status int, id uuid.UUID) {
	var p HealthCheckPreset
	if err := h.db.Get(&p, presetSelect+` WHERE p.id = $1`, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Preset not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to load preset", http.StatusInternalServerError)
		return
	}
	writeJSON(w, status, p)
}

func trimPtr(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}
