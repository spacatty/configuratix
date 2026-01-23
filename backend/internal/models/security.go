package models

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// SecurityIPBan represents a banned IP address
type SecurityIPBan struct {
	ID              uuid.UUID       `db:"id" json:"id"`
	IPAddress       string          `db:"ip_address" json:"ip_address"`
	SourceMachineID *uuid.UUID      `db:"source_machine_id" json:"source_machine_id,omitempty"`
	Reason          string          `db:"reason" json:"reason"`
	Details         json.RawMessage `db:"details" json:"details"`
	BannedAt        time.Time       `db:"banned_at" json:"banned_at"`
	ExpiresAt       time.Time       `db:"expires_at" json:"expires_at"`
	CreatedBy       *uuid.UUID      `db:"created_by" json:"created_by,omitempty"`
	IsActive        bool            `db:"is_active" json:"is_active"`
	UnbannedAt      *time.Time      `db:"unbanned_at" json:"unbanned_at,omitempty"`
}

// SecurityIPBanWithDetails includes machine name for display
type SecurityIPBanWithDetails struct {
	SecurityIPBan
	SourceMachineName string `db:"source_machine_name" json:"source_machine_name,omitempty"`
	CreatedByEmail    string `db:"created_by_email" json:"created_by_email,omitempty"`
}

// SecurityIPWhitelist represents a whitelisted IP or CIDR
type SecurityIPWhitelist struct {
	ID          uuid.UUID `db:"id" json:"id"`
	OwnerID     uuid.UUID `db:"owner_id" json:"owner_id"`
	IPCIDR      string    `db:"ip_cidr" json:"ip_cidr"`
	Description string    `db:"description" json:"description"`
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
}

// SecurityUAPattern represents a user-agent pattern to block
type SecurityUAPattern struct {
	ID          uuid.UUID  `db:"id" json:"id"`
	OwnerID     *uuid.UUID `db:"owner_id" json:"owner_id,omitempty"`
	Category    string     `db:"category" json:"category"`
	Pattern     string     `db:"pattern" json:"pattern"`
	MatchType   string     `db:"match_type" json:"match_type"`
	Description string     `db:"description" json:"description"`
	IsSystem    bool       `db:"is_system" json:"is_system"`
	IsActive    bool       `db:"is_active" json:"is_active"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
}

// SecurityUACategory represents a user's toggle for a UA category
type SecurityUACategory struct {
	ID        uuid.UUID `db:"id" json:"id"`
	OwnerID   uuid.UUID `db:"owner_id" json:"owner_id"`
	Category  string    `db:"category" json:"category"`
	IsEnabled bool      `db:"is_enabled" json:"is_enabled"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// SecurityEndpointRule represents an allowed path pattern for a nginx config
type SecurityEndpointRule struct {
	ID            uuid.UUID `db:"id" json:"id"`
	NginxConfigID uuid.UUID `db:"nginx_config_id" json:"nginx_config_id"`
	Pattern       string    `db:"pattern" json:"pattern"`
	Description   string    `db:"description" json:"description"`
	Priority      int       `db:"priority" json:"priority"`
	IsActive      bool      `db:"is_active" json:"is_active"`
	CreatedAt     time.Time `db:"created_at" json:"created_at"`
}

// SecurityConfigSettings represents security settings for a nginx config
type SecurityConfigSettings struct {
	ID                      uuid.UUID `db:"id" json:"id"`
	NginxConfigID           uuid.UUID `db:"nginx_config_id" json:"nginx_config_id"`
	UABlockingEnabled       bool      `db:"ua_blocking_enabled" json:"ua_blocking_enabled"`
	EndpointBlockingEnabled bool      `db:"endpoint_blocking_enabled" json:"endpoint_blocking_enabled"`
	SyncEnabled             bool      `db:"sync_enabled" json:"sync_enabled"`
	SyncIntervalMinutes     int       `db:"sync_interval_minutes" json:"sync_interval_minutes"`
	CreatedAt               time.Time `db:"created_at" json:"created_at"`
	UpdatedAt               time.Time `db:"updated_at" json:"updated_at"`
}

// SecurityMachineSettings represents security settings for a machine
type SecurityMachineSettings struct {
	ID              uuid.UUID    `db:"id" json:"id"`
	MachineID       uuid.UUID    `db:"machine_id" json:"machine_id"`
	NftablesEnabled bool         `db:"nftables_enabled" json:"nftables_enabled"`
	LastSyncAt      sql.NullTime `db:"last_sync_at" json:"last_sync_at"`
	BanCount        int          `db:"ban_count" json:"ban_count"`
	CreatedAt       time.Time    `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time    `db:"updated_at" json:"updated_at"`
}

// SecurityStats represents security statistics
type SecurityStats struct {
	TotalBans       int            `json:"total_bans"`
	ActiveBans      int            `json:"active_bans"`
	BansToday       int            `json:"bans_today"`
	BansThisWeek    int            `json:"bans_this_week"`
	TopReasons      []ReasonCount  `json:"top_reasons"`
	TopMachines     []MachineCount `json:"top_machines"`
	WhitelistCount  int            `json:"whitelist_count"`
	UAPatternCount  int            `json:"ua_pattern_count"`
}

// ReasonCount for stats
type ReasonCount struct {
	Reason string `db:"reason" json:"reason"`
	Count  int    `db:"count" json:"count"`
}

// MachineCount for stats
type MachineCount struct {
	MachineID   uuid.UUID `db:"machine_id" json:"machine_id"`
	MachineName string    `db:"machine_name" json:"machine_name"`
	Count       int       `db:"count" json:"count"`
}

// UAPatternsByCategory groups patterns by category
type UAPatternsByCategory struct {
	Category    string              `json:"category"`
	IsEnabled   bool                `json:"is_enabled"`
	PatternCount int                `json:"pattern_count"`
	Patterns    []SecurityUAPattern `json:"patterns"`
}

// ============================================================
// Request/Response types for API
// ============================================================

// CreateBanRequest for manual IP ban
type CreateBanRequest struct {
	IPAddress   string          `json:"ip_address"`
	Reason      string          `json:"reason"`
	Details     json.RawMessage `json:"details,omitempty"`
	ExpiresInDays int           `json:"expires_in_days,omitempty"` // 0 = default 30 days
}

// ImportBansRequest for bulk import
type ImportBansRequest struct {
	IPs    []string `json:"ips"`
	Reason string   `json:"reason"`
}

// ImportBansResponse for bulk import result
type ImportBansResponse struct {
	Imported         int      `json:"imported"`
	SkippedWhitelist int      `json:"skipped_whitelist"`
	AlreadyBanned    int      `json:"already_banned"`
	Invalid          int      `json:"invalid"`
	SkippedIPs       []string `json:"skipped_ips,omitempty"`
}

// CreateWhitelistRequest for adding to whitelist
type CreateWhitelistRequest struct {
	IPCIDR      string `json:"ip_cidr"`
	Description string `json:"description"`
}

// CreateUAPatternRequest for custom UA pattern
type CreateUAPatternRequest struct {
	Category    string `json:"category"`
	Pattern     string `json:"pattern"`
	MatchType   string `json:"match_type"`
	Description string `json:"description"`
}

// ToggleUACategoryRequest for enabling/disabling a category
type ToggleUACategoryRequest struct {
	IsEnabled bool `json:"is_enabled"`
}

// UpdateSecurityConfigRequest for nginx config security settings
type UpdateSecurityConfigRequest struct {
	UABlockingEnabled       *bool `json:"ua_blocking_enabled,omitempty"`
	EndpointBlockingEnabled *bool `json:"endpoint_blocking_enabled,omitempty"`
	SyncEnabled             *bool `json:"sync_enabled,omitempty"`
	SyncIntervalMinutes     *int  `json:"sync_interval_minutes,omitempty"`
}

// CreateEndpointRuleRequest for adding endpoint rule
type CreateEndpointRuleRequest struct {
	Pattern     string `json:"pattern"`
	Description string `json:"description"`
	Priority    int    `json:"priority"`
}

// UpdateMachineSecurityRequest for machine security settings
type UpdateMachineSecurityRequest struct {
	NftablesEnabled *bool `json:"nftables_enabled,omitempty"`
}

// ============================================================
// Agent sync types
// ============================================================

// AgentSecuritySyncRequest from agent to backend
type AgentSecuritySyncRequest struct {
	MachineID  uuid.UUID           `json:"machine_id"`
	NewBans    []AgentBanReport    `json:"new_bans"`
	LastSyncAt *time.Time          `json:"last_sync_at,omitempty"`
	BanCount   int                 `json:"ban_count"` // Current nftables ban count
}

// AgentBanReport represents a ban detected by agent
type AgentBanReport struct {
	IPAddress string          `json:"ip_address"`
	Reason    string          `json:"reason"`
	Details   json.RawMessage `json:"details"`
	BannedAt  time.Time       `json:"banned_at"`
}

// AgentSecuritySyncResponse from backend to agent
type AgentSecuritySyncResponse struct {
	MissingBans      []AgentBanEntry     `json:"missing_bans"`
	BansToRemove     []string            `json:"bans_to_remove"` // IPs to unban (whitelisted or expired)
	WhitelistUpdated bool                `json:"whitelist_updated"`
	Whitelist        []string            `json:"whitelist,omitempty"` // Full whitelist if updated
	PatternsUpdated  bool                `json:"patterns_updated"`
	NextSyncAt       time.Time           `json:"next_sync_at"`
}

// AgentBanEntry represents a ban for agent to apply
type AgentBanEntry struct {
	IPAddress string    `json:"ip_address"`
	ExpiresAt time.Time `json:"expires_at"`
}

// AgentUAPatternsResponse for agent to get UA patterns
type AgentUAPatternsResponse struct {
	Patterns    []string  `json:"patterns"` // Just the pattern strings for nginx map
	UpdatedAt   time.Time `json:"updated_at"`
}

// AgentEndpointRulesResponse for agent to get endpoint rules
type AgentEndpointRulesResponse struct {
	ConfigID    uuid.UUID `json:"config_id"`
	Patterns    []string  `json:"patterns"` // Allowed path patterns
	Enabled     bool      `json:"enabled"`
}

// NftablesState represents the current state of nftables on a machine
type NftablesState struct {
	Enabled     bool      `json:"enabled"`
	BanCount    int       `json:"ban_count"`
	TableExists bool      `json:"table_exists"`
	SetExists   bool      `json:"set_exists"`
	RuleExists  bool      `json:"rule_exists"`
	LastError   string    `json:"last_error,omitempty"`
	CheckedAt   time.Time `json:"checked_at"`
}

// BanListPage represents a paginated list of bans
type BanListPage struct {
	Bans       []SecurityIPBanWithDetails `json:"bans"`
	Total      int                        `json:"total"`
	Page       int                        `json:"page"`
	PageSize   int                        `json:"page_size"`
	TotalPages int                        `json:"total_pages"`
}

// BanListFilters for filtering ban list
type BanListFilters struct {
	Search       string     `json:"search"`        // IP search
	Reason       string     `json:"reason"`        // Filter by reason
	MachineID    *uuid.UUID `json:"machine_id"`    // Filter by source machine
	IsActive     *bool      `json:"is_active"`     // Filter by active status
	DateFrom     *time.Time `json:"date_from"`
	DateTo       *time.Time `json:"date_to"`
}

