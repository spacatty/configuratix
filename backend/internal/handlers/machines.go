package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

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
	type MachineWithAgent struct {
		models.Machine
		AgentName    *string    `db:"agent_name" json:"agent_name"`
		AgentVersion *string    `db:"agent_version" json:"agent_version"`
		LastSeen     *time.Time `db:"last_seen" json:"last_seen"`
	}

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

// GetMachine returns a single machine by ID
func (h *MachinesHandler) GetMachine(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var machine models.Machine
	err = h.db.Get(&machine, "SELECT * FROM machines WHERE id = $1", id)
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

