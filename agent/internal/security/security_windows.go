//go:build windows

package security

import (
	"errors"
	"time"
)

// Config for security module
type Config struct {
	Enabled          bool
	ServerURL        string
	APIKey           string
	MachineID        string
	SyncInterval     time.Duration
	SecurityLogPath  string
	NginxIncludePath string
}

// Module is the main security module (stub for Windows)
type Module struct {
	config Config
}

// NftablesState represents the current state
type NftablesState struct {
	Enabled     bool      `json:"enabled"`
	BanCount    int       `json:"ban_count"`
	TableExists bool      `json:"table_exists"`
	SetExists   bool      `json:"set_exists"`
	RuleExists  bool      `json:"rule_exists"`
	LastError   string    `json:"last_error,omitempty"`
	CheckedAt   time.Time `json:"checked_at"`
}

// New creates a new security module (stub)
func New(cfg Config) *Module {
	return &Module{config: cfg}
}

// Start is a stub for Windows
func (m *Module) Start() error {
	return errors.New("security module is not supported on Windows")
}

// Stop is a stub for Windows
func (m *Module) Stop() {}

// IsEnabled returns false on Windows
func (m *Module) IsEnabled() bool {
	return false
}

// GetBanCount returns 0 on Windows
func (m *Module) GetBanCount() int {
	return 0
}

// GetState returns empty state on Windows
func (m *Module) GetState() *NftablesState {
	return &NftablesState{
		Enabled:   false,
		LastError: "Not supported on Windows",
		CheckedAt: time.Now(),
	}
}

// SetEnabled is a no-op on Windows
func (m *Module) SetEnabled(enabled bool) error {
	return errors.New("not supported on Windows")
}

// ClearAllBans is a no-op on Windows
func (m *Module) ClearAllBans() error {
	return errors.New("not supported on Windows")
}

// GetUAPatterns returns empty on Windows
func (m *Module) GetUAPatterns() []string {
	return []string{}
}

