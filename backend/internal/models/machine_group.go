package models

import (
	"time"

	"github.com/google/uuid"
)

// MachineGroup represents a group for organizing machines
type MachineGroup struct {
	ID        uuid.UUID `db:"id" json:"id"`
	OwnerID   uuid.UUID `db:"owner_id" json:"owner_id"`
	Name      string    `db:"name" json:"name"`
	Emoji     string    `db:"emoji" json:"emoji"`
	Color     string    `db:"color" json:"color"`
	Position  int       `db:"position" json:"position"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// MachineGroupWithCount includes the count of machines in the group
type MachineGroupWithCount struct {
	MachineGroup
	MachineCount int `db:"machine_count" json:"machine_count"`
}

// MachineGroupMember represents a machine's membership in a group
type MachineGroupMember struct {
	ID        uuid.UUID `db:"id" json:"id"`
	GroupID   uuid.UUID `db:"group_id" json:"group_id"`
	MachineID uuid.UUID `db:"machine_id" json:"machine_id"`
	Position  int       `db:"position" json:"position"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

// MachineInGroup represents a machine with its position in a group
type MachineInGroup struct {
	Machine
	Position int `db:"position" json:"position"`
}

