package dns

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// CloudflareProvider implements the Provider interface for Cloudflare
type CloudflareProvider struct {
	apiToken string
	client   *http.Client
}

// NewCloudflareProvider creates a new Cloudflare provider
func NewCloudflareProvider(apiToken string) *CloudflareProvider {
	return &CloudflareProvider{
		apiToken: apiToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (p *CloudflareProvider) Name() string {
	return "cloudflare"
}

type cfResponse struct {
	Success  bool            `json:"success"`
	Errors   []cfError       `json:"errors"`
	Messages []string        `json:"messages"`
	Result   json.RawMessage `json:"result"`
}

type cfError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (p *CloudflareProvider) doRequest(ctx context.Context, method, path string, body interface{}) (*cfResponse, error) {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewBuffer(b)
	}

	req, err := http.NewRequestWithContext(ctx, method,
		"https://api.cloudflare.com/client/v4"+path, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+p.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result cfResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if !result.Success {
		if len(result.Errors) > 0 {
			return nil, fmt.Errorf("Cloudflare error [%d]: %s", result.Errors[0].Code, result.Errors[0].Message)
		}
		return nil, fmt.Errorf("Cloudflare request failed")
	}

	return &result, nil
}

func (p *CloudflareProvider) ValidateCredentials(ctx context.Context) error {
	_, err := p.doRequest(ctx, "GET", "/user/tokens/verify", nil)
	return err
}

func (p *CloudflareProvider) getZoneID(ctx context.Context, domain string) (string, error) {
	result, err := p.doRequest(ctx, "GET", "/zones?name="+domain, nil)
	if err != nil {
		return "", err
	}

	var zones []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(result.Result, &zones); err != nil {
		return "", fmt.Errorf("failed to parse zones: %w", err)
	}

	if len(zones) == 0 {
		return "", fmt.Errorf("zone not found for %s", domain)
	}

	return zones[0].ID, nil
}

func (p *CloudflareProvider) GetExpectedNameservers(ctx context.Context, domain string) ([]string, error) {
	zoneID, err := p.getZoneID(ctx, domain)
	if err != nil {
		return nil, err
	}

	result, err := p.doRequest(ctx, "GET", "/zones/"+zoneID, nil)
	if err != nil {
		return nil, err
	}

	var zone struct {
		NameServers []string `json:"name_servers"`
	}
	if err := json.Unmarshal(result.Result, &zone); err != nil {
		return nil, fmt.Errorf("failed to parse zone: %w", err)
	}

	return zone.NameServers, nil
}

func (p *CloudflareProvider) ListRecords(ctx context.Context, domain string) ([]Record, error) {
	zoneID, err := p.getZoneID(ctx, domain)
	if err != nil {
		return nil, err
	}

	result, err := p.doRequest(ctx, "GET", "/zones/"+zoneID+"/dns_records?per_page=1000", nil)
	if err != nil {
		return nil, err
	}

	var cfRecords []struct {
		ID         string    `json:"id"`
		Name       string    `json:"name"`
		Type       string    `json:"type"`
		Content    string    `json:"content"`
		TTL        int       `json:"ttl"`
		Priority   int       `json:"priority"`
		Proxied    bool      `json:"proxied"`
		ModifiedOn time.Time `json:"modified_on"`
	}
	if err := json.Unmarshal(result.Result, &cfRecords); err != nil {
		return nil, fmt.Errorf("failed to parse records: %w", err)
	}

	records := make([]Record, 0, len(cfRecords))
	for _, r := range cfRecords {
		// Extract subdomain from full name (www.example.com -> www)
		name := strings.TrimSuffix(r.Name, "."+domain)
		if name == domain {
			name = "@"
		}

		record := Record{
			ID:        r.ID,
			Name:      name,
			Type:      r.Type,
			Value:     r.Content,
			TTL:       r.TTL,
			Priority:  r.Priority,
			Proxied:   r.Proxied,
			UpdatedAt: r.ModifiedOn,
		}
		records = append(records, record)
	}

	return records, nil
}

func (p *CloudflareProvider) CreateRecord(ctx context.Context, domain string, record Record) (*Record, error) {
	zoneID, err := p.getZoneID(ctx, domain)
	if err != nil {
		return nil, err
	}

	// Build full name
	name := record.Name
	if name == "@" {
		name = domain
	} else {
		name = record.Name + "." + domain
	}

	body := map[string]interface{}{
		"type":    record.Type,
		"name":    name,
		"content": record.Value,
		"ttl":     record.TTL,
		"proxied": record.Proxied,
	}

	if record.TTL == 0 {
		body["ttl"] = 1 // 1 = auto
	}

	if record.Type == "MX" {
		body["priority"] = record.Priority
	}

	result, err := p.doRequest(ctx, "POST", "/zones/"+zoneID+"/dns_records", body)
	if err != nil {
		return nil, err
	}

	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(result.Result, &created); err != nil {
		return nil, fmt.Errorf("failed to parse created record: %w", err)
	}

	record.ID = created.ID
	return &record, nil
}

func (p *CloudflareProvider) UpdateRecord(ctx context.Context, domain string, recordID string, record Record) (*Record, error) {
	zoneID, err := p.getZoneID(ctx, domain)
	if err != nil {
		return nil, err
	}

	// Build full name
	name := record.Name
	if name == "@" {
		name = domain
	} else {
		name = record.Name + "." + domain
	}

	body := map[string]interface{}{
		"type":    record.Type,
		"name":    name,
		"content": record.Value,
		"ttl":     record.TTL,
		"proxied": record.Proxied,
	}

	if record.TTL == 0 {
		body["ttl"] = 1
	}

	if record.Type == "MX" {
		body["priority"] = record.Priority
	}

	_, err = p.doRequest(ctx, "PUT", "/zones/"+zoneID+"/dns_records/"+recordID, body)
	if err != nil {
		return nil, err
	}

	record.ID = recordID
	return &record, nil
}

func (p *CloudflareProvider) DeleteRecord(ctx context.Context, domain string, recordID string) error {
	zoneID, err := p.getZoneID(ctx, domain)
	if err != nil {
		return err
	}

	_, err = p.doRequest(ctx, "DELETE", "/zones/"+zoneID+"/dns_records/"+recordID, nil)
	return err
}

