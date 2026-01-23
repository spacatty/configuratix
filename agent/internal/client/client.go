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

// HeartbeatWithStats sends full system stats
func (c *Client) HeartbeatWithStats(stats interface{}) error {
	body, _ := json.Marshal(stats)
	req, _ := http.NewRequest("POST", c.serverURL+"/api/agent/heartbeat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("heartbeat failed: %d", resp.StatusCode)
	}

	return nil
}

type Job struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	Status  string          `json:"status"`
}

func (c *Client) GetJobs() ([]Job, error) {
	req, _ := http.NewRequest("GET", c.serverURL+"/api/agent/jobs", nil)
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

func (c *Client) UpdateJob(jobID, status, logs string) error {
	body, _ := json.Marshal(map[string]string{
		"job_id": jobID,
		"status": status,
		"logs":   logs,
	})
	req, _ := http.NewRequest("POST", c.serverURL+"/api/agent/jobs/update", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("update job failed: %d", resp.StatusCode)
	}

	return nil
}

