package dns

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"
)

// Record represents a DNS record (provider-agnostic)
type Record struct {
	ID        string    `json:"id"`         // Provider's record ID
	Name      string    `json:"name"`       // Subdomain: "www", "@", "*"
	Type      string    `json:"type"`       // A, AAAA, CNAME, TXT, MX
	Value     string    `json:"value"`      // Target value
	TTL       int       `json:"ttl"`        // Seconds
	Priority  int       `json:"priority"`   // For MX
	Proxied   bool      `json:"proxied"`    // CF orange cloud
	UpdatedAt time.Time `json:"updated_at"`
}

// NSStatus represents nameserver validation result
type NSStatus struct {
	Valid    bool     `json:"valid"`
	Status   string   `json:"status"`   // unknown, pending, valid, invalid
	Expected []string `json:"expected"` // Expected NS records
	Actual   []string `json:"actual"`   // Actual NS from DNS lookup
	Message  string   `json:"message"`
}

// SyncResult represents the result of a sync comparison
type SyncResult struct {
	InSync    bool       `json:"in_sync"`
	Created   []Record   `json:"created"`   // In local, not in remote
	Updated   []Record   `json:"updated"`   // Values differ
	Deleted   []Record   `json:"deleted"`   // In remote, not in local
	Conflicts []Conflict `json:"conflicts"` // Values differ
	Errors    []string   `json:"errors"`
}

// Conflict when local and remote differ
type Conflict struct {
	RecordName  string `json:"record_name"`
	RecordType  string `json:"record_type"`
	LocalValue  string `json:"local_value"`
	RemoteValue string `json:"remote_value"`
	RemoteID    string `json:"remote_id"`
	LocalID     string `json:"local_id"`
}

// Provider interface - implement for each DNS provider
type Provider interface {
	// Name returns provider identifier
	Name() string // "dnspod", "cloudflare"

	// ValidateCredentials checks if API credentials work
	ValidateCredentials(ctx context.Context) error

	// GetExpectedNameservers returns NS records user should set at registrar
	GetExpectedNameservers(ctx context.Context, domain string) ([]string, error)

	// ListRecords fetches all records for a domain from provider
	ListRecords(ctx context.Context, domain string) ([]Record, error)

	// CreateRecord creates a new DNS record
	CreateRecord(ctx context.Context, domain string, record Record) (*Record, error)

	// UpdateRecord modifies an existing record
	UpdateRecord(ctx context.Context, domain string, recordID string, record Record) (*Record, error)

	// DeleteRecord removes a record
	DeleteRecord(ctx context.Context, domain string, recordID string) error
}

// NewProvider creates providers from account config
func NewProvider(provider string, apiID, apiToken string) (Provider, error) {
	switch provider {
	case "dnspod":
		return NewDNSPodProvider(apiID, apiToken), nil
	case "cloudflare":
		return NewCloudflareProvider(apiToken), nil
	default:
		return nil, fmt.Errorf("unknown provider: %s", provider)
	}
}

// CheckNameservers performs a live DNS lookup to check if NS records are correct
func CheckNameservers(domain string, expected []string) *NSStatus {
	result := &NSStatus{
		Expected: expected,
		Status:   "unknown",
	}

	// Perform NS lookup
	nsRecords, err := net.LookupNS(domain)
	if err != nil {
		result.Status = "invalid"
		result.Message = fmt.Sprintf("DNS lookup failed: %v", err)
		return result
	}

	// Extract hostnames
	actual := make([]string, len(nsRecords))
	for i, ns := range nsRecords {
		actual[i] = strings.TrimSuffix(ns.Host, ".")
	}
	result.Actual = actual

	// Check if all expected NS are present
	expectedSet := make(map[string]bool)
	for _, ns := range expected {
		expectedSet[strings.ToLower(strings.TrimSuffix(ns, "."))] = true
	}

	matchCount := 0
	for _, ns := range actual {
		if expectedSet[strings.ToLower(ns)] {
			matchCount++
		}
	}

	if matchCount >= len(expected) {
		result.Valid = true
		result.Status = "valid"
		result.Message = "Nameservers correctly configured"
	} else if matchCount > 0 {
		result.Status = "pending"
		result.Message = "Some nameservers detected, propagation in progress"
	} else {
		result.Status = "invalid"
		result.Message = "Nameservers not pointing to provider"
	}

	return result
}

