package handlers

import (
	"net/http"
	"os"
	"strings"
)

// InstallHandler serves the agent installation script
type InstallHandler struct{}

func NewInstallHandler() *InstallHandler {
	return &InstallHandler{}
}

// ServeInstallScript serves the install.sh script with the correct server URL injected
func (h *InstallHandler) ServeInstallScript(w http.ResponseWriter, r *http.Request) {
	// Determine the server URL from the request
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	serverURL := scheme + "://" + r.Host

	// Read the install script template
	scriptPaths := []string{
		"../agent/install.sh",
		"agent/install.sh",
	}

	var script []byte
	var err error
	for _, path := range scriptPaths {
		script, err = os.ReadFile(path)
		if err == nil {
			break
		}
	}

	if err != nil {
		// Fallback: embedded minimal script
		script = []byte(getEmbeddedInstallScript())
	}

	// Replace the default SERVER_URL with the actual server URL
	scriptStr := string(script)
	scriptStr = strings.Replace(
		scriptStr,
		`SERVER_URL="${CONFIGURATIX_SERVER:-http://localhost:8080}"`,
		`SERVER_URL="${CONFIGURATIX_SERVER:-`+serverURL+`}"`,
		1,
	)

	w.Header().Set("Content-Type", "text/x-shellscript")
	w.Header().Set("Content-Disposition", "inline; filename=\"install.sh\"")
	w.Write([]byte(scriptStr))
}

func getEmbeddedInstallScript() string {
	return `#!/bin/bash
set -e

TOKEN="$1"
SERVER_URL="${CONFIGURATIX_SERVER:-http://localhost:8080}"

if [ -z "$TOKEN" ]; then
    echo "Error: Enrollment token is required"
    echo "Usage: curl -sSL $SERVER_URL/install.sh | sudo bash -s -- YOUR_TOKEN"
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

echo "=== Configuratix Agent Installer ==="
echo "Server: $SERVER_URL"
echo ""

# Install Go if not present
if ! command -v go &> /dev/null; then
    echo "Installing Go..."
    apt-get update
    apt-get install -y golang-go
fi

# Create directories
mkdir -p /etc/configuratix
mkdir -p /opt/configuratix/bin

# Download and build agent from server
echo "Downloading agent source..."
cd /tmp
rm -rf configuratix-agent-build
mkdir configuratix-agent-build
cd configuratix-agent-build

# Download agent source tarball
curl -sSL "$SERVER_URL/api/agent/source" -o agent.tar.gz || {
    echo "Note: Could not download pre-built agent, building from scratch..."
}

# For now, create minimal agent inline
cat > go.mod << 'EOF'
module configuratix/agent
go 1.21
EOF

mkdir -p cmd/agent internal/config internal/client internal/executor

# ... (agent source files would be created here)
# For brevity, using a simple version

cat > cmd/agent/main.go << 'MAINEOF'
package main

import (
    "bytes"
    "encoding/json"
    "flag"
    "fmt"
    "io"
    "log"
    "net"
    "net/http"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "time"
)

const Version = "0.1.0"
const ConfigDir = "/etc/configuratix"
const ConfigFile = "agent.json"

type Config struct {
    ServerURL string ` + "`json:\"server_url\"`" + `
    AgentID   string ` + "`json:\"agent_id\"`" + `
    APIKey    string ` + "`json:\"api_key\"`" + `
}

func loadConfig() (*Config, error) {
    path := filepath.Join(ConfigDir, ConfigFile)
    data, err := os.ReadFile(path)
    if err != nil { return nil, err }
    var config Config
    json.Unmarshal(data, &config)
    return &config, nil
}

func (c *Config) save() error {
    os.MkdirAll(ConfigDir, 0755)
    data, _ := json.MarshalIndent(c, "", "  ")
    return os.WriteFile(filepath.Join(ConfigDir, ConfigFile), data, 0600)
}

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
        enroll(*server, *token)
    case "run":
        runAgent()
    case "version":
        fmt.Println("Configuratix Agent", Version)
    }
}

func enroll(serverURL, token string) {
    hostname, _ := os.Hostname()
    ip := getIP()
    osVer := getOS()
    
    body, _ := json.Marshal(map[string]string{
        "token": token, "hostname": hostname, "ip": ip, "os": osVer,
    })
    resp, err := http.Post(serverURL+"/api/agent/enroll", "application/json", bytes.NewReader(body))
    if err != nil { log.Fatal(err) }
    defer resp.Body.Close()
    if resp.StatusCode != 201 {
        b, _ := io.ReadAll(resp.Body)
        log.Fatal("Enrollment failed: ", string(b))
    }
    var result struct { AgentID string ` + "`json:\"agent_id\"`" + `; APIKey string ` + "`json:\"api_key\"`" + ` }
    json.NewDecoder(resp.Body).Decode(&result)
    
    cfg := &Config{ServerURL: serverURL, AgentID: result.AgentID, APIKey: result.APIKey}
    cfg.save()
    log.Println("Enrolled successfully!")
}

func runAgent() {
    cfg, err := loadConfig()
    if err != nil { log.Fatal("Run enroll first") }
    log.Println("Starting agent...")
    
    client := &http.Client{Timeout: 30 * time.Second}
    for {
        // Heartbeat
        body, _ := json.Marshal(map[string]string{"version": Version})
        req, _ := http.NewRequest("POST", cfg.ServerURL+"/api/agent/heartbeat", bytes.NewReader(body))
        req.Header.Set("Content-Type", "application/json")
        req.Header.Set("X-API-Key", cfg.APIKey)
        client.Do(req)
        
        // Get jobs
        req, _ = http.NewRequest("GET", cfg.ServerURL+"/api/agent/jobs", nil)
        req.Header.Set("X-API-Key", cfg.APIKey)
        resp, err := client.Do(req)
        if err == nil {
            var jobs []struct { ID string; Type string; Payload json.RawMessage }
            json.NewDecoder(resp.Body).Decode(&jobs)
            resp.Body.Close()
            for _, job := range jobs {
                processJob(cfg, client, job.ID, job.Type, job.Payload)
            }
        }
        time.Sleep(5 * time.Second)
    }
}

func processJob(cfg *Config, client *http.Client, id, jobType string, payload json.RawMessage) {
    log.Println("Processing:", jobType)
    updateJob(cfg, client, id, "running", "Starting...")
    
    var logs string
    var err error
    switch jobType {
    case "bootstrap_machine":
        logs, err = bootstrap()
    case "apply_domain":
        var p struct { Domain string; NginxConfig string ` + "`json:\"nginx_config\"`" + ` }
        json.Unmarshal(payload, &p)
        logs, err = applyDomain(p.Domain, p.NginxConfig)
    case "remove_domain":
        var p struct { Domain string }
        json.Unmarshal(payload, &p)
        logs, err = removeDomain(p.Domain)
    }
    
    if err != nil {
        updateJob(cfg, client, id, "failed", logs+"\n"+err.Error())
    } else {
        updateJob(cfg, client, id, "completed", logs)
    }
}

func updateJob(cfg *Config, client *http.Client, id, status, logs string) {
    body, _ := json.Marshal(map[string]string{"job_id": id, "status": status, "logs": logs})
    req, _ := http.NewRequest("POST", cfg.ServerURL+"/api/agent/jobs/update", bytes.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-API-Key", cfg.APIKey)
    client.Do(req)
}

func bootstrap() (string, error) {
    var logs strings.Builder
    logs.WriteString("Bootstrapping...\n")
    runCmd("apt-get", "update")
    runCmd("apt-get", "install", "-y", "nginx", "certbot", "python3-certbot-nginx")
    os.MkdirAll("/etc/nginx/conf.d/configuratix", 0755)
    runCmd("systemctl", "enable", "nginx")
    runCmd("systemctl", "start", "nginx")
    logs.WriteString("Done\n")
    return logs.String(), nil
}

func applyDomain(domain, config string) (string, error) {
    path := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain)
    os.WriteFile(path, []byte(config), 0644)
    if _, err := runCmd("nginx", "-t"); err != nil {
        os.Remove(path)
        return "", err
    }
    runCmd("systemctl", "reload", "nginx")
    return "Applied " + domain, nil
}

func removeDomain(domain string) (string, error) {
    os.Remove(fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain))
    runCmd("systemctl", "reload", "nginx")
    return "Removed " + domain, nil
}

func runCmd(name string, args ...string) (string, error) {
    cmd := exec.Command(name, args...)
    out, err := cmd.CombinedOutput()
    return string(out), err
}

func getIP() string {
    conn, _ := net.Dial("udp", "8.8.8.8:80")
    if conn != nil { defer conn.Close(); return conn.LocalAddr().(*net.UDPAddr).IP.String() }
    return ""
}

func getOS() string {
    out, _ := exec.Command("lsb_release", "-d", "-s").Output()
    return strings.TrimSpace(string(out))
}
MAINEOF

go build -o /opt/configuratix/bin/configuratix-agent ./cmd/agent
cd / && rm -rf /tmp/configuratix-agent-build

echo "Enrolling..."
/opt/configuratix/bin/configuratix-agent enroll --server "$SERVER_URL" --token "$TOKEN"

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

systemctl daemon-reload
systemctl enable configuratix-agent
systemctl start configuratix-agent

echo ""
echo "=== Installation Complete ==="
echo "Check status: systemctl status configuratix-agent"
`
}
