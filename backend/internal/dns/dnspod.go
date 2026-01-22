package dns

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DNSPodProvider implements the Provider interface for DNSPod
type DNSPodProvider struct {
	loginToken string // Format: "{id},{token}"
	client     *http.Client
}

// NewDNSPodProvider creates a new DNSPod provider
func NewDNSPodProvider(apiID, apiToken string) *DNSPodProvider {
	return &DNSPodProvider{
		loginToken: fmt.Sprintf("%s,%s", apiID, apiToken),
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (p *DNSPodProvider) Name() string {
	return "dnspod"
}

type dnspodResponse struct {
	Status struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		CreatedAt string `json:"created_at"`
	} `json:"status"`
	Domain  json.RawMessage `json:"domain"`
	Records json.RawMessage `json:"records"`
	Record  json.RawMessage `json:"record"`
}

func (p *DNSPodProvider) doRequest(ctx context.Context, endpoint string, params url.Values) (*dnspodResponse, error) {
	params.Set("login_token", p.loginToken)
	params.Set("format", "json")

	req, err := http.NewRequestWithContext(ctx, "POST",
		"https://dnsapi.cn/"+endpoint,
		strings.NewReader(params.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "Configuratix/1.0")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result dnspodResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if result.Status.Code != "1" {
		return nil, fmt.Errorf("DNSPod error [%s]: %s", result.Status.Code, result.Status.Message)
	}

	return &result, nil
}

func (p *DNSPodProvider) ValidateCredentials(ctx context.Context) error {
	params := url.Values{}
	_, err := p.doRequest(ctx, "User.Detail", params)
	return err
}

func (p *DNSPodProvider) GetExpectedNameservers(ctx context.Context, domain string) ([]string, error) {
	// DNSPod has fixed nameservers for free accounts
	// For paid accounts, they might differ - we could query Domain.Info
	return []string{
		"f1g1ns1.dnspod.net",
		"f1g1ns2.dnspod.net",
	}, nil
}

func (p *DNSPodProvider) ListRecords(ctx context.Context, domain string) ([]Record, error) {
	params := url.Values{
		"domain": {domain},
	}

	result, err := p.doRequest(ctx, "Record.List", params)
	if err != nil {
		return nil, err
	}

	var dnspodRecords []struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		Type       string `json:"type"`
		Value      string `json:"value"`
		TTL        string `json:"ttl"`
		MX         string `json:"mx"`
		UpdatedOn  string `json:"updated_on"`
		RecordLine string `json:"line"`
	}

	if err := json.Unmarshal(result.Records, &dnspodRecords); err != nil {
		return nil, fmt.Errorf("failed to parse records: %w", err)
	}

	records := make([]Record, 0, len(dnspodRecords))
	for _, r := range dnspodRecords {
		// Skip NS records for the root domain (managed by DNSPod)
		if r.Type == "NS" && r.Name == "@" {
			continue
		}

		ttl, _ := strconv.Atoi(r.TTL)
		mx, _ := strconv.Atoi(r.MX)

		record := Record{
			ID:       r.ID,
			Name:     r.Name,
			Type:     r.Type,
			Value:    r.Value,
			TTL:      ttl,
			Priority: mx,
		}

		if r.UpdatedOn != "" {
			record.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", r.UpdatedOn)
		}

		records = append(records, record)
	}

	return records, nil
}

func (p *DNSPodProvider) CreateRecord(ctx context.Context, domain string, record Record) (*Record, error) {
	params := url.Values{
		"domain":      {domain},
		"sub_domain":  {record.Name},
		"record_type": {record.Type},
		"record_line": {"默认"}, // Default line
		"value":       {record.Value},
	}

	if record.TTL > 0 {
		params.Set("ttl", strconv.Itoa(record.TTL))
	} else {
		params.Set("ttl", "600")
	}

	if record.Type == "MX" && record.Priority > 0 {
		params.Set("mx", strconv.Itoa(record.Priority))
	}

	result, err := p.doRequest(ctx, "Record.Create", params)
	if err != nil {
		return nil, err
	}

	var created struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(result.Record, &created); err != nil {
		return nil, fmt.Errorf("failed to parse created record: %w", err)
	}

	record.ID = created.ID
	return &record, nil
}

func (p *DNSPodProvider) UpdateRecord(ctx context.Context, domain string, recordID string, record Record) (*Record, error) {
	params := url.Values{
		"domain":      {domain},
		"record_id":   {recordID},
		"sub_domain":  {record.Name},
		"record_type": {record.Type},
		"record_line": {"默认"},
		"value":       {record.Value},
	}

	if record.TTL > 0 {
		params.Set("ttl", strconv.Itoa(record.TTL))
	}

	if record.Type == "MX" && record.Priority > 0 {
		params.Set("mx", strconv.Itoa(record.Priority))
	}

	_, err := p.doRequest(ctx, "Record.Modify", params)
	if err != nil {
		return nil, err
	}

	record.ID = recordID
	return &record, nil
}

func (p *DNSPodProvider) DeleteRecord(ctx context.Context, domain string, recordID string) error {
	params := url.Values{
		"domain":    {domain},
		"record_id": {recordID},
	}

	_, err := p.doRequest(ctx, "Record.Remove", params)
	return err
}

