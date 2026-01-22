package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

type Domain struct {
	ID                uuid.UUID  `db:"id" json:"id"`
	FQDN              string     `db:"fqdn" json:"fqdn"`
	OwnerID           *uuid.UUID `db:"owner_id" json:"owner_id"`
	AssignedMachineID *uuid.UUID `db:"assigned_machine_id" json:"assigned_machine_id"`
	ConfigID          *uuid.UUID `db:"config_id" json:"config_id"`
	Status            string     `db:"status" json:"status"` // idle, linked, healthy, unhealthy
	NotesMD           *string    `db:"notes_md" json:"notes_md"`
	LastCheckAt       *time.Time `db:"last_check_at" json:"last_check_at"`
	CreatedAt         time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time  `db:"updated_at" json:"updated_at"`

	// DNS Management fields
	DNSAccountID       *uuid.UUID `db:"dns_account_id" json:"dns_account_id"`
	DNSMode            *string    `db:"dns_mode" json:"dns_mode"`                         // external, managed
	NSStatus           *string    `db:"ns_status" json:"ns_status"`                       // pending, valid, invalid
	NSLastCheck        *time.Time `db:"ns_last_check" json:"ns_last_check"`
	NSExpected         *string    `db:"ns_expected" json:"ns_expected"`
	NSActual           *string    `db:"ns_actual" json:"ns_actual"`
	IsWildcard         *bool      `db:"is_wildcard" json:"is_wildcard"`
	IPAddress          *string    `db:"ip_address" json:"ip_address"`
	HTTPSSendProxy     *bool      `db:"https_send_proxy" json:"https_send_proxy"`
	HTTPIncomingPorts  pq.Int64Array `db:"http_incoming_ports" json:"http_incoming_ports"`
	HTTPOutgoingPorts  pq.Int64Array `db:"http_outgoing_ports" json:"http_outgoing_ports"`
	HTTPSIncomingPorts pq.Int64Array `db:"https_incoming_ports" json:"https_incoming_ports"`
	HTTPSOutgoingPorts pq.Int64Array `db:"https_outgoing_ports" json:"https_outgoing_ports"`
}

