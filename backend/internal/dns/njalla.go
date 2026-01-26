package dns

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// NjallaProvider implements the Provider interface for Njalla
type NjallaProvider struct {
	apiToken string
	client   *http.Client
}

// NewNjallaProvider creates a new Njalla provider
func NewNjallaProvider(apiToken string) *NjallaProvider {
	return &NjallaProvider{
		apiToken: apiToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (p *NjallaProvider) Name() string {
	return "njalla"
}

// Njalla API request/response structures
type njallaRequest struct {
	Method string      `json:"method"`
	Params interface{} `json:"params"`
}

type njallaResponse struct {
	Jsonrpc string           `json:"jsonrpc"`
	Result  json.RawMessage  `json:"result,omitempty"`
	Error   *njallaError     `json:"error,omitempty"`
	ID      interface{}      `json:"id"`
}

type njallaError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type njallaDomain struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expiry,omitempty"`
}

type njallaRecord struct {
	ID       string `json:"id"`
	Name     string `json:"name"`     // Subdomain: "@" for root, "www", etc
	Type     string `json:"type"`     // A, AAAA, MX, TXT, CNAME, etc
	Content  string `json:"content"`  // The record value
	TTL      int    `json:"ttl"`
	Priority int    `json:"prio,omitempty"` // For MX records
}

func (p *NjallaProvider) doRequest(ctx context.Context, method string, params interface{}) (*njallaResponse, error) {
	reqBody := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
		"id":      1,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://njal.la/api/1/", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, err
	}

	// Auth via header: "Authorization: Njalla <token>"
	req.Header.Set("Authorization", "Njalla "+p.apiToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result njallaResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w (body: %s)", err, string(respBody))
	}

	if result.Error != nil {
		return nil, fmt.Errorf("Njalla error [%d]: %s", result.Error.Code, result.Error.Message)
	}

	return &result, nil
}

func (p *NjallaProvider) ValidateCredentials(ctx context.Context) error {
	params := map[string]interface{}{}
	_, err := p.doRequest(ctx, "list-domains", params)
	return err
}

// CreateZone - Njalla doesn't support creating zones via API
// Domains must be registered/transferred through their web interface
func (p *NjallaProvider) CreateZone(ctx context.Context, domain string) error {
	// Check if domain exists
	params := map[string]interface{}{
		"domain": domain,
	}

	_, err := p.doRequest(ctx, "get-domain", params)
	if err != nil {
		return fmt.Errorf("domain not found in Njalla account (domains must be registered through njal.la): %w", err)
	}

	return nil
}

func (p *NjallaProvider) GetExpectedNameservers(ctx context.Context, domain string) ([]string, error) {
	// Njalla uses fixed nameservers
	return []string{
		"ns1.njal.la",
		"ns2.njal.la",
		"ns3.njal.la",
	}, nil
}

// GetOrCreateZone checks if domain exists in Njalla account
func (p *NjallaProvider) GetOrCreateZone(ctx context.Context, domain string) ([]string, error) {
	// Check if domain exists
	params := map[string]interface{}{
		"domain": domain,
	}

	_, err := p.doRequest(ctx, "get-domain", params)
	if err != nil {
		return nil, fmt.Errorf("domain not found in Njalla account: %w", err)
	}

	return p.GetExpectedNameservers(ctx, domain)
}

func (p *NjallaProvider) ListRecords(ctx context.Context, domain string) ([]Record, error) {
	params := map[string]interface{}{
		"domain": domain,
	}

	result, err := p.doRequest(ctx, "list-records", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		Records []njallaRecord `json:"records"`
	}
	if err := json.Unmarshal(result.Result, &response); err != nil {
		// Try parsing as direct array
		var records []njallaRecord
		if err := json.Unmarshal(result.Result, &records); err != nil {
			return nil, fmt.Errorf("failed to parse records: %w", err)
		}
		response.Records = records
	}

	records := make([]Record, 0, len(response.Records))
	for _, r := range response.Records {
		// Skip NS records for root (managed by Njalla)
		if r.Type == "NS" && (r.Name == "@" || r.Name == "") {
			continue
		}

		name := r.Name
		if name == "" {
			name = "@"
		}

		record := Record{
			ID:       r.ID,
			Name:     name,
			Type:     r.Type,
			Value:    r.Content,
			TTL:      r.TTL,
			Priority: r.Priority,
			Proxied:  false, // Njalla doesn't support proxying
		}
		records = append(records, record)
	}

	return records, nil
}

func (p *NjallaProvider) CreateRecord(ctx context.Context, domain string, record Record) (*Record, error) {
	name := record.Name
	if name == "@" {
		name = "@"
	}

	params := map[string]interface{}{
		"domain":  domain,
		"name":    name,
		"type":    record.Type,
		"content": record.Value,
		"ttl":     record.TTL,
	}

	if record.TTL == 0 {
		params["ttl"] = 3600
	}

	if record.Type == "MX" && record.Priority > 0 {
		params["prio"] = record.Priority
	}

	result, err := p.doRequest(ctx, "add-record", params)
	if err != nil {
		return nil, fmt.Errorf("failed to create record: %w", err)
	}

	// Parse the response to get the record ID
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(result.Result, &created); err != nil {
		// Try to get ID from different response format
		var response map[string]interface{}
		if err := json.Unmarshal(result.Result, &response); err == nil {
			if id, ok := response["id"].(string); ok {
				created.ID = id
			}
		}
	}

	record.ID = created.ID
	return &record, nil
}

func (p *NjallaProvider) UpdateRecord(ctx context.Context, domain string, recordID string, record Record) (*Record, error) {
	name := record.Name
	if name == "@" {
		name = "@"
	}

	params := map[string]interface{}{
		"domain":  domain,
		"id":      recordID,
		"name":    name,
		"type":    record.Type,
		"content": record.Value,
		"ttl":     record.TTL,
	}

	if record.Type == "MX" && record.Priority > 0 {
		params["prio"] = record.Priority
	}

	_, err := p.doRequest(ctx, "edit-record", params)
	if err != nil {
		return nil, fmt.Errorf("failed to update record: %w", err)
	}

	record.ID = recordID
	return &record, nil
}

func (p *NjallaProvider) DeleteRecord(ctx context.Context, domain string, recordID string) error {
	params := map[string]interface{}{
		"domain": domain,
		"id":     recordID,
	}

	_, err := p.doRequest(ctx, "remove-record", params)
	return err
}

