package models

import (
	"time"

	"github.com/google/uuid"
)

// LandingType defines the type of landing page
const (
	LandingTypeHTML = "html"
	LandingTypePHP  = "php"
)

type Landing struct {
	ID          uuid.UUID  `db:"id" json:"id"`
	Name        string     `db:"name" json:"name"`
	OwnerID     uuid.UUID  `db:"owner_id" json:"owner_id"`
	Type        string     `db:"type" json:"type"` // html, php, asset
	FileName    string     `db:"file_name" json:"file_name"`
	FileSize    int64      `db:"file_size" json:"file_size"`
	StoragePath string     `db:"storage_path" json:"-"` // Internal path, not exposed
	PreviewPath *string    `db:"preview_path" json:"preview_path,omitempty"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
}

// LandingWithOwner includes owner info - explicitly list all fields to avoid sqlx embedding issues
type LandingWithOwner struct {
	ID          uuid.UUID  `db:"id" json:"id"`
	Name        string     `db:"name" json:"name"`
	OwnerID     uuid.UUID  `db:"owner_id" json:"owner_id"`
	Type        string     `db:"type" json:"type"`
	FileName    string     `db:"file_name" json:"file_name"`
	FileSize    int64      `db:"file_size" json:"file_size"`
	StoragePath string     `db:"storage_path" json:"-"`
	PreviewPath *string    `db:"preview_path" json:"preview_path,omitempty"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
	OwnerEmail  string     `db:"owner_email" json:"owner_email"`
	OwnerName   string     `db:"owner_name" json:"owner_name"`
}

