package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// DNSAccount represents a user's DNS provider account credentials
type DNSAccount struct {
	ID        uuid.UUID `db:"id" json:"id"`
	OwnerID   uuid.UUID `db:"owner_id" json:"owner_id"`
	Provider  string    `db:"provider" json:"provider"`   // dnspod, cloudflare
	Name      string    `db:"name" json:"name"`           // User-friendly name
	ApiID     *string   `db:"api_id" json:"api_id"`       // DNSPod token ID, null for CF
	ApiToken  string    `db:"api_token" json:"-"`         // Never expose in JSON
	IsDefault bool      `db:"is_default" json:"is_default"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// DNSManagedDomain represents a domain managed for DNS purposes
// Completely independent from the main domains table
type DNSManagedDomain struct {
	ID           uuid.UUID      `db:"id" json:"id"`
	OwnerID      uuid.UUID      `db:"owner_id" json:"owner_id"`
	FQDN         string         `db:"fqdn" json:"fqdn"`
	DNSAccountID *uuid.UUID     `db:"dns_account_id" json:"dns_account_id"`
	NSStatus     string         `db:"ns_status" json:"ns_status"` // unknown, pending, valid, invalid
	NSLastCheck  *time.Time     `db:"ns_last_check" json:"ns_last_check"`
	NSExpected   pq.StringArray `db:"ns_expected" json:"ns_expected"`
	NSActual     pq.StringArray `db:"ns_actual" json:"ns_actual"`
	NotesMD      *string        `db:"notes_md" json:"notes_md"`
	CreatedAt    time.Time      `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time      `db:"updated_at" json:"updated_at"`
}

// DNSManagedDomainWithAccount includes account info for display
type DNSManagedDomainWithAccount struct {
	DNSManagedDomain
	DNSAccountName     *string `db:"dns_account_name" json:"dns_account_name"`
	DNSAccountProvider *string `db:"dns_account_provider" json:"dns_account_provider"`
}

// DNSRecord represents a DNS record stored in our database
type DNSRecord struct {
	ID          uuid.UUID `db:"id" json:"id"`
	DNSDomainID uuid.UUID `db:"dns_domain_id" json:"dns_domain_id"` // References dns_managed_domains
	Name        string    `db:"name" json:"name"`                   // Subdomain: www, @, *
	RecordType  string    `db:"record_type" json:"record_type"`     // A, AAAA, CNAME, TXT, MX
	Value       string    `db:"value" json:"value"`
	TTL         int       `db:"ttl" json:"ttl"`
	Priority    *int      `db:"priority" json:"priority"`
	Proxied     bool      `db:"proxied" json:"proxied"` // CF orange cloud

	// Port overrides for nginx
	HTTPIncomingPort  *int `db:"http_incoming_port" json:"http_incoming_port"`
	HTTPOutgoingPort  *int `db:"http_outgoing_port" json:"http_outgoing_port"`
	HTTPSIncomingPort *int `db:"https_incoming_port" json:"https_incoming_port"`
	HTTPSOutgoingPort *int `db:"https_outgoing_port" json:"https_outgoing_port"`

	// Sync status
	RemoteRecordID *string    `db:"remote_record_id" json:"remote_record_id"`
	SyncStatus     string     `db:"sync_status" json:"sync_status"` // synced, pending, conflict, local_only, remote_only, error
	SyncError      *string    `db:"sync_error" json:"sync_error"`
	LastSyncedAt   *time.Time `db:"last_synced_at" json:"last_synced_at"`

	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}
