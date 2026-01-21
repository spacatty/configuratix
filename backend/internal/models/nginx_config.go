package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type NginxConfig struct {
	ID             uuid.UUID       `db:"id" json:"id"`
	Name           string          `db:"name" json:"name"`
	OwnerID        *uuid.UUID      `db:"owner_id" json:"owner_id"`
	Mode           string          `db:"mode" json:"mode"` // auto, manual
	StructuredJSON json.RawMessage `db:"structured_json" json:"structured_json"`
	RawText        *string         `db:"raw_text" json:"raw_text"`
	CreatedAt      time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time       `db:"updated_at" json:"updated_at"`
}

// NginxConfigStructured represents the structured form data
type NginxConfigStructured struct {
	SSLMode   string             `json:"ssl_mode"`   // disabled, allow_http, redirect_https
	SSLEmail  string             `json:"ssl_email,omitempty"` // Email for SSL certificate issuance
	Locations []LocationConfig   `json:"locations"`
	CORS      *CORSConfig        `json:"cors"`
}

type LocationConfig struct {
	Path       string `json:"path"`
	Type       string `json:"type"`        // proxy, static
	StaticType string `json:"static_type"` // local, landing (only for static type)
	ProxyURL   string `json:"proxy_url,omitempty"`
	Root       string `json:"root,omitempty"`
	Index      string `json:"index,omitempty"`
	LandingID  string `json:"landing_id,omitempty"` // UUID of landing page
	UsePHP     bool   `json:"use_php"`              // Enable PHP-FPM for this location
}

type CORSConfig struct {
	Enabled      bool     `json:"enabled"`
	AllowAll     bool     `json:"allow_all"`
	AllowMethods []string `json:"allow_methods,omitempty"`
	AllowHeaders []string `json:"allow_headers,omitempty"`
	AllowOrigins []string `json:"allow_origins,omitempty"`
}

