package handlers

import (
	"net/http"
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

	// Always use the embedded script (contains full 'run' job type support)
	scriptStr := getEmbeddedInstallScript()

	// Replace the default SERVER_URL with the actual server URL
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

SERVER_URL="${CONFIGURATIX_SERVER:-http://localhost:8080}"
REINSTALL=false
FORCE_NEW=false
CONFIG_FILE="/etc/configuratix/agent.json"

# Parse arguments
TOKEN=""
for arg in "$@"; do
    case $arg in
        --force)
            FORCE_NEW=true
            ;;
        *)
            if [ -z "$TOKEN" ]; then
                TOKEN="$arg"
            fi
            ;;
    esac
done

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

echo "==========================================="
echo "    Configuratix Agent Installer v2.0     "
echo "==========================================="
echo ""
echo "Server: $SERVER_URL"
if [ "$FORCE_NEW" = true ]; then
    echo "Mode: FORCE NEW ENROLLMENT"
fi
echo ""

# Check if agent already exists
if [ -f "$CONFIG_FILE" ] || [ -f "/opt/configuratix/bin/configuratix-agent" ] || systemctl is-active --quiet configuratix-agent 2>/dev/null; then
    echo "=== Existing agent detected ==="
    REINSTALL=true
    
    # Stop existing agent service
    if systemctl is-active --quiet configuratix-agent 2>/dev/null; then
        echo "Stopping existing agent service..."
        systemctl stop configuratix-agent 2>/dev/null || true
        sleep 2
    fi
    
    # Force kill any lingering agent processes
    if pgrep -f "configuratix-agent" > /dev/null 2>&1; then
        echo "Force killing agent processes..."
        pkill -9 -f "configuratix-agent" 2>/dev/null || true
        sleep 1
    fi
    
    # Remove old binary (will be rebuilt)
    if [ -f "/opt/configuratix/bin/configuratix-agent" ]; then
        echo "Removing old agent binary..."
        rm -f /opt/configuratix/bin/configuratix-agent
    fi
    
    echo "Old agent cleaned up. Proceeding with reinstallation..."
fi

# Install dependencies
echo "Installing dependencies..."
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx fail2ban ufw unzip curl

# Create directories
mkdir -p /etc/configuratix
mkdir -p /opt/configuratix/bin
mkdir -p /etc/nginx/conf.d/configuratix

# Add configuratix include to nginx.conf if not already present
if ! grep -q "conf.d/configuratix" /etc/nginx/nginx.conf; then
    echo "Adding configuratix include to nginx.conf..."
    sed -i '/include \/etc\/nginx\/conf.d\/\*.conf;/a\        include /etc/nginx/conf.d/configuratix/*.conf;' /etc/nginx/nginx.conf
fi

# Enable nginx (if not already)
systemctl enable nginx 2>/dev/null || true
systemctl start nginx 2>/dev/null || true

# Configure fail2ban with SSH protection (only if not configured)
if [ ! -f /etc/fail2ban/jail.local ]; then
    cat > /etc/fail2ban/jail.local << 'JAILEOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
JAILEOF
fi

systemctl enable fail2ban 2>/dev/null || true
systemctl restart fail2ban 2>/dev/null || true

# Configure UFW (only if not enabled)
if ! ufw status | grep -q "Status: active"; then
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    echo "y" | ufw enable
fi

# Download agent binary
echo "Downloading agent binary..."
AGENT_DOWNLOAD_URL="${SERVER_URL}/api/agent/download"
AGENT_PATH="/opt/configuratix/bin/configuratix-agent"

# Try to download pre-built binary
if curl -sSL -f -o "${AGENT_PATH}.tmp" "$AGENT_DOWNLOAD_URL"; then
    mv "${AGENT_PATH}.tmp" "$AGENT_PATH"
    chmod +x "$AGENT_PATH"
    echo "Agent binary downloaded successfully"
else
    echo "Failed to download pre-built binary, falling back to source build..."
    # Install Go for source build
    apt-get install -y golang-go
    
    cd /tmp
    rm -rf configuratix-agent-build
    mkdir configuratix-agent-build
    cd configuratix-agent-build

cat > go.mod << 'EOF'
module configuratix/agent
go 1.21

require (
	github.com/creack/pty v1.1.21
	github.com/gorilla/websocket v1.5.1
)

require golang.org/x/net v0.17.0 // indirect
EOF


mkdir -p cmd/agent

cat > cmd/agent/main.go << 'MAINEOF'
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const Version = "0.4.1"
const ConfigDir = "/etc/configuratix"
const ConfigFile = "agent.json"

type Config struct {
	ServerURL string ` + "`" + `json:"server_url"` + "`" + `
	AgentID   string ` + "`" + `json:"agent_id"` + "`" + `
	APIKey    string ` + "`" + `json:"api_key"` + "`" + `
}

type Stats struct {
	Version     string     ` + "`" + `json:"version"` + "`" + `
	CPUPercent  float64    ` + "`" + `json:"cpu_percent"` + "`" + `
	MemoryUsed  int64      ` + "`" + `json:"memory_used"` + "`" + `
	MemoryTotal int64      ` + "`" + `json:"memory_total"` + "`" + `
	DiskUsed    int64      ` + "`" + `json:"disk_used"` + "`" + `
	DiskTotal   int64      ` + "`" + `json:"disk_total"` + "`" + `
	SSHPort     int        ` + "`" + `json:"ssh_port"` + "`" + `
	UFWEnabled  bool       ` + "`" + `json:"ufw_enabled"` + "`" + `
	UFWRules    []UFWRule  ` + "`" + `json:"ufw_rules"` + "`" + `
	Fail2ban    bool       ` + "`" + `json:"fail2ban_enabled"` + "`" + `
}

type UFWRule struct {
	Port     string ` + "`" + `json:"port"` + "`" + `
	Protocol string ` + "`" + `json:"protocol"` + "`" + `
	Action   string ` + "`" + `json:"action"` + "`" + `
	From     string ` + "`" + `json:"from"` + "`" + `
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
	var result struct { AgentID string ` + "`" + `json:"agent_id"` + "`" + `; APIKey string ` + "`" + `json:"api_key"` + "`" + ` }
	json.NewDecoder(resp.Body).Decode(&result)
	
	cfg := &Config{ServerURL: serverURL, AgentID: result.AgentID, APIKey: result.APIKey}
	cfg.save()
	log.Println("Enrolled successfully!")
}

func getStats() Stats {
	stats := Stats{Version: Version}
	
	// CPU - simple load average based
	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		parts := strings.Fields(string(data))
		if len(parts) > 0 {
			if load, err := strconv.ParseFloat(parts[0], 64); err == nil {
				if cpus := getCPUCount(); cpus > 0 {
					stats.CPUPercent = (load / float64(cpus)) * 100
					if stats.CPUPercent > 100 { stats.CPUPercent = 100 }
				}
			}
		}
	}
	
	// Memory
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		lines := strings.Split(string(data), "\n")
		var total, available int64
		for _, line := range lines {
			if strings.HasPrefix(line, "MemTotal:") {
				fmt.Sscanf(line, "MemTotal: %d kB", &total)
				total *= 1024
			} else if strings.HasPrefix(line, "MemAvailable:") {
				fmt.Sscanf(line, "MemAvailable: %d kB", &available)
				available *= 1024
			}
		}
		stats.MemoryTotal = total
		stats.MemoryUsed = total - available
	}
	
	// Disk
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil {
		stats.DiskTotal = int64(stat.Blocks) * int64(stat.Bsize)
		stats.DiskUsed = stats.DiskTotal - int64(stat.Bfree)*int64(stat.Bsize)
	}
	
	// SSH Port
	stats.SSHPort = getSSHPort()
	
	// UFW status and rules
	if out, err := exec.Command("ufw", "status").Output(); err == nil {
		outStr := string(out)
		stats.UFWEnabled = strings.Contains(outStr, "Status: active")
		stats.UFWRules = parseUFWRules(outStr)
	}
	
	// Fail2ban status
	if out, err := exec.Command("systemctl", "is-active", "fail2ban").Output(); err == nil {
		stats.Fail2ban = strings.TrimSpace(string(out)) == "active"
	}
	
	return stats
}

func parseUFWRules(output string) []UFWRule {
	var rules []UFWRule
	lines := strings.Split(output, "\n")
	inRules := false
	
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" { continue }
		
		// Skip header lines until we find the dashed separator
		if strings.HasPrefix(line, "--") {
			inRules = true
			continue
		}
		if !inRules { continue }
		
		// Parse rule line: "80/tcp                     ALLOW       Anywhere"
		// or: "22/tcp (v6)                ALLOW       Anywhere (v6)"
		parts := strings.Fields(line)
		if len(parts) < 3 { continue }
		
		portProto := parts[0]
		action := parts[1]
		from := "Anywhere"
		if len(parts) >= 3 {
			from = strings.Join(parts[2:], " ")
		}
		
		// Skip IPv6 duplicates for cleaner display
		if strings.Contains(portProto, "(v6)") { continue }
		
		// Parse port/protocol
		portProto = strings.TrimSuffix(portProto, "(v6)")
		portProto = strings.TrimSpace(portProto)
		
		port := portProto
		protocol := "tcp"
		if strings.Contains(portProto, "/") {
			pp := strings.Split(portProto, "/")
			port = pp[0]
			if len(pp) > 1 { protocol = pp[1] }
		}
		
		rules = append(rules, UFWRule{
			Port:     port,
			Protocol: protocol,
			Action:   action,
			From:     from,
		})
	}
	return rules
}

func getCPUCount() int {
	if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		return strings.Count(string(data), "processor")
	}
	return 1
}

func getSSHPort() int {
	paths := []string{"/etc/ssh/sshd_config"}
	for _, path := range paths {
		if data, err := os.ReadFile(path); err == nil {
			re := regexp.MustCompile(` + "`" + `(?m)^Port\s+(\d+)` + "`" + `)
			if matches := re.FindStringSubmatch(string(data)); len(matches) > 1 {
				if port, err := strconv.Atoi(matches[1]); err == nil {
					return port
				}
			}
		}
	}
	return 22
}

func runAgent() {
	cfg, err := loadConfig()
	if err != nil { log.Fatal("Run enroll first") }
	log.Println("Starting agent v" + Version)
	
	// Start terminal WebSocket in background
	go runTerminalWebSocket(cfg)
	
	client := &http.Client{Timeout: 30 * time.Second}
	for {
		stats := getStats()
		body, _ := json.Marshal(stats)
		req, _ := http.NewRequest("POST", cfg.ServerURL+"/api/agent/heartbeat", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-Key", cfg.APIKey)
		client.Do(req)
		
		req, _ = http.NewRequest("GET", cfg.ServerURL+"/api/agent/jobs", nil)
		req.Header.Set("X-API-Key", cfg.APIKey)
		resp, err := client.Do(req)
		if err == nil {
			var jobs []struct { 
				ID string ` + "`" + `json:"id"` + "`" + `
				Type string ` + "`" + `json:"type"` + "`" + `
				Payload json.RawMessage ` + "`" + `json:"payload"` + "`" + `
			}
			json.NewDecoder(resp.Body).Decode(&jobs)
			resp.Body.Close()
			for _, job := range jobs {
				processJob(cfg, client, job.ID, job.Type, job.Payload)
			}
		}
		time.Sleep(5 * time.Second)
	}
}

// Terminal WebSocket client
type TerminalMessage struct {
	Type string ` + "`" + `json:"type"` + "`" + `
	Data string ` + "`" + `json:"data,omitempty"` + "`" + `
	Cols int    ` + "`" + `json:"cols,omitempty"` + "`" + `
	Rows int    ` + "`" + `json:"rows,omitempty"` + "`" + `
}

func runTerminalWebSocket(cfg *Config) {
	for {
		err := connectTerminal(cfg)
		if err != nil {
			log.Printf("Terminal: %v, reconnecting in 5s...", err)
		}
		time.Sleep(5 * time.Second)
	}
}

func connectTerminal(cfg *Config) error {
	// Convert HTTP URL to WebSocket URL
	wsURL := cfg.ServerURL
	if strings.HasPrefix(wsURL, "https://") {
		wsURL = "wss://" + strings.TrimPrefix(wsURL, "https://")
	} else {
		wsURL = "ws://" + strings.TrimPrefix(wsURL, "http://")
	}
	wsURL += "/api/agent/terminal"
	
	// Add API key as query parameter
	u, err := url.Parse(wsURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %v", err)
	}
	q := u.Query()
	q.Set("key", cfg.APIKey)
	u.RawQuery = q.Encode()
	
	log.Printf("Terminal: connecting to %s", u.Host)
	
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	
	conn, _, err := dialer.Dial(u.String(), nil)
	if err != nil {
		return fmt.Errorf("connection failed: %v", err)
	}
	defer conn.Close()
	
	log.Println("Terminal: connected")
	
	// Start PTY shell
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	
	cmd := exec.Command(shell, "-l")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	
	ptmx, err := pty.Start(cmd)
	if err != nil {
		conn.WriteJSON(TerminalMessage{Type: "output", Data: fmt.Sprintf("Failed to start shell: %v\r\n", err)})
		return fmt.Errorf("failed to start PTY: %v", err)
	}
	
	// Cleanup on exit
	defer func() {
		ptmx.Close()
		cmd.Process.Kill()
		cmd.Wait()
	}()
	
	done := make(chan struct{})
	var once sync.Once
	closeDone := func() { once.Do(func() { close(done) }) }
	
	// Ping keepalive goroutine
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err := conn.WriteJSON(TerminalMessage{Type: "ping"}); err != nil {
					closeDone()
					return
				}
			}
		}
	}()
	
	// Read from PTY, send to WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				closeDone()
				return
			}
			
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteJSON(TerminalMessage{Type: "output", Data: string(buf[:n])}); err != nil {
				closeDone()
				return
			}
		}
	}()
	
	// Read from WebSocket, write to PTY
	go func() {
		for {
			var msg TerminalMessage
			// No read deadline - rely on ping/pong for keepalive
			if err := conn.ReadJSON(&msg); err != nil {
				closeDone()
				return
			}
			
			switch msg.Type {
			case "input":
				ptmx.Write([]byte(msg.Data))
			case "resize":
				if msg.Cols > 0 && msg.Rows > 0 {
					pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(msg.Cols), Rows: uint16(msg.Rows)})
				}
			case "ping":
				conn.WriteJSON(TerminalMessage{Type: "pong"})
			case "pong":
				// Keepalive response, ignore
			}
		}
	}()
	
	// Wait for done signal
	<-done
	conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	return nil
}

func processJob(cfg *Config, client *http.Client, id, jobType string, payload json.RawMessage) {
	log.Println("Processing:", jobType)
	updateJob(cfg, client, id, "running", "Starting...")
	
	var logs string
	var err error
	
	// Generic instruction-based jobs (no agent update needed for new features)
	switch jobType {
	case "script":
		// Execute bash script with variable substitution
		var p struct { 
			Script string ` + "`" + `json:"script"` + "`" + `
			Vars map[string]string ` + "`" + `json:"vars"` + "`" + `
		}
		json.Unmarshal(payload, &p)
		logs, err = execScript(p.Script, p.Vars)
	case "exec":
		// Execute simple command(s)
		var p struct { 
			Commands []string ` + "`" + `json:"commands"` + "`" + `
			Command string ` + "`" + `json:"command"` + "`" + ` // single command alternative
		}
		json.Unmarshal(payload, &p)
		if p.Command != "" {
			p.Commands = []string{p.Command}
		}
		logs, err = execCommands(p.Commands)
	case "file":
		// File operations
		var p struct {
			Action string ` + "`" + `json:"action"` + "`" + ` // write, append, delete
			Path string ` + "`" + `json:"path"` + "`" + `
			Content string ` + "`" + `json:"content"` + "`" + `
			Mode string ` + "`" + `json:"mode"` + "`" + ` // optional: "0644"
		}
		json.Unmarshal(payload, &p)
		logs, err = fileOp(p.Action, p.Path, p.Content, p.Mode)
	case "service":
		// Systemd service management
		var p struct {
			Name string ` + "`" + `json:"name"` + "`" + `
			Action string ` + "`" + `json:"action"` + "`" + ` // start, stop, restart, reload, enable, disable
		}
		json.Unmarshal(payload, &p)
		logs, err = serviceOp(p.Name, p.Action)
	
	case "run":
		// Unified multi-step job with rollback support - THE ONLY job type needed
		var p RunPayload
		json.Unmarshal(payload, &p)
		logs, err = executeRun(p)
	
	case "deploy_landing":
		// Special case: needs HTTP download from server (can't be done via exec)
		var p struct { 
			LandingID string ` + "`" + `json:"landing_id"` + "`" + `
			TargetPath string ` + "`" + `json:"target_path"` + "`" + `
			IndexFile string ` + "`" + `json:"index_file"` + "`" + `
			UsePHP bool ` + "`" + `json:"use_php"` + "`" + `
			ReplaceContent *bool ` + "`" + `json:"replace_content"` + "`" + `
		}
		json.Unmarshal(payload, &p)
		// Default replace_content to true if not specified
		replaceContent := p.ReplaceContent == nil || *p.ReplaceContent
		logs, err = deployLanding(cfg, client, p.LandingID, p.TargetPath, p.IndexFile, replaceContent)
	
	default:
		logs = "Unknown job type: " + jobType + ". Agent only supports 'run' and 'deploy_landing' types."
		err = fmt.Errorf("unknown job type: %s", jobType)
	}
	
	if err != nil {
		updateJob(cfg, client, id, "failed", logs+"\nError: "+err.Error())
	} else {
		updateJob(cfg, client, id, "completed", logs)
	}
}

// Step represents a single operation in a run job
type Step struct {
	Action  string ` + "`" + `json:"action"` + "`" + `  // exec, file, service, fetch
	
	// For exec
	Command string ` + "`" + `json:"command"` + "`" + `
	Timeout int    ` + "`" + `json:"timeout"` + "`" + ` // seconds, default 300
	
	// For file
	Path    string ` + "`" + `json:"path"` + "`" + `
	Content string ` + "`" + `json:"content"` + "`" + `
	URL     string ` + "`" + `json:"url"` + "`" + `     // fetch content from URL instead of inline
	Mode    string ` + "`" + `json:"mode"` + "`" + `    // file permissions
	Op      string ` + "`" + `json:"op"` + "`" + `      // write, append, delete, backup
	
	// For service
	Name    string ` + "`" + `json:"name"` + "`" + `
	
	// For logging
	Log     string ` + "`" + `json:"log"` + "`" + `     // "out" = log command output (default), or custom command to execute and log
}

// RunPayload is the unified job type for complex operations
type RunPayload struct {
	Steps    []Step ` + "`" + `json:"steps"` + "`" + `
	OnError  string ` + "`" + `json:"on_error"` + "`" + `  // stop (default), continue, rollback
	Vars     map[string]string ` + "`" + `json:"vars"` + "`" + ` // variable substitution
}

// executeRun processes a run job with multiple steps
func executeRun(payload RunPayload) (string, error) {
	var logs strings.Builder
	var backups []string // for rollback
	
	onError := payload.OnError
	if onError == "" { onError = "stop" }
	
	for i, step := range payload.Steps {
		logs.WriteString(fmt.Sprintf("\n=== Step %d: %s ===\n", i+1, step.Action))
		
		// Variable substitution
		step = substituteVars(step, payload.Vars)
		
		var stepLog string
		var err error
		
		switch step.Action {
		case "exec":
			stepLog, err = execWithTimeout(step.Command, step.Timeout)
		case "file":
			stepLog, err, backups = fileOpSafe(step, backups)
		case "service":
			stepLog, err = serviceOp(step.Name, step.Op)
		case "fetch":
			stepLog, err = fetchToFile(step.URL, step.Path, step.Mode)
		default:
			err = fmt.Errorf("unknown action: %s", step.Action)
		}
		
		logs.WriteString(stepLog)
		
		// Handle custom logging: if Log is set and not "out", execute the log command
		if step.Log != "" && step.Log != "out" {
			logs.WriteString("\n--- Log output ---\n")
			logOutput, logErr := execWithTimeout(step.Log, 30)
			logs.WriteString(logOutput)
			if logErr != nil {
				logs.WriteString(fmt.Sprintf("(log command failed: %v)\n", logErr))
			}
		}
		
		if err != nil {
			logs.WriteString(fmt.Sprintf("ERROR: %v\n", err))
			
			if onError == "rollback" {
				logs.WriteString("\n=== Rolling back ===\n")
				rollbackLog := rollback(backups)
				logs.WriteString(rollbackLog)
			}
			
			if onError != "continue" {
				return logs.String(), err
			}
		}
	}
	
	logs.WriteString("\n=== All steps completed ===\n")
	return logs.String(), nil
}

// substituteVars replaces {{var}} with values in all string fields
func substituteVars(step Step, vars map[string]string) Step {
	for k, v := range vars {
		placeholder := "{{" + k + "}}"
		step.Command = strings.ReplaceAll(step.Command, placeholder, v)
		step.Path = strings.ReplaceAll(step.Path, placeholder, v)
		step.Content = strings.ReplaceAll(step.Content, placeholder, v)
		step.URL = strings.ReplaceAll(step.URL, placeholder, v)
		step.Name = strings.ReplaceAll(step.Name, placeholder, v)
		step.Log = strings.ReplaceAll(step.Log, placeholder, v)
	}
	return step
}

// execWithTimeout runs a command with timeout
func execWithTimeout(cmdStr string, timeoutSec int) (string, error) {
	var logs strings.Builder
	logs.WriteString("$ " + cmdStr + "\n")
	
	if timeoutSec <= 0 { timeoutSec = 300 } // 5 min default
	
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, "/bin/bash", "-c", cmdStr)
	out, err := cmd.CombinedOutput()
	logs.WriteString(string(out))
	
	if ctx.Err() == context.DeadlineExceeded {
		return logs.String(), fmt.Errorf("command timed out after %ds", timeoutSec)
	}
	
	return logs.String(), err
}

// fileOpSafe performs file operations with backup support
func fileOpSafe(step Step, backups []string) (string, error, []string) {
	var logs strings.Builder
	path := step.Path
	op := step.Op
	if op == "" { op = "write" }
	
	// Fetch content from URL if specified
	content := step.Content
	if step.URL != "" {
		logs.WriteString(fmt.Sprintf("Fetching content from %s...\n", step.URL))
		resp, err := http.Get(step.URL)
		if err != nil { return logs.String(), err, backups }
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		if err != nil { return logs.String(), err, backups }
		content = string(data)
		logs.WriteString(fmt.Sprintf("Fetched %d bytes\n", len(data)))
	}
	
	switch op {
	case "write":
		// Backup existing file for rollback
		if _, err := os.Stat(path); err == nil {
			backupPath := path + ".configuratix-backup"
			if data, err := os.ReadFile(path); err == nil {
				os.WriteFile(backupPath, data, 0644)
				backups = append(backups, backupPath+":"+path)
				logs.WriteString(fmt.Sprintf("Backed up to %s\n", backupPath))
			}
		}
		
		logs.WriteString(fmt.Sprintf("Writing to %s (%d bytes)...\n", path, len(content)))
		os.MkdirAll(filepath.Dir(path), 0755)
		perm := os.FileMode(0644)
		if step.Mode != "" {
			if m, err := strconv.ParseUint(step.Mode, 8, 32); err == nil {
				perm = os.FileMode(m)
			}
		}
		if err := os.WriteFile(path, []byte(content), perm); err != nil {
			return logs.String(), err, backups
		}
		logs.WriteString("Done\n")
		
	case "append":
		logs.WriteString(fmt.Sprintf("Appending to %s...\n", path))
		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil { return logs.String(), err, backups }
		defer f.Close()
		f.WriteString(content)
		logs.WriteString("Done\n")
		
	case "delete":
		// Backup before delete
		if data, err := os.ReadFile(path); err == nil {
			backupPath := path + ".configuratix-backup"
			os.WriteFile(backupPath, data, 0644)
			backups = append(backups, backupPath+":"+path)
		}
		logs.WriteString(fmt.Sprintf("Deleting %s...\n", path))
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return logs.String(), err, backups
		}
		logs.WriteString("Done\n")
		
	case "backup":
		backupPath := path + ".configuratix-backup"
		logs.WriteString(fmt.Sprintf("Backing up %s to %s...\n", path, backupPath))
		if data, err := os.ReadFile(path); err == nil {
			os.WriteFile(backupPath, data, 0644)
			logs.WriteString("Done\n")
		} else {
			logs.WriteString("File not found, skipped\n")
		}
		
	default:
		return logs.String(), fmt.Errorf("unknown file op: %s", op), backups
	}
	
	return logs.String(), nil, backups
}

// fetchToFile downloads a URL to a file
func fetchToFile(url, path, mode string) (string, error) {
	var logs strings.Builder
	logs.WriteString(fmt.Sprintf("Fetching %s -> %s\n", url, path))
	
	resp, err := http.Get(url)
	if err != nil { return logs.String(), err }
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 {
		return logs.String(), fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	
	os.MkdirAll(filepath.Dir(path), 0755)
	perm := os.FileMode(0644)
	if mode != "" {
		if m, err := strconv.ParseUint(mode, 8, 32); err == nil {
			perm = os.FileMode(m)
		}
	}
	
	data, err := io.ReadAll(resp.Body)
	if err != nil { return logs.String(), err }
	
	if err := os.WriteFile(path, data, perm); err != nil {
		return logs.String(), err
	}
	
	logs.WriteString(fmt.Sprintf("Downloaded %d bytes\n", len(data)))
	return logs.String(), nil
}

// rollback restores backed up files
func rollback(backups []string) string {
	var logs strings.Builder
	for _, b := range backups {
		parts := strings.SplitN(b, ":", 2)
		if len(parts) != 2 { continue }
		backupPath, originalPath := parts[0], parts[1]
		
		if data, err := os.ReadFile(backupPath); err == nil {
			os.WriteFile(originalPath, data, 0644)
			os.Remove(backupPath)
			logs.WriteString(fmt.Sprintf("Restored %s\n", originalPath))
		}
	}
	return logs.String()
}

// serviceOp manages systemd services
func serviceOp(name, action string) (string, error) {
	var logs strings.Builder
	if action == "" { action = "restart" }
	logs.WriteString(fmt.Sprintf("Service %s: %s...\n", name, action))
	
	validActions := map[string]bool{"start": true, "stop": true, "restart": true, "reload": true, "enable": true, "disable": true, "status": true}
	if !validActions[action] {
		return logs.String(), fmt.Errorf("invalid service action: %s", action)
	}
	
	out, err := runCmd("systemctl", action, name)
	logs.WriteString(out)
	
	return logs.String(), err
}

// Legacy compatibility functions
func execScript(script string, vars map[string]string) (string, error) {
	return executeRun(RunPayload{
		Steps: []Step{{Action: "exec", Command: script}},
		Vars:  vars,
	})
}

func execCommands(commands []string) (string, error) {
	var logs strings.Builder
	for _, cmd := range commands {
		out, err := execWithTimeout(cmd, 300)
		logs.WriteString(out)
		if err != nil { return logs.String(), err }
	}
	return logs.String(), nil
}

func fileOp(action, path, content, mode string) (string, error) {
	out, err, _ := fileOpSafe(Step{Action: "file", Op: action, Path: path, Content: content, Mode: mode}, nil)
	return out, err
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
	logs.WriteString("Bootstrapping machine...\n")
	runCmd("apt-get", "update")
	out, _ := runCmd("apt-get", "install", "-y", "nginx", "certbot", "python3-certbot-nginx", "fail2ban", "ufw", "unzip")
	logs.WriteString(out)
	os.MkdirAll("/etc/nginx/conf.d/configuratix", 0755)
	
	// Add configuratix include to nginx.conf if not already present
	nginxConf, _ := os.ReadFile("/etc/nginx/nginx.conf")
	if !strings.Contains(string(nginxConf), "conf.d/configuratix") {
		logs.WriteString("Adding configuratix include to nginx.conf...\n")
		runCmd("sed", "-i", "/include \\/etc\\/nginx\\/conf.d\\/\\*.conf;/a\\        include /etc/nginx/conf.d/configuratix/*.conf;", "/etc/nginx/nginx.conf")
	}
	
	runCmd("systemctl", "enable", "nginx")
	runCmd("systemctl", "start", "nginx")
	runCmd("systemctl", "enable", "fail2ban")
	runCmd("systemctl", "start", "fail2ban")
	logs.WriteString("Bootstrap complete\n")
	return logs.String(), nil
}

func changeSSHPort(port int) (string, error) {
	var logs strings.Builder
	logs.WriteString(fmt.Sprintf("Changing SSH port to %d...\n", port))
	oldPort := getSSHPort()
	configPath := "/etc/ssh/sshd_config"
	data, err := os.ReadFile(configPath)
	if err != nil { return logs.String(), err }
	content := string(data)
	re := regexp.MustCompile(` + "`" + `(?m)^#?Port\s+\d+` + "`" + `)
	if re.MatchString(content) {
		content = re.ReplaceAllString(content, fmt.Sprintf("Port %d", port))
	} else {
		content = fmt.Sprintf("Port %d\n", port) + content
	}
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil { return logs.String(), err }
	logs.WriteString("Updated sshd_config\n")
	runCmd("ufw", "allow", fmt.Sprintf("%d/tcp", port))
	if oldPort != port && oldPort != 22 {
		runCmd("ufw", "delete", "allow", fmt.Sprintf("%d/tcp", oldPort))
	}
	logs.WriteString("Updated UFW rules\n")
	// Daemon reload required for Ubuntu 22.04+
	runCmd("systemctl", "daemon-reload")
	logs.WriteString("Reloaded systemd daemon\n")
	out, err := runCmd("systemctl", "restart", "sshd")
	if err != nil { out, err = runCmd("systemctl", "restart", "ssh") }
	logs.WriteString(out)
	if err != nil { return logs.String(), fmt.Errorf("failed to restart SSH") }
	logs.WriteString(fmt.Sprintf("SSH port changed to %d\n", port))
	return logs.String(), nil
}

func changeRootPassword(password string) (string, error) {
	var logs strings.Builder
	logs.WriteString("Changing root password...\n")
	cmd := exec.Command("chpasswd")
	cmd.Stdin = strings.NewReader(fmt.Sprintf("root:%s", password))
	out, err := cmd.CombinedOutput()
	logs.WriteString(string(out))
	if err != nil { return logs.String(), err }
	logs.WriteString("Root password changed successfully\n")
	return logs.String(), nil
}

func toggleUFW(enabled bool) (string, error) {
	var logs strings.Builder
	if enabled {
		logs.WriteString("Enabling UFW...\n")
		cmd := exec.Command("ufw", "--force", "enable")
		out, err := cmd.CombinedOutput()
		logs.WriteString(string(out))
		if err != nil { return logs.String(), err }
	} else {
		logs.WriteString("Disabling UFW...\n")
		out, err := runCmd("ufw", "disable")
		logs.WriteString(out)
		if err != nil { return logs.String(), err }
	}
	return logs.String(), nil
}

func toggleFail2ban(enabled bool, config string) (string, error) {
	var logs strings.Builder
	if config != "" {
		logs.WriteString("Writing fail2ban config...\n")
		if err := os.WriteFile("/etc/fail2ban/jail.local", []byte(config), 0644); err != nil {
			return logs.String(), err
		}
	}
	if enabled {
		logs.WriteString("Enabling fail2ban...\n")
		runCmd("systemctl", "enable", "fail2ban")
		out, err := runCmd("systemctl", "restart", "fail2ban")
		logs.WriteString(out)
		if err != nil { return logs.String(), err }
	} else {
		logs.WriteString("Disabling fail2ban...\n")
		out, err := runCmd("systemctl", "stop", "fail2ban")
		logs.WriteString(out)
		runCmd("systemctl", "disable", "fail2ban")
		if err != nil { return logs.String(), err }
	}
	return logs.String(), nil
}

func ufwRule(port, protocol, action string) (string, error) {
	var logs strings.Builder
	if action == "delete" {
		logs.WriteString(fmt.Sprintf("Removing UFW rule for port %s/%s...\n", port, protocol))
		out, err := runCmd("ufw", "delete", "allow", fmt.Sprintf("%s/%s", port, protocol))
		logs.WriteString(out)
		return logs.String(), err
	}
	logs.WriteString(fmt.Sprintf("Adding UFW rule for port %s/%s...\n", port, protocol))
	if protocol == "both" {
		out, _ := runCmd("ufw", "allow", fmt.Sprintf("%s/tcp", port))
		logs.WriteString(out)
		out, err := runCmd("ufw", "allow", fmt.Sprintf("%s/udp", port))
		logs.WriteString(out)
		return logs.String(), err
	}
	out, err := runCmd("ufw", "allow", fmt.Sprintf("%s/%s", port, protocol))
	logs.WriteString(out)
	return logs.String(), err
}

func deployLanding(cfg *Config, client *http.Client, landingID, targetPath, indexFile string, replaceContent bool) (string, error) {
	var logs strings.Builder
	logs.WriteString(fmt.Sprintf("Deploying landing %s to %s...\n", landingID, targetPath))
	
	// Check if content already exists and replaceContent is false
	if !replaceContent {
		// Check if the target directory exists and has content
		entries, err := os.ReadDir(targetPath)
		if err == nil && len(entries) > 0 {
			logs.WriteString("Content already exists and replace_content=false, skipping extraction.\n")
			logs.WriteString(fmt.Sprintf("Existing files: %d\n", len(entries)))
			return logs.String(), nil
		}
		logs.WriteString("Directory empty or doesn't exist, will deploy content.\n")
	}
	
	// Create target directory
	logs.WriteString("Creating target directory...\n")
	out, err := runCmd("mkdir", "-p", targetPath)
	logs.WriteString(out)
	if err != nil {
		return logs.String(), fmt.Errorf("failed to create target directory: %v", err)
	}
	
	// Clear existing content (only if replaceContent is true)
	if replaceContent {
		logs.WriteString("Clearing existing content...\n")
		runCmd("rm", "-rf", targetPath+"/*")
	}
	
	// Download static content from server
	downloadURL := cfg.ServerURL + "/api/agent/static/" + landingID + "/download"
	logs.WriteString(fmt.Sprintf("Downloading from %s...\n", downloadURL))
	
	req, _ := http.NewRequest("GET", downloadURL, nil)
	req.Header.Set("X-API-Key", cfg.APIKey)
	
	resp, err := client.Do(req)
	if err != nil {
		return logs.String(), fmt.Errorf("failed to download landing: %v", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return logs.String(), fmt.Errorf("download failed (%d): %s", resp.StatusCode, string(body))
	}
	
	// Save to temp file
	tmpFile := "/tmp/landing_" + landingID + ".zip"
	f, err := os.Create(tmpFile)
	if err != nil {
		return logs.String(), fmt.Errorf("failed to create temp file: %v", err)
	}
	n, err := io.Copy(f, resp.Body)
	f.Close()
	if err != nil {
		return logs.String(), fmt.Errorf("failed to save download: %v", err)
	}
	logs.WriteString(fmt.Sprintf("Downloaded %d bytes\n", n))
	
	// Extract
	logs.WriteString("Extracting archive...\n")
	out, err = runCmd("unzip", "-o", tmpFile, "-d", targetPath)
	logs.WriteString(out)
	if err != nil {
		return logs.String(), fmt.Errorf("failed to extract: %v", err)
	}
	
	// Cleanup temp file
	os.Remove(tmpFile)
	
	// Set ownership
	logs.WriteString("Setting permissions...\n")
	out, _ = runCmd("chown", "-R", "www-data:www-data", targetPath)
	logs.WriteString(out)
	
	logs.WriteString(fmt.Sprintf("Landing deployed successfully to %s\n", targetPath))
	return logs.String(), nil
}

func applyDomain(domain, config string) (string, error) {
	var logs strings.Builder
	logs.WriteString(fmt.Sprintf("Applying config for %s...\n", domain))
	
	path := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain)
	certPath := fmt.Sprintf("/etc/letsencrypt/live/%s/fullchain.pem", domain)
	
	// Check if config references SSL
	hasSSL := strings.Contains(config, "listen 443 ssl")
	needsCert := hasSSL && !fileExists(certPath)
	
	if needsCert {
		logs.WriteString("SSL enabled but certificate not found. Issuing certificate first...\n")
		
		// Create HTTP-only config first for ACME challenge
		httpConfig := fmt.Sprintf(` + "`" + `server {
    listen 80;
    server_name %s;
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    location / {
        return 301 https://$host$request_uri;
    }
}
` + "`" + `, domain)
		
		if err := os.WriteFile(path, []byte(httpConfig), 0644); err != nil { 
			return logs.String(), err 
		}
		
		// Reload nginx for ACME challenge
		out, err := runCmd("nginx", "-t")
		logs.WriteString(out)
		if err != nil { 
			os.Remove(path)
			return logs.String(), fmt.Errorf("nginx config test failed") 
		}
		out, _ = runCmd("systemctl", "reload", "nginx")
		logs.WriteString(out)
		
		// Issue certificate with certbot
		// Flags explanation:
		// --non-interactive: Never ask for user input
		// --agree-tos: Agree to ACME server's Terms of Service
		// --no-eff-email: Don't share email with EFF
		// --email: Required email (use noreply placeholder)
		// --keep-until-expiring: Don't renew if cert exists and not expiring
		// --cert-name: Use domain as certificate name
		logs.WriteString("Running certbot...\n")
		
		// Try standalone method first (most reliable, stops nginx briefly)
		out, err = runCmd("systemctl", "stop", "nginx")
		logs.WriteString(out)
		
		out, err = runCmd("certbot", "certonly", 
			"--standalone",
			"-d", domain,
			"--non-interactive",
			"--agree-tos",
			"--no-eff-email",
			"--email", "noreply@configuratix.local",
			"--keep-until-expiring",
			"--cert-name", domain,
		)
		logs.WriteString(out)
		
		// Restart nginx regardless
		runCmd("systemctl", "start", "nginx")
		
		if err != nil {
			// Try webroot method as fallback (nginx stays running)
			logs.WriteString("Standalone method failed, trying webroot method...\n")
			runCmd("mkdir", "-p", "/var/www/html/.well-known/acme-challenge")
			out, err = runCmd("certbot", "certonly",
				"--webroot",
				"-w", "/var/www/html",
				"-d", domain,
				"--non-interactive",
				"--agree-tos",
				"--no-eff-email",
				"--email", "noreply@configuratix.local",
				"--keep-until-expiring",
				"--cert-name", domain,
			)
			logs.WriteString(out)
			if err != nil {
				logs.WriteString("Certificate issuance failed. Keeping HTTP-only config.\n")
				return logs.String(), fmt.Errorf("certbot failed: %v", err)
			}
		}
		logs.WriteString("Certificate issued successfully!\n")
	}
	
	// Now write the full config (with SSL if certs exist)
	if err := os.WriteFile(path, []byte(config), 0644); err != nil { 
		return logs.String(), err 
	}
	
	out, err := runCmd("nginx", "-t")
	logs.WriteString(out)
	if err != nil { 
		os.Remove(path)
		return logs.String(), fmt.Errorf("nginx config test failed") 
	}
	
	out, err = runCmd("systemctl", "reload", "nginx")
	logs.WriteString(out)
	logs.WriteString(fmt.Sprintf("Config applied for %s\n", domain))
	return logs.String(), err
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func removeDomain(domain string) (string, error) {
	var logs strings.Builder
	logs.WriteString(fmt.Sprintf("Removing config for %s...\n", domain))
	path := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain)
	os.Remove(path)
	out, _ := runCmd("systemctl", "reload", "nginx")
	logs.WriteString(out)
	logs.WriteString(fmt.Sprintf("Config removed for %s\n", domain))
	return logs.String(), nil
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

# Download dependencies and build (fallback only)
echo "Downloading Go dependencies..."
go mod tidy

go build -o /opt/configuratix/bin/configuratix-agent ./cmd/agent
cd / && rm -rf /tmp/configuratix-agent-build
echo "Agent built from source successfully"
fi

# Handle enrollment
if [ "$REINSTALL" = false ] || [ "$FORCE_NEW" = true ]; then
    if [ -z "$TOKEN" ]; then
        echo "Error: Enrollment token is required"
        echo "Usage: curl -sSL $SERVER_URL/install.sh | sudo bash -s -- YOUR_TOKEN"
        echo "       curl -sSL $SERVER_URL/install.sh | sudo bash -s -- YOUR_TOKEN --force"
        exit 1
    fi
    
    if [ "$FORCE_NEW" = true ]; then
        echo "Force mode: Removing old configuration..."
        rm -f "$CONFIG_FILE"
    fi
    
    echo "Enrolling agent with server..."
    /opt/configuratix/bin/configuratix-agent enroll --server "$SERVER_URL" --token "$TOKEN"
else
    echo "Re-using existing agent configuration..."
    echo "  (Use --force flag with a new token to re-enroll)"
fi

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

# Wait a moment and check if agent is running
sleep 2
if systemctl is-active --quiet configuratix-agent; then
    echo ""
    echo "==========================================="
    if [ "$REINSTALL" = true ]; then
        echo "=== Agent Reinstalled Successfully ==="
    else
        echo "=== Installation Complete ==="
    fi
    echo "==========================================="
    echo ""
    echo "Agent status: RUNNING"
    echo "Agent version: $(cat /opt/configuratix/bin/configuratix-agent 2>/dev/null | head -c 100 || echo 'latest')"
    echo ""
    echo "Services configured:"
    echo "  - Nginx: $(systemctl is-active nginx)"
    echo "  - Fail2ban: $(systemctl is-active fail2ban)"
    echo "  - UFW: $(ufw status | head -1)"
    echo ""
    echo "Check status: systemctl status configuratix-agent"
    echo "View logs: journalctl -u configuratix-agent -f"
else
    echo ""
    echo "WARNING: Agent may not have started correctly"
    echo "Check logs: journalctl -u configuratix-agent -n 50"
fi
`
}
