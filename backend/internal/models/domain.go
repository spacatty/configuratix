package models

import (
	"time"

	"github.com/google/uuid"
)

type Domain struct {
	ID                         uuid.UUID  `db:"id" json:"id"`
	FQDN                       string     `db:"fqdn" json:"fqdn"`
	OwnerID                    *uuid.UUID `db:"owner_id" json:"owner_id"`
	AssignedMachineID          *uuid.UUID `db:"assigned_machine_id" json:"assigned_machine_id"`
	ConfigID                   *uuid.UUID `db:"config_id" json:"config_id"`
	Status                     string     `db:"status" json:"status"` // idle, linked, healthy, unhealthy
	HealthCheckExpectedStatus  int        `db:"health_check_expected_status" json:"health_check_expected_status"`
	NotesMD                    *string    `db:"notes_md" json:"notes_md"`
	LastCheckAt                *time.Time `db:"last_check_at" json:"last_check_at"`
	CreatedAt                  time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt                  time.Time  `db:"updated_at" json:"updated_at"`
	// Apply tracking (migration 039)
	ApplyStatus    *string    `db:"apply_status" json:"apply_status"` // null|pending|applying|applied|failed|removing
	LastJobID      *uuid.UUID `db:"last_job_id" json:"last_job_id"`
	LastApplyError *string    `db:"last_apply_error" json:"last_apply_error"`
	LastAppliedAt  *time.Time `db:"last_applied_at" json:"last_applied_at"`
	// Health check details (migration 041)
	HealthCheckPath     *string `db:"health_check_path" json:"health_check_path"`
	LastCheckStatusCode *int    `db:"last_check_status_code" json:"last_check_status_code"`
	LastCheckResponseMS *int    `db:"last_check_response_ms" json:"last_check_response_ms"`
	LastCheckError      *string `db:"last_check_error" json:"last_check_error"`
	// Health check presets and custom rules (migration 042)
	HealthCheckPresetID       *uuid.UUID `db:"health_check_preset_id" json:"health_check_preset_id"`
	HealthCheckExpected       *string    `db:"health_check_expected" json:"health_check_expected"`
	HealthCheckBodyContains   *string    `db:"health_check_body_contains" json:"health_check_body_contains"`
	HealthCheckTimeoutSeconds *int       `db:"health_check_timeout_seconds" json:"health_check_timeout_seconds"`
	// Last failed check's response (migration 043); served by GET /domains/{id}/check-response.
	LastCheckResponseHeaders *string `db:"last_check_response_headers" json:"-"`
	LastCheckResponseBody    *string `db:"last_check_response_body" json:"-"`
	LastCheckBodyTruncated   bool    `db:"last_check_body_truncated" json:"-"`
}
