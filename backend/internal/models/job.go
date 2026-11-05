package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Job statuses
const (
	JobStatusPending   = "pending"
	JobStatusRunning   = "running"
	JobStatusCompleted = "completed"
	JobStatusFailed    = "failed"
	JobStatusCancelled = "cancelled"
)

// IsTerminalJobStatus reports whether a job status is final.
func IsTerminalJobStatus(s string) bool {
	return s == JobStatusCompleted || s == JobStatusFailed || s == JobStatusCancelled
}

// JobColumns is the explicit column list matching Job. Use it instead of SELECT * so that
// columns added by later migrations do not break sqlx scanning.
const JobColumns = `id, agent_id, type, COALESCE(payload_json, '{}'::jsonb) AS payload_json, COALESCE(status, 'pending') AS status, logs,
	started_at, finished_at, COALESCE(created_at, NOW()) AS created_at, COALESCE(updated_at, created_at, NOW()) AS updated_at,
	title, action, created_by, entity_type, entity_id, result_json, error_message, timeout_seconds,
	COALESCE(attempts, 0) AS attempts, COALESCE(cancel_requested, false) AS cancel_requested, parent_job_id`

type Job struct {
	ID          uuid.UUID       `db:"id" json:"id"`
	AgentID     uuid.UUID       `db:"agent_id" json:"agent_id"`
	Type        string          `db:"type" json:"type"`
	PayloadJSON json.RawMessage `db:"payload_json" json:"payload"`
	Status      string          `db:"status" json:"status"` // pending, running, completed, failed, cancelled
	Logs        *string         `db:"logs" json:"logs"`
	StartedAt   *time.Time      `db:"started_at" json:"started_at"`
	FinishedAt  *time.Time      `db:"finished_at" json:"finished_at"`
	CreatedAt   time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time       `db:"updated_at" json:"updated_at"`

	// Metadata (migration 039)
	Title           *string         `db:"title" json:"title,omitempty"`
	Action          *string         `db:"action" json:"action,omitempty"`
	CreatedBy       *uuid.UUID      `db:"created_by" json:"created_by,omitempty"`
	EntityType      *string         `db:"entity_type" json:"entity_type,omitempty"`
	EntityID        *string         `db:"entity_id" json:"entity_id,omitempty"`
	ResultJSON      NullRawMessage  `db:"result_json" json:"result_json,omitempty"`
	ErrorMessage    *string         `db:"error_message" json:"error_message,omitempty"`
	TimeoutSeconds  *int            `db:"timeout_seconds" json:"timeout_seconds,omitempty"`
	Attempts        int             `db:"attempts" json:"attempts"`
	CancelRequested bool            `db:"cancel_requested" json:"cancel_requested"`
	ParentJobID     *uuid.UUID      `db:"parent_job_id" json:"parent_job_id,omitempty"`
	// Internal: set once jobhooks.OnJobFinished has run. Kept so legacy "SELECT *" scans still work.
	HooksProcessedAt *time.Time `db:"hooks_processed_at" json:"-"`
	// Agent runtime (migration 040). Present so legacy "SELECT *" scans keep working.
	Seq       int64      `db:"seq" json:"seq"`
	ClaimedAt *time.Time `db:"claimed_at" json:"claimed_at,omitempty"`
}
