package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
)

type SetupHandler struct {
	db *database.DB
}

func NewSetupHandler(db *database.DB) *SetupHandler {
	return &SetupHandler{db: db}
}

type SetupStatusResponse struct {
	NeedsSetup bool `json:"needs_setup"`
}

type CreateFirstUserRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// CheckSetup returns whether the application needs initial setup (no users exist)
func (h *SetupHandler) CheckSetup(w http.ResponseWriter, r *http.Request) {
	var count int
	err := h.db.Get(&count, "SELECT COUNT(*) FROM users")
	if err != nil {
		// If table doesn't exist yet, needs setup
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(SetupStatusResponse{NeedsSetup: true})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(SetupStatusResponse{NeedsSetup: count == 0})
}

// CreateFirstUser creates the first admin user (only works if no users exist)
func (h *SetupHandler) CreateFirstUser(w http.ResponseWriter, r *http.Request) {
	// Check if users already exist
	var count int
	err := h.db.Get(&count, "SELECT COUNT(*) FROM users")
	if err == nil && count > 0 {
		http.Error(w, "Setup already completed", http.StatusForbidden)
		return
	}

	var req CreateFirstUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
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

	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "Failed to hash password", http.StatusInternalServerError)
		return
	}

	// First user is always superadmin
	_, err = h.db.Exec(
		"INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'superadmin')",
		req.Email,
		passwordHash,
	)
	if err != nil {
		log.Printf("Failed to create user: %v", err)
		http.Error(w, "Failed to create user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Admin user created successfully"})
}

