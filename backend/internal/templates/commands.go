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
		Description: "Remove nginx configuration for a domain (both HTTP and passthrough)",
		Category:    "domains",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name to remove"},
		},
		OnError: "continue",
		Steps: []Step{
			// Remove HTTP config
			{Action: "exec", Command: "rm -f /etc/nginx/conf.d/configuratix/{{domain}}.conf", Timeout: 10},
			// Remove passthrough/stream config
			{Action: "exec", Command: "rm -f /etc/nginx/stream.d/{{domain}}.conf", Timeout: 10},
			{Action: "exec", Command: "nginx -t 2>&1 || true", Timeout: 30},
			{Action: "service", Name: "nginx", Op: "reload"},
		},
	},

	"apply_passthrough_domain": {
		ID:          "apply_passthrough_domain",
		Name:        "Apply Passthrough Domain",
		Description: "Configure SSL passthrough (Layer 4) for a domain using nginx stream module with PROXY Protocol",
		Category:    "domains",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			{Name: "target", Type: "string", Required: true, Description: "Backend target (host:port)"},
		},
		OnError: "stop",
		Steps: []Step{
			// Create directories
			{Action: "exec", Command: "mkdir -p /etc/nginx/stream.d /etc/nginx/conf.d/configuratix", Timeout: 10},
			// Remove any existing HTTP config for this domain (switching from HTTP to passthrough)
			{Action: "exec", Command: "rm -f /etc/nginx/conf.d/configuratix/{{domain}}.conf", Timeout: 10},
			// Ensure nginx stream module is available and working
			{Action: "exec", Command: `
NGINX_CONF="/etc/nginx/nginx.conf"

echo "=== Checking nginx stream module ==="

# Check if module is already loaded via modules-enabled (Ubuntu/Debian style)
MODULE_ALREADY_LOADED=false
if [ -f /etc/nginx/modules-enabled/50-mod-stream.conf ] || \
   ls /etc/nginx/modules-enabled/*stream* 2>/dev/null | grep -q .; then
    echo "Stream module is auto-loaded via modules-enabled"
    MODULE_ALREADY_LOADED=true
fi

# Remove any duplicate load_module directives we may have added previously
if grep -q "^load_module.*ngx_stream_module" "$NGINX_CONF"; then
    if [ "$MODULE_ALREADY_LOADED" = true ]; then
        echo "Removing duplicate load_module directive (module already loaded via modules-enabled)..."
        sed -i '/^load_module.*ngx_stream_module/d' "$NGINX_CONF"
    fi
fi

# Test if stream works
TEST_RESULT=$(nginx -t 2>&1)
if echo "$TEST_RESULT" | grep -q "unknown directive.*stream"; then
    echo "Stream module not available, need to install..."
    
    # Check if dynamic module exists but not loaded
    if [ -f /usr/lib/nginx/modules/ngx_stream_module.so ] && [ "$MODULE_ALREADY_LOADED" = false ]; then
        if ! grep -q "load_module.*ngx_stream_module" "$NGINX_CONF"; then
            echo "Adding stream module load directive..."
            sed -i '1i load_module /usr/lib/nginx/modules/ngx_stream_module.so;' "$NGINX_CONF"
        fi
    else
        echo "Installing nginx with stream support..."
        apt-get update
        
        # Try libnginx-mod-stream first (smallest)
        if apt-cache show libnginx-mod-stream >/dev/null 2>&1; then
            echo "Installing libnginx-mod-stream..."
            DEBIAN_FRONTEND=noninteractive apt-get install -y libnginx-mod-stream
        elif apt-cache show nginx-extras >/dev/null 2>&1; then
            echo "Installing nginx-extras..."
            DEBIAN_FRONTEND=noninteractive apt-get install -y nginx-extras
        elif apt-cache show nginx-full >/dev/null 2>&1; then
            echo "Installing nginx-full..."
            DEBIAN_FRONTEND=noninteractive apt-get install -y nginx-full
        else
            echo "ERROR: Cannot find nginx stream module package"
            exit 1
        fi
    fi
elif echo "$TEST_RESULT" | grep -q "already loaded"; then
    echo "Duplicate module load detected, cleaning up..."
    # Remove manual load_module if modules-enabled handles it
    sed -i '/^load_module.*ngx_stream_module/d' "$NGINX_CONF"
fi

# Final verification
if nginx -t 2>&1 | grep -q "unknown directive.*stream"; then
    echo "ERROR: Stream module still not working"
    exit 1
fi

echo "Nginx stream module is ready"
`, Timeout: 300},
			// Ensure nginx.conf includes stream.d directory
			{Action: "exec", Command: `
NGINX_CONF="/etc/nginx/nginx.conf"
STREAM_INCLUDE="include /etc/nginx/stream.d/*.conf;"

# Check if stream block exists (handle various formats)
if grep -qE "^stream\s*\{" "$NGINX_CONF"; then
    # Stream block exists, ensure it has the include
    if ! grep -q "include /etc/nginx/stream.d" "$NGINX_CONF"; then
        sed -i '/^stream\s*{/a\    '"$STREAM_INCLUDE"'' "$NGINX_CONF"
        echo "Added stream.d include to existing stream block"
    else
        echo "Stream block with include already exists"
    fi
else
    # Add stream block at the end of the file
    echo "" >> "$NGINX_CONF"
    echo "# SSL Passthrough configuration (Configuratix)" >> "$NGINX_CONF"
    echo "stream {" >> "$NGINX_CONF"
    echo "    $STREAM_INCLUDE" >> "$NGINX_CONF"
    echo "}" >> "$NGINX_CONF"
    echo "Added stream block to nginx.conf"
fi
`, Timeout: 30},
			// Write stream config for this domain (just a marker file)
			{Action: "file", Op: "write", Path: "/etc/nginx/stream.d/{{domain}}.conf", Mode: "0644", Content: `# SSL Passthrough marker for {{domain}}
# Actual routing is in 00-sni-map.conf
# Target: {{target}}
# PROXY Protocol: enabled (backend must listen with proxy_protocol)
`},
			// Create/update the SNI map configuration for HTTPS (SSL passthrough)
			{Action: "exec", Command: `
STREAM_MAP="/etc/nginx/stream.d/00-sni-map.conf"
DOMAIN="{{domain}}"
TARGET="{{target}}"

# Extract host and port from target
TARGET_HOST=$(echo "$TARGET" | cut -d: -f1)
TARGET_PORT=$(echo "$TARGET" | cut -d: -f2)
# Default to 443 if no port specified
if [ "$TARGET_PORT" = "$TARGET_HOST" ]; then
    TARGET_PORT="443"
fi

# Create or update SNI map file with PROXY Protocol support (HTTPS only)
if [ ! -f "$STREAM_MAP" ]; then
    cat > "$STREAM_MAP" << 'MAPEOF'
# SNI-based routing for SSL passthrough with PROXY Protocol
# Auto-generated by Configuratix
#
# NOTE: HTTP (port 80) is handled via regular nginx http block (conf.d)
# This only handles HTTPS (port 443) via stream/SNI routing

map $ssl_preread_server_name $passthrough_backend {
    default "";
}

server {
    listen 443;
    ssl_preread on;
    
    proxy_pass $passthrough_backend;
    proxy_protocol on;
    proxy_connect_timeout 5s;
    proxy_timeout 300s;
}
MAPEOF
fi

# Add/update this domain in the map
sed -i "/^    \"*$DOMAIN\"* /d" "$STREAM_MAP"
sed -i "/^    $DOMAIN /d" "$STREAM_MAP"
sed -i "/default \"\";/i\\    $DOMAIN $TARGET_HOST:$TARGET_PORT;" "$STREAM_MAP"

echo "Updated stream SNI map for $DOMAIN -> $TARGET_HOST:$TARGET_PORT"
`, Timeout: 30, Log: "cat /etc/nginx/stream.d/00-sni-map.conf"},
			// Create HTTP proxy config (for certbot and redirects) - uses regular nginx http block
			{Action: "exec", Command: `
DOMAIN="{{domain}}"
TARGET="{{target}}"
HTTP_CONF="/etc/nginx/conf.d/configuratix/${DOMAIN}.conf"

# Extract host from target
TARGET_HOST=$(echo "$TARGET" | cut -d: -f1)

# Create HTTP proxy config (Layer 7 - can read Host header)
cat > "$HTTP_CONF" << EOF
# HTTP Proxy for passthrough domain: $DOMAIN
# Auto-generated by Configuratix
#
# This proxies HTTP traffic (port 80) to the backend for:
# - Certbot HTTP-01 challenges
# - HTTP to HTTPS redirects (handled by backend)
#
# IMPORTANT: Backend must accept PROXY Protocol on port 80:
#   listen 80 proxy_protocol;
#   set_real_ip_from 0.0.0.0/0;
#   real_ip_header proxy_protocol;

server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://$TARGET_HOST:80;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # For PROXY Protocol support (optional, requires nginx compiled with realip)
        # proxy_protocol on;
    }
}
EOF

echo "Created HTTP proxy config: $HTTP_CONF"
`, Timeout: 30, Log: "cat /etc/nginx/conf.d/configuratix/{{domain}}.conf"},
			// Test nginx config
			{Action: "exec", Command: "nginx -t", Timeout: 30},
			// Reload nginx
			{Action: "exec", Command: "systemctl is-active nginx >/dev/null 2>&1 && systemctl reload nginx || systemctl start nginx", Timeout: 30, Log: "systemctl status nginx --no-pager | head -5"},
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
