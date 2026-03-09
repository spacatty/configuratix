package models

import (
	"time"

	"github.com/google/uuid"
)

// DomainGroup represents a group for organizing domains
type DomainGroup struct {
	ID        uuid.UUID `db:"id" json:"id"`
	OwnerID   uuid.UUID `db:"owner_id" json:"owner_id"`
	Name      string    `db:"name" json:"name"`
	Emoji     string    `db:"emoji" json:"emoji"`
	Color     string    `db:"color" json:"color"`
	Position  int       `db:"position" json:"position"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// DomainGroupWithCount includes the count of domains in the group
type DomainGroupWithCount struct {
	DomainGroup
	DomainCount int `db:"domain_count" json:"domain_count"`
}

// DomainGroupMember represents a domain's membership in a group
type DomainGroupMember struct {
	ID        uuid.UUID `db:"id" json:"id"`
	GroupID   uuid.UUID `db:"group_id" json:"group_id"`
	DomainID  uuid.UUID `db:"domain_id" json:"domain_id"`
	Position  int       `db:"position" json:"position"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}
