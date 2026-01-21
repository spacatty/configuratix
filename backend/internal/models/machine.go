package models

import (
	"time"

	"github.com/google/uuid"
)

type Machine struct {
	ID           uuid.UUID  `db:"id" json:"id"`
	AgentID      *uuid.UUID `db:"agent_id" json:"agent_id"`
	Hostname     *string    `db:"hostname" json:"hostname"`
	IPAddress    *string    `db:"ip_address" json:"ip_address"`
	UbuntuVersion *string   `db:"ubuntu_version" json:"ubuntu_version"`
	NotesMD      *string    `db:"notes_md" json:"notes_md"`
	CreatedAt    time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time  `db:"updated_at" json:"updated_at"`
}

