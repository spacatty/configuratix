package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// UUIDArray is a custom type for UUID arrays in PostgreSQL
type UUIDArray []uuid.UUID

// JSONStringArray is a custom type for JSONB string arrays
type JSONStringArray []string

// Scan implements sql.Scanner for JSONB
func (a *JSONStringArray) Scan(value interface{}) error {
	if value == nil {
		*a = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		*a = nil
		return nil
	}
	return json.Unmarshal(bytes, a)
}

// Value implements driver.Valuer for JSONB
func (a JSONStringArray) Value() (driver.Value, error) {
	if a == nil {
		return "[]", nil
	}
	return json.Marshal(a)
}

// PassthroughPool represents a dynamic DNS rotation pool for a specific record
type PassthroughPool struct {
	ID                 uuid.UUID       `db:"id" json:"id"`
	DNSRecordID        uuid.UUID       `db:"dns_record_id" json:"dns_record_id"`
	TargetIP           string          `db:"target_ip" json:"target_ip"`
	TargetPort         int             `db:"target_port" json:"target_port"`
	TargetPortHTTP     int             `db:"target_port_http" json:"target_port_http"`       // Port for HTTP (80) passthrough
	RotationStrategy   string          `db:"rotation_strategy" json:"rotation_strategy"`     // round_robin, random
	RotationMode       string          `db:"rotation_mode" json:"rotation_mode"`             // interval, scheduled
	IntervalMinutes    int             `db:"interval_minutes" json:"interval_minutes"`
	ScheduledTimes     JSONStringArray `db:"scheduled_times" json:"scheduled_times"`         // JSON array
	HealthCheckEnabled bool            `db:"health_check_enabled" json:"health_check_enabled"`
	CurrentMachineID   *uuid.UUID      `db:"current_machine_id" json:"current_machine_id"`
	CurrentIndex       int             `db:"current_index" json:"current_index"`
	IsPaused           bool            `db:"is_paused" json:"is_paused"`
	LastRotatedAt      *time.Time      `db:"last_rotated_at" json:"last_rotated_at"`
	GroupIDs           pq.StringArray  `db:"group_ids" json:"group_ids"`                     // Machine groups for dynamic membership (UUID[])
	CreatedAt          time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt          time.Time       `db:"updated_at" json:"updated_at"`
}

// PassthroughMember represents a machine in a passthrough pool
type PassthroughMember struct {
	ID                 uuid.UUID `db:"id" json:"id"`
	PoolID             uuid.UUID `db:"pool_id" json:"pool_id"`
	MachineID          uuid.UUID `db:"machine_id" json:"machine_id"`
	Priority           int       `db:"priority" json:"priority"`
	IsEnabled          bool      `db:"is_enabled" json:"is_enabled"`
	NginxConfigApplied bool      `db:"nginx_config_applied" json:"nginx_config_applied"`
	CreatedAt          time.Time `db:"created_at" json:"created_at"`
}

// PassthroughMemberWithMachine includes machine details
type PassthroughMemberWithMachine struct {
	PassthroughMember
	MachineName string     `db:"machine_name" json:"machine_name"`
	MachineIP   string     `db:"machine_ip" json:"machine_ip"`
	LastSeen    *time.Time `db:"last_seen" json:"last_seen"`
	IsOnline    bool       `json:"is_online"` // Computed
}

// WildcardPool represents a wildcard DNS rotation pool for *.domain.com
type WildcardPool struct {
	ID                 uuid.UUID       `db:"id" json:"id"`
	DNSDomainID        uuid.UUID       `db:"dns_domain_id" json:"dns_domain_id"`
	IncludeRoot        bool            `db:"include_root" json:"include_root"`
	TargetIP           string          `db:"target_ip" json:"target_ip"`
	TargetPort         int             `db:"target_port" json:"target_port"`
	TargetPortHTTP     int             `db:"target_port_http" json:"target_port_http"`   // Port for HTTP (80) passthrough
	RotationStrategy   string          `db:"rotation_strategy" json:"rotation_strategy"`
	RotationMode       string          `db:"rotation_mode" json:"rotation_mode"`
	IntervalMinutes    int             `db:"interval_minutes" json:"interval_minutes"`
	ScheduledTimes     JSONStringArray `db:"scheduled_times" json:"scheduled_times"`
	HealthCheckEnabled bool            `db:"health_check_enabled" json:"health_check_enabled"`
	CurrentMachineID   *uuid.UUID      `db:"current_machine_id" json:"current_machine_id"`
	CurrentIndex       int             `db:"current_index" json:"current_index"`
	IsPaused           bool            `db:"is_paused" json:"is_paused"`
	LastRotatedAt      *time.Time      `db:"last_rotated_at" json:"last_rotated_at"`
	GroupIDs           pq.StringArray  `db:"group_ids" json:"group_ids"`               // Machine groups for dynamic membership (UUID[])
	CreatedAt          time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt          time.Time       `db:"updated_at" json:"updated_at"`
}

// WildcardPoolMember represents a machine in a wildcard pool
type WildcardPoolMember struct {
	ID                 uuid.UUID `db:"id" json:"id"`
	PoolID             uuid.UUID `db:"pool_id" json:"pool_id"`
	MachineID          uuid.UUID `db:"machine_id" json:"machine_id"`
	Priority           int       `db:"priority" json:"priority"`
	IsEnabled          bool      `db:"is_enabled" json:"is_enabled"`
	NginxConfigApplied bool      `db:"nginx_config_applied" json:"nginx_config_applied"`
	CreatedAt          time.Time `db:"created_at" json:"created_at"`
}

// WildcardMemberWithMachine includes machine details
type WildcardMemberWithMachine struct {
	WildcardPoolMember
	MachineName string     `db:"machine_name" json:"machine_name"`
	MachineIP   string     `db:"machine_ip" json:"machine_ip"`
	LastSeen    *time.Time `db:"last_seen" json:"last_seen"`
	IsOnline    bool       `json:"is_online"` // Computed
}

// RotationHistory logs each rotation event
type RotationHistory struct {
	ID            uuid.UUID  `db:"id" json:"id"`
	PoolType      string     `db:"pool_type" json:"pool_type"`       // 'record' or 'wildcard'
	PoolID        uuid.UUID  `db:"pool_id" json:"pool_id"`
	DNSDomainID   *uuid.UUID `db:"dns_domain_id" json:"dns_domain_id"`
	RecordName    *string    `db:"record_name" json:"record_name"`
	FromMachineID *uuid.UUID `db:"from_machine_id" json:"from_machine_id"`
	FromIP        string     `db:"from_ip" json:"from_ip"`
	ToMachineID   *uuid.UUID `db:"to_machine_id" json:"to_machine_id"`
	ToIP          string     `db:"to_ip" json:"to_ip"`
	Trigger       string     `db:"trigger" json:"trigger"`           // 'scheduled', 'manual', 'health'
	RotatedAt     time.Time  `db:"rotated_at" json:"rotated_at"`
}

// RotationHistoryWithDetails includes machine names
type RotationHistoryWithDetails struct {
	RotationHistory
	FromMachineName string `db:"from_machine_name" json:"from_machine_name"`
	ToMachineName   string `db:"to_machine_name" json:"to_machine_name"`
}

// PassthroughPoolWithDetails includes record and current state info
type PassthroughPoolWithDetails struct {
	PassthroughPool
	RecordName         string `db:"record_name" json:"record_name"`
	RecordType         string `db:"record_type" json:"record_type"`
	DomainName         string `db:"domain_name" json:"domain_name"`
	CurrentMachineName string `db:"current_machine_name" json:"current_machine_name"`
	CurrentMachineIP   string `db:"current_machine_ip" json:"current_machine_ip"`
	MemberCount        int    `db:"member_count" json:"member_count"`
}

// WildcardPoolWithDetails includes domain and current state info
type WildcardPoolWithDetails struct {
	WildcardPool
	DomainName         string `db:"domain_name" json:"domain_name"`
	CurrentMachineName string `db:"current_machine_name" json:"current_machine_name"`
	CurrentMachineIP   string `db:"current_machine_ip" json:"current_machine_ip"`
	MemberCount        int    `db:"member_count" json:"member_count"`
}

