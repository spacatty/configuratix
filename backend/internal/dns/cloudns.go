package dns

import (
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

// ClouDNSProvider implements the Provider interface for ClouDNS
type ClouDNSProvider struct {
	authID       string // auth-id or sub-auth-id
	authPassword string
	isSubUser    bool
	client       *http.Client
}

// NewClouDNSProvider creates a new ClouDNS provider
// apiID is auth-id (or sub-auth-id), apiToken is auth-password
func NewClouDNSProvider(apiID, apiToken string) *ClouDNSProvider {
	// If apiID starts with "sub-", it's a sub-user
	isSubUser := strings.HasPrefix(apiID, "sub-")
	if isSubUser {
		apiID = strings.TrimPrefix(apiID, "sub-")
	}

	return &ClouDNSProvider{
		authID:       apiID,
		authPassword: apiToken,
		isSubUser:    isSubUser,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (p *ClouDNSProvider) Name() string {
	return "cloudns"
}

const cloudnsBaseURL = "https://api.cloudns.net/dns/"

// ClouDNS API response structures
type cloudnsStatus struct {
	Status            string `json:"status"`
	StatusDescription string `json:"statusDescription"`
}

type cloudnsZone struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Zone   string `json:"zone"`
	Status string `json:"status"`
}

type cloudnsRecord struct {
	ID       string `json:"id"`
	Host     string `json:"host"`     // Subdomain: "" for root, "www", etc
	Type     string `json:"type"`     // A, AAAA, MX, TXT, CNAME, etc
	Record   string `json:"record"`   // The record value
	TTL      string `json:"ttl"`
	Priority string `json:"priority,omitempty"` // For MX records
}

func (p *ClouDNSProvider) buildParams() url.Values {
	params := url.Values{}
	if p.isSubUser {
		params.Set("sub-auth-id", p.authID)
	} else {
		params.Set("auth-id", p.authID)
	}
	params.Set("auth-password", p.authPassword)
	return params
}

func (p *ClouDNSProvider) doRequest(ctx context.Context, endpoint string, extraParams url.Values) ([]byte, error) {
	params := p.buildParams()
	for k, v := range extraParams {
		params[k] = v
	}

	reqURL := cloudnsBaseURL + endpoint + ".json?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Check for error response
	var status cloudnsStatus
	if err := json.Unmarshal(body, &status); err == nil {
		if status.Status == "Failed" {
			return nil, fmt.Errorf("ClouDNS error: %s", status.StatusDescription)
		}
	}

	return body, nil
}

func (p *ClouDNSProvider) doPost(ctx context.Context, endpoint string, extraParams url.Values) ([]byte, error) {
	params := p.buildParams()
	for k, v := range extraParams {
		params[k] = v
	}

	reqURL := cloudnsBaseURL + endpoint + ".json"

	req, err := http.NewRequestWithContext(ctx, "POST", reqURL, strings.NewReader(params.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Check for error response
	var status cloudnsStatus
	if err := json.Unmarshal(body, &status); err == nil {
		if status.Status == "Failed" {
			return nil, fmt.Errorf("ClouDNS error: %s", status.StatusDescription)
		}
	}

	return body, nil
}

func (p *ClouDNSProvider) ValidateCredentials(ctx context.Context) error {
	// Use login endpoint to validate
	_, err := p.doRequest(ctx, "login", nil)
	return err
}

// CreateZone creates a new zone in ClouDNS
func (p *ClouDNSProvider) CreateZone(ctx context.Context, domain string) error {
	params := url.Values{}
	params.Set("domain-name", domain)
	params.Set("zone-type", "master")

	_, err := p.doPost(ctx, "register", params)
	if err != nil {
		// Check if zone already exists
		if strings.Contains(err.Error(), "already exists") {
			return nil
		}
		return err
	}
	return nil
}

func (p *ClouDNSProvider) GetExpectedNameservers(ctx context.Context, domain string) ([]string, error) {
	// ClouDNS nameservers depend on account type
	// Free accounts get: ns1.cloudns.net, ns2.cloudns.net, ns3.cloudns.net, ns4.cloudns.net
	// Premium accounts get more
	return []string{
		"ns1.cloudns.net",
		"ns2.cloudns.net",
		"ns3.cloudns.net",
		"ns4.cloudns.net",
	}, nil
}

// GetOrCreateZone creates zone if needed and returns nameservers
func (p *ClouDNSProvider) GetOrCreateZone(ctx context.Context, domain string) ([]string, error) {
	// Try to get zone info first
	params := url.Values{}
	params.Set("domain-name", domain)

	body, err := p.doRequest(ctx, "get-zone-info", params)
	if err != nil {
		// Zone doesn't exist, create it
		if err := p.CreateZone(ctx, domain); err != nil {
			return nil, err
		}
	}

	// Parse zone info to get nameservers if available
	var zoneInfo struct {
		Name string   `json:"name"`
		NS   []string `json:"ns,omitempty"`
	}
	if err := json.Unmarshal(body, &zoneInfo); err == nil && len(zoneInfo.NS) > 0 {
		return zoneInfo.NS, nil
	}

	return p.GetExpectedNameservers(ctx, domain)
}

func (p *ClouDNSProvider) ListRecords(ctx context.Context, domain string) ([]Record, error) {
	params := url.Values{}
	params.Set("domain-name", domain)

	body, err := p.doRequest(ctx, "records", params)
	if err != nil {
		return nil, err
	}

	// ClouDNS returns records as a map with ID as key
	var recordsMap map[string]cloudnsRecord
	if err := json.Unmarshal(body, &recordsMap); err != nil {
		// Try parsing as empty response
		var emptyCheck interface{}
		if json.Unmarshal(body, &emptyCheck) == nil {
			return []Record{}, nil
		}
		return nil, fmt.Errorf("failed to parse records: %w (body: %s)", err, string(body))
	}

	records := make([]Record, 0, len(recordsMap))
	for id, r := range recordsMap {
		// Skip NS records for root (managed by ClouDNS)
		if r.Type == "NS" && r.Host == "" {
			continue
		}

		name := r.Host
		if name == "" {
			name = "@"
		}

		ttl, _ := strconv.Atoi(r.TTL)
		priority, _ := strconv.Atoi(r.Priority)

		record := Record{
			ID:       id,
			Name:     name,
			Type:     r.Type,
			Value:    r.Record,
			TTL:      ttl,
			Priority: priority,
			Proxied:  false, // ClouDNS doesn't support proxying
		}
		records = append(records, record)
	}

	return records, nil
}

func (p *ClouDNSProvider) CreateRecord(ctx context.Context, domain string, record Record) (*Record, error) {
	name := record.Name
	if name == "@" {
		name = ""
	}

	params := url.Values{}
	params.Set("domain-name", domain)
	params.Set("record-type", record.Type)
	params.Set("host", name)
	params.Set("record", record.Value)
	params.Set("ttl", strconv.Itoa(record.TTL))

	if record.TTL == 0 {
		params.Set("ttl", "3600")
	}

	if record.Type == "MX" && record.Priority > 0 {
		params.Set("priority", strconv.Itoa(record.Priority))
	}

	body, err := p.doPost(ctx, "add-record", params)
	if err != nil {
		return nil, fmt.Errorf("failed to create record: %w", err)
	}

	// Parse response to get record ID
	var response struct {
		Status string `json:"status"`
		Data   struct {
			ID int `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err == nil && response.Data.ID > 0 {
		record.ID = strconv.Itoa(response.Data.ID)
	} else {
		// Try alternate response format
		var altResponse struct {
			ID int `json:"id"`
		}
		if err := json.Unmarshal(body, &altResponse); err == nil && altResponse.ID > 0 {
			record.ID = strconv.Itoa(altResponse.ID)
		}
	}

	return &record, nil
}

func (p *ClouDNSProvider) UpdateRecord(ctx context.Context, domain string, recordID string, record Record) (*Record, error) {
	name := record.Name
	if name == "@" {
		name = ""
	}

	params := url.Values{}
	params.Set("domain-name", domain)
	params.Set("record-id", recordID)
	params.Set("host", name)
	params.Set("record", record.Value)
	params.Set("ttl", strconv.Itoa(record.TTL))

	if record.Type == "MX" && record.Priority > 0 {
		params.Set("priority", strconv.Itoa(record.Priority))
	}

	_, err := p.doPost(ctx, "mod-record", params)
	if err != nil {
		return nil, fmt.Errorf("failed to update record: %w", err)
	}

	record.ID = recordID
	return &record, nil
}

func (p *ClouDNSProvider) DeleteRecord(ctx context.Context, domain string, recordID string) error {
	params := url.Values{}
	params.Set("domain-name", domain)
	params.Set("record-id", recordID)

	_, err := p.doPost(ctx, "delete-record", params)
	return err
}

