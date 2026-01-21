#!/bin/bash
set -e

# Configuratix Agent Installer
# Usage: curl -sSL http://YOUR_SERVER/install.sh | sudo bash -s -- YOUR_TOKEN

TOKEN="$1"
SERVER_URL="${CONFIGURATIX_SERVER:-http://localhost:8080}"

if [ -z "$TOKEN" ]; then
    echo "Error: Enrollment token is required"
    echo "Usage: curl -sSL http://YOUR_SERVER/install.sh | sudo bash -s -- YOUR_TOKEN"
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

echo "=== Configuratix Agent Installer ==="
echo "Server: $SERVER_URL"
echo ""

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VERSION=$VERSION_ID
else
    echo "Error: Cannot detect OS"
    exit 1
fi

echo "Detected OS: $OS $VERSION"

if [[ "$OS" != "ubuntu" ]] || [[ "$VERSION" != "22.04" && "$VERSION" != "24.04" ]]; then
    echo "Warning: This installer is designed for Ubuntu 22.04 and 24.04"
    echo "Proceeding anyway..."
fi

# Create directories
mkdir -p /etc/configuratix
mkdir -p /opt/configuratix/bin

# Download agent binary
echo "Downloading agent..."
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    ARCH="amd64"
elif [ "$ARCH" = "aarch64" ]; then
    ARCH="arm64"
fi

# For now, we'll build from source or use a pre-built binary
# In production, this would download from a release URL
if ! command -v go &> /dev/null; then
    echo "Installing Go..."
    apt-get update
    apt-get install -y golang-go
fi

# Build agent (in production, download pre-built binary)
echo "Building agent..."
cd /tmp
if [ -d "configuratix-agent" ]; then
    rm -rf configuratix-agent
fi
mkdir configuratix-agent
cd configuratix-agent

# Create a minimal agent build
cat > go.mod << 'EOF'
module configuratix/agent

go 1.21
EOF

mkdir -p cmd/agent internal/config internal/client internal/executor

# Copy the agent source (in production, this would be downloaded)
# For now, we'll create a minimal version

cat > internal/config/config.go << 'CONFIGEOF'
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const (
	ConfigDir  = "/etc/configuratix"
	ConfigFile = "agent.json"
)

type Config struct {
	ServerURL string `json:"server_url"`
	AgentID   string `json:"agent_id"`
	APIKey    string `json:"api_key"`
}

func Load() (*Config, error) {
	path := filepath.Join(ConfigDir, ConfigFile)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func (c *Config) Save() error {
	if err := os.MkdirAll(ConfigDir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(ConfigDir, ConfigFile)
	return os.WriteFile(path, data, 0600)
}
CONFIGEOF

cat > internal/client/client.go << 'CLIENTEOF'
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
		http:      &http.Client{Timeout: 30 * time.Second},
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
	json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func (c *Client) Heartbeat(version string) error {
	body, _ := json.Marshal(map[string]string{"version": version})
	req, _ := http.NewRequest("POST", c.serverURL+"/api/agent/heartbeat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

type Job struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func (c *Client) GetJobs() ([]Job, error) {
	req, _ := http.NewRequest("GET", c.serverURL+"/api/agent/jobs", nil)
	req.Header.Set("X-API-Key", c.apiKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var jobs []Job
	json.NewDecoder(resp.Body).Decode(&jobs)
	return jobs, nil
}

func (c *Client) UpdateJob(jobID, status, logs string) error {
	body, _ := json.Marshal(map[string]string{"job_id": jobID, "status": status, "logs": logs})
	req, _ := http.NewRequest("POST", c.serverURL+"/api/agent/jobs/update", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)
	c.http.Do(req)
	return nil
}
CLIENTEOF

cat > internal/executor/executor.go << 'EXECEOF'
package executor

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type Executor struct{}

func New() *Executor { return &Executor{} }

func (e *Executor) Execute(jobType string, payload json.RawMessage) (string, error) {
	switch jobType {
	case "bootstrap_machine":
		return e.bootstrap()
	case "apply_domain":
		var p struct {
			Domain      string `json:"domain"`
			NginxConfig string `json:"nginx_config"`
		}
		json.Unmarshal(payload, &p)
		return e.applyDomain(p.Domain, p.NginxConfig)
	case "remove_domain":
		var p struct{ Domain string `json:"domain"` }
		json.Unmarshal(payload, &p)
		return e.removeDomain(p.Domain)
	default:
		return "", fmt.Errorf("unknown job: %s", jobType)
	}
}

func (e *Executor) bootstrap() (string, error) {
	var logs strings.Builder
	logs.WriteString("Bootstrapping machine...\n")
	run("apt-get", "update")
	run("apt-get", "install", "-y", "nginx", "certbot", "python3-certbot-nginx", "fail2ban")
	os.MkdirAll("/etc/nginx/conf.d/configuratix", 0755)
	run("systemctl", "enable", "nginx")
	run("systemctl", "start", "nginx")
	logs.WriteString("Bootstrap complete\n")
	return logs.String(), nil
}

func (e *Executor) applyDomain(domain, config string) (string, error) {
	path := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain)
	os.WriteFile(path, []byte(config), 0644)
	if _, err := run("nginx", "-t"); err != nil {
		os.Remove(path)
		return "", err
	}
	run("systemctl", "reload", "nginx")
	return fmt.Sprintf("Applied config for %s\n", domain), nil
}

func (e *Executor) removeDomain(domain string) (string, error) {
	path := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain)
	os.Remove(path)
	run("systemctl", "reload", "nginx")
	return fmt.Sprintf("Removed config for %s\n", domain), nil
}

func run(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return out.String(), err
}
EXECEOF

cat > cmd/agent/main.go << 'MAINEOF'
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"

	"configuratix/agent/internal/client"
	"configuratix/agent/internal/config"
	"configuratix/agent/internal/executor"
)

const Version = "0.1.0"

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: configuratix-agent [enroll|run|version]")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "enroll":
		fs := flag.NewFlagSet("enroll", flag.ExitOnError)
		server := fs.String("server", "", "Server URL")
		token := fs.String("token", "", "Enrollment token")
		fs.Parse(os.Args[2:])
		if *server == "" || *token == "" {
			log.Fatal("--server and --token required")
		}
		enroll(*server, *token)
	case "run":
		run()
	case "version":
		fmt.Println("Configuratix Agent", Version)
	default:
		fmt.Println("Unknown command")
		os.Exit(1)
	}
}

func enroll(serverURL, token string) {
	hostname, _ := os.Hostname()
	ip := getIP()
	osVer := getOS()

	c := client.New(serverURL, "")
	resp, err := c.Enroll(client.EnrollRequest{Token: token, Hostname: hostname, IP: ip, OS: osVer})
	if err != nil {
		log.Fatal(err)
	}

	cfg := &config.Config{ServerURL: serverURL, AgentID: resp.AgentID, APIKey: resp.APIKey}
	cfg.Save()
	log.Println("Enrolled! Run: configuratix-agent run")
}

func run() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal("Run enroll first:", err)
	}

	log.Println("Starting agent...")
	c := client.New(cfg.ServerURL, cfg.APIKey)
	ex := executor.New()

	for {
		c.Heartbeat(Version)
		jobs, _ := c.GetJobs()
		for _, job := range jobs {
			log.Println("Processing job:", job.ID)
			c.UpdateJob(job.ID, "running", "Starting...")
			logs, err := ex.Execute(job.Type, job.Payload)
			if err != nil {
				c.UpdateJob(job.ID, "failed", logs+"\n"+err.Error())
			} else {
				c.UpdateJob(job.ID, "completed", logs)
			}
		}
		time.Sleep(5 * time.Second)
	}
}

func getIP() string {
	conn, _ := net.Dial("udp", "8.8.8.8:80")
	if conn != nil {
		defer conn.Close()
		return conn.LocalAddr().(*net.UDPAddr).IP.String()
	}
	return ""
}

func getOS() string {
	out, _ := exec.Command("lsb_release", "-d", "-s").Output()
	return strings.TrimSpace(string(out))
}
MAINEOF

# Build
go build -o /opt/configuratix/bin/configuratix-agent ./cmd/agent

# Clean up
cd /
rm -rf /tmp/configuratix-agent

echo "Agent installed to /opt/configuratix/bin/configuratix-agent"

# Enroll
echo "Enrolling agent..."
/opt/configuratix/bin/configuratix-agent enroll --server "$SERVER_URL" --token "$TOKEN"

# Create systemd service
cat > /etc/systemd/system/configuratix-agent.service << EOF
[Unit]
Description=Configuratix Agent
After=network.target

[Service]
Type=simple
ExecStart=/opt/configuratix/bin/configuratix-agent run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
systemctl daemon-reload
systemctl enable configuratix-agent
systemctl start configuratix-agent

echo ""
echo "=== Installation Complete ==="
echo "Agent is now running as a systemd service"
echo "Check status: systemctl status configuratix-agent"
echo "View logs: journalctl -u configuratix-agent -f"

