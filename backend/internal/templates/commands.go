package templates

import (
	"encoding/json"
)

// Step represents a single operation
type Step struct {
	Action  string `json:"action"`            // exec, file, service, fetch
	Command string `json:"command,omitempty"` // for exec
	Timeout int    `json:"timeout,omitempty"` // seconds
	Path    string `json:"path,omitempty"`    // for file/fetch
	Content string `json:"content,omitempty"` // for file
	URL     string `json:"url,omitempty"`     // for fetch
	Mode    string `json:"mode,omitempty"`    // file permissions
	Op      string `json:"op,omitempty"`      // write, append, delete, backup / service action
	Name    string `json:"name,omitempty"`    // service name
}

// CommandTemplate defines a reusable command
type CommandTemplate struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Category    string            `json:"category"`
	Variables   []VariableDef     `json:"variables"`
	Steps       []Step            `json:"steps"`
	OnError     string            `json:"on_error"` // stop, continue, rollback
}

// VariableDef describes a template variable
type VariableDef struct {
	Name        string `json:"name"`
	Type        string `json:"type"`        // string, int, bool, text
	Required    bool   `json:"required"`
	Default     string `json:"default,omitempty"`
	Description string `json:"description"`
}

// RunPayload is the job payload format
type RunPayload struct {
	Steps   []Step            `json:"steps"`
	Vars    map[string]string `json:"vars,omitempty"`
	OnError string            `json:"on_error,omitempty"`
}

// ToPayload converts template + variables to a run job payload
func (t *CommandTemplate) ToPayload(vars map[string]string) json.RawMessage {
	payload := RunPayload{
		Steps:   t.Steps,
		Vars:    vars,
		OnError: t.OnError,
	}
	data, _ := json.Marshal(payload)
	return data
}

// Built-in command templates
var Commands = map[string]*CommandTemplate{
	"change_ssh_port": {
		ID:          "change_ssh_port",
		Name:        "Change SSH Port",
		Description: "Change the SSH daemon listening port and update UFW rules",
		Category:    "security",
		Variables: []VariableDef{
			{Name: "port", Type: "int", Required: true, Description: "New SSH port (1024-65535)"},
		},
		OnError: "rollback",
		Steps: []Step{
			{Action: "file", Op: "backup", Path: "/etc/ssh/sshd_config"},
			{Action: "exec", Command: `sed -i 's/^#\?Port.*/Port {{port}}/' /etc/ssh/sshd_config || echo "Port {{port}}" >> /etc/ssh/sshd_config`, Timeout: 30},
			{Action: "exec", Command: "ufw allow {{port}}/tcp", Timeout: 30},
			{Action: "exec", Command: "ufw delete allow 22/tcp 2>/dev/null || true", Timeout: 30},
			{Action: "service", Name: "sshd", Op: "restart"},
		},
	},

	"change_root_password": {
		ID:          "change_root_password",
		Name:        "Change Root Password",
		Description: "Change the root user password",
		Category:    "security",
		Variables: []VariableDef{
			{Name: "password", Type: "string", Required: true, Description: "New root password"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `echo "root:{{password}}" | chpasswd`, Timeout: 30},
		},
	},

	"toggle_ufw": {
		ID:          "toggle_ufw",
		Name:        "Toggle UFW Firewall",
		Description: "Enable or disable UFW firewall",
		Category:    "firewall",
		Variables: []VariableDef{
			{Name: "enabled", Type: "bool", Required: true, Description: "Enable (true) or disable (false)"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `if [ "{{enabled}}" = "true" ]; then ufw --force enable; else ufw disable; fi`, Timeout: 30},
		},
	},

	"ufw_allow_port": {
		ID:          "ufw_allow_port",
		Name:        "UFW Allow Port",
		Description: "Allow a port through the firewall",
		Category:    "firewall",
		Variables: []VariableDef{
			{Name: "port", Type: "string", Required: true, Description: "Port number"},
			{Name: "protocol", Type: "string", Required: false, Default: "tcp", Description: "Protocol (tcp/udp/both)"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `if [ "{{protocol}}" = "both" ]; then ufw allow {{port}}/tcp && ufw allow {{port}}/udp; else ufw allow {{port}}/{{protocol}}; fi`, Timeout: 30},
		},
	},

	"ufw_delete_port": {
		ID:          "ufw_delete_port",
		Name:        "UFW Delete Port Rule",
		Description: "Remove a port rule from the firewall",
		Category:    "firewall",
		Variables: []VariableDef{
			{Name: "port", Type: "string", Required: true, Description: "Port number"},
			{Name: "protocol", Type: "string", Required: false, Default: "tcp", Description: "Protocol (tcp/udp/both)"},
		},
		OnError: "continue",
		Steps: []Step{
			{Action: "exec", Command: `if [ "{{protocol}}" = "both" ]; then ufw delete allow {{port}}/tcp; ufw delete allow {{port}}/udp; else ufw delete allow {{port}}/{{protocol}}; fi`, Timeout: 30},
		},
	},

	"toggle_fail2ban": {
		ID:          "toggle_fail2ban",
		Name:        "Toggle Fail2ban",
		Description: "Enable or disable Fail2ban service with optional config",
		Category:    "security",
		Variables: []VariableDef{
			{Name: "enabled", Type: "bool", Required: true, Description: "Enable (true) or disable (false)"},
			{Name: "config", Type: "text", Required: false, Description: "Custom jail.local config (optional)"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `if [ -n "{{config}}" ]; then echo '{{config}}' > /etc/fail2ban/jail.local; fi`, Timeout: 30},
			{Action: "exec", Command: `if [ "{{enabled}}" = "true" ]; then systemctl enable fail2ban && systemctl restart fail2ban; else systemctl stop fail2ban && systemctl disable fail2ban; fi`, Timeout: 60},
		},
	},

	"apply_nginx_config": {
		ID:          "apply_nginx_config",
		Name:        "Apply Nginx Config",
		Description: "Write nginx config for a domain and reload",
		Category:    "nginx",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			{Name: "config", Type: "text", Required: true, Description: "Nginx config content"},
		},
		OnError: "rollback",
		Steps: []Step{
			{Action: "file", Op: "backup", Path: "/etc/nginx/conf.d/configuratix/{{domain}}.conf"},
			{Action: "file", Op: "write", Path: "/etc/nginx/conf.d/configuratix/{{domain}}.conf", Content: "{{config}}", Mode: "0644"},
			{Action: "exec", Command: "nginx -t", Timeout: 30},
			{Action: "service", Name: "nginx", Op: "reload"},
		},
	},

	"remove_nginx_config": {
		ID:          "remove_nginx_config",
		Name:        "Remove Nginx Config",
		Description: "Remove nginx config for a domain",
		Category:    "nginx",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
		},
		OnError: "continue",
		Steps: []Step{
			{Action: "file", Op: "delete", Path: "/etc/nginx/conf.d/configuratix/{{domain}}.conf"},
			{Action: "service", Name: "nginx", Op: "reload"},
		},
	},

	"issue_ssl_cert": {
		ID:          "issue_ssl_cert",
		Name:        "Issue SSL Certificate",
		Description: "Issue SSL certificate via Certbot for a domain",
		Category:    "ssl",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			{Name: "email", Type: "string", Required: false, Default: "", Description: "Email for Let's Encrypt notifications"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `certbot --nginx -d {{domain}} --non-interactive --agree-tos --email "{{email}}" --redirect || certbot --nginx -d {{domain}} --non-interactive --agree-tos --register-unsafely-without-email --redirect`, Timeout: 300},
		},
	},

	"bootstrap_machine": {
		ID:          "bootstrap_machine",
		Name:        "Bootstrap Machine",
		Description: "Install all required packages (nginx, certbot, fail2ban, ufw)",
		Category:    "system",
		Variables:   []VariableDef{},
		OnError:     "stop",
		Steps: []Step{
			{Action: "exec", Command: "apt-get update", Timeout: 120},
			{Action: "exec", Command: "apt-get install -y nginx certbot python3-certbot-nginx fail2ban ufw", Timeout: 300},
			{Action: "exec", Command: "mkdir -p /etc/nginx/conf.d/configuratix", Timeout: 10},
			{Action: "service", Name: "nginx", Op: "enable"},
			{Action: "service", Name: "nginx", Op: "start"},
			{Action: "service", Name: "fail2ban", Op: "enable"},
			{Action: "service", Name: "fail2ban", Op: "start"},
			{Action: "exec", Command: "ufw default deny incoming", Timeout: 10},
			{Action: "exec", Command: "ufw default allow outgoing", Timeout: 10},
			{Action: "exec", Command: "ufw allow 22/tcp", Timeout: 10},
			{Action: "exec", Command: "ufw allow 80/tcp", Timeout: 10},
			{Action: "exec", Command: "ufw allow 443/tcp", Timeout: 10},
			{Action: "exec", Command: "echo 'y' | ufw enable", Timeout: 10},
		},
	},

	"install_package": {
		ID:          "install_package",
		Name:        "Install Package",
		Description: "Install a package via apt",
		Category:    "system",
		Variables: []VariableDef{
			{Name: "package", Type: "string", Required: true, Description: "Package name"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: "apt-get update", Timeout: 120},
			{Action: "exec", Command: "apt-get install -y {{package}}", Timeout: 300},
		},
	},

	"restart_service": {
		ID:          "restart_service",
		Name:        "Restart Service",
		Description: "Restart a systemd service",
		Category:    "system",
		Variables: []VariableDef{
			{Name: "service", Type: "string", Required: true, Description: "Service name"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "service", Name: "{{service}}", Op: "restart"},
		},
	},

	"write_file": {
		ID:          "write_file",
		Name:        "Write File",
		Description: "Write content to a file",
		Category:    "files",
		Variables: []VariableDef{
			{Name: "path", Type: "string", Required: true, Description: "File path"},
			{Name: "content", Type: "text", Required: true, Description: "File content"},
			{Name: "mode", Type: "string", Required: false, Default: "0644", Description: "File permissions"},
		},
		OnError: "rollback",
		Steps: []Step{
			{Action: "file", Op: "backup", Path: "{{path}}"},
			{Action: "file", Op: "write", Path: "{{path}}", Content: "{{content}}", Mode: "{{mode}}"},
		},
	},

	"exec_command": {
		ID:          "exec_command",
		Name:        "Execute Command",
		Description: "Run an arbitrary shell command",
		Category:    "system",
		Variables: []VariableDef{
			{Name: "command", Type: "text", Required: true, Description: "Shell command to execute"},
			{Name: "timeout", Type: "int", Required: false, Default: "300", Description: "Timeout in seconds"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: "{{command}}", Timeout: 300},
		},
	},
}

// GetCommand returns a command template by ID
func GetCommand(id string) *CommandTemplate {
	return Commands[id]
}

// ListCommands returns all available commands
func ListCommands() []*CommandTemplate {
	var list []*CommandTemplate
	for _, cmd := range Commands {
		list = append(list, cmd)
	}
	return list
}

// ListCommandsByCategory returns commands grouped by category
func ListCommandsByCategory() map[string][]*CommandTemplate {
	result := make(map[string][]*CommandTemplate)
	for _, cmd := range Commands {
		result[cmd.Category] = append(result[cmd.Category], cmd)
	}
	return result
}

