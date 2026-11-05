package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type CommandsHandler struct {
	db *database.DB
}

func NewCommandsHandler(db *database.DB) *CommandsHandler {
	return &CommandsHandler{db: db}
}

// ListCommands returns all available command templates
func (h *CommandsHandler) ListCommands(w http.ResponseWriter, r *http.Request) {
	commands := templates.ListCommands()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(commands)
}

// GetCommand returns a single command template by ID
func (h *CommandsHandler) GetCommand(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	cmd := templates.GetCommand(id)
	if cmd == nil {
		http.Error(w, "Command not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cmd)
}

// ExecuteCommandRequest is the request body for executing a command
type ExecuteCommandRequest struct {
	MachineID string            `json:"machine_id"`
	CommandID string            `json:"command_id"`
	Variables map[string]string `json:"variables"`
}

// ExecuteCommand creates a job from a command template
func (h *CommandsHandler) ExecuteCommand(w http.ResponseWriter, r *http.Request) {
	var req ExecuteCommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	cmd := templates.GetCommand(req.CommandID)
	if cmd == nil {
		http.Error(w, "Command not found", http.StatusNotFound)
		return
	}
	if req.Variables == nil {
		req.Variables = map[string]string{}
	}

	machineID, err := uuid.Parse(req.MachineID)
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canManageMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	agentID, err := machineAgentID(h.db, machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}

	// Validates required variables, applies defaults and rejects unsafe values.
	spec, err := jobs.FromTemplate(req.CommandID, req.Variables)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	spec.AgentID = agentID
	spec.EntityType = jobs.EntityCommand
	spec.EntityID = req.CommandID
	spec.CreatedBy = jobs.UserID(r)

	job, err := jobs.Create(r.Context(), h.db, spec)
	if err != nil {
		log.Printf("Failed to create job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, jobCreatedResponse(job))
}
