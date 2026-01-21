package models

import (
	"time"

	"github.com/google/uuid"
)

type EnrollmentToken struct {
	ID        uuid.UUID  `db:"id" json:"id"`
	Name      *string    `db:"name" json:"name"`
	Token     string     `db:"token" json:"token,omitempty"` // Only shown once on creation
	OwnerID   *uuid.UUID `db:"owner_id" json:"owner_id"`
	ExpiresAt time.Time  `db:"expires_at" json:"expires_at"`
	UsedAt    *time.Time `db:"used_at" json:"used_at"`
	CreatedAt time.Time  `db:"created_at" json:"created_at"`
}
