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

TOKEN="$1"
SERVER_URL="${CONFIGURATIX_SERVER:-http://localhost:8080}"
REINSTALL=false
CONFIG_FILE="/etc/configuratix/agent.json"

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

echo "=== Configuratix Agent Installer ==="
echo "Server: $SERVER_URL"
echo ""

# Check if agent already exists
if [ -f "$CONFIG_FILE" ]; then
    echo "Existing agent configuration found."
    REINSTALL=true
    
    # Stop existing agent
    if systemctl is-active --quiet configuratix-agent; then
        echo "Stopping existing agent..."
        systemctl stop configuratix-agent
    fi
fi

# If no config exists, token is required
if [ "$REINSTALL" = false ] && [ -z "$TOKEN" ]; then
    echo "Error: Enrollment token is required for new installation"
    echo "Usage: curl -sSL $SERVER_URL/install.sh | sudo bash -s -- YOUR_TOKEN"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
apt-get update
apt-get install -y golang-go nginx certbot python3-certbot-nginx fail2ban ufw

# Create directories
mkdir -p /etc/configuratix
mkdir -p /opt/configuratix/bin
mkdir -p /etc/nginx/conf.d/configuratix

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

# Build agent
echo "Building agent..."
cd /tmp
rm -rf configuratix-agent-build
mkdir configuratix-agent-build
cd configuratix-agent-build

cat > go.mod << 'EOF'
module configuratix/agent
go 1.21
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
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const Version = "0.2.0"
const ConfigDir = "/etc/configuratix"
const ConfigFile = "agent.json"

type Config struct {
	ServerURL string ` + "`" + `json:"server_url"` + "`" + `
	AgentID   string ` + "`" + `json:"agent_id"` + "`" + `
	APIKey    string ` + "`" + `json:"api_key"` + "`" + `
}

type Stats struct {
	Version     string  ` + "`" + `json:"version"` + "`" + `
	CPUPercent  float64 ` + "`" + `json:"cpu_percent"` + "`" + `
	MemoryUsed  int64   ` + "`" + `json:"memory_used"` + "`" + `
	MemoryTotal int64   ` + "`" + `json:"memory_total"` + "`" + `
	DiskUsed    int64   ` + "`" + `json:"disk_used"` + "`" + `
	DiskTotal   int64   ` + "`" + `json:"disk_total"` + "`" + `
	SSHPort     int     ` + "`" + `json:"ssh_port"` + "`" + `
	UFWEnabled  bool    ` + "`" + `json:"ufw_enabled"` + "`" + `
	Fail2ban    bool    ` + "`" + `json:"fail2ban_enabled"` + "`" + `
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
	
	// UFW status
	if out, err := exec.Command("ufw", "status").Output(); err == nil {
		stats.UFWEnabled = strings.Contains(string(out), "Status: active")
	}
	
	// Fail2ban status
	if out, err := exec.Command("systemctl", "is-active", "fail2ban").Output(); err == nil {
		stats.Fail2ban = strings.TrimSpace(string(out)) == "active"
	}
	
	return stats
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
		// Unified multi-step job with rollback support
		var p RunPayload
		json.Unmarshal(payload, &p)
		logs, err = executeRun(p)
	
	// Legacy typed jobs (kept for backwards compatibility)
	case "bootstrap_machine":
		logs, err = bootstrap()
	case "apply_domain":
		var p struct { Domain string ` + "`" + `json:"domain"` + "`" + `; NginxConfig string ` + "`" + `json:"nginx_config"` + "`" + ` }
		json.Unmarshal(payload, &p)
		logs, err = applyDomain(p.Domain, p.NginxConfig)
	case "remove_domain":
		var p struct { Domain string ` + "`" + `json:"domain"` + "`" + ` }
		json.Unmarshal(payload, &p)
		logs, err = removeDomain(p.Domain)
	case "change_ssh_port":
		var p struct { Port int ` + "`" + `json:"port"` + "`" + ` }
		json.Unmarshal(payload, &p)
		logs, err = changeSSHPort(p.Port)
	case "change_root_password":
		var p struct { Password string ` + "`" + `json:"password"` + "`" + ` }
		json.Unmarshal(payload, &p)
		logs, err = changeRootPassword(p.Password)
	case "toggle_ufw":
		var p struct { Enabled bool ` + "`" + `json:"enabled"` + "`" + ` }
		json.Unmarshal(payload, &p)
		logs, err = toggleUFW(p.Enabled)
	case "toggle_fail2ban":
		var p struct { Enabled bool ` + "`" + `json:"enabled"` + "`" + `; Config string ` + "`" + `json:"config"` + "`" + ` }
		json.Unmarshal(payload, &p)
		logs, err = toggleFail2ban(p.Enabled, p.Config)
	case "ufw_rule":
		var p struct { Port string ` + "`" + `json:"port"` + "`" + `; Protocol string ` + "`" + `json:"protocol"` + "`" + `; Action string ` + "`" + `json:"action"` + "`" + ` }
		json.Unmarshal(payload, &p)
		logs, err = ufwRule(p.Port, p.Protocol, p.Action)
	default:
		logs = "Unknown job type: " + jobType
		err = fmt.Errorf("unknown job type")
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
	out, _ := runCmd("apt-get", "install", "-y", "nginx", "certbot", "python3-certbot-nginx", "fail2ban", "ufw")
	logs.WriteString(out)
	os.MkdirAll("/etc/nginx/conf.d/configuratix", 0755)
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

func applyDomain(domain, config string) (string, error) {
	var logs strings.Builder
	logs.WriteString(fmt.Sprintf("Applying config for %s...\n", domain))
	path := fmt.Sprintf("/etc/nginx/conf.d/configuratix/%s.conf", domain)
	if err := os.WriteFile(path, []byte(config), 0644); err != nil { return logs.String(), err }
	out, err := runCmd("nginx", "-t")
	logs.WriteString(out)
	if err != nil { os.Remove(path); return logs.String(), fmt.Errorf("nginx config test failed") }
	out, err = runCmd("systemctl", "reload", "nginx")
	logs.WriteString(out)
	logs.WriteString(fmt.Sprintf("Config applied for %s\n", domain))
	return logs.String(), err
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

go build -o /opt/configuratix/bin/configuratix-agent ./cmd/agent
cd / && rm -rf /tmp/configuratix-agent-build

# Only enroll if this is a new installation (no existing config)
if [ "$REINSTALL" = false ]; then
    echo "Enrolling new agent..."
    /opt/configuratix/bin/configuratix-agent enroll --server "$SERVER_URL" --token "$TOKEN"
else
    echo "Re-using existing agent configuration..."
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

echo ""
echo "=== Installation Complete ==="
echo "Agent enrolled and running"
echo "Nginx, Certbot, Fail2ban, and UFW installed and configured"
echo "Check status: systemctl status configuratix-agent"
`
}
