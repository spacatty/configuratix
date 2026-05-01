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
	Log     string `json:"log,omitempty"`     // "out" = log command output (default), or custom command to execute and log
}

// CommandTemplate defines a reusable command
type CommandTemplate struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Category    string        `json:"category"`
	Variables   []VariableDef `json:"variables"`
	Steps       []Step        `json:"steps"`
	OnError     string        `json:"on_error"` // stop, continue, rollback
}

// VariableDef describes a template variable
type VariableDef struct {
	Name        string `json:"name"`
	Type        string `json:"type"` // string, int, bool, text
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
			{Action: "exec", Command: `sed -i 's/^#\?Port.*/Port {{port}}/' /etc/ssh/sshd_config || echo "Port {{port}}" >> /etc/ssh/sshd_config`, Timeout: 30, Log: "grep '^Port' /etc/ssh/sshd_config"},
			{Action: "exec", Command: "ufw allow {{port}}/tcp", Timeout: 30, Log: "ufw status | grep {{port}}"},
			{Action: "exec", Command: "ufw delete allow 22/tcp 2>/dev/null || true", Timeout: 30},
			{Action: "exec", Command: "systemctl daemon-reload", Timeout: 30},
			{Action: "exec", Command: "systemctl restart sshd 2>/dev/null || systemctl restart ssh", Timeout: 60, Log: "systemctl is-active sshd || systemctl is-active ssh"},
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
			{Action: "exec", Command: `if [ "{{enabled}}" = "true" ]; then ufw --force enable; else ufw disable; fi`, Timeout: 30, Log: "ufw status"},
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
			{Action: "exec", Command: `if [ "{{protocol}}" = "both" ]; then ufw allow {{port}}/tcp && ufw allow {{port}}/udp; else ufw allow {{port}}/{{protocol}}; fi`, Timeout: 30, Log: "ufw status | grep {{port}}"},
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
			{Action: "exec", Command: `if [ "{{protocol}}" = "both" ]; then ufw delete allow {{port}}/tcp; ufw delete allow {{port}}/udp; else ufw delete allow {{port}}/{{protocol}}; fi`, Timeout: 30, Log: "ufw status"},
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

	"read_file": {
		ID:          "read_file",
		Name:        "Read File",
		Description: "Read content from a file",
		Category:    "files",
		Variables: []VariableDef{
			{Name: "path", Type: "string", Required: true, Description: "File path"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: "cat {{path}}", Timeout: 30},
		},
	},

	"list_nginx_configs": {
		ID:          "list_nginx_configs",
		Name:        "List Nginx Configs",
		Description: "List all nginx configuration files",
		Category:    "nginx",
		Variables:   []VariableDef{},
		OnError:     "continue",
		Steps: []Step{
			{Action: "exec", Command: "echo '=== Main Config ===' && ls -la /etc/nginx/nginx.conf 2>/dev/null && echo '=== Site Configs ===' && ls -la /etc/nginx/conf.d/configuratix/*.conf 2>/dev/null || echo 'No configuratix configs' && echo '=== Sites Enabled ===' && ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo 'No sites-enabled'", Timeout: 30},
		},
	},

	"nginx_test_reload": {
		ID:          "nginx_test_reload",
		Name:        "Test and Reload Nginx",
		Description: "Test nginx configuration and reload if valid",
		Category:    "nginx",
		Variables:   []VariableDef{},
		OnError:     "stop",
		Steps: []Step{
			{Action: "exec", Command: "nginx -t", Timeout: 30},
			{Action: "exec", Command: "systemctl reload nginx", Timeout: 30},
		},
	},

	"get_sshd_config": {
		ID:          "get_sshd_config",
		Name:        "Get SSHD Config",
		Description: "Read the SSH daemon configuration",
		Category:    "security",
		Variables:   []VariableDef{},
		OnError:     "stop",
		Steps: []Step{
			{Action: "exec", Command: "cat /etc/ssh/sshd_config", Timeout: 30},
		},
	},

	"get_php_config": {
		ID:          "get_php_config",
		Name:        "Get PHP Config",
		Description: "Read the PHP-FPM configuration",
		Category:    "php",
		Variables:   []VariableDef{},
		OnError:     "continue",
		Steps: []Step{
			{Action: "exec", Command: "PHP_VERSION=$(php -r 'echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;' 2>/dev/null) && cat /etc/php/${PHP_VERSION}/fpm/php.ini 2>/dev/null || echo 'PHP not installed'", Timeout: 30},
		},
	},

	"write_nginx_config": {
		ID:          "write_nginx_config",
		Name:        "Write Nginx Config",
		Description: "Write nginx configuration and reload",
		Category:    "nginx",
		Variables: []VariableDef{
			{Name: "path", Type: "string", Required: true, Description: "Config file path"},
			{Name: "content", Type: "text", Required: true, Description: "Config content"},
		},
		OnError: "rollback",
		Steps: []Step{
			{Action: "file", Op: "backup", Path: "{{path}}"},
			{Action: "file", Op: "write", Path: "{{path}}", Content: "{{content}}", Mode: "0644"},
			{Action: "exec", Command: "nginx -t", Timeout: 30},
			{Action: "exec", Command: "systemctl reload nginx", Timeout: 30},
		},
	},

	"write_sshd_config": {
		ID:          "write_sshd_config",
		Name:        "Write SSHD Config",
		Description: "Write SSH daemon configuration and reload",
		Category:    "security",
		Variables: []VariableDef{
			{Name: "content", Type: "text", Required: true, Description: "sshd_config content"},
		},
		OnError: "rollback",
		Steps: []Step{
			{Action: "file", Op: "backup", Path: "/etc/ssh/sshd_config"},
			{Action: "file", Op: "write", Path: "/etc/ssh/sshd_config", Content: "{{content}}", Mode: "0644"},
			{Action: "exec", Command: "sshd -t", Timeout: 30},
			{Action: "exec", Command: "systemctl daemon-reload", Timeout: 30},
			{Action: "exec", Command: "systemctl restart sshd 2>/dev/null || systemctl restart ssh", Timeout: 60},
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

	"install_php": {
		ID:          "install_php",
		Name:        "Install PHP-FPM",
		Description: "Install PHP-FPM with common extensions for web hosting",
		Category:    "php",
		Variables:   []VariableDef{},
		OnError:     "stop",
		Steps: []Step{
			{Action: "exec", Command: "apt-get update", Timeout: 120},
			{Action: "exec", Command: "apt-get install -y php-fpm php-cli php-common php-curl php-gd php-json php-mbstring php-mysql php-xml php-zip", Timeout: 300},
			{Action: "exec", Command: "PHP_VERSION=$(php -r 'echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;') && systemctl enable php${PHP_VERSION}-fpm && systemctl start php${PHP_VERSION}-fpm", Timeout: 60},
		},
	},

	"check_php_status": {
		ID:          "check_php_status",
		Name:        "Check PHP Status",
		Description: "Check if PHP-FPM is installed and running",
		Category:    "php",
		Variables:   []VariableDef{},
		OnError:     "continue",
		Steps: []Step{
			{Action: "exec", Command: "php -v || echo 'PHP not installed'", Timeout: 10},
			{Action: "exec", Command: "PHP_VERSION=$(php -r 'echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;' 2>/dev/null) && systemctl status php${PHP_VERSION}-fpm --no-pager || echo 'PHP-FPM not running'", Timeout: 30},
		},
	},

	"get_php_logs": {
		ID:          "get_php_logs",
		Name:        "Get PHP-FPM Logs",
		Description: "Retrieve recent PHP-FPM logs",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "lines", Type: "int", Required: false, Default: "100", Description: "Number of lines to retrieve"},
		},
		OnError: "continue",
		Steps: []Step{
			{Action: "exec", Command: "PHP_VERSION=$(php -r 'echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;' 2>/dev/null) && journalctl -u php${PHP_VERSION}-fpm --no-pager -n {{lines}} || tail -n {{lines}} /var/log/php*-fpm.log 2>/dev/null || echo 'No PHP logs found'", Timeout: 30},
		},
	},

	"restart_php": {
		ID:          "restart_php",
		Name:        "Restart PHP-FPM",
		Description: "Restart the PHP-FPM service",
		Category:    "php",
		Variables:   []VariableDef{},
		OnError:     "stop",
		Steps: []Step{
			{Action: "exec", Command: "PHP_VERSION=$(php -r 'echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;') && systemctl restart php${PHP_VERSION}-fpm", Timeout: 60},
		},
	},

	"list_php_versions": {
		ID:          "list_php_versions",
		Name:        "List PHP Versions",
		Description: "List installed PHP versions",
		Category:    "php",
		Variables:   []VariableDef{},
		OnError:     "continue",
		Steps: []Step{
			{Action: "exec", Command: "ls /etc/php/ 2>/dev/null | grep -E '^[0-9]+\\.[0-9]+$' || echo ''", Timeout: 10},
		},
	},

	"reload_php_version": {
		ID:          "reload_php_version",
		Name:        "Reload PHP-FPM Version",
		Description: "Reload a specific PHP-FPM version",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Description: "PHP version (e.g., 8.2)", Required: true},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: "systemctl reload php{{version}}-fpm || systemctl restart php{{version}}-fpm", Timeout: 60},
		},
	},

	"deploy_landing": {
		ID:          "deploy_landing",
		Name:        "Deploy Landing Page",
		Description: "Download and extract a landing page archive to the target directory",
		Category:    "landings",
		Variables: []VariableDef{
			{Name: "url", Type: "string", Required: true, Description: "URL to download the landing zip"},
			{Name: "target_path", Type: "string", Required: true, Description: "Target directory path"},
		},
		OnError: "rollback",
		Steps: []Step{
			{Action: "exec", Command: "mkdir -p {{target_path}}", Timeout: 10},
			{Action: "exec", Command: "rm -rf {{target_path}}/* 2>/dev/null || true", Timeout: 30},
			{Action: "fetch", URL: "{{url}}", Path: "/tmp/landing_download.zip"},
			{Action: "exec", Command: "unzip -o /tmp/landing_download.zip -d {{target_path}}", Timeout: 60},
			{Action: "exec", Command: "rm /tmp/landing_download.zip", Timeout: 10},
			{Action: "exec", Command: "chown -R www-data:www-data {{target_path}}", Timeout: 30},
		},
	},

	"apply_domain": {
		ID:          "apply_domain",
		Name:        "Apply Domain Configuration",
		Description: "Apply nginx config for a domain, issuing SSL certificate if needed",
		Category:    "domains",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			{Name: "nginx_config", Type: "text", Required: true, Description: "Nginx configuration content"},
			{Name: "ssl_enabled", Type: "bool", Required: false, Default: "true", Description: "Whether SSL is enabled"},
			{Name: "ssl_email", Type: "string", Required: false, Default: "admin@example.com", Description: "Email for SSL certificate"},
		},
		OnError: "stop",
		Steps: []Step{
			// Create config directory
			{Action: "exec", Command: "mkdir -p /etc/nginx/conf.d/configuratix", Timeout: 10},
			// Issue SSL cert if needed - remove old config first to avoid PHP socket issues
			{Action: "exec", Command: `
DOMAIN="{{domain}}"
SSL_ENABLED="{{ssl_enabled}}"
SSL_EMAIL="{{ssl_email}}"
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
CONFIG_PATH="/etc/nginx/conf.d/configuratix/$DOMAIN.conf"

if [ "$SSL_ENABLED" = "true" ] && [ ! -f "$CERT_PATH" ]; then
    echo "Issuing SSL certificate for $DOMAIN..."
    # Backup and remove old config to prevent nginx start failures
    if [ -f "$CONFIG_PATH" ]; then
        mv "$CONFIG_PATH" "$CONFIG_PATH.bak" 2>/dev/null || true
    fi
    # Reload nginx without the problematic config, then stop for certbot
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
    systemctl stop nginx 2>/dev/null || true
    # Issue certificate
    certbot certonly --standalone -d "$DOMAIN" \
        --non-interactive --agree-tos --no-eff-email \
        --email "$SSL_EMAIL" \
        --cert-name "$DOMAIN"
    # Don't start nginx yet - let the config write step handle it
    echo "Certificate issued successfully"
fi
`, Timeout: 180},
			// Write nginx config
			{Action: "file", Op: "write", Path: "/etc/nginx/conf.d/configuratix/{{domain}}.conf", Content: "{{nginx_config}}", Mode: "0644", Log: "cat /etc/nginx/conf.d/configuratix/{{domain}}.conf"},
			// Test nginx - temporarily disable configs with missing SSL certs
			{Action: "exec", Command: `
echo "Testing nginx configuration..."

# Function to check if a config has missing SSL certs
check_and_disable_broken_configs() {
    DISABLED_CONFIGS=""
    for conf in /etc/nginx/conf.d/configuratix/*.conf; do
        [ -f "$conf" ] || continue
        # Extract ssl_certificate paths from config
        certs=$(grep -oP 'ssl_certificate\s+\K[^;]+' "$conf" 2>/dev/null || true)
        for cert in $certs; do
            if [ ! -f "$cert" ]; then
                echo "WARNING: Disabling $conf - missing certificate: $cert"
                mv "$conf" "$conf.disabled" 2>/dev/null || true
                DISABLED_CONFIGS="$DISABLED_CONFIGS $conf"
                break
            fi
        done
    done
    echo "$DISABLED_CONFIGS"
}

# Also check main nginx conf.d
check_and_disable_broken_configs_main() {
    for conf in /etc/nginx/conf.d/*.conf; do
        [ -f "$conf" ] || continue
        [[ "$conf" == *"/configuratix/"* ]] && continue  # Skip our managed configs
        certs=$(grep -oP 'ssl_certificate\s+\K[^;]+' "$conf" 2>/dev/null || true)
        for cert in $certs; do
            if [ ! -f "$cert" ]; then
                echo "WARNING: Disabling $conf - missing certificate: $cert"
                mv "$conf" "$conf.disabled" 2>/dev/null || true
                break
            fi
        done
    done
}

# Disable broken configs before testing
check_and_disable_broken_configs
check_and_disable_broken_configs_main

# Now test nginx
nginx -t
`, Timeout: 60},
			// Start/reload nginx
			{Action: "exec", Command: "systemctl is-active nginx >/dev/null 2>&1 && systemctl reload nginx || systemctl start nginx", Timeout: 30, Log: "systemctl status nginx --no-pager | head -5"},
		},
	},

	"remove_domain": {
		ID:          "remove_domain",
		Name:        "Remove Domain Configuration",
		Description: "Remove nginx configuration for a domain (both HTTP and passthrough) and regenerate consolidated config",
		Category:    "domains",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name to remove"},
		},
		OnError: "continue",
		Steps: []Step{
			// Remove marker file and old HTTP config
			{Action: "exec", Command: "rm -f /etc/nginx/stream.d/passthrough-{{domain}}.conf", Timeout: 10},
			{Action: "exec", Command: "rm -f /etc/nginx/conf.d/configuratix/{{domain}}.conf", Timeout: 10},
			// Regenerate consolidated config from remaining markers
			{Action: "exec", Command: `
#!/bin/bash
set -e

STREAM_DIR="/etc/nginx/stream.d"
CONFIG_FILE="$STREAM_DIR/configuratix-passthrough-manual.conf"

echo "=== Regenerating passthrough config ==="

# Collect all domains from marker files
declare -A HTTPS_TARGETS
declare -A HTTP_TARGETS

for marker in "$STREAM_DIR"/passthrough-*.conf; do
    [ -f "$marker" ] || continue
    
    # Extract domain from filename (passthrough-domain.com.conf -> domain.com)
    filename=$(basename "$marker")
    domain="${filename#passthrough-}"
    domain="${domain%.conf}"
    
    # Extract target from marker file
    target_https=$(grep "^# Target HTTPS:" "$marker" 2>/dev/null | cut -d: -f2- | tr -d ' ')
    target_http=$(grep "^# Target HTTP:" "$marker" 2>/dev/null | cut -d: -f2- | tr -d ' ')
    
    if [ -n "$target_https" ]; then
        HTTPS_TARGETS["$domain"]="$target_https"
        if [ -n "$target_http" ]; then
            echo "Found: $domain -> HTTPS: $target_https, HTTP: $target_http"
        else
            echo "Found: $domain -> HTTPS: $target_https, HTTP: disabled"
        fi
    fi
    if [ -n "$target_http" ]; then
        HTTP_TARGETS["$domain"]="$target_http"
    fi
done

# If no domains left, remove config file and re-enable disabled sites
if [ ${#HTTPS_TARGETS[@]} -eq 0 ]; then
    echo "No passthrough domains remaining, cleaning up..."
    rm -f "$CONFIG_FILE"
    
    # Re-enable sites that were disabled by passthrough
    SITES_ENABLED="/etc/nginx/sites-enabled"
    SITES_DISABLED="/etc/nginx/sites-disabled-by-passthrough"
    if [ -d "$SITES_DISABLED" ]; then
        echo "Re-enabling disabled sites..."
        for conf in "$SITES_DISABLED"/*; do
            [ -f "$conf" ] || continue
            confname=$(basename "$conf")
            echo "  Re-enabling $confname"
            mv "$conf" "$SITES_ENABLED/$confname"
        done
        rmdir "$SITES_DISABLED" 2>/dev/null || true
    fi
    
    # Re-enable DNS Management config if it was disabled
    DNS_MGMT_CONFIG="$STREAM_DIR/configuratix-passthrough.conf"
    if [ -f "${DNS_MGMT_CONFIG}.disabled-by-manual" ]; then
        echo "Re-enabling DNS Management passthrough config..."
        mv "${DNS_MGMT_CONFIG}.disabled-by-manual" "$DNS_MGMT_CONFIG"
    fi
    
    nginx -t && (systemctl is-active nginx >/dev/null 2>&1 && systemctl reload nginx || true)
    echo "Passthrough removed, original sites restored"
    exit 0
fi

# Generate consolidated config
cat > "$CONFIG_FILE" << 'HEADER'
# Configuratix Manual Passthrough Configuration
# Auto-generated - DO NOT EDIT MANUALLY
# Domains are tracked via passthrough-*.conf marker files

HEADER

# SNI map for HTTPS
echo "# SNI-based backend routing for HTTPS" >> "$CONFIG_FILE"
echo "map \$ssl_preread_server_name \$backend_https {" >> "$CONFIG_FILE"
echo "    default reject;" >> "$CONFIG_FILE"
for domain in "${!HTTPS_TARGETS[@]}"; do
    echo "    $domain ${HTTPS_TARGETS[$domain]};" >> "$CONFIG_FILE"
done
echo "}" >> "$CONFIG_FILE"
echo "" >> "$CONFIG_FILE"

# Reject upstream
cat >> "$CONFIG_FILE" << 'REJECT'
# Reject upstream (closed connection)
upstream reject {
    server 127.0.0.1:1 down;
}

REJECT

# HTTPS server block
cat >> "$CONFIG_FILE" << 'HTTPS'
# HTTPS Passthrough (TLS SNI-based routing)
server {
    listen 443;
    ssl_preread on;
    proxy_pass $backend_https;
    proxy_protocol on;
    proxy_connect_timeout 10s;
    proxy_timeout 30m;
}

HTTPS

# HTTP server block - use first target as default (stream can't route by Host header)
first_http_target=""
for domain in "${!HTTP_TARGETS[@]}"; do
    first_http_target="${HTTP_TARGETS[$domain]}"
    break
done

if [ -n "$first_http_target" ]; then
    cat >> "$CONFIG_FILE" << EOF
# HTTP Passthrough (Layer 4 - all traffic to backend)
server {
    listen 80;
    proxy_pass $first_http_target;
    proxy_protocol on;
    proxy_connect_timeout 10s;
    proxy_timeout 30m;
}
EOF
fi

echo "Regenerated config with ${#HTTPS_TARGETS[@]} domain(s)"
cat "$CONFIG_FILE"

# Test and reload
nginx -t
systemctl is-active nginx >/dev/null 2>&1 && systemctl reload nginx || systemctl start nginx
`, Timeout: 60},
		},
	},

	"apply_passthrough_domain": {
		ID:          "apply_passthrough_domain",
		Name:        "Apply Passthrough Domain",
		Description: "Configure SSL passthrough (Layer 4) for a domain using nginx stream module with PROXY Protocol",
		Category:    "domains",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			{Name: "target", Type: "string", Required: true, Description: "Backend target IP address"},
			{Name: "https_port", Type: "string", Required: false, Default: "443", Description: "Backend HTTPS port"},
			{Name: "http_port", Type: "string", Required: false, Default: "80", Description: "Backend HTTP port"},
			{Name: "enable_http", Type: "string", Required: false, Default: "true", Description: "Enable HTTP passthrough marker/listener for port 80"},
		},
		OnError: "stop",
		Steps: []Step{
			// Single atomic setup and config script
			{Action: "exec", Command: `
#!/bin/bash
set -e

DOMAIN="{{domain}}"
TARGET="{{target}}"
HTTPS_PORT="{{https_port}}"
HTTP_PORT="{{http_port}}"
ENABLE_HTTP="{{enable_http}}"

# Default ports if not specified or template not substituted
if [ -z "$HTTPS_PORT" ] || [[ "$HTTPS_PORT" == *"{{"* ]]; then
    HTTPS_PORT="443"
fi
if [ -z "$HTTP_PORT" ] || [[ "$HTTP_PORT" == *"{{"* ]]; then
    HTTP_PORT="80"
fi
if [ -z "$ENABLE_HTTP" ] || [[ "$ENABLE_HTTP" == *"{{"* ]]; then
    ENABLE_HTTP="true"
fi

# Normalize HTTP toggle values
case "$(echo "$ENABLE_HTTP" | tr '[:upper:]' '[:lower:]')" in
    true|1|yes|on) ENABLE_HTTP="true" ;;
    *) ENABLE_HTTP="false" ;;
esac

NGINX_CONF="/etc/nginx/nginx.conf"
STREAM_DIR="/etc/nginx/stream.d"
CONFIG_FILE="$STREAM_DIR/configuratix-passthrough-manual.conf"
MARKER_FILE="$STREAM_DIR/passthrough-${DOMAIN}.conf"
DNS_MGMT_CONFIG="$STREAM_DIR/configuratix-passthrough.conf"

echo "=== Configuratix Passthrough Setup for $DOMAIN ==="
if [ "$ENABLE_HTTP" = "true" ]; then
    echo "Target: $TARGET (HTTPS: $HTTPS_PORT, HTTP: $HTTP_PORT)"
else
    echo "Target: $TARGET (HTTPS: $HTTPS_PORT, HTTP: disabled)"
fi

# 1. Create directories
mkdir -p "$STREAM_DIR" /etc/nginx/conf.d/configuratix

# 1.5. Check for DNS Management config conflict
# If configuratix-passthrough.conf exists (DNS Management), we need to disable it
# as manual passthrough will take over these ports
if [ -f "$DNS_MGMT_CONFIG" ]; then
    echo "=== Detected DNS Management passthrough config ==="
    echo "Disabling DNS Management config to avoid port conflict..."
    mv "$DNS_MGMT_CONFIG" "$DNS_MGMT_CONFIG.disabled-by-manual"
    echo "NOTE: DNS Management passthrough has been disabled."
    echo "      To re-enable, remove this domain from manual passthrough first."
fi

# 2. Remove any old HTTP-block config for this domain
rm -f "/etc/nginx/conf.d/configuratix/${DOMAIN}.conf"

# 3. Disable sites-enabled configs that listen on ports 80/443
# (Stream passthrough needs exclusive access to these ports)
echo "=== Checking for conflicting site configs ==="
SITES_ENABLED="/etc/nginx/sites-enabled"
SITES_DISABLED="/etc/nginx/sites-disabled-by-passthrough"
mkdir -p "$SITES_DISABLED"

if [ -d "$SITES_ENABLED" ]; then
    for conf in "$SITES_ENABLED"/*; do
        [ -f "$conf" ] || [ -L "$conf" ] || continue
        confname=$(basename "$conf")
        
        # Check if this config listens on 80 or 443
        if grep -qE 'listen\s+(80|443)' "$conf" 2>/dev/null; then
            echo "Disabling $confname (listens on 80/443)..."
            mv "$conf" "$SITES_DISABLED/$confname"
        fi
    done
fi

# Also remove any leftover .disabled-by-passthrough files from previous runs
rm -f "$SITES_ENABLED"/*.disabled-by-passthrough 2>/dev/null || true

# 4. Check and install stream module if needed
echo "=== Checking nginx stream module ==="

STREAM_AVAILABLE=false

# Check if already loaded via modules-enabled
if [ -f /etc/nginx/modules-enabled/50-mod-stream.conf ] || \
   ls /etc/nginx/modules-enabled/*stream* 2>/dev/null | grep -q .; then
    echo "Stream module is auto-loaded via modules-enabled"
    STREAM_AVAILABLE=true
fi

# Remove duplicate load_module if auto-loaded
if [ "$STREAM_AVAILABLE" = true ]; then
    sed -i '/^load_module.*ngx_stream_module/d' "$NGINX_CONF" 2>/dev/null || true
fi

# If not auto-loaded, check if dynamic module exists
if [ "$STREAM_AVAILABLE" = false ] && [ -f /usr/lib/nginx/modules/ngx_stream_module.so ]; then
    if ! grep -q "load_module.*ngx_stream_module" "$NGINX_CONF"; then
        echo "Adding stream module load directive..."
        sed -i '1i load_module /usr/lib/nginx/modules/ngx_stream_module.so;' "$NGINX_CONF"
    fi
    STREAM_AVAILABLE=true
fi

# If still not available, install it
if [ "$STREAM_AVAILABLE" = false ]; then
    echo "Installing nginx stream module..."
    apt-get update -qq
    if apt-cache show libnginx-mod-stream >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y libnginx-mod-stream
    elif apt-cache show nginx-extras >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y nginx-extras
    elif apt-cache show nginx-full >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y nginx-full
    else
        echo "ERROR: Cannot install stream module"
        exit 1
    fi
fi

# 5. Verify stream module is available BEFORE adding stream block
echo "=== Verifying stream module availability ==="
MODULE_OK=false

# Check if auto-loaded via modules-enabled
if [ -f /etc/nginx/modules-enabled/50-mod-stream.conf ] || \
   ls /etc/nginx/modules-enabled/*stream* 2>/dev/null | grep -q .; then
    echo "Stream module auto-loaded via modules-enabled"
    MODULE_OK=true
fi

# Check if module file exists (for manual load_module)
if [ "$MODULE_OK" = false ] && [ -f /usr/lib/nginx/modules/ngx_stream_module.so ]; then
    echo "Stream module available at /usr/lib/nginx/modules/"
    MODULE_OK=true
fi

# Check if compiled in (nginx-full or similar)
if [ "$MODULE_OK" = false ]; then
    if nginx -V 2>&1 | grep -q "with-stream"; then
        echo "Stream module compiled into nginx"
        MODULE_OK=true
    fi
fi

if [ "$MODULE_OK" = false ]; then
    echo "ERROR: Stream module is not available after installation attempt"
    exit 1
fi
echo "Stream module verified OK"

# 6. Add stream block to nginx.conf if missing
if ! grep -qE "^stream\s*\{" "$NGINX_CONF"; then
    echo "" >> "$NGINX_CONF"
    echo "# SSL Passthrough configuration (Configuratix)" >> "$NGINX_CONF"
    echo "stream {" >> "$NGINX_CONF"
    echo "    include /etc/nginx/stream.d/*.conf;" >> "$NGINX_CONF"
    echo "}" >> "$NGINX_CONF"
    echo "Added stream block to nginx.conf"
elif ! grep -q "include /etc/nginx/stream.d" "$NGINX_CONF"; then
    sed -i '/^stream\s*{/a\    include /etc/nginx/stream.d/*.conf;' "$NGINX_CONF"
    echo "Added stream.d include to existing stream block"
fi

# 7. Write marker file for this domain
cat > "$MARKER_FILE" << EOF
# Configuratix Passthrough Marker
# Domain: $DOMAIN
# Target HTTPS: ${TARGET}:${HTTPS_PORT}
# PROXY Protocol: enabled
# HTTP Passthrough Enabled: ${ENABLE_HTTP}
# Created: $(date -Iseconds)
EOF
if [ "$ENABLE_HTTP" = "true" ]; then
    echo "# Target HTTP: ${TARGET}:${HTTP_PORT}" >> "$MARKER_FILE"
else
    echo "# HTTP Passthrough: disabled" >> "$MARKER_FILE"
fi
echo "Created marker: $MARKER_FILE"

# 8. Regenerate consolidated config from all markers
echo "=== Regenerating consolidated config ==="

declare -A HTTPS_TARGETS
declare -A HTTP_TARGETS

for marker in "$STREAM_DIR"/passthrough-*.conf; do
    [ -f "$marker" ] || continue
    
    # Extract domain from filename
    filename=$(basename "$marker")
    dom="${filename#passthrough-}"
    dom="${dom%.conf}"
    
    # Extract targets from marker
    target_https=$(grep "^# Target HTTPS:" "$marker" 2>/dev/null | sed 's/^# Target HTTPS: *//')
    target_http=$(grep "^# Target HTTP:" "$marker" 2>/dev/null | sed 's/^# Target HTTP: *//')
    
    if [ -n "$target_https" ]; then
        HTTPS_TARGETS["$dom"]="$target_https"
    fi
    if [ -n "$target_http" ]; then
        HTTP_TARGETS["$dom"]="$target_http"
    fi
    if [ -n "$target_http" ]; then
        echo "  - $dom -> HTTPS: $target_https, HTTP: $target_http"
    else
        echo "  - $dom -> HTTPS: $target_https, HTTP: disabled"
    fi
done

# Generate config
cat > "$CONFIG_FILE" << 'HEADER'
# Configuratix Manual Passthrough Configuration
# Auto-generated - DO NOT EDIT MANUALLY
# Domains are tracked via passthrough-*.conf marker files

HEADER

# SNI map
echo "# SNI-based backend routing for HTTPS" >> "$CONFIG_FILE"
echo "map \$ssl_preread_server_name \$backend_https {" >> "$CONFIG_FILE"
echo "    default reject;" >> "$CONFIG_FILE"
for dom in "${!HTTPS_TARGETS[@]}"; do
    echo "    $dom ${HTTPS_TARGETS[$dom]};" >> "$CONFIG_FILE"
done
echo "}" >> "$CONFIG_FILE"
echo "" >> "$CONFIG_FILE"

# Reject upstream
cat >> "$CONFIG_FILE" << 'REJECT'
# Reject upstream (closed connection)
upstream reject {
    server 127.0.0.1:1 down;
}

REJECT

# HTTPS server
cat >> "$CONFIG_FILE" << 'HTTPS'
# HTTPS Passthrough (TLS SNI-based routing)
server {
    listen 443;
    ssl_preread on;
    proxy_pass $backend_https;
    proxy_protocol on;
    proxy_connect_timeout 10s;
    proxy_timeout 30m;
}

HTTPS

# HTTP server - get first target for default routing
first_http=""
for dom in "${!HTTP_TARGETS[@]}"; do
    first_http="${HTTP_TARGETS[$dom]}"
    break
done

if [ -n "$first_http" ]; then
    cat >> "$CONFIG_FILE" << EOF
# HTTP Passthrough (Layer 4 - all traffic to backend)
server {
    listen 80;
    proxy_pass $first_http;
    proxy_protocol on;
    proxy_connect_timeout 10s;
    proxy_timeout 30m;
}
EOF
fi

echo ""
echo "=== Generated Config ==="
cat "$CONFIG_FILE"

# 9. Test and reload nginx
echo ""
echo "=== Testing nginx config ==="
nginx -t

echo "=== Reloading nginx ==="
if systemctl is-active nginx >/dev/null 2>&1; then
    systemctl reload nginx
else
    systemctl start nginx
fi

# Verify
sleep 1
if systemctl is-active nginx >/dev/null 2>&1; then
    echo "SUCCESS: Nginx is running with passthrough for $DOMAIN"
else
    echo "ERROR: Nginx failed to start"
    journalctl -u nginx --no-pager -n 10
    exit 1
fi
`, Timeout: 300},
		},
	},

	// ==================== PHP RUNTIME TEMPLATES ====================

	"install_php_runtime": {
		ID:          "install_php_runtime",
		Name:        "Install PHP Runtime",
		Description: "Install PHP-FPM with Ondřej Surý's PPA for specific version and extensions",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Type: "string", Required: true, Description: "PHP version (8.0, 8.1, 8.2, 8.3, 8.4)"},
			{Name: "extensions", Type: "text", Required: false, Default: "mysqli,curl,mbstring,xml,zip", Description: "Comma-separated list of extensions"},
		},
		OnError: "stop",
		Steps: []Step{
			// Add Ondřej's PPA
			{Action: "exec", Command: "apt-get update && apt-get install -y software-properties-common", Timeout: 120},
			{Action: "exec", Command: "add-apt-repository -y ppa:ondrej/php", Timeout: 60},
			{Action: "exec", Command: "apt-get update", Timeout: 120},
			// Install PHP-FPM and CLI
			{Action: "exec", Command: "apt-get install -y php{{version}}-fpm php{{version}}-cli php{{version}}-common", Timeout: 300},
			// Install extensions
			{Action: "exec", Command: `
VERSION="{{version}}"
EXTENSIONS="{{extensions}}"

# Parse comma-separated extensions and install
for ext in $(echo "$EXTENSIONS" | tr ',' ' '); do
    ext=$(echo "$ext" | tr -d ' ')
    if [ -n "$ext" ]; then
        echo "Installing php${VERSION}-${ext}..."
        apt-get install -y "php${VERSION}-${ext}" 2>/dev/null || echo "Warning: php${VERSION}-${ext} not available"
    fi
done
`, Timeout: 600, Log: "php{{version}} -m"},
			// Enable and start PHP-FPM
			{Action: "exec", Command: "systemctl enable php{{version}}-fpm", Timeout: 30},
			{Action: "exec", Command: "systemctl restart php{{version}}-fpm", Timeout: 60},
			// Set as default PHP version
			{Action: "exec", Command: "update-alternatives --set php /usr/bin/php{{version}} 2>/dev/null || true", Timeout: 30},
		},
	},

	"remove_php_runtime": {
		ID:          "remove_php_runtime",
		Name:        "Remove PHP Runtime",
		Description: "Remove PHP-FPM installation for a specific version",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Type: "string", Required: true, Description: "PHP version to remove"},
		},
		OnError: "continue",
		Steps: []Step{
			{Action: "exec", Command: "systemctl stop php{{version}}-fpm 2>/dev/null || true", Timeout: 30},
			{Action: "exec", Command: "systemctl disable php{{version}}-fpm 2>/dev/null || true", Timeout: 30},
			{Action: "exec", Command: "apt-get remove -y 'php{{version}}-*'", Timeout: 300},
			{Action: "exec", Command: "apt-get autoremove -y", Timeout: 120},
		},
	},

	"switch_php_version": {
		ID:          "switch_php_version",
		Name:        "Switch PHP Version",
		Description: "Switch to a different PHP version (must be already installed)",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Type: "string", Required: true, Description: "PHP version to switch to"},
		},
		OnError: "stop",
		Steps: []Step{
			// Check if target version is installed
			{Action: "exec", Command: "dpkg -l | grep php{{version}}-fpm || (echo 'PHP {{version}} not installed' && exit 1)", Timeout: 30},
			// Set as default
			{Action: "exec", Command: "update-alternatives --set php /usr/bin/php{{version}} 2>/dev/null || true", Timeout: 30},
			// Restart FPM
			{Action: "exec", Command: "systemctl restart php{{version}}-fpm", Timeout: 60, Log: "php -v"},
		},
	},

	"get_php_runtime_info": {
		ID:          "get_php_runtime_info",
		Name:        "Get PHP Runtime Info",
		Description: "Get information about installed PHP runtime",
		Category:    "php",
		Variables:   []VariableDef{},
		OnError:     "continue",
		Steps: []Step{
			{Action: "exec", Command: `
echo "=== PHP Version ==="
php -v 2>/dev/null || echo "PHP not installed"
echo ""
echo "=== Installed PHP Versions ==="
ls -1 /usr/bin/php* 2>/dev/null | grep -E 'php[0-9]+\.[0-9]+$' || echo "No PHP versions found"
echo ""
echo "=== Active PHP-FPM Services ==="
systemctl list-units --type=service | grep php.*fpm || echo "No PHP-FPM services"
echo ""
echo "=== PHP-FPM Sockets ==="
ls -la /run/php/*.sock 2>/dev/null || echo "No PHP-FPM sockets"
echo ""
echo "=== Loaded Extensions ==="
php -m 2>/dev/null | head -50 || echo "Cannot list extensions"
`, Timeout: 60},
		},
	},

	"install_php_extension": {
		ID:          "install_php_extension",
		Name:        "Install PHP Extension",
		Description: "Install a PHP extension for a specific version",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Type: "string", Required: true, Description: "PHP version"},
			{Name: "extension", Type: "string", Required: true, Description: "Extension name"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: "apt-get update", Timeout: 120},
			{Action: "exec", Command: "apt-get install -y php{{version}}-{{extension}}", Timeout: 300},
			{Action: "exec", Command: "systemctl restart php{{version}}-fpm", Timeout: 60, Log: "php{{version}} -m | grep -i {{extension}}"},
		},
	},

	"remove_php_extension": {
		ID:          "remove_php_extension",
		Name:        "Remove PHP Extension",
		Description: "Remove a PHP extension for a specific version",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Type: "string", Required: true, Description: "PHP version"},
			{Name: "extension", Type: "string", Required: true, Description: "Extension name"},
		},
		OnError: "continue",
		Steps: []Step{
			{Action: "exec", Command: "apt-get remove -y php{{version}}-{{extension}}", Timeout: 300},
			{Action: "exec", Command: "systemctl restart php{{version}}-fpm", Timeout: 60},
		},
	},

	"get_php_fpm_status": {
		ID:          "get_php_fpm_status",
		Name:        "Get PHP-FPM Status",
		Description: "Check PHP-FPM service status and configuration",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Type: "string", Required: true, Description: "PHP version"},
		},
		OnError: "continue",
		Steps: []Step{
			{Action: "exec", Command: "systemctl status php{{version}}-fpm --no-pager", Timeout: 30},
			{Action: "exec", Command: "ls -la /run/php/php{{version}}-fpm.sock 2>/dev/null || echo 'Socket not found'", Timeout: 10},
			{Action: "exec", Command: "cat /etc/php/{{version}}/fpm/pool.d/www.conf | grep -E '^(listen|pm\\.|user|group)' 2>/dev/null || echo 'Config not found'", Timeout: 30},
		},
	},

	"configure_php_fpm_pool": {
		ID:          "configure_php_fpm_pool",
		Name:        "Configure PHP-FPM Pool",
		Description: "Configure PHP-FPM pool settings",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Type: "string", Required: true, Description: "PHP version"},
			{Name: "max_children", Type: "int", Required: false, Default: "5", Description: "Max children processes"},
			{Name: "start_servers", Type: "int", Required: false, Default: "2", Description: "Start servers"},
			{Name: "min_spare_servers", Type: "int", Required: false, Default: "1", Description: "Min spare servers"},
			{Name: "max_spare_servers", Type: "int", Required: false, Default: "3", Description: "Max spare servers"},
		},
		OnError: "rollback",
		Steps: []Step{
			{Action: "file", Op: "backup", Path: "/etc/php/{{version}}/fpm/pool.d/www.conf"},
			{Action: "exec", Command: `
VERSION="{{version}}"
POOL_CONF="/etc/php/${VERSION}/fpm/pool.d/www.conf"

sed -i 's/^pm.max_children.*/pm.max_children = {{max_children}}/' "$POOL_CONF"
sed -i 's/^pm.start_servers.*/pm.start_servers = {{start_servers}}/' "$POOL_CONF"
sed -i 's/^pm.min_spare_servers.*/pm.min_spare_servers = {{min_spare_servers}}/' "$POOL_CONF"
sed -i 's/^pm.max_spare_servers.*/pm.max_spare_servers = {{max_spare_servers}}/' "$POOL_CONF"
`, Timeout: 30},
			{Action: "exec", Command: "php-fpm{{version}} -t", Timeout: 30},
			{Action: "exec", Command: "systemctl restart php{{version}}-fpm", Timeout: 60},
		},
	},

	// ==================== SPEED TEST TOOLS ====================

	"speedtest_public": {
		ID:          "speedtest_public",
		Name:        "Public Speedtest",
		Description: "Run a public internet speed test using speedtest-cli",
		Category:    "tools",
		Variables:   []VariableDef{},
		OnError:     "stop",
		Steps: []Step{
			{Action: "exec", Command: `
# Check if speedtest is installed, if not install it
if ! command -v speedtest &> /dev/null && ! command -v speedtest-cli &> /dev/null; then
    echo "Installing speedtest-cli..."
    apt-get update >/dev/null 2>&1
    apt-get install -y speedtest-cli >/dev/null 2>&1 || pip3 install speedtest-cli 2>/dev/null
fi

# Try speedtest (ookla) first, then speedtest-cli
if command -v speedtest &> /dev/null; then
    speedtest --accept-license --accept-gdpr 2>/dev/null || speedtest
elif command -v speedtest-cli &> /dev/null; then
    speedtest-cli --simple
else
    echo "ERROR: speedtest not available"
    exit 1
fi
`, Timeout: 120},
		},
	},

	"speedtest_download": {
		ID:          "speedtest_download",
		Name:        "Download Speed Test",
		Description: "Test download speed from a URL",
		Category:    "tools",
		Variables: []VariableDef{
			{Name: "url", Type: "string", Required: true, Description: "URL to download from"},
			{Name: "size_mb", Type: "int", Required: false, Default: "100", Description: "Expected file size in MB (for reference)"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `
URL="{{url}}"
echo "Testing download speed from: $URL"
echo "=========================================="

# Use curl with progress and timing
START=$(date +%s.%N)
RESULT=$(curl -w "\nDownload Size: %{size_download} bytes\nTime: %{time_total}s\nSpeed: %{speed_download} bytes/sec\n" -o /dev/null -L --max-time 120 "$URL" 2>&1)
END=$(date +%s.%N)

echo "$RESULT"

# Parse and display in human-readable format
SPEED_BPS=$(echo "$RESULT" | grep "Speed:" | awk '{print $2}')
if [ -n "$SPEED_BPS" ]; then
    SPEED_MBPS=$(echo "scale=2; $SPEED_BPS * 8 / 1000000" | bc 2>/dev/null || echo "N/A")
    echo ""
    echo "=========================================="
    echo "Download Speed: $SPEED_MBPS Mbps"
fi
`, Timeout: 180},
		},
	},

	"speedtest_upload": {
		ID:          "speedtest_upload",
		Name:        "Upload Speed Test",
		Description: "Test upload speed to a URL (using temp.sh or custom endpoint)",
		Category:    "tools",
		Variables: []VariableDef{
			{Name: "url", Type: "string", Required: false, Default: "https://temp.sh/upload", Description: "URL to upload to"},
			{Name: "size_mb", Type: "int", Required: false, Default: "10", Description: "Size of test file in MB"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `
URL="{{url}}"
SIZE_MB="{{size_mb}}"
echo "Testing upload speed to: $URL"
echo "Test file size: ${SIZE_MB}MB"
echo "=========================================="

# Create test file
TEST_FILE="/tmp/speedtest_upload_$$"
dd if=/dev/urandom of="$TEST_FILE" bs=1M count=$SIZE_MB 2>/dev/null

# Upload and measure
START=$(date +%s.%N)
if [ "$URL" = "https://temp.sh/upload" ] || [[ "$URL" == *"temp.sh"* ]]; then
    # temp.sh uses PUT method
    RESULT=$(curl -w "\nUpload Size: %{size_upload} bytes\nTime: %{time_total}s\nSpeed: %{speed_upload} bytes/sec\n" \
        -X PUT -T "$TEST_FILE" --max-time 120 "$URL" 2>&1)
else
    # Regular POST upload
    RESULT=$(curl -w "\nUpload Size: %{size_upload} bytes\nTime: %{time_total}s\nSpeed: %{speed_upload} bytes/sec\n" \
        -X POST -F "file=@$TEST_FILE" --max-time 120 "$URL" 2>&1)
fi
END=$(date +%s.%N)

rm -f "$TEST_FILE"

echo "$RESULT"

# Parse and display in human-readable format
SPEED_BPS=$(echo "$RESULT" | grep "Speed:" | awk '{print $2}')
if [ -n "$SPEED_BPS" ]; then
    SPEED_MBPS=$(echo "scale=2; $SPEED_BPS * 8 / 1000000" | bc 2>/dev/null || echo "N/A")
    echo ""
    echo "=========================================="
    echo "Upload Speed: $SPEED_MBPS Mbps"
fi
`, Timeout: 300},
		},
	},

	"speedtest_machine_download": {
		ID:          "speedtest_machine_download",
		Name:        "Machine-to-Machine Download Test",
		Description: "Test download speed from another machine",
		Category:    "tools",
		Variables: []VariableDef{
			{Name: "source_ip", Type: "string", Required: true, Description: "Source machine IP address"},
			{Name: "port", Type: "int", Required: false, Default: "8765", Description: "Port to use for test"},
			{Name: "size_mb", Type: "int", Required: false, Default: "100", Description: "Size of test file in MB"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `
SOURCE_IP="{{source_ip}}"
PORT="{{port}}"
SIZE_MB="{{size_mb}}"
echo "Testing download speed from: $SOURCE_IP:$PORT"
echo "Test file size: ${SIZE_MB}MB"
echo "=========================================="

# Download from source machine
START=$(date +%s.%N)
RESULT=$(curl -w "\nDownload Size: %{size_download} bytes\nTime: %{time_total}s\nSpeed: %{speed_download} bytes/sec\n" \
    -o /dev/null --max-time 120 "http://$SOURCE_IP:$PORT/speedtest" 2>&1)
END=$(date +%s.%N)

echo "$RESULT"

# Parse and display in human-readable format
SPEED_BPS=$(echo "$RESULT" | grep "Speed:" | awk '{print $2}')
if [ -n "$SPEED_BPS" ]; then
    SPEED_MBPS=$(echo "scale=2; $SPEED_BPS * 8 / 1000000" | bc 2>/dev/null || echo "N/A")
    echo ""
    echo "=========================================="
    echo "Download Speed: $SPEED_MBPS Mbps"
fi
`, Timeout: 180},
		},
	},

	"speedtest_serve": {
		ID:          "speedtest_serve",
		Name:        "Start Speed Test Server",
		Description: "Start a temporary HTTP server for speed tests",
		Category:    "tools",
		Variables: []VariableDef{
			{Name: "port", Type: "int", Required: false, Default: "8765", Description: "Port to listen on"},
			{Name: "size_mb", Type: "int", Required: false, Default: "100", Description: "Size of test file in MB"},
			{Name: "duration", Type: "int", Required: false, Default: "60", Description: "How long to serve in seconds"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `
PORT="{{port}}"
SIZE_MB="{{size_mb}}"
DURATION="{{duration}}"

echo "Starting speed test server on port $PORT for $DURATION seconds..."
echo "Test file size: ${SIZE_MB}MB"

# Create test file
TEST_DIR="/tmp/speedtest_serve_$$"
mkdir -p "$TEST_DIR"
dd if=/dev/urandom of="$TEST_DIR/speedtest" bs=1M count=$SIZE_MB 2>/dev/null

# Check if python3 is available
if command -v python3 &> /dev/null; then
    cd "$TEST_DIR"
    timeout $DURATION python3 -m http.server $PORT 2>&1 &
    SERVER_PID=$!
    echo "Server started with PID $SERVER_PID"
    echo "Clients can download from: http://$(hostname -I | awk '{print $1}'):$PORT/speedtest"
    
    # Wait for timeout
    sleep $DURATION
    kill $SERVER_PID 2>/dev/null
else
    echo "ERROR: python3 not available"
    rm -rf "$TEST_DIR"
    exit 1
fi

rm -rf "$TEST_DIR"
echo "Server stopped"
`, Timeout: 300},
		},
	},

	"speedtest_iperf_server": {
		ID:          "speedtest_iperf_server",
		Name:        "Start iPerf3 Server",
		Description: "Start an iPerf3 server for network bandwidth testing",
		Category:    "tools",
		Variables: []VariableDef{
			{Name: "port", Type: "int", Required: false, Default: "5201", Description: "Port to listen on"},
			{Name: "duration", Type: "int", Required: false, Default: "60", Description: "How long to serve in seconds"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `
PORT="{{port}}"
DURATION="{{duration}}"

# Install iperf3 if not available
if ! command -v iperf3 &> /dev/null; then
    echo "Installing iperf3..."
    apt-get update >/dev/null 2>&1
    apt-get install -y iperf3 >/dev/null 2>&1
fi

echo "Starting iPerf3 server on port $PORT for $DURATION seconds..."
echo "Connect with: iperf3 -c $(hostname -I | awk '{print $1}') -p $PORT"

# Run server for specified duration
timeout $DURATION iperf3 -s -p $PORT 2>&1 || true

echo "iPerf3 server stopped"
`, Timeout: 300},
		},
	},

	"speedtest_iperf_client": {
		ID:          "speedtest_iperf_client",
		Name:        "Run iPerf3 Client",
		Description: "Run iPerf3 client to test bandwidth to a server",
		Category:    "tools",
		Variables: []VariableDef{
			{Name: "server_ip", Type: "string", Required: true, Description: "iPerf3 server IP address"},
			{Name: "port", Type: "int", Required: false, Default: "5201", Description: "Server port"},
			{Name: "duration", Type: "int", Required: false, Default: "10", Description: "Test duration in seconds"},
			{Name: "reverse", Type: "bool", Required: false, Default: "false", Description: "Reverse mode (download instead of upload)"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `
SERVER_IP="{{server_ip}}"
PORT="{{port}}"
DURATION="{{duration}}"
REVERSE="{{reverse}}"

# Install iperf3 if not available
if ! command -v iperf3 &> /dev/null; then
    echo "Installing iperf3..."
    apt-get update >/dev/null 2>&1
    apt-get install -y iperf3 >/dev/null 2>&1
fi

echo "Running iPerf3 test to $SERVER_IP:$PORT..."
echo "Duration: ${DURATION}s"
echo "Mode: $([ "$REVERSE" = "true" ] && echo "Download (reverse)" || echo "Upload")"
echo "=========================================="

if [ "$REVERSE" = "true" ]; then
    iperf3 -c "$SERVER_IP" -p "$PORT" -t "$DURATION" -R
else
    iperf3 -c "$SERVER_IP" -p "$PORT" -t "$DURATION"
fi
`, Timeout: 120},
		},
	},

	"speedtest_latency": {
		ID:          "speedtest_latency",
		Name:        "Latency Test",
		Description: "Test network latency to a host",
		Category:    "tools",
		Variables: []VariableDef{
			{Name: "host", Type: "string", Required: true, Description: "Host to ping (IP or domain)"},
			{Name: "count", Type: "int", Required: false, Default: "10", Description: "Number of ping packets"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `
HOST="{{host}}"
COUNT="{{count}}"

echo "Testing latency to: $HOST"
echo "Sending $COUNT packets..."
echo "=========================================="

ping -c $COUNT "$HOST" 2>&1
`, Timeout: 60},
		},
	},

	"network_info": {
		ID:          "network_info",
		Name:        "Network Information",
		Description: "Get network interface and routing information",
		Category:    "tools",
		Variables:   []VariableDef{},
		OnError:     "continue",
		Steps: []Step{
			{Action: "exec", Command: `
echo "=== Network Interfaces ==="
ip -br addr 2>/dev/null || ifconfig -a 2>/dev/null || echo "Cannot get interfaces"

echo ""
echo "=== Public IP ==="
curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 icanhazip.com 2>/dev/null || echo "Cannot get public IP"

echo ""
echo "=== Default Gateway ==="
ip route | grep default 2>/dev/null || route -n | grep UG 2>/dev/null || echo "Cannot get gateway"

echo ""
echo "=== DNS Servers ==="
cat /etc/resolv.conf 2>/dev/null | grep nameserver || echo "Cannot get DNS"

echo ""
echo "=== Open Ports ==="
ss -tlnp 2>/dev/null | head -20 || netstat -tlnp 2>/dev/null | head -20 || echo "Cannot get ports"
`, Timeout: 30},
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
