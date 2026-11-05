package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	serverURL string
	apiKey    string
	http      *http.Client
}

func New(serverURL, apiKey string) *Client {
	return &Client{
		serverURL: serverURL,
		apiKey:    apiKey,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type EnrollRequest struct {
	Token    string `json:"token"`
	Hostname string `json:"hostname"`
	IP       string `json:"ip"`
	OS       string `json:"os"`
}

type EnrollResponse struct {
	AgentID string `json:"agent_id"`
	APIKey  string `json:"api_key"`
}

func (c *Client) Enroll(req EnrollRequest) (*EnrollResponse, error) {
	body, _ := json.Marshal(req)
	resp, err := c.http.Post(c.serverURL+"/api/agent/enroll", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("enrollment failed: %s", string(bodyBytes))
	}

	var result EnrollResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}

// HeartbeatResponse is the backend's answer to a heartbeat. Old backends only
// return {"status":"ok"}; every other field is optional.
type HeartbeatResponse struct {
	Status        string `json:"status"`
	TargetVersion string `json:"target_version,omitempty"`
}

// HeartbeatWithStats sends full system stats
func (c *Client) HeartbeatWithStats(stats interface{}) error {
	_, err := c.Heartbeat(stats)
	return err
}

// Heartbeat sends the heartbeat payload and decodes the (optional) response.
func (c *Client) Heartbeat(payload interface{}) (*HeartbeatResponse, error) {
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", c.serverURL+"/api/agent/heartbeat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("heartbeat failed: %d", resp.StatusCode)
	}

	var hr HeartbeatResponse
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&hr)
	return &hr, nil
}

type Job struct {
	ID             string          `json:"id"`
	Type           string          `json:"type"`
	Payload        json.RawMessage `json:"payload"`
	Status         string          `json:"status"`
	TimeoutSeconds *int            `json:"timeout_seconds,omitempty"`
	Attempts       int             `json:"attempts,omitempty"`
}

// GetJobs claims up to 10 pending jobs (legacy behaviour).
func (c *Client) GetJobs() ([]Job, error) {
	return c.ClaimJobs(0)
}

// ClaimJobs atomically claims up to limit pending jobs (limit<=0: server default).
// Claimed jobs are already marked running on the server.
func (c *Client) ClaimJobs(limit int) ([]Job, error) {
	u := c.serverURL + "/api/agent/jobs"
	if limit > 0 {
		u += fmt.Sprintf("?limit=%d", limit)
	}
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get jobs failed: %d", resp.StatusCode)
	}

	var jobs []Job
	if err := json.NewDecoder(resp.Body).Decode(&jobs); err != nil {
		return nil, err
	}

	return jobs, nil
}

// UpdateJob sends a legacy update (status + logs appended with newline).
func (c *Client) UpdateJob(jobID, status, logs string) error {
	_, err := c.ReportJob(JobUpdate{JobID: jobID, Status: status, Logs: logs})
	return err
}

// JobUpdate is the v2 job update request. AppendLogs is appended verbatim
// (no separator) to jobs.logs; Result is stored in jobs.result_json.
type JobUpdate struct {
	JobID      string      `json:"job_id"`
	Status     string      `json:"status"`
	Logs       string      `json:"logs,omitempty"`
	AppendLogs *string     `json:"append_logs,omitempty"`
	Result     interface{} `json:"result,omitempty"`
	Error      string      `json:"error,omitempty"`
}

// JobUpdateResponse is returned by the backend. Old backends return only
// {"status":"ok"}.
type JobUpdateResponse struct {
	Status          string `json:"status"`
	JobStatus       string `json:"job_status,omitempty"`
	CancelRequested bool   `json:"cancel_requested,omitempty"`
}

func (c *Client) ReportJob(u JobUpdate) (*JobUpdateResponse, error) {
	body, _ := json.Marshal(u)
	req, _ := http.NewRequest("POST", c.serverURL+"/api/agent/jobs/update", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update job failed: %d", resp.StatusCode)
	}

	var r JobUpdateResponse
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&r)
	return &r, nil
}
