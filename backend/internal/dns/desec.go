package dns

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DeSECProvider implements the Provider interface for deSEC.io
type DeSECProvider struct {
	apiToken string
	client   *http.Client
}

// NewDeSECProvider creates a new deSEC provider
func NewDeSECProvider(apiToken string) *DeSECProvider {
	return &DeSECProvider{
		apiToken: apiToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (p *DeSECProvider) Name() string {
	return "desec"
}

// deSEC uses RRsets - a set of records with same name and type
type desecRRset struct {
	Domain  string   `json:"domain,omitempty"`
	Subname string   `json:"subname"`        // "" for apex, "www" for www, etc
	Name    string   `json:"name,omitempty"` // Full name (read-only)
	Type    string   `json:"type"`           // A, AAAA, CNAME, MX, TXT, etc
	Records []string `json:"records"`        // The actual record values
	TTL     int      `json:"ttl"`            // TTL in seconds
	Created string   `json:"created,omitempty"`
	Touched string   `json:"touched,omitempty"`
}

type desecDomain struct {
	Name       string     `json:"name"`
	MinimumTTL int        `json:"minimum_ttl"`
	Keys       []desecKey `json:"keys,omitempty"`
	Created    string     `json:"created"`
	Published  string     `json:"published,omitempty"`
	Touched    string     `json:"touched,omitempty"`
}

type desecKey struct {
	DNSKey  string   `json:"dnskey"`
	DS      []string `json:"ds"`
	Flags   int      `json:"flags"`
	Keytype string   `json:"keytype"`
}

type desecError struct {
	Detail string `json:"detail"`
}

func (p *DeSECProvider) doRequest(ctx context.Context, method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewBuffer(b)
	}

	req, err := http.NewRequestWithContext(ctx, method,
		"https://desec.io/api/v1"+path, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Token "+p.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Handle error responses
	if resp.StatusCode >= 400 {
		var errResp desecError
		if json.Unmarshal(respBody, &errResp) == nil && errResp.Detail != "" {
			return nil, fmt.Errorf("deSEC error [%d]: %s", resp.StatusCode, errResp.Detail)
		}
		// Try to parse as array of errors (deSEC sometimes returns arrays)
		var errArray []map[string]interface{}
		if json.Unmarshal(respBody, &errArray) == nil && len(errArray) > 0 {
			return nil, fmt.Errorf("deSEC error [%d]: %v", resp.StatusCode, errArray[0])
		}
		return nil, fmt.Errorf("deSEC error [%d]: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

func (p *DeSECProvider) ValidateCredentials(ctx context.Context) error {
	// Try listing domains to validate token
	_, err := p.doRequest(ctx, "GET", "/domains/", nil)
	return err
}

// CreateZone creates a new domain in deSEC
func (p *DeSECProvider) CreateZone(ctx context.Context, domain string) error {
	body := map[string]string{
		"name": domain,
	}

	_, err := p.doRequest(ctx, "POST", "/domains/", body)
	if err != nil {
		// Check if domain already exists
		if strings.Contains(err.Error(), "already exists") ||
			strings.Contains(err.Error(), "already registered") ||
			strings.Contains(err.Error(), "409") {
			return nil // Domain exists, that's fine
		}
		return fmt.Errorf("failed to create domain: %w", err)
	}

	return nil
}

func (p *DeSECProvider) GetExpectedNameservers(ctx context.Context, domain string) ([]string, error) {
	// deSEC uses predictable nameservers based on domain name
	// ns1.desec.io and ns2.desec.org for all domains
	return []string{
		"ns1.desec.io",
		"ns2.desec.org",
	}, nil
}

// GetOrCreateZone creates the domain if it doesn't exist and returns nameservers
func (p *DeSECProvider) GetOrCreateZone(ctx context.Context, domain string) ([]string, error) {
	// First check if domain exists
	_, err := p.doRequest(ctx, "GET", "/domains/"+url.PathEscape(domain)+"/", nil)
	if err != nil {
		// Domain doesn't exist, create it
		if err := p.CreateZone(ctx, domain); err != nil {
			return nil, err
		}
	}

	// deSEC always uses these nameservers
	return p.GetExpectedNameservers(ctx, domain)
}

func (p *DeSECProvider) ListRecords(ctx context.Context, domain string) ([]Record, error) {
	respBody, err := p.doRequest(ctx, "GET", "/domains/"+url.PathEscape(domain)+"/rrsets/", nil)
	if err != nil {
		return nil, err
	}

	var rrsets []desecRRset
	if err := json.Unmarshal(respBody, &rrsets); err != nil {
		return nil, fmt.Errorf("failed to parse rrsets: %w", err)
	}

	// Flatten RRsets to individual records
	// deSEC groups records by (subname, type), we need to expand them
	var records []Record
	for _, rrset := range rrsets {
		// Skip NS records for apex (managed by deSEC)
		if rrset.Type == "NS" && rrset.Subname == "" {
			continue
		}

		// Each record in the RRset becomes a separate Record
		for i, value := range rrset.Records {
			// Create a unique ID combining subname, type, and index
			recordID := fmt.Sprintf("%s:%s:%d", rrset.Subname, rrset.Type, i)

			// Convert subname to our format (empty string -> @)
			name := rrset.Subname
			if name == "" {
				name = "@"
			}

			// Parse priority for MX records
			priority := 0
			recordValue := value
			if rrset.Type == "MX" {
				// MX records in deSEC are stored as "priority target"
				parts := strings.SplitN(value, " ", 2)
				if len(parts) == 2 {
					priority, _ = strconv.Atoi(parts[0])
					recordValue = strings.TrimSuffix(parts[1], ".")
				}
			}

			// Clean up trailing dots from values
			recordValue = strings.TrimSuffix(recordValue, ".")

			// Parse timestamp
			var updatedAt time.Time
			if rrset.Touched != "" {
				updatedAt, _ = time.Parse(time.RFC3339, rrset.Touched)
			}

			record := Record{
				ID:        recordID,
				Name:      name,
				Type:      rrset.Type,
				Value:     recordValue,
				TTL:       rrset.TTL,
				Priority:  priority,
				Proxied:   false, // deSEC doesn't have proxying
				UpdatedAt: updatedAt,
			}
			records = append(records, record)
		}
	}

	return records, nil
}

func (p *DeSECProvider) CreateRecord(ctx context.Context, domain string, record Record) (*Record, error) {
	// Convert @ to empty string for deSEC
	subname := record.Name
	if subname == "@" {
		subname = ""
	}

	// Format value based on record type
	value := record.Value
	if record.Type == "MX" {
		// MX records need priority prefix
		value = fmt.Sprintf("%d %s.", record.Priority, strings.TrimSuffix(record.Value, "."))
	} else if record.Type == "CNAME" || record.Type == "NS" {
		// Add trailing dot for CNAME and NS
		if !strings.HasSuffix(value, ".") {
			value = value + "."
		}
	} else if record.Type == "TXT" {
		// TXT records need to be quoted
		if !strings.HasPrefix(value, "\"") {
			value = fmt.Sprintf("\"%s\"", value)
		}
	}

	ttl := record.TTL
	if ttl == 0 {
		ttl = 3600 // deSEC minimum is 3600 for most records
	}
	if ttl < 3600 {
		ttl = 3600 // deSEC has a minimum TTL of 3600
	}

	// First, try to get existing RRset
	existingPath := fmt.Sprintf("/domains/%s/rrsets/%s/%s/",
		url.PathEscape(domain),
		url.PathEscape(subname),
		url.PathEscape(record.Type))

	existingResp, err := p.doRequest(ctx, "GET", existingPath, nil)
	if err == nil {
		// RRset exists, we need to add to it
		var existing desecRRset
		if json.Unmarshal(existingResp, &existing) == nil {
			// Add new value to existing records
			existing.Records = append(existing.Records, value)
			existing.TTL = ttl

			// Update the RRset
			updateBody := map[string]interface{}{
				"records": existing.Records,
				"ttl":     ttl,
			}
			_, err = p.doRequest(ctx, "PATCH", existingPath, updateBody)
			if err != nil {
				return nil, fmt.Errorf("failed to update rrset: %w", err)
			}

			record.ID = fmt.Sprintf("%s:%s:%d", subname, record.Type, len(existing.Records)-1)
			return &record, nil
		}
	}

	// RRset doesn't exist, create new one
	rrset := desecRRset{
		Subname: subname,
		Type:    record.Type,
		Records: []string{value},
		TTL:     ttl,
	}

	_, err = p.doRequest(ctx, "POST", "/domains/"+url.PathEscape(domain)+"/rrsets/", rrset)
	if err != nil {
		return nil, fmt.Errorf("failed to create record: %w", err)
	}

	record.ID = fmt.Sprintf("%s:%s:0", subname, record.Type)
	return &record, nil
}

func (p *DeSECProvider) UpdateRecord(ctx context.Context, domain string, recordID string, record Record) (*Record, error) {
	// Parse the record ID to get subname and type
	// ID format: "subname:type:index"
	parts := strings.SplitN(recordID, ":", 3)
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid record ID format")
	}

	oldSubname := parts[0]
	oldType := parts[1]
	recordIndex := 0
	if len(parts) == 3 {
		recordIndex, _ = strconv.Atoi(parts[2])
	}

	// Convert @ to empty string
	newSubname := record.Name
	if newSubname == "@" {
		newSubname = ""
	}

	// Format value
	value := record.Value
	if record.Type == "MX" {
		value = fmt.Sprintf("%d %s.", record.Priority, strings.TrimSuffix(record.Value, "."))
	} else if record.Type == "CNAME" || record.Type == "NS" {
		if !strings.HasSuffix(value, ".") {
			value = value + "."
		}
	} else if record.Type == "TXT" {
		if !strings.HasPrefix(value, "\"") {
			value = fmt.Sprintf("\"%s\"", value)
		}
	}

	ttl := record.TTL
	if ttl < 3600 {
		ttl = 3600
	}

	// If name or type changed, we need to delete old and create new
	if oldSubname != newSubname || oldType != record.Type {
		// Delete old record
		if err := p.DeleteRecord(ctx, domain, recordID); err != nil {
			return nil, fmt.Errorf("failed to delete old record: %w", err)
		}
		// Create new record
		return p.CreateRecord(ctx, domain, record)
	}

	// Get existing RRset
	path := fmt.Sprintf("/domains/%s/rrsets/%s/%s/",
		url.PathEscape(domain),
		url.PathEscape(oldSubname),
		url.PathEscape(oldType))

	respBody, err := p.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get rrset: %w", err)
	}

	var existing desecRRset
	if err := json.Unmarshal(respBody, &existing); err != nil {
		return nil, fmt.Errorf("failed to parse rrset: %w", err)
	}

	// Update the specific record in the RRset
	if recordIndex >= len(existing.Records) {
		return nil, fmt.Errorf("record index out of range")
	}
	existing.Records[recordIndex] = value

	// Update RRset
	updateBody := map[string]interface{}{
		"records": existing.Records,
		"ttl":     ttl,
	}
	_, err = p.doRequest(ctx, "PATCH", path, updateBody)
	if err != nil {
		return nil, fmt.Errorf("failed to update rrset: %w", err)
	}

	record.ID = recordID
	return &record, nil
}

func (p *DeSECProvider) DeleteRecord(ctx context.Context, domain string, recordID string) error {
	// Parse the record ID: "subname:type:index"
	parts := strings.SplitN(recordID, ":", 3)
	if len(parts) < 2 {
		return fmt.Errorf("invalid record ID format")
	}

	subname := parts[0]
	recordType := parts[1]
	recordIndex := 0
	if len(parts) == 3 {
		recordIndex, _ = strconv.Atoi(parts[2])
	}

	path := fmt.Sprintf("/domains/%s/rrsets/%s/%s/",
		url.PathEscape(domain),
		url.PathEscape(subname),
		url.PathEscape(recordType))

	// Get existing RRset
	respBody, err := p.doRequest(ctx, "GET", path, nil)
	if err != nil {
		// RRset doesn't exist, nothing to delete
		return nil
	}

	var existing desecRRset
	if err := json.Unmarshal(respBody, &existing); err != nil {
		return fmt.Errorf("failed to parse rrset: %w", err)
	}

	// If only one record, delete the entire RRset
	if len(existing.Records) <= 1 {
		_, err = p.doRequest(ctx, "DELETE", path, nil)
		return err
	}

	// Remove the specific record from the RRset
	if recordIndex >= len(existing.Records) {
		return fmt.Errorf("record index out of range")
	}
	existing.Records = append(existing.Records[:recordIndex], existing.Records[recordIndex+1:]...)

	// Update RRset with remaining records
	updateBody := map[string]interface{}{
		"records": existing.Records,
		"ttl":     existing.TTL,
	}
	_, err = p.doRequest(ctx, "PATCH", path, updateBody)
	return err
}
