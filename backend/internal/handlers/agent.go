package handlers

import (
	"context"
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
	"golang.org/x/crypto/bcrypt"
)

type AgentHandler struct {
	db *database.DB
}

func NewAgentHandler(db *database.DB) *AgentHandler {
	return &AgentHandler{db: db}
}

type EnrollRequest struct {
	Token    string `json:"token"`
	Hostname string `json:"hostname"`
	IP       string `json:"ip"`
	OS       string `json:"os"`
}

type EnrollResponse struct {
	AgentID  uuid.UUID `json:"agent_id"`
	APIKey   string    `json:"api_key"`
}

// Enroll handles agent enrollment
func (h *AgentHandler) Enroll(w http.ResponseWriter, r *http.Request) {
	var req EnrollRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	// Find and validate enrollment token
	var enrollmentToken models.EnrollmentToken
	err := h.db.Get(&enrollmentToken, `
		SELECT * FROM enrollment_tokens 
		WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL
	`, req.Token)
	if err != nil {
		http.Error(w, "Invalid or expired enrollment token", http.StatusUnauthorized)
		return
	}

	// Generate API key for the agent
	apiKeyBytes := make([]byte, 32)
	if _, err := rand.Read(apiKeyBytes); err != nil {
		log.Printf("Failed to generate API key: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}
	apiKey := base64.URLEncoding.EncodeToString(apiKeyBytes)

	// Hash the API key for storage
	apiKeyHash, err := auth.HashPassword(apiKey)
	if err != nil {
		log.Printf("Failed to hash API key: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}

	// Hash the token for storage
	tokenHash, err := auth.HashPassword(req.Token)
	if err != nil {
		log.Printf("Failed to hash token: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}

	// Start transaction
	tx, err := h.db.Beginx()
	if err != nil {
		log.Printf("Failed to start transaction: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Create agent
	var agent models.Agent
	err = tx.Get(&agent, `
		INSERT INTO agents (name, token_hash, api_key_hash, last_seen)
		VALUES ($1, $2, $3, NOW())
		RETURNING *
	`, req.Hostname, tokenHash, apiKeyHash)
	if err != nil {
		log.Printf("Failed to create agent: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}

	// Create machine with owner from enrollment token
	_, err = tx.Exec(`
		INSERT INTO machines (agent_id, hostname, ip_address, ubuntu_version, owner_id)
		VALUES ($1, $2, $3, $4, $5)
	`, agent.ID, req.Hostname, req.IP, req.OS, enrollmentToken.OwnerID)
	if err != nil {
		log.Printf("Failed to create machine: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}

	// Mark enrollment token as used
	_, err = tx.Exec("UPDATE enrollment_tokens SET used_at = NOW() WHERE id = $1", enrollmentToken.ID)
	if err != nil {
		log.Printf("Failed to mark token as used: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}

	response := EnrollResponse{
		AgentID: agent.ID,
		APIKey:  apiKey,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// UFWRule represents a single UFW firewall rule
type UFWRule struct {
	Port     string `json:"port"`
	Protocol string `json:"protocol"`
	Action   string `json:"action"`
	From     string `json:"from"`
}

// HeartbeatRequest includes system stats from agent
type HeartbeatRequest struct {
	Version     string    `json:"version"`
	CPUPercent  float64   `json:"cpu_percent"`
	MemoryUsed  int64     `json:"memory_used"`
	MemoryTotal int64     `json:"memory_total"`
	DiskUsed    int64     `json:"disk_used"`
	DiskTotal   int64     `json:"disk_total"`
	SSHPort     int       `json:"ssh_port"`
	UFWEnabled  bool      `json:"ufw_enabled"`
	UFWRules    []UFWRule `json:"ufw_rules"`
	Fail2ban    bool      `json:"fail2ban_enabled"`
}

// Heartbeat handles agent heartbeat
func (h *AgentHandler) Heartbeat(w http.ResponseWriter, r *http.Request) {
	agentID, ok := r.Context().Value("agent_id").(uuid.UUID)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req HeartbeatRequest
	json.NewDecoder(r.Body).Decode(&req)

	// Update agent last_seen and version
	_, err := h.db.Exec(`
		UPDATE agents SET last_seen = NOW(), version = COALESCE(NULLIF($1, ''), version)
		WHERE id = $2
	`, req.Version, agentID)
	if err != nil {
		log.Printf("Failed to update agent heartbeat: %v", err)
	}

	// Serialize UFW rules to JSON
	ufwRulesJSON, _ := json.Marshal(req.UFWRules)

	// Update machine stats
	_, err = h.db.Exec(`
		UPDATE machines SET 
			cpu_percent = $1,
			memory_used = $2,
			memory_total = $3,
			disk_used = $4,
			disk_total = $5,
			ssh_port = CASE WHEN $6 > 0 THEN $6 ELSE ssh_port END,
			ufw_enabled = $7,
			fail2ban_enabled = $8,
			ufw_rules_json = $9,
			updated_at = NOW()
		WHERE agent_id = $10
	`, req.CPUPercent, req.MemoryUsed, req.MemoryTotal, req.DiskUsed, req.DiskTotal,
		req.SSHPort, req.UFWEnabled, req.Fail2ban, ufwRulesJSON, agentID)
	if err != nil {
		log.Printf("Failed to update machine stats: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// GetJobs returns pending jobs for an agent
func (h *AgentHandler) GetJobs(w http.ResponseWriter, r *http.Request) {
	agentID, ok := r.Context().Value("agent_id").(uuid.UUID)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var jobs []models.Job
	err := h.db.Select(&jobs, `
		SELECT * FROM jobs 
		WHERE agent_id = $1 AND status = 'pending'
		ORDER BY created_at ASC
		LIMIT 10
	`, agentID)
	if err != nil {
		log.Printf("Failed to get jobs: %v", err)
		http.Error(w, "Failed to get jobs", http.StatusInternalServerError)
		return
	}

	if jobs == nil {
		jobs = []models.Job{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

// UpdateJob updates job status
func (h *AgentHandler) UpdateJob(w http.ResponseWriter, r *http.Request) {
	agentID, ok := r.Context().Value("agent_id").(uuid.UUID)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		JobID  uuid.UUID `json:"job_id"`
		Status string    `json:"status"`
		Logs   string    `json:"logs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var finishedAt *time.Time
	if req.Status == "completed" || req.Status == "failed" {
		now := time.Now()
		finishedAt = &now
	}

	var startedAt *time.Time
	if req.Status == "running" {
		now := time.Now()
		startedAt = &now
	}

	_, err := h.db.Exec(`
		UPDATE jobs 
		SET status = $1, logs = COALESCE(logs || E'\n' || $2, $2), 
			started_at = COALESCE(started_at, $3),
			finished_at = $4,
			updated_at = NOW()
		WHERE id = $5 AND agent_id = $6
	`, req.Status, req.Logs, startedAt, finishedAt, req.JobID, agentID)
	if err != nil {
		log.Printf("Failed to update job: %v", err)
		http.Error(w, "Failed to update job", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// AgentAuthMiddleware validates agent API key
// Note: API keys are stored as bcrypt hashes, so we need to iterate through agents
// For production with many agents, consider adding a key prefix/identifier
func AgentAuthMiddleware(db *database.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			apiKey := r.Header.Get("X-API-Key")
			if apiKey == "" {
				http.Error(w, "Missing API key", http.StatusUnauthorized)
				return
			}

			// Security: Limit key length to prevent DoS
			if len(apiKey) > 256 {
				http.Error(w, "Invalid API key", http.StatusUnauthorized)
				return
			}

			// Find agent by checking API key hash
			// Only get active agents (seen in last 30 days) to reduce iteration
			var agents []models.Agent
			err := db.Select(&agents, `
				SELECT id, api_key_hash FROM agents 
				WHERE api_key_hash IS NOT NULL 
				AND (last_seen IS NULL OR last_seen > NOW() - INTERVAL '30 days')
			`)
			if err != nil {
				log.Printf("Agent auth DB error: %v", err)
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			var matchedAgent *models.Agent
			for i := range agents {
				agent := &agents[i]
				if agent.APIKeyHash != nil {
					if err := bcrypt.CompareHashAndPassword([]byte(*agent.APIKeyHash), []byte(apiKey)); err == nil {
						matchedAgent = agent
						break
					}
				}
			}

			if matchedAgent == nil {
				// Log failed attempts (rate limit this in production)
				log.Printf("Invalid agent API key attempt")
				http.Error(w, "Invalid API key", http.StatusUnauthorized)
				return
			}

			// Add agent ID to context
			ctx := r.Context()
			ctx = context.WithValue(ctx, "agent_id", matchedAgent.ID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

