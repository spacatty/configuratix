package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"
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

	// Get command template
	cmd := templates.GetCommand(req.CommandID)
	if cmd == nil {
		http.Error(w, "Command not found", http.StatusNotFound)
		return
	}

	// Validate required variables
	for _, v := range cmd.Variables {
		if v.Required {
			if _, ok := req.Variables[v.Name]; !ok {
				http.Error(w, "Missing required variable: "+v.Name, http.StatusBadRequest)
				return
			}
		}
		// Apply defaults
		if v.Default != "" {
			if _, ok := req.Variables[v.Name]; !ok {
				req.Variables[v.Name] = v.Default
			}
		}
	}

	// Get machine's agent ID
	machineID, err := uuid.Parse(req.MachineID)
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	var agentID uuid.UUID
	err = h.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1 AND agent_id IS NOT NULL", machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}

	// Create job with run type
	payload := cmd.ToPayload(req.Variables)

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
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(job)
}

