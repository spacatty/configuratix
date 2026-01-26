package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Machine struct {
	ID            uuid.UUID  `db:"id" json:"id"`
	AgentID       *uuid.UUID `db:"agent_id" json:"agent_id"`
	OwnerID       *uuid.UUID `db:"owner_id" json:"owner_id"`
	ProjectID     *uuid.UUID `db:"project_id" json:"project_id"`
	Title         *string    `db:"title" json:"title"`
	Hostname      *string    `db:"hostname" json:"hostname"`
	IPAddress     *string    `db:"ip_address" json:"ip_address"`
	DetectedIPs   json.RawMessage `db:"detected_ips" json:"detected_ips"` // All IPs from interfaces
	PrimaryIP     *string    `db:"primary_ip" json:"primary_ip"`          // Selected IP for passthrough
	UbuntuVersion *string    `db:"ubuntu_version" json:"ubuntu_version"`
	NotesMD       *string    `db:"notes_md" json:"notes_md"`
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at" json:"updated_at"`

	// Access token protection
	AccessTokenHash *string `db:"access_token_hash" json:"-"`
	AccessTokenSet  bool    `db:"access_token_set" json:"access_token_set"`

	// Settings
	SSHPort         int             `db:"ssh_port" json:"ssh_port"`
	UFWEnabled      bool            `db:"ufw_enabled" json:"ufw_enabled"`
	UFWRulesJSON    json.RawMessage `db:"ufw_rules_json" json:"ufw_rules"`
	Fail2banEnabled bool            `db:"fail2ban_enabled" json:"fail2ban_enabled"`
	Fail2banConfig  *string         `db:"fail2ban_config" json:"fail2ban_config"`
	RootPasswordSet bool            `db:"root_password_set" json:"root_password_set"`

	// PHP
	PHPInstalled bool    `db:"php_installed" json:"php_installed"`
	PHPVersion   *string `db:"php_version" json:"php_version"`

	// Stats (from agent heartbeat)
	CPUPercent  float64 `db:"cpu_percent" json:"cpu_percent"`
	MemoryUsed  int64   `db:"memory_used" json:"memory_used"`
	MemoryTotal int64   `db:"memory_total" json:"memory_total"`
	DiskUsed    int64   `db:"disk_used" json:"disk_used"`
	DiskTotal   int64   `db:"disk_total" json:"disk_total"`
}

// MachineWithDetails includes additional info for display
// Note: Explicitly list all fields instead of embedding to avoid sqlx scanning issues
type MachineWithDetails struct {
	// Machine fields
	ID              uuid.UUID       `db:"id" json:"id"`
	AgentID         *uuid.UUID      `db:"agent_id" json:"agent_id"`
	OwnerID         *uuid.UUID      `db:"owner_id" json:"owner_id"`
	ProjectID       *uuid.UUID      `db:"project_id" json:"project_id"`
	Title           *string         `db:"title" json:"title"`
	Hostname        *string         `db:"hostname" json:"hostname"`
	IPAddress       *string         `db:"ip_address" json:"ip_address"`
	DetectedIPs     json.RawMessage `db:"detected_ips" json:"detected_ips"`
	PrimaryIP       *string         `db:"primary_ip" json:"primary_ip"`
	UbuntuVersion   *string         `db:"ubuntu_version" json:"ubuntu_version"`
	NotesMD         *string    `db:"notes_md" json:"notes_md"`
	CreatedAt       time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at" json:"updated_at"`
	AccessTokenHash *string         `db:"access_token_hash" json:"-"` // Hidden from API
	AccessTokenSet  bool            `db:"access_token_set" json:"access_token_set"`
	SSHPort         int             `db:"ssh_port" json:"ssh_port"`
	UFWEnabled      bool            `db:"ufw_enabled" json:"ufw_enabled"`
	UFWRulesJSON    json.RawMessage `db:"ufw_rules_json" json:"ufw_rules"`
	Fail2banEnabled bool            `db:"fail2ban_enabled" json:"fail2ban_enabled"`
	Fail2banConfig  *string         `db:"fail2ban_config" json:"fail2ban_config"`
	RootPasswordSet bool            `db:"root_password_set" json:"root_password_set"`
	PHPInstalled    bool       `db:"php_installed" json:"php_installed"`
	PHPVersion      *string    `db:"php_version" json:"php_version"`
	CPUPercent      float64    `db:"cpu_percent" json:"cpu_percent"`
	MemoryUsed      int64      `db:"memory_used" json:"memory_used"`
	MemoryTotal     int64      `db:"memory_total" json:"memory_total"`
	DiskUsed        int64      `db:"disk_used" json:"disk_used"`
	DiskTotal       int64      `db:"disk_total" json:"disk_total"`
	// Join fields
	OwnerEmail   *string    `db:"owner_email" json:"owner_email"`
	OwnerName    *string    `db:"owner_name" json:"owner_name"`
	ProjectName  *string    `db:"project_name" json:"project_name"`
	AgentName    *string    `db:"agent_name" json:"agent_name"`
	AgentVersion *string    `db:"agent_version" json:"agent_version"`
	LastSeen     *time.Time `db:"last_seen" json:"last_seen"`
}

// DisplayTitle returns the title or hostname as fallback
func (m *Machine) DisplayTitle() string {
	if m.Title != nil && *m.Title != "" {
		return *m.Title
	}
	if m.Hostname != nil && *m.Hostname != "" {
		return *m.Hostname
	}
	return "Unknown"
}

// Default fail2ban SSH jail configuration
const DefaultFail2banConfig = `[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
`
