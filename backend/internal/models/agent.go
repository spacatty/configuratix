package models

import (
	"time"

	"github.com/google/uuid"
)

type Agent struct {
	ID          uuid.UUID  `db:"id" json:"id"`
	Name        string     `db:"name" json:"name"`
	TokenHash   string     `db:"token_hash" json:"-"`
	APIKeyHash  *string    `db:"api_key_hash" json:"-"`
	Version     *string    `db:"version" json:"version"`
	LastSeen    *time.Time `db:"last_seen" json:"last_seen"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
}

