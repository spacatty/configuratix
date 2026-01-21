package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Job struct {
	ID         uuid.UUID       `db:"id" json:"id"`
	AgentID    uuid.UUID       `db:"agent_id" json:"agent_id"`
	Type       string           `db:"type" json:"type"`
	PayloadJSON json.RawMessage `db:"payload_json" json:"payload"`
	Status     string           `db:"status" json:"status"` // pending, running, completed, failed
	Logs       *string          `db:"logs" json:"logs"`
	StartedAt  *time.Time       `db:"started_at" json:"started_at"`
	FinishedAt *time.Time       `db:"finished_at" json:"finished_at"`
	CreatedAt  time.Time        `db:"created_at" json:"created_at"`
	UpdatedAt  time.Time        `db:"updated_at" json:"updated_at"`
}

