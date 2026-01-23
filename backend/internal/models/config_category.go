package models

import (
	"time"

	"github.com/google/uuid"
)

// ConfigCategory represents a custom config file category
type ConfigCategory struct {
	ID        uuid.UUID `db:"id" json:"id"`
	MachineID uuid.UUID `db:"machine_id" json:"machine_id"`
	Name      string    `db:"name" json:"name"`
	Emoji     string    `db:"emoji" json:"emoji"`
	Color     string    `db:"color" json:"color"`
	Position  int       `db:"position" json:"position"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// ConfigPath represents a file path within a category
type ConfigPath struct {
	ID            uuid.UUID `db:"id" json:"id"`
	CategoryID    uuid.UUID `db:"category_id" json:"category_id"`
	Name          string    `db:"name" json:"name"`
	Path          string    `db:"path" json:"path"`
	FileType      string    `db:"file_type" json:"file_type"`
	ReloadCommand *string   `db:"reload_command" json:"reload_command"`
	Position      int       `db:"position" json:"position"`
	CreatedAt     time.Time `db:"created_at" json:"created_at"`
}

// ConfigCategoryWithPaths includes the paths for a category
type ConfigCategoryWithPaths struct {
	ConfigCategory
	Paths []ConfigPath `json:"paths"`
}

// BuiltInConfigCategory represents a built-in category with files
type BuiltInConfigCategory struct {
	ID          string           `json:"id"` // e.g., "nginx", "php", "ssh"
	Name        string           `json:"name"`
	Emoji       string           `json:"emoji"`
	Color       string           `json:"color"`
	Description string           `json:"description"`
	Subcategories []BuiltInSubcategory `json:"subcategories,omitempty"`
}

type BuiltInSubcategory struct {
	ID    string       `json:"id"`
	Name  string       `json:"name"`
	Files []ConfigFile `json:"files"`
}

// ConfigFile represents a single config file
type ConfigFile struct {
	Name          string  `json:"name"`
	Path          string  `json:"path"`
	Type          string  `json:"type"` // nginx, php, ssh, text
	Readonly      bool    `json:"readonly"`
	ReloadCommand *string `json:"reload_command,omitempty"`
}

// ConfigListResponse is the full response for config listing
type ConfigListResponse struct {
	BuiltIn []BuiltInConfigCategory   `json:"built_in"`
	Custom  []ConfigCategoryWithPaths `json:"custom"`
}

