package models

import (
	"time"

	"github.com/google/uuid"
)

type Machine struct {
	ID            uuid.UUID  `db:"id" json:"id"`
	AgentID       *uuid.UUID `db:"agent_id" json:"agent_id"`
	Hostname      *string    `db:"hostname" json:"hostname"`
	IPAddress     *string    `db:"ip_address" json:"ip_address"`
	UbuntuVersion *string    `db:"ubuntu_version" json:"ubuntu_version"`
	NotesMD       *string    `db:"notes_md" json:"notes_md"`
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at" json:"updated_at"`

	// Settings
	SSHPort          int     `db:"ssh_port" json:"ssh_port"`
	UFWEnabled       bool    `db:"ufw_enabled" json:"ufw_enabled"`
	Fail2banEnabled  bool    `db:"fail2ban_enabled" json:"fail2ban_enabled"`
	Fail2banConfig   *string `db:"fail2ban_config" json:"fail2ban_config"`
	RootPasswordSet  bool    `db:"root_password_set" json:"root_password_set"`

	// Stats (from agent heartbeat)
	CPUPercent   float64 `db:"cpu_percent" json:"cpu_percent"`
	MemoryUsed   int64   `db:"memory_used" json:"memory_used"`
	MemoryTotal  int64   `db:"memory_total" json:"memory_total"`
	DiskUsed     int64   `db:"disk_used" json:"disk_used"`
	DiskTotal    int64   `db:"disk_total" json:"disk_total"`
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
