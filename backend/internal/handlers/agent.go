package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobhooks"
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
	AgentID uuid.UUID `json:"agent_id"`
	APIKey  string    `json:"api_key"`
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
		INSERT INTO agents (name, token_hash, api_key_hash, api_key_lookup, last_seen)
		VALUES ($1, $2, $3, $4, NOW())
		RETURNING id
	`, req.Hostname, tokenHash, apiKeyHash, apiKeyLookup(apiKey))
	if err != nil {
		log.Printf("Failed to create agent: %v", err)
		http.Error(w, "Failed to enroll agent", http.StatusInternalServerError)
		return
	}

	// Create machine with owner from enrollment token, set title to hostname by default
	_, err = tx.Exec(`
		INSERT INTO machines (agent_id, hostname, ip_address, ubuntu_version, owner_id, title)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, agent.ID, req.Hostname, req.IP, req.OS, enrollmentToken.OwnerID, req.Hostname)
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

// InterfaceIP represents an IP address on an interface
type InterfaceIP struct {
	Interface string `json:"interface"`
	IP        string `json:"ip"`
	IsPublic  bool   `json:"is_public"`
	IsIPv6    bool   `json:"is_ipv6"`
}

// HeartbeatRequest includes system stats from agent.
// Fields after DetectedIPs are sent by agents >= 0.6.0 only.
type HeartbeatRequest struct {
	Version     string        `json:"version"`
	CPUPercent  float64       `json:"cpu_percent"`
	MemoryUsed  int64         `json:"memory_used"`
	MemoryTotal int64         `json:"memory_total"`
	DiskUsed    int64         `json:"disk_used"`
	DiskTotal   int64         `json:"disk_total"`
	SSHPort     int           `json:"ssh_port"`
	UFWEnabled  bool          `json:"ufw_enabled"`
	UFWRules    []UFWRule     `json:"ufw_rules"`
	Fail2ban    bool          `json:"fail2ban_enabled"`
	DetectedIPs []InterfaceIP `json:"detected_ips"`

	Arch                string   `json:"arch"`
	OS                  string   `json:"os"`
	Capabilities        []string `json:"capabilities"`
	RunningJobID        *string  `json:"running_job_id"`
	UpdateState         string   `json:"update_state"`
	UpdateTargetVersion string   `json:"update_target_version"`
	UpdateError         string   `json:"update_error"`
	UpdateJobID         string   `json:"update_job_id"`
	UpdateAvailable     bool     `json:"update_available"`
	LatestVersion       string   `json:"latest_version"`
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

	// v2 agents always send capabilities; only they report running_job_id.
	isV2 := req.Capabilities != nil
	var capsJSON []byte
	var runningJobID *uuid.UUID
	if isV2 {
		capsJSON, _ = json.Marshal(req.Capabilities)
		if req.RunningJobID != nil {
			if id, err := uuid.Parse(*req.RunningJobID); err == nil {
				runningJobID = &id
			}
		}
	}

	// Update agent last_seen, version and runtime state
	_, err := h.db.Exec(`
		UPDATE agents SET last_seen = NOW(),
			version = COALESCE(NULLIF($1, ''), version),
			arch = COALESCE(NULLIF($2, ''), arch),
			capabilities = CASE WHEN $3 THEN $4::jsonb ELSE capabilities END,
			running_job_id = CASE WHEN $3 THEN $5::uuid ELSE running_job_id END
		WHERE id = $6
	`, req.Version, req.Arch, isV2, nullableJSON(capsJSON), runningJobID, agentID)
	if err != nil {
		log.Printf("Failed to update agent heartbeat: %v", err)
	}

	h.processUpdateHeartbeat(r.Context(), agentID, &req)

	// Serialize UFW rules to JSON
	ufwRulesJSON, _ := json.Marshal(req.UFWRules)

	// Serialize detected IPs to JSON
	detectedIPsJSON, _ := json.Marshal(req.DetectedIPs)

	// Auto-select primary IP: prefer first public IPv4, fallback to first IPv4
	var autoPrimaryIP string
	for _, ip := range req.DetectedIPs {
		if !ip.IsIPv6 && ip.IsPublic {
			autoPrimaryIP = ip.IP
			break
		}
	}
	if autoPrimaryIP == "" {
		// Fallback to first non-IPv6 IP
		for _, ip := range req.DetectedIPs {
			if !ip.IsIPv6 {
				autoPrimaryIP = ip.IP
				break
			}
		}
	}

	// Update machine stats including detected IPs
	// Only update primary_ip if it's not already set (user hasn't manually selected)
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
			detected_ips = $10,
			primary_ip = COALESCE(primary_ip, $11),
			ip_address = COALESCE($11, ip_address),
			updated_at = NOW()
		WHERE agent_id = $12
	`, req.CPUPercent, req.MemoryUsed, req.MemoryTotal, req.DiskUsed, req.DiskTotal,
		req.SSHPort, req.UFWEnabled, req.Fail2ban, ufwRulesJSON, detectedIPsJSON, autoPrimaryIP, agentID)
	if err != nil {
		log.Printf("Failed to update machine stats: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":         "ok",
		"target_version": AgentTargetVersion(),
	})
}

func nullableJSON(b []byte) interface{} {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}

// claimedJob is what agents receive from GetJobs. JSON field names match the
// legacy models.Job encoding (id, agent_id, type, payload, status, ...).
type claimedJob struct {
	ID             uuid.UUID       `db:"id" json:"id"`
	AgentID        uuid.UUID       `db:"agent_id" json:"agent_id"`
	Type           string          `db:"type" json:"type"`
	PayloadJSON    json.RawMessage `db:"payload_json" json:"payload"`
	Status         string          `db:"status" json:"status"`
	CreatedAt      time.Time       `db:"created_at" json:"created_at"`
	Seq            int64           `db:"seq" json:"seq"`
	TimeoutSeconds *int            `db:"timeout_seconds" json:"timeout_seconds,omitempty"`
	Attempts       int             `db:"attempts" json:"attempts"`
}

// GetJobs atomically claims pending jobs for an agent (marks them running).
// Concurrent polls never receive the same job (FOR UPDATE SKIP LOCKED).
// ?limit=N (1..50, default 10 for old agents; v2 agents claim one at a time).
func (h *AgentHandler) GetJobs(w http.ResponseWriter, r *http.Request) {
	agentID, ok := r.Context().Value("agent_id").(uuid.UUID)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	limit := 10
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 1 && n <= 50 {
			limit = n
		}
	}

	var jobs []claimedJob
	err := h.db.Select(&jobs, `
		UPDATE jobs j
		SET status = 'running',
			started_at = COALESCE(j.started_at, NOW()),
			attempts = COALESCE(j.attempts, 0) + 1,
			claimed_at = NOW(),
			updated_at = NOW()
		WHERE j.id IN (
			SELECT id FROM jobs
			WHERE agent_id = $1 AND status = 'pending' AND NOT COALESCE(cancel_requested, false)
			ORDER BY created_at, seq
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		RETURNING j.id, j.agent_id, j.type, j.payload_json, j.status, j.created_at, j.seq,
			j.timeout_seconds, COALESCE(j.attempts, 0) AS attempts
	`, agentID, limit)
	if err != nil {
		log.Printf("Failed to claim jobs: %v", err)
		http.Error(w, "Failed to get jobs", http.StatusInternalServerError)
		return
	}

	// RETURNING order is unspecified: restore queue order.
	sort.Slice(jobs, func(i, k int) bool {
		if !jobs[i].CreatedAt.Equal(jobs[k].CreatedAt) {
			return jobs[i].CreatedAt.Before(jobs[k].CreatedAt)
		}
		return jobs[i].Seq < jobs[k].Seq
	})

	for _, j := range jobs {
		jobhooks.OnJobStarted(context.Background(), h.db, j.ID.String())
		if j.Type == "update_agent" {
			h.db.Exec(`
				UPDATE agents SET update_state = 'downloading'
				WHERE id = $1 AND update_job_id = $2 AND update_state = 'pending'
			`, agentID, j.ID)
		}
	}

	if jobs == nil {
		jobs = []claimedJob{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

// JobUpdateRequest is sent by agents.
//
// Legacy agents (<0.6.0) send {job_id, status, logs}; logs is appended with a
// newline separator. v2 agents stream {job_id, status:"running", append_logs}
// and finish with {job_id, status, append_logs, result, error}; append_logs is
// appended verbatim.
type JobUpdateRequest struct {
	JobID      uuid.UUID       `json:"job_id"`
	Status     string          `json:"status"`
	Logs       *string         `json:"logs"`
	AppendLogs *string         `json:"append_logs"`
	Result     json.RawMessage `json:"result"`
	Error      string          `json:"error"`
}

// JobUpdateResponse tells the agent the job's current state.
type JobUpdateResponse struct {
	Status          string `json:"status"` // "ok"
	JobStatus       string `json:"job_status"`
	CancelRequested bool   `json:"cancel_requested"`
}

const maxJobLogBytes = 8 << 20

func isTerminalStatus(s string) bool {
	return s == "completed" || s == "failed" || s == "cancelled"
}

// legacyErrorMessage extracts "Error: ..." appended by old agents.
func legacyErrorMessage(logs string) string {
	if i := strings.LastIndex(logs, "\nError: "); i >= 0 {
		return strings.TrimSpace(logs[i+len("\nError: "):])
	}
	return ""
}

// UpdateJob updates job status / appends logs / stores the structured result.
func (h *AgentHandler) UpdateJob(w http.ResponseWriter, r *http.Request) {
	agentID, ok := r.Context().Value("agent_id").(uuid.UUID)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req JobUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	switch req.Status {
	case "running", "completed", "failed", "cancelled":
	default:
		http.Error(w, "Invalid status", http.StatusBadRequest)
		return
	}

	legacy := req.AppendLogs == nil && len(req.Result) == 0
	ctx := r.Context()

	resp, finished, err := h.applyJobUpdate(ctx, agentID, &req, legacy)
	if err != nil {
		log.Printf("Failed to update job %s: %v", req.JobID, err)
		http.Error(w, "Failed to update job", http.StatusInternalServerError)
		return
	}

	if finished {
		h.afterJobFinished(ctx, req.JobID, resp.JobStatus)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// afterJobFinished runs the L7 certificate status parser and the entity hooks.
func (h *AgentHandler) afterJobFinished(ctx context.Context, jobID uuid.UUID, status string) {
	var logs sql.NullString
	h.db.Get(&logs, `SELECT logs FROM jobs WHERE id = $1`, jobID)
	l7Status := "completed"
	if status != "completed" {
		l7Status = "failed"
	}
	h.updateL7CertificateStatuses(jobID, l7Status, logs.String)
	jobhooks.OnJobFinished(context.Background(), h.db, jobID.String())
}

func (h *AgentHandler) applyJobUpdate(ctx context.Context, agentID uuid.UUID, req *JobUpdateRequest, legacy bool) (*JobUpdateResponse, bool, error) {
	tx, err := h.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()

	var cur struct {
		Status          string `db:"status"`
		Type            string `db:"type"`
		CancelRequested bool   `db:"cancel_requested"`
	}
	err = tx.GetContext(ctx, &cur, `
		SELECT COALESCE(status, 'pending') AS status, type, COALESCE(cancel_requested, false) AS cancel_requested
		FROM jobs WHERE id = $1 AND agent_id = $2 FOR UPDATE
	`, req.JobID, agentID)
	if err == sql.ErrNoRows {
		return &JobUpdateResponse{Status: "ok", JobStatus: "not_found"}, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	// Logs: legacy appends with newline separator, v2 appends verbatim.
	var appendText string
	var sep bool
	if req.Logs != nil {
		appendText, sep = *req.Logs, true
	}
	if req.AppendLogs != nil {
		appendText += *req.AppendLogs
		if req.Logs == nil {
			sep = false
		}
	}
	if req.Logs != nil || (req.AppendLogs != nil && *req.AppendLogs != "") {
		q := `UPDATE jobs SET logs = CASE
				WHEN length(COALESCE(logs, '')) > $3 THEN logs
				WHEN $4 THEN COALESCE(logs || E'\n' || $2, $2)
				ELSE COALESCE(logs, '') || $2 END,
				updated_at = NOW()
			WHERE id = $1`
		if _, err := tx.ExecContext(ctx, q, req.JobID, appendText, maxJobLogBytes, sep); err != nil {
			return nil, false, err
		}
	}

	resp := &JobUpdateResponse{Status: "ok", JobStatus: cur.Status, CancelRequested: cur.CancelRequested}

	// Terminal jobs (reaped, cancelled, confirmed) keep their status.
	if isTerminalStatus(cur.Status) {
		return resp, false, tx.Commit()
	}

	newStatus := req.Status
	if newStatus == "running" {
		startedExpr := "COALESCE(started_at, NOW())"
		if legacy {
			// Old agents claim up to 10 jobs at once and run them sequentially:
			// their own "running" report is the real start time.
			startedExpr = "NOW()"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE jobs SET status = 'running', started_at = `+startedExpr+`, updated_at = NOW() WHERE id = $1`, req.JobID); err != nil {
			return nil, false, err
		}
		resp.JobStatus = "running"
		return resp, false, tx.Commit()
	}

	errMsg := req.Error
	if errMsg == "" && newStatus != "completed" && req.Logs != nil {
		errMsg = legacyErrorMessage(*req.Logs)
	}
	if len(errMsg) > 4000 {
		errMsg = errMsg[:4000]
	}

	// update_agent: "completed" only means the new binary is installed and the
	// agent is restarting; the job completes when a heartbeat confirms the
	// target version (or fails on rollback / timeout).
	if cur.Type == "update_agent" {
		var a struct {
			Version string `db:"version"`
			Target  string `db:"target"`
		}
		tx.GetContext(ctx, &a, `SELECT COALESCE(version, '') AS version, COALESCE(update_target_version, '') AS target FROM agents WHERE id = $1`, agentID)
		if newStatus == "completed" && a.Target != "" && a.Version != a.Target {
			if _, err := tx.ExecContext(ctx, `
				UPDATE jobs SET logs = COALESCE(logs, '') || $2, result_json = COALESCE($3::jsonb, result_json), updated_at = NOW()
				WHERE id = $1`, req.JobID, "\n[server] Binary installed; waiting for the agent to restart and confirm version "+a.Target+"...\n", nullableRaw(req.Result)); err != nil {
				return nil, false, err
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE agents SET update_state = 'restarting'
				WHERE id = $1 AND update_job_id = $2 AND update_state IN ('pending','downloading','verifying','installing','restarting')
			`, agentID, req.JobID); err != nil {
				return nil, false, err
			}
			resp.JobStatus = "running"
			return resp, false, tx.Commit()
		}
		stateVal := "confirmed"
		if newStatus != "completed" {
			stateVal = "failed"
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE agents SET update_state = $3, last_update_error = NULLIF($4, '')
			WHERE id = $1 AND update_job_id = $2
		`, agentID, req.JobID, stateVal, errMsg); err != nil {
			return nil, false, err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE jobs SET status = $2::text,
			finished_at = NOW(),
			started_at = COALESCE(started_at, NOW()),
			result_json = COALESCE($3::jsonb, result_json),
			error_message = CASE WHEN $2::text = 'completed' THEN NULL ELSE COALESCE(NULLIF($4::text, ''), error_message) END,
			updated_at = NOW()
		WHERE id = $1
	`, req.JobID, newStatus, nullableRaw(req.Result), errMsg); err != nil {
		return nil, false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agents SET running_job_id = NULL WHERE id = $1 AND running_job_id = $2`, agentID, req.JobID); err != nil {
		return nil, false, err
	}
	resp.JobStatus = newStatus
	return resp, true, tx.Commit()
}

func nullableRaw(b json.RawMessage) interface{} {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	return string(b)
}

func (h *AgentHandler) updateL7CertificateStatuses(jobID uuid.UUID, jobStatus, logs string) {
	if jobStatus == "failed" {
		lastError := logs
		if len(lastError) > 4000 {
			lastError = lastError[len(lastError)-4000:]
		}
		_, err := h.db.Exec(`
			UPDATE dns_l7_certificates
			SET status = 'failed',
				last_error = $1,
				last_checked_at = NOW(),
				updated_at = NOW()
			WHERE last_job_id = $2
		`, lastError, jobID)
		if err != nil {
			log.Printf("Failed to mark L7 certificate rows failed for job %s: %v", jobID, err)
		}
		return
	}

	for _, line := range strings.Split(logs, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "CONFIGURATIX_L7_CERT_STATUS|") {
			continue
		}
		parts := strings.SplitN(line, "|", 5)
		if len(parts) != 5 {
			continue
		}

		domain := parts[1]
		status := parts[2]
		expiresRaw := parts[3]
		detail := parts[4]

		var expiresAt *time.Time
		if expiresRaw != "" {
			if parsed, err := time.Parse(time.RFC3339, expiresRaw); err == nil {
				expiresAt = &parsed
			}
		}

		var issuer *string
		var lastError *string
		if status == "valid" || status == "expiring" {
			if detail != "" {
				issuer = &detail
			}
		} else if detail != "" {
			lastError = &detail
		}

		_, err := h.db.Exec(`
			UPDATE dns_l7_certificates
			SET status = $1,
				expires_at = $2,
				issuer = $3,
				last_error = $4,
				last_checked_at = NOW(),
				updated_at = NOW()
			WHERE last_job_id = $5 AND domain = $6
		`, status, expiresAt, issuer, lastError, jobID, domain)
		if err != nil {
			log.Printf("Failed to update L7 certificate status for %s in job %s: %v", domain, jobID, err)
		}
	}
}

// apiKeyLookup returns the indexed lookup digest for an agent API key.
// Keys are 256-bit random values, so an unsalted SHA-256 is safe to store and index.
func apiKeyLookup(apiKey string) string {
	sum := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(sum[:])
}

// invalidAgentKeys remembers recently rejected keys (by lookup digest) so that
// agents of deleted machines retrying every few seconds don't trigger repeated
// bcrypt sweeps over legacy agents.
var invalidAgentKeys = struct {
	sync.Mutex
	m map[string]time.Time
}{m: make(map[string]time.Time)}

const (
	invalidAgentKeyTTL    = 10 * time.Minute
	invalidAgentKeyMaxLen = 10000
)

func isKnownInvalidAgentKey(lookup string) bool {
	invalidAgentKeys.Lock()
	defer invalidAgentKeys.Unlock()
	exp, ok := invalidAgentKeys.m[lookup]
	if ok && time.Now().After(exp) {
		delete(invalidAgentKeys.m, lookup)
		return false
	}
	return ok
}

func rememberInvalidAgentKey(lookup string) {
	invalidAgentKeys.Lock()
	defer invalidAgentKeys.Unlock()
	now := time.Now()
	if len(invalidAgentKeys.m) >= invalidAgentKeyMaxLen {
		for k, exp := range invalidAgentKeys.m {
			if now.After(exp) {
				delete(invalidAgentKeys.m, k)
			}
		}
		if len(invalidAgentKeys.m) >= invalidAgentKeyMaxLen {
			invalidAgentKeys.m = make(map[string]time.Time)
		}
	}
	invalidAgentKeys.m[lookup] = now.Add(invalidAgentKeyTTL)
}

// AgentAuthMiddleware validates agent API key.
// Keys are matched by an indexed SHA-256 lookup column. Agents enrolled before
// that column existed are matched once via bcrypt and then backfilled.
func AgentAuthMiddleware(db *database.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check header first, then query parameter (for WebSocket connections)
			apiKey := r.Header.Get("X-API-Key")
			if apiKey == "" {
				apiKey = r.URL.Query().Get("key")
			}
			if apiKey == "" {
				http.Error(w, "Missing API key", http.StatusUnauthorized)
				return
			}

			// Security: Limit key length to prevent DoS
			if len(apiKey) > 256 {
				http.Error(w, "Invalid API key", http.StatusUnauthorized)
				return
			}

			lookup := apiKeyLookup(apiKey)

			// Fast path: indexed lookup
			var agentID uuid.UUID
			err := db.Get(&agentID, `SELECT id FROM agents WHERE api_key_lookup = $1`, lookup)
			if err != nil && err != sql.ErrNoRows {
				log.Printf("Agent auth DB error: %v", err)
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			matched := err == nil

			// Slow path: legacy agents without a lookup digest yet (bcrypt, once per agent)
			if !matched && !isKnownInvalidAgentKey(lookup) {
				var agents []models.Agent
				err := db.Select(&agents, `
					SELECT id, api_key_hash FROM agents
					WHERE api_key_hash IS NOT NULL AND api_key_lookup IS NULL
					AND (last_seen IS NULL OR last_seen > NOW() - INTERVAL '30 days')
				`)
				if err != nil {
					log.Printf("Agent auth DB error: %v", err)
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}
				for i := range agents {
					if bcrypt.CompareHashAndPassword([]byte(*agents[i].APIKeyHash), []byte(apiKey)) == nil {
						agentID = agents[i].ID
						matched = true
						if _, err := db.Exec(`UPDATE agents SET api_key_lookup = $1 WHERE id = $2`, lookup, agentID); err != nil {
							log.Printf("Failed to backfill agent API key lookup for %s: %v", agentID, err)
						}
						break
					}
				}
				if !matched {
					rememberInvalidAgentKey(lookup)
				}
			}

			if !matched {
				http.Error(w, "Invalid API key", http.StatusUnauthorized)
				return
			}

			// Add agent ID to context
			ctx := r.Context()
			ctx = context.WithValue(ctx, "agent_id", agentID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
