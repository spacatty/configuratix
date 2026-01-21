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

# Install dependencies
echo "Installing dependencies..."
apt-get update
apt-get install -y golang-go nginx certbot python3-certbot-nginx fail2ban ufw

# Create directories
mkdir -p /etc/configuratix
mkdir -p /opt/configuratix/bin
mkdir -p /etc/nginx/conf.d/configuratix

# Enable nginx
systemctl enable nginx
systemctl start nginx

# Configure fail2ban with SSH protection
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

systemctl enable fail2ban
systemctl restart fail2ban

# Configure UFW
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
echo "y" | ufw enable

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
	switch jobType {
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
echo "Agent enrolled and running"
echo "Nginx, Certbot, Fail2ban, and UFW installed and configured"
echo "Check status: systemctl status configuratix-agent"
`
}
