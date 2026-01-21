package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type JobsHandler struct {
	db *database.DB
}

func NewJobsHandler(db *database.DB) *JobsHandler {
	return &JobsHandler{db: db}
}

// ListJobs returns all jobs (optionally filtered by agent or status)
func (h *JobsHandler) ListJobs(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	status := r.URL.Query().Get("status")

	query := "SELECT * FROM jobs WHERE 1=1"
	args := []interface{}{}
	argNum := 1

	if agentID != "" {
		query += " AND agent_id = $" + string(rune('0'+argNum))
		args = append(args, agentID)
		argNum++
	}

	if status != "" {
		query += " AND status = $" + string(rune('0'+argNum))
		args = append(args, status)
	}

	query += " ORDER BY created_at DESC LIMIT 100"

	var jobs []models.Job
	err := h.db.Select(&jobs, query, args...)
	if err != nil {
		log.Printf("Failed to list jobs: %v", err)
		http.Error(w, "Failed to list jobs", http.StatusInternalServerError)
		return
	}

	if jobs == nil {
		jobs = []models.Job{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

// GetJob returns a single job by ID
func (h *JobsHandler) GetJob(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid job ID", http.StatusBadRequest)
		return
	}

	var job models.Job
	err = h.db.Get(&job, "SELECT * FROM jobs WHERE id = $1", id)
	if err != nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

type CreateJobRequest struct {
	AgentID uuid.UUID       `json:"agent_id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// CreateJob creates a new job for an agent
func (h *JobsHandler) CreateJob(w http.ResponseWriter, r *http.Request) {
	var req CreateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Type == "" {
		http.Error(w, "Job type is required", http.StatusBadRequest)
		return
	}

	var job models.Job
	err := h.db.Get(&job, `
		INSERT INTO jobs (agent_id, type, payload_json, status)
		VALUES ($1, $2, $3, 'pending')
		RETURNING *
	`, req.AgentID, req.Type, req.Payload)
	if err != nil {
		log.Printf("Failed to create job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(job)
}

// Helper function to create a job (used internally)
func CreateJobForAgent(db *database.DB, agentID uuid.UUID, jobType string, payload interface{}) (*models.Job, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	var job models.Job
	err = db.Get(&job, `
		INSERT INTO jobs (agent_id, type, payload_json, status)
		VALUES ($1, $2, $3, 'pending')
		RETURNING *
	`, agentID, jobType, payloadBytes)
	if err != nil {
		return nil, err
	}

	return &job, nil
}

