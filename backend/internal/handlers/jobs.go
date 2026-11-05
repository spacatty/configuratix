package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobhooks"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

type JobsHandler struct {
	db *database.DB
}

func NewJobsHandler(db *database.DB) *JobsHandler {
	return &JobsHandler{db: db}
}

// JobListItem is one row of GET /api/jobs (no logs/payload unless include_logs=1).
type JobListItem struct {
	ID              uuid.UUID  `db:"id" json:"id"`
	Title           string     `db:"title" json:"title"`
	Type            string     `db:"type" json:"type"`
	Action          *string    `db:"action" json:"action"`
	Status          string     `db:"status" json:"status"`
	AgentID         *uuid.UUID `db:"agent_id" json:"agent_id"`
	MachineID       *uuid.UUID `db:"machine_id" json:"machine_id"`
	MachineTitle    *string    `db:"machine_title" json:"machine_title"`
	MachineHostname *string    `db:"machine_hostname" json:"machine_hostname"`
	EntityType      *string    `db:"entity_type" json:"entity_type"`
	EntityID        *string    `db:"entity_id" json:"entity_id"`
	CreatedByEmail  *string    `db:"created_by_email" json:"created_by_email"`
	CreatedAt       time.Time  `db:"created_at" json:"created_at"`
	StartedAt       *time.Time `db:"started_at" json:"started_at"`
	FinishedAt      *time.Time `db:"finished_at" json:"finished_at"`
	DurationMS      *int64     `db:"duration_ms" json:"duration_ms"`
	ErrorMessage    *string    `db:"error_message" json:"error_message"`
	Attempts        int        `db:"attempts" json:"attempts"`
	CancelRequested bool       `db:"cancel_requested" json:"cancel_requested"`
	ParentJobID     *uuid.UUID `db:"parent_job_id" json:"parent_job_id"`

	// Only with include_logs=1 (legacy machine page).
	Logs    *string         `db:"logs" json:"logs,omitempty"`
	Payload json.RawMessage `db:"payload_json" json:"-"`
}

type jobCounts struct {
	Pending   int `json:"pending"`
	Running   int `json:"running"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
	Cancelled int `json:"cancelled"`
}

func (c *jobCounts) add(status string, n int) {
	switch status {
	case models.JobStatusPending:
		c.Pending += n
	case models.JobStatusRunning:
		c.Running += n
	case models.JobStatusCompleted:
		c.Completed += n
	case models.JobStatusFailed:
		c.Failed += n
	case models.JobStatusCancelled:
		c.Cancelled += n
	}
}

const jobListSelect = `
	SELECT j.id, COALESCE(j.title, INITCAP(REPLACE(j.type, '_', ' '))) AS title, j.type, j.action, COALESCE(j.status, 'pending') AS status,
		j.agent_id, m.id AS machine_id, COALESCE(NULLIF(m.title, ''), m.hostname) AS machine_title, m.hostname AS machine_hostname,
		j.entity_type, j.entity_id, u.email AS created_by_email,
		COALESCE(j.created_at, NOW()) AS created_at, j.started_at, j.finished_at,
		CASE WHEN j.started_at IS NOT NULL THEN
			(EXTRACT(EPOCH FROM (COALESCE(j.finished_at, NOW()) - j.started_at)) * 1000)::bigint END AS duration_ms,
		j.error_message, COALESCE(j.attempts, 0) AS attempts, COALESCE(j.cancel_requested, false) AS cancel_requested,
		j.parent_job_id`

const jobListFrom = `
	FROM jobs j
	LEFT JOIN machines m ON m.agent_id = j.agent_id
	LEFT JOIN users u ON u.id = j.created_by`

// sqlBuilder collects WHERE conditions with numbered placeholders.
type sqlBuilder struct {
	conds []string
	args  []interface{}
}

func (b *sqlBuilder) arg(v interface{}) string {
	b.args = append(b.args, v)
	return "$" + strconv.Itoa(len(b.args))
}

func (b *sqlBuilder) where() string {
	if len(b.conds) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(b.conds, " AND ")
}

// jobScope adds the permission filter (superadmin: all; others: jobs of visible machines).
func jobScope(b *sqlBuilder, r *http.Request) bool {
	claims, uid, ok := requestClaims(r)
	if !ok {
		return false
	}
	if !claims.IsSuperAdmin() {
		b.args = append(b.args, uid)
		b.conds = append(b.conds, "m.id IS NOT NULL AND "+machineVisibilitySQL("m", len(b.args)))
	}
	return true
}

func parseSince(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	if d, err := time.ParseDuration(s); err == nil && d > 0 {
		return time.Now().Add(-d), true
	}
	return time.Time{}, false
}

func encodeCursor(t time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}

func decodeCursor(c string) (time.Time, uuid.UUID, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, uuid.Nil, false
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, false
	}
	t, err1 := time.Parse(time.RFC3339Nano, parts[0])
	id, err2 := uuid.Parse(parts[1])
	return t, id, err1 == nil && err2 == nil
}

// ListJobs: GET /api/jobs — permission-scoped, filterable, cursor-paginated.
func (h *JobsHandler) ListJobs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	b := &sqlBuilder{}
	if !jobScope(b, r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if v := q.Get("machine_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			http.Error(w, "Invalid machine_id", http.StatusBadRequest)
			return
		}
		b.conds = append(b.conds, "m.id = "+b.arg(id))
	}
	if v := q.Get("agent_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			http.Error(w, "Invalid agent_id", http.StatusBadRequest)
			return
		}
		b.conds = append(b.conds, "j.agent_id = "+b.arg(id))
	}
	if v := q.Get("type"); v != "" {
		p := b.arg(v)
		b.conds = append(b.conds, "(j.type = "+p+" OR j.action = "+p+")")
	}
	if v := q.Get("action"); v != "" {
		b.conds = append(b.conds, "j.action = "+b.arg(v))
	}
	if v := q.Get("entity_type"); v != "" {
		b.conds = append(b.conds, "j.entity_type = "+b.arg(v))
	}
	if v := q.Get("entity_id"); v != "" {
		b.conds = append(b.conds, "j.entity_id = "+b.arg(v))
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		b.conds = append(b.conds, "j.title ILIKE "+b.arg("%"+escapeLike(v)+"%"))
	}
	if v := q.Get("since"); v != "" {
		t, ok := parseSince(v)
		if !ok {
			http.Error(w, "Invalid since (RFC3339 timestamp or duration like 24h)", http.StatusBadRequest)
			return
		}
		b.conds = append(b.conds, "j.created_at >= "+b.arg(t))
	}

	// Counts use every filter except status and cursor.
	countConds := append([]string{}, b.conds...)
	countArgs := append([]interface{}{}, b.args...)

	if v := q.Get("status"); v != "" {
		var statuses []string
		for _, s := range strings.Split(v, ",") {
			if s = strings.TrimSpace(s); s != "" {
				statuses = append(statuses, s)
			}
		}
		if len(statuses) > 0 {
			b.conds = append(b.conds, "j.status = ANY("+b.arg(pq.Array(statuses))+")")
		}
	}
	if c := q.Get("cursor"); c != "" {
		t, id, ok := decodeCursor(c)
		if !ok {
			http.Error(w, "Invalid cursor", http.StatusBadRequest)
			return
		}
		b.conds = append(b.conds, "(j.created_at, j.id) < ("+b.arg(t)+", "+b.arg(id)+")")
	}

	limit := 50
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 200 {
		limit = 200
	}

	includeLogs := q.Get("include_logs") == "1" || q.Get("include_logs") == "true"
	sel := jobListSelect
	if includeLogs {
		sel += ", RIGHT(j.logs, 20000) AS logs, COALESCE(j.payload_json, '{}'::jsonb) AS payload_json"
	}
	query := sel + jobListFrom + b.where() + " ORDER BY j.created_at DESC, j.id DESC LIMIT " + b.arg(limit+1)

	items := []JobListItem{}
	if err := h.db.Select(&items, query, b.args...); err != nil {
		log.Printf("Failed to list jobs: %v", err)
		http.Error(w, "Failed to list jobs", http.StatusInternalServerError)
		return
	}

	var nextCursor *string
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		c := encodeCursor(last.CreatedAt, last.ID)
		nextCursor = &c
	}
	if includeLogs {
		for i := range items {
			if items[i].Logs != nil {
				_, secrets := redactPayload(items[i].Payload)
				red := redactLogs(*items[i].Logs, secrets)
				items[i].Logs = &red
			}
		}
	}

	var counts jobCounts
	var rows []struct {
		Status string `db:"status"`
		N      int    `db:"n"`
	}
	cb := &sqlBuilder{conds: countConds, args: countArgs}
	if err := h.db.Select(&rows, "SELECT COALESCE(j.status, 'pending') AS status, COUNT(*)::int AS n"+jobListFrom+cb.where()+" GROUP BY j.status", cb.args...); err == nil {
		for _, row := range rows {
			counts.add(row.Status, row.N)
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"jobs":        items,
		"next_cursor": nextCursor,
		"counts":      counts,
	})
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// JobDetail is GET /api/jobs/{id}.
type JobDetail struct {
	JobListItem
	TimeoutSeconds *int            `json:"timeout_seconds"`
	UpdatedAt      time.Time       `json:"updated_at"`
	Logs           string          `json:"logs"`
	Payload        json.RawMessage `json:"payload"`
	ResultJSON     json.RawMessage `json:"result_json"`
	Retries        []uuid.UUID     `json:"retries"`
}

// loadVisibleJob loads a job if the requester can see it.
func (h *JobsHandler) loadVisibleJob(r *http.Request, id uuid.UUID) (*JobListItem, error) {
	b := &sqlBuilder{}
	if !jobScope(b, r) {
		return nil, sql.ErrNoRows
	}
	b.conds = append(b.conds, "j.id = "+b.arg(id))
	var item JobListItem
	if err := h.db.Get(&item, jobListSelect+jobListFrom+b.where(), b.args...); err != nil {
		return nil, err
	}
	return &item, nil
}

// GetJob: GET /api/jobs/{id} — full detail, logs and payload redacted.
func (h *JobsHandler) GetJob(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid job ID", http.StatusBadRequest)
		return
	}
	item, err := h.loadVisibleJob(r, id)
	if err != nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}
	var full models.Job
	if err := h.db.Get(&full, "SELECT "+models.JobColumns+" FROM jobs WHERE id = $1", id); err != nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}
	payload, secrets := redactPayload(full.PayloadJSON)
	detail := JobDetail{
		JobListItem:    *item,
		TimeoutSeconds: full.TimeoutSeconds,
		UpdatedAt:      full.UpdatedAt,
		Logs:           redactLogs(nullStringToString(full.Logs), secrets),
		Payload:        payload,
		ResultJSON:     json.RawMessage(full.ResultJSON),
		Retries:        []uuid.UUID{},
	}
	_ = h.db.Select(&detail.Retries, "SELECT id FROM jobs WHERE parent_job_id = $1 ORDER BY created_at", id)
	writeJSON(w, http.StatusOK, detail)
}

// CancelJob: POST /api/jobs/{id}/cancel
func (h *JobsHandler) CancelJob(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid job ID", http.StatusBadRequest)
		return
	}
	item, err := h.loadVisibleJob(r, id)
	if err != nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}
	if !h.canManageJob(r, item) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	switch item.Status {
	case models.JobStatusPending:
		res, err := h.db.Exec(`UPDATE jobs SET status = 'cancelled', cancel_requested = true, finished_at = NOW(),
			error_message = 'Cancelled by user', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, id)
		if err != nil {
			http.Error(w, "Failed to cancel job", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			// Raced with the agent picking it up: request cancellation instead.
			h.db.Exec(`UPDATE jobs SET cancel_requested = true, updated_at = NOW() WHERE id = $1`, id)
			writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "status": "running", "cancel_requested": true})
			return
		}
		jobhooks.OnJobFinished(r.Context(), h.db, id.String())
		writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "status": "cancelled", "cancel_requested": true})
	case models.JobStatusRunning:
		h.db.Exec(`UPDATE jobs SET cancel_requested = true, updated_at = NOW() WHERE id = $1`, id)
		writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "status": "running", "cancel_requested": true})
	default:
		http.Error(w, "Job is already "+item.Status, http.StatusConflict)
	}
}

// RetryJob: POST /api/jobs/{id}/retry — clones a failed/cancelled job.
func (h *JobsHandler) RetryJob(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid job ID", http.StatusBadRequest)
		return
	}
	item, err := h.loadVisibleJob(r, id)
	if err != nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}
	if !h.canManageJob(r, item) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	if item.Status != models.JobStatusFailed && item.Status != models.JobStatusCancelled {
		http.Error(w, "Only failed or cancelled jobs can be retried", http.StatusConflict)
		return
	}
	var orig models.Job
	if err := h.db.Get(&orig, "SELECT "+models.JobColumns+" FROM jobs WHERE id = $1", id); err != nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	// Passthrough payloads embed their transaction id in the scripts: re-render from current DB
	// state (fresh txn, fresh backups) instead of cloning.
	if a := derefStr(orig.Action); (a == "passthrough_apply" || a == "passthrough_remove") && orig.EntityID != nil {
		machineID, perr := uuid.Parse(*orig.EntityID)
		if perr != nil {
			http.Error(w, "Invalid passthrough job entity", http.StatusConflict)
			return
		}
		meta := PassthroughJobMeta{CreatedBy: jobs.UserID(r), ParentJobID: &orig.ID, Attempts: orig.Attempts + 1}
		gen := NewPassthroughNginxGenerator(h.db)
		var job *models.Job
		if a == "passthrough_apply" {
			job, err = gen.ApplyToMachineJob(machineID, meta)
		} else {
			job, err = gen.RemoveFromMachineJob(machineID, meta)
		}
		if err != nil {
			http.Error(w, "Failed to retry: "+err.Error(), http.StatusBadRequest)
			return
		}
		if job == nil {
			http.Error(w, "Nothing to retry: machine has no passthrough configuration", http.StatusConflict)
			return
		}
		writeJSON(w, http.StatusCreated, jobCreatedResponse(job))
		return
	}

	spec := jobs.Spec{
		AgentID:     orig.AgentID,
		Type:        orig.Type,
		Payload:     refreshTxn(orig.PayloadJSON),
		Title:       derefStr(orig.Title),
		Action:      derefStr(orig.Action),
		EntityType:  derefStr(orig.EntityType),
		EntityID:    derefStr(orig.EntityID),
		CreatedBy:   jobs.UserID(r),
		ParentJobID: &orig.ID,
		Attempts:    orig.Attempts + 1,
	}
	if orig.TimeoutSeconds != nil {
		spec.TimeoutSeconds = *orig.TimeoutSeconds
	}
	job, err := jobs.Create(r.Context(), h.db, spec)
	if err != nil {
		log.Printf("Failed to retry job %s: %v", id, err)
		http.Error(w, "Failed to retry job", http.StatusInternalServerError)
		return
	}
	if spec.EntityType == jobs.EntityDomain && spec.EntityID != "" {
		state := "pending"
		h.db.Exec(`UPDATE domains SET last_job_id = $1, apply_status = $2, updated_at = NOW() WHERE id::text = $3`, job.ID, state, spec.EntityID)
	}
	if spec.EntityType == jobs.EntityPHPRuntime && spec.EntityID != "" && spec.Action != "remove_php_runtime" {
		h.db.Exec(`UPDATE php_runtimes SET status = 'installing', error_message = NULL, updated_at = NOW() WHERE machine_id::text = $1`, spec.EntityID)
	}
	writeJSON(w, http.StatusCreated, jobCreatedResponse(job))
}

// refreshTxn replaces vars.txn in a run payload so retries get fresh backup/staging dirs.
func refreshTxn(payload json.RawMessage) json.RawMessage {
	var p map[string]interface{}
	if json.Unmarshal(payload, &p) != nil {
		return payload
	}
	vars, ok := p["vars"].(map[string]interface{})
	if !ok {
		return payload
	}
	if _, has := vars["txn"]; !has {
		return payload
	}
	vars["txn"] = templates.NewTxnID()
	out, err := json.Marshal(p)
	if err != nil {
		return payload
	}
	return out
}

func (h *JobsHandler) canManageJob(r *http.Request, item *JobListItem) bool {
	claims, _, ok := requestClaims(r)
	if !ok {
		return false
	}
	if claims.IsSuperAdmin() {
		return true
	}
	return item.MachineID != nil && canManageMachineID(h.db, r, *item.MachineID)
}

// JobStats: GET /api/jobs/stats?hours=24
func (h *JobsHandler) JobStats(w http.ResponseWriter, r *http.Request) {
	hours := 24
	if v := r.URL.Query().Get("hours"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			hours = n
		}
	}
	if hours > 720 {
		hours = 720
	}
	stats, err := h.jobStats(r, hours)
	if err != nil {
		log.Printf("Failed to compute job stats: %v", err)
		http.Error(w, "Failed to compute job stats", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

type jobBucket struct {
	Hour time.Time `json:"hour"`
	jobCounts
}

type jobStatsResponse struct {
	Hours       int         `json:"hours"`
	Since       time.Time   `json:"since"`
	Counts      jobCounts   `json:"counts"`
	Total       int         `json:"total"`
	Buckets     []jobBucket `json:"buckets"`
	TopFailing  []failCount `json:"top_failing"`
	AvgDuration *int64      `json:"avg_duration_ms"`
}

type failCount struct {
	Type   string `db:"type" json:"type"`
	Failed int    `db:"failed" json:"failed"`
	Total  int    `db:"total" json:"total"`
}

func (h *JobsHandler) jobStats(r *http.Request, hours int) (*jobStatsResponse, error) {
	since := time.Now().Add(-time.Duration(hours) * time.Hour).Truncate(time.Hour)
	b := &sqlBuilder{}
	if !jobScope(b, r) {
		return nil, fmt.Errorf("unauthorized")
	}
	b.conds = append(b.conds, "j.created_at >= "+b.arg(since))
	where := b.where()

	resp := &jobStatsResponse{Hours: hours, Since: since, Buckets: []jobBucket{}, TopFailing: []failCount{}}

	var rows []struct {
		Hour   time.Time `db:"hour"`
		Status string    `db:"status"`
		N      int       `db:"n"`
	}
	if err := h.db.Select(&rows, "SELECT date_trunc('hour', j.created_at) AS hour, COALESCE(j.status, 'pending') AS status, COUNT(*)::int AS n"+
		jobListFrom+where+" GROUP BY 1, 2", b.args...); err != nil {
		return nil, err
	}
	byHour := map[int64]*jobBucket{}
	for t := since; !t.After(time.Now()); t = t.Add(time.Hour) {
		bk := &jobBucket{Hour: t.UTC()}
		byHour[t.Unix()] = bk
	}
	for _, row := range rows {
		resp.Counts.add(row.Status, row.N)
		resp.Total += row.N
		bk, ok := byHour[row.Hour.Unix()]
		if !ok {
			bk = &jobBucket{Hour: row.Hour.UTC()}
			byHour[row.Hour.Unix()] = bk
		}
		bk.add(row.Status, row.N)
	}
	for _, bk := range byHour {
		resp.Buckets = append(resp.Buckets, *bk)
	}
	sort.Slice(resp.Buckets, func(i, j int) bool { return resp.Buckets[i].Hour.Before(resp.Buckets[j].Hour) })

	_ = h.db.Select(&resp.TopFailing, `SELECT COALESCE(j.action, j.type) AS type,
			COUNT(*) FILTER (WHERE j.status = 'failed')::int AS failed, COUNT(*)::int AS total`+
		jobListFrom+where+` GROUP BY 1 HAVING COUNT(*) FILTER (WHERE j.status = 'failed') > 0
		ORDER BY 2 DESC, 3 DESC LIMIT 5`, b.args...)

	var avg sql.NullFloat64
	_ = h.db.Get(&avg, `SELECT AVG(EXTRACT(EPOCH FROM (j.finished_at - j.started_at)) * 1000)`+jobListFrom+where+
		` AND j.finished_at IS NOT NULL AND j.started_at IS NOT NULL`, b.args...)
	if avg.Valid {
		v := int64(avg.Float64)
		resp.AvgDuration = &v
	}
	return resp, nil
}

type CreateJobRequest struct {
	AgentID uuid.UUID       `json:"agent_id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	Title   string          `json:"title"`
}

// CreateJob: POST /api/jobs — raw job creation, superadmin only (not used by the UI).
func (h *JobsHandler) CreateJob(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := requestClaims(r)
	if !ok || !claims.IsSuperAdmin() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	var req CreateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Type == "" || req.AgentID == uuid.Nil {
		http.Error(w, "agent_id and type are required", http.StatusBadRequest)
		return
	}
	job, err := jobs.Create(r.Context(), h.db, jobs.Spec{
		AgentID:    req.AgentID,
		Type:       req.Type,
		Payload:    req.Payload,
		Title:      req.Title,
		EntityType: jobs.EntityCommand,
		CreatedBy:  jobs.UserID(r),
	})
	if err != nil {
		log.Printf("Failed to create job: %v", err)
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, jobCreatedResponse(job))
}

// jobCreatedResponse is the redacted representation returned when a job is created.
func jobCreatedResponse(job *models.Job) map[string]interface{} {
	payload, _ := redactPayload(job.PayloadJSON)
	return map[string]interface{}{
		"id":          job.ID,
		"job_id":      job.ID,
		"agent_id":    job.AgentID,
		"type":        job.Type,
		"action":      job.Action,
		"title":       job.Title,
		"status":      job.Status,
		"entity_type": job.EntityType,
		"entity_id":   job.EntityID,
		"payload":     payload,
		"created_at":  job.CreatedAt,
	}
}

// CreateJobForAgent creates a job (used internally).
func CreateJobForAgent(db *database.DB, agentID uuid.UUID, jobType string, payload interface{}) (*models.Job, error) {
	return jobs.Create(context.Background(), db, jobs.Spec{AgentID: agentID, Type: jobType, Payload: payload})
}

// ===================== Redaction =====================

const redactedMarker = "••••••"

var (
	sensitiveKeyRe     = regexp.MustCompile(`(?i)(^|[_-])(password|passwd|pass|secret|token|key|apikey|credentials?)([_-]|$)`)
	sensitiveContentRe = regexp.MustCompile(`(?i)(password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----`)
	contentKeys        = map[string]bool{"content": true, "config": true, "nginx_config": true, "command": true, "script": true}
)

// redactPayload masks sensitive values in a job payload and returns the values that were
// masked so they can also be removed from logs.
func redactPayload(raw json.RawMessage) (json.RawMessage, []string) {
	if len(raw) == 0 {
		return raw, nil
	}
	var v interface{}
	if err := json.Unmarshal(raw, &v); err != nil {
		return json.RawMessage(`"[unreadable payload]"`), nil
	}
	var secrets []string
	v = redactValue("", v, &secrets)
	out, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`"[unreadable payload]"`), secrets
	}
	return out, secrets
}

func redactValue(key string, v interface{}, secrets *[]string) interface{} {
	switch t := v.(type) {
	case map[string]interface{}:
		for k, child := range t {
			t[k] = redactValue(k, child, secrets)
		}
		return t
	case []interface{}:
		for i, child := range t {
			t[i] = redactValue(key, child, secrets)
		}
		return t
	case string:
		if key != "" && sensitiveKeyRe.MatchString(key) && t != "" {
			*secrets = append(*secrets, t)
			return redactedMarker
		}
		if contentKeys[key] && key != "command" && key != "script" && sensitiveContentRe.MatchString(t) {
			return "[redacted: content contains credentials]"
		}
		if (key == "command" || key == "script") && sensitiveContentRe.MatchString(t) {
			return sensitiveAssignRe.ReplaceAllString(t, "${1}"+redactedMarker)
		}
		return t
	default:
		return v
	}
}

var sensitiveAssignRe = regexp.MustCompile(`(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?)[^\s'"]+`)

// redactLogs removes known secret values from logs.
func redactLogs(logs string, secrets []string) string {
	for _, s := range secrets {
		if len(s) >= 4 {
			logs = strings.ReplaceAll(logs, s, redactedMarker)
		}
	}
	return logs
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
