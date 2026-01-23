package models

import (
	"time"

	"github.com/google/uuid"
)

type Domain struct {
	ID                uuid.UUID  `db:"id" json:"id"`
	FQDN              string     `db:"fqdn" json:"fqdn"`
	OwnerID           *uuid.UUID `db:"owner_id" json:"owner_id"`
	AssignedMachineID *uuid.UUID `db:"assigned_machine_id" json:"assigned_machine_id"`
	ConfigID          *uuid.UUID `db:"config_id" json:"config_id"`
	Status            string     `db:"status" json:"status"` // idle, linked, healthy, unhealthy
	NotesMD           *string    `db:"notes_md" json:"notes_md"`
	LastCheckAt       *time.Time `db:"last_check_at" json:"last_check_at"`
	CreatedAt         time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time  `db:"updated_at" json:"updated_at"`
}
