package templates

// Transactional configuration templates.
//
// These templates only use exec/file steps with on_error "stop", so they behave identically on
// old (0.5.x) and new agents. Every script:
//   - writes new content to a staging file first (/var/lib/configuratix/staging/<txn>/...)
//   - records the current state of every file it will touch in /var/lib/configuratix/backups/<txn>/
//   - atomically installs the new file(s), runs the service config test (nginx -t, php-fpm -t)
//   - on any failure restores the recorded state, re-tests, keeps the service running and prints
//     "CONFIGURATIX_RESULT|rolled_back|<reason>" before exiting non-zero
//   - on success prints "CONFIGURATIX_RESULT|applied" (or "removed")
// Additional markers: "CONFIGURATIX_DISABLED|<path>|<reason>" and "CONFIGURATIX_REENABLED|<path>".

const stagingPrefix = "/var/lib/configuratix/staging/{{txn}}/"

// certCheckShell defines cfx_conf_certs_ok FILE: fails (and sets CFX_MISSING_CERT) when any
// literal ssl_certificate / ssl_certificate_key path in FILE does not exist.
const certCheckShell = `
cfx_conf_certs_ok() {
    local cert
    CFX_MISSING_CERT=""
    for cert in $(grep -oP '^\s*ssl_certificate(_key)?\s+\K[^;]+' "$1" 2>/dev/null || true); do
        case "$cert" in *'$'*) continue ;; esac
        cert="${cert%\"}"; cert="${cert#\"}"
        if [ ! -f "$cert" ]; then
            CFX_MISSING_CERT="$cert"
            return 1
        fi
    done
    return 0
}
`

// reenableDisabledShell re-enables *.conf.disabled files (created by earlier apply runs) whose
// certificates now exist; reverts them again if they break nginx -t. Expects CONFIG_PATH.
const reenableDisabledShell = `
CFX_REENABLED=""
for disabled in /etc/nginx/conf.d/configuratix/*.conf.disabled /etc/nginx/conf.d/*.conf.disabled; do
    [ -f "$disabled" ] || continue
    [ "$disabled" = "$CONFIG_PATH.disabled" ] && continue
    orig="${disabled%.disabled}"
    [ -e "$orig" ] && continue
    if cfx_conf_certs_ok "$disabled"; then
        cfx_backup "$disabled" "$orig"
        mv -f -- "$disabled" "$orig"
        CFX_REENABLED="$CFX_REENABLED $orig"
        echo "Re-enabled $orig (certificates now present)"
    fi
done
if [ -n "$CFX_REENABLED" ]; then
    if nginx -t >/dev/null 2>&1; then
        for orig in $CFX_REENABLED; do echo "CONFIGURATIX_REENABLED|$orig"; done
    else
        echo "WARNING: re-enabled configs break nginx -t, disabling them again"
        for orig in $CFX_REENABLED; do mv -f -- "$orig" "$orig.disabled"; done
    fi
fi
`

// disableMissingCertsShell disables other configs whose certificates are missing so that one
// broken site cannot block the apply. Reported via CONFIGURATIX_DISABLED markers. Expects CONFIG_PATH.
const disableMissingCertsShell = `
for conf in /etc/nginx/conf.d/configuratix/*.conf /etc/nginx/conf.d/*.conf; do
    [ -f "$conf" ] || continue
    [ "$conf" = "$CONFIG_PATH" ] && continue
    if ! cfx_conf_certs_ok "$conf"; then
        cfx_backup "$conf" "$conf.disabled"
        mv -f -- "$conf" "$conf.disabled"
        echo "WARNING: disabled $conf (missing certificate $CFX_MISSING_CERT)"
        echo "CONFIGURATIX_DISABLED|$conf|missing certificate $CFX_MISSING_CERT"
    fi
done
`

const activateNginxShell = `
cfx_nginx_test || exit 1
if ! cfx_nginx_up; then
    CFX_FAIL_REASON="nginx reload/start failed"
    exit 1
fi
CFX_NGINX_STOPPED=0
sleep 1
if ! systemctl is-active --quiet nginx; then
    CFX_FAIL_REASON="nginx is not running after reload"
    journalctl -u nginx --no-pager -n 10 2>/dev/null || true
    exit 1
fi
`

var applyDomainScript = `
DOMAIN='{{domain}}'
SSL_ENABLED='{{ssl_enabled}}'
SSL_EMAIL="$(printf '%s' '{{ssl_email}}' | base64 -d)"
CFX_TXN='{{txn}}'
` + TxnShellLib + certCheckShell + `
trap cfx_txn_trap EXIT
set -e

CONF_DIR="/etc/nginx/conf.d/configuratix"
CONFIG_PATH="$CONF_DIR/$DOMAIN.conf"
STAGED="$CFX_STAGING_DIR/$DOMAIN.conf"
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

echo "=== Apply nginx config for $DOMAIN (txn $CFX_TXN) ==="
if [ ! -s "$STAGED" ]; then
    CFX_TXN_RESTORE=0
    CFX_FAIL_REASON="staged config $STAGED is missing or empty"
    exit 1
fi
mkdir -p "$CONF_DIR"
` + ensureNginxBansSnippetCommand + `
cfx_backup "$CONFIG_PATH" "$CONFIG_PATH.disabled" "$CONFIG_PATH.bak"
` + reenableDisabledShell + `
if [ "$SSL_ENABLED" = "true" ] && [ ! -f "$CERT_PATH" ]; then
    echo "=== Issuing SSL certificate for $DOMAIN (certbot standalone) ==="
    case "$DOMAIN" in
        '*.'*)
            CFX_FAIL_REASON="wildcard certificate for $DOMAIN cannot be issued with HTTP validation; place it at $CERT_PATH (DNS-01) or disable SSL"
            exit 1 ;;
    esac
    if ! command -v certbot >/dev/null 2>&1; then
        CFX_FAIL_REASON="certbot is not installed"
        exit 1
    fi
    # The current config may reference the missing certificate; it is backed up and restored on failure.
    rm -f -- "$CONFIG_PATH"
    CFX_NGINX_STOPPED=1
    systemctl stop nginx 2>/dev/null || true
    if [ -n "$SSL_EMAIL" ]; then
        set -- --email "$SSL_EMAIL"
    else
        set -- --register-unsafely-without-email
    fi
    # nginx is restarted by the EXIT trap (failure) or by the activation below (success).
    if ! certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos --no-eff-email "$@" --cert-name "$DOMAIN"; then
        CFX_FAIL_REASON="certbot failed to issue a certificate for $DOMAIN"
        exit 1
    fi
    echo "Certificate issued"
fi

cfx_install "$STAGED" "$CONFIG_PATH"
rm -f -- "$CONFIG_PATH.disabled" "$CONFIG_PATH.bak"
echo "Installed $CONFIG_PATH"
if ! cfx_conf_certs_ok "$CONFIG_PATH"; then
    CFX_FAIL_REASON="config references missing certificate $CFX_MISSING_CERT"
    exit 1
fi
` + disableMissingCertsShell + `
echo "Testing nginx configuration..."
` + activateNginxShell + `
systemctl status nginx --no-pager 2>/dev/null | head -5 || true
echo "Applied $CONFIG_PATH"
exit 0
`

var removeDomainScript = `
DOMAIN='{{domain}}'
CFX_TXN='{{txn}}'
` + TxnShellLib + `
trap cfx_txn_trap EXIT
set -e
CFX_SUCCESS_RESULT="removed"

STREAM_DIR="/etc/nginx/stream.d"
CONFIG_FILE="$STREAM_DIR/configuratix-passthrough-manual.conf"
HTTP_CONFIG_FILE="/etc/nginx/conf.d/configuratix/passthrough-manual-http.conf"
MARKER="$STREAM_DIR/passthrough-$DOMAIN.conf"
SITE="/etc/nginx/conf.d/configuratix/$DOMAIN.conf"
DNS_MGMT_CONFIG="$STREAM_DIR/configuratix-passthrough.conf"
DNS_MGMT_HTTP_CONFIG="/etc/nginx/conf.d/configuratix/passthrough-dns-http.conf"

echo "=== Remove domain $DOMAIN (txn $CFX_TXN) ==="
cfx_backup "$MARKER" "$SITE" "$SITE.disabled" "$SITE.bak" "$CONFIG_FILE" "$HTTP_CONFIG_FILE" \
    "$DNS_MGMT_CONFIG" "$DNS_MGMT_CONFIG.disabled-by-manual" \
    "$DNS_MGMT_HTTP_CONFIG" "$DNS_MGMT_HTTP_CONFIG.disabled-by-manual"
rm -f -- "$MARKER" "$SITE" "$SITE.disabled" "$SITE.bak"
echo "Removed nginx files for $DOMAIN"

if [ -f "$CONFIG_FILE" ] || [ -f "$HTTP_CONFIG_FILE" ] || ls "$STREAM_DIR"/passthrough-*.conf >/dev/null 2>&1; then
    # Regenerate the consolidated manual passthrough config from the remaining markers.
    (
` + passthroughRegenerateShell + `
    )
fi

echo "Testing nginx configuration..."
` + activateNginxShell + `
exit 0
`

// installStagedNginxScript installs one staged file at TARGET with backup/test/restore.
var installStagedNginxScript = `
CFX_TXN='{{txn}}'
` + TxnShellLib + `
trap cfx_txn_trap EXIT
set -e
echo "=== Install $TARGET (txn $CFX_TXN) ==="
if [ ! -f "$STAGED" ]; then
    CFX_TXN_RESTORE=0
    CFX_FAIL_REASON="staged file $STAGED is missing"
    exit 1
fi
` + ensureNginxBansSnippetCommand + `
cfx_backup "$TARGET"
cfx_install "$STAGED" "$TARGET"
echo "Installed $TARGET"
` + activateNginxShell + `
exit 0
`

var removeNginxConfigScript = `
DOMAIN='{{domain}}'
CFX_TXN='{{txn}}'
` + TxnShellLib + `
trap cfx_txn_trap EXIT
set -e
CFX_SUCCESS_RESULT="removed"
TARGET="/etc/nginx/conf.d/configuratix/$DOMAIN.conf"
cfx_backup "$TARGET"
rm -f -- "$TARGET"
echo "Removed $TARGET"
` + activateNginxShell + `
exit 0
`

var writePHPConfigScript = `
TARGET='{{path}}'
VERSION='{{version}}'
CFX_TXN='{{txn}}'
STAGED="/var/lib/configuratix/staging/$CFX_TXN/file"
` + TxnShellLib + `
trap cfx_txn_trap EXIT
set -e
echo "=== Install $TARGET (txn $CFX_TXN) ==="
if [ ! -f "$STAGED" ]; then
    CFX_TXN_RESTORE=0
    CFX_FAIL_REASON="staged file $STAGED is missing"
    exit 1
fi
cfx_backup "$TARGET"
cfx_install "$STAGED" "$TARGET"
php_fpm_test() {
    if command -v "php-fpm$VERSION" >/dev/null 2>&1; then
        if ! OUT="$("php-fpm$VERSION" -t 2>&1)"; then
            echo "$OUT"
            CFX_FAIL_REASON="php-fpm$VERSION -t failed: $(echo "$OUT" | grep -m1 -iE 'error' | tr '|' '/' | cut -c1-300)"
            return 1
        fi
        echo "$OUT"
    fi
    return 0
}
php_fpm_test || exit 1
if systemctl list-unit-files "php$VERSION-fpm.service" >/dev/null 2>&1; then
    if ! (systemctl reload "php$VERSION-fpm" || systemctl restart "php$VERSION-fpm"); then
        CFX_FAIL_REASON="php$VERSION-fpm reload failed"
        exit 1
    fi
fi
exit 0
`

var configurePHPPoolScript = `
VERSION='{{version}}'
CFX_TXN='{{txn}}'
` + TxnShellLib + `
trap cfx_txn_trap EXIT
set -e
POOL_CONF="/etc/php/${VERSION}/fpm/pool.d/www.conf"
if [ ! -f "$POOL_CONF" ]; then
    CFX_TXN_RESTORE=0
    CFX_FAIL_REASON="$POOL_CONF not found"
    exit 1
fi
cfx_backup "$POOL_CONF"
sed -i 's/^pm.max_children.*/pm.max_children = {{max_children}}/' "$POOL_CONF"
sed -i 's/^pm.start_servers.*/pm.start_servers = {{start_servers}}/' "$POOL_CONF"
sed -i 's/^pm.min_spare_servers.*/pm.min_spare_servers = {{min_spare_servers}}/' "$POOL_CONF"
sed -i 's/^pm.max_spare_servers.*/pm.max_spare_servers = {{max_spare_servers}}/' "$POOL_CONF"
if ! OUT="$("php-fpm$VERSION" -t 2>&1)"; then
    echo "$OUT"
    CFX_FAIL_REASON="php-fpm$VERSION -t failed"
    exit 1
fi
echo "$OUT"
if ! systemctl restart "php$VERSION-fpm"; then
    CFX_FAIL_REASON="php$VERSION-fpm restart failed"
    exit 1
fi
exit 0
`

var txnVar = VariableDef{Name: "txn", Type: "txn", Required: false, Description: "Transaction id (auto-generated)"}

func init() {
	add := func(t *CommandTemplate) { Commands[t.ID] = t }

	add(&CommandTemplate{
		ID:          "change_root_password",
		Name:        "Change Root Password",
		Description: "Change the root user password",
		Category:    "security",
		Variables: []VariableDef{
			{Name: "password", Type: "secret", Required: true, Description: "New root password"},
		},
		OnError: "stop",
		Steps: []Step{
			// The password travels base64-encoded and is decoded on the machine, so no shell metacharacter can escape.
			{Action: "exec", Command: `CFX_PW="$(printf '%s' '{{password}}' | base64 -d)" && printf 'root:%s\n' "$CFX_PW" | chpasswd && echo "Root password changed"`, Timeout: 30},
		},
	})

	add(&CommandTemplate{
		ID:          "toggle_fail2ban",
		Name:        "Toggle Fail2ban",
		Description: "Enable or disable Fail2ban service with optional config",
		Category:    "security",
		Variables: []VariableDef{
			{Name: "enabled", Type: "bool", Required: true, Description: "Enable (true) or disable (false)"},
			{Name: "config", Type: "b64", Required: false, Description: "Custom jail.local config (optional)"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `CFX_CFG='{{config}}'; if [ -n "$CFX_CFG" ]; then [ -f /etc/fail2ban/jail.local ] && cp -a /etc/fail2ban/jail.local /etc/fail2ban/jail.local.configuratix-backup; printf '%s' "$CFX_CFG" | base64 -d > /etc/fail2ban/jail.local; fi`, Timeout: 30},
			{Action: "exec", Command: `if [ '{{enabled}}' = "true" ]; then systemctl enable fail2ban && systemctl restart fail2ban; else systemctl stop fail2ban && systemctl disable fail2ban; fi`, Timeout: 60},
		},
	})

	add(&CommandTemplate{
		ID:          "apply_nginx_config",
		Name:        "Apply Nginx Config",
		Description: "Write nginx config for a domain, test it and reload (restores the previous config on failure)",
		Category:    "nginx",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			{Name: "config", Type: "text", Required: true, Description: "Nginx config content"},
			txnVar,
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "file", Op: "write", Path: stagingPrefix + "{{domain}}.conf", Content: "{{config}}", Mode: "0644"},
			{Action: "exec", Command: "DOMAIN='{{domain}}'\nTARGET=\"/etc/nginx/conf.d/configuratix/$DOMAIN.conf\"\nSTAGED=\"/var/lib/configuratix/staging/{{txn}}/$DOMAIN.conf\"\n" + installStagedNginxScript, Timeout: 120},
		},
	})

	add(&CommandTemplate{
		ID:          "remove_nginx_config",
		Name:        "Remove Nginx Config",
		Description: "Remove nginx config for a domain (restored if nginx test fails)",
		Category:    "nginx",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			txnVar,
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: removeNginxConfigScript, Timeout: 120},
		},
	})

	add(&CommandTemplate{
		ID:          "issue_ssl_cert",
		Name:        "Issue SSL Certificate",
		Description: "Issue SSL certificate via Certbot for a domain",
		Category:    "ssl",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			{Name: "email", Type: "b64", Required: false, Default: "", Description: "Email for Let's Encrypt notifications"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: `certbot --nginx -d '{{domain}}' --non-interactive --agree-tos --email "$(printf '%s' '{{email}}' | base64 -d)" --redirect || certbot --nginx -d '{{domain}}' --non-interactive --agree-tos --register-unsafely-without-email --redirect`, Timeout: 300},
		},
	})

	add(&CommandTemplate{
		ID:          "read_file",
		Name:        "Read File",
		Description: "Read content from a file",
		Category:    "files",
		Variables: []VariableDef{
			{Name: "path", Type: "string", Required: true, Description: "File path"},
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: "cat -- '{{path}}'", Timeout: 30},
		},
	})

	add(&CommandTemplate{
		ID:          "write_nginx_config",
		Name:        "Write Nginx Config",
		Description: "Write an nginx configuration file, test and reload (restores the previous file on failure)",
		Category:    "nginx",
		Variables: []VariableDef{
			{Name: "path", Type: "string", Required: true, Description: "Config file path"},
			{Name: "content", Type: "text", Required: true, Description: "Config content"},
			txnVar,
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "file", Op: "write", Path: stagingPrefix + "file", Content: "{{content}}", Mode: "0644"},
			{Action: "exec", Command: "TARGET='{{path}}'\nSTAGED=\"/var/lib/configuratix/staging/{{txn}}/file\"\n" + installStagedNginxScript, Timeout: 120},
		},
	})

	add(&CommandTemplate{
		ID:          "write_php_config",
		Name:        "Write PHP Config",
		Description: "Write a PHP/PHP-FPM configuration file, test with php-fpm -t and reload (restores on failure)",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "path", Type: "string", Required: true, Description: "Config file path under /etc/php"},
			{Name: "version", Type: "string", Required: true, Description: "PHP version (e.g. 8.3)"},
			{Name: "content", Type: "text", Required: true, Description: "Config content"},
			txnVar,
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "file", Op: "write", Path: stagingPrefix + "file", Content: "{{content}}", Mode: "0644"},
			{Action: "exec", Command: writePHPConfigScript, Timeout: 120},
		},
	})

	add(&CommandTemplate{
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
			{Action: "exec", Command: "mkdir -p '{{target_path}}'", Timeout: 10},
			{Action: "exec", Command: "find '{{target_path}}' -mindepth 1 -delete 2>/dev/null || true", Timeout: 30},
			{Action: "fetch", URL: "{{url}}", Path: "/tmp/landing_download.zip"},
			{Action: "exec", Command: "unzip -o /tmp/landing_download.zip -d '{{target_path}}'", Timeout: 60},
			{Action: "exec", Command: "rm -f /tmp/landing_download.zip", Timeout: 10},
			{Action: "exec", Command: "chown -R www-data:www-data '{{target_path}}'", Timeout: 30},
		},
	})

	add(&CommandTemplate{
		ID:          "apply_domain",
		Name:        "Apply Domain Configuration",
		Description: "Apply nginx config for a domain (issuing an SSL certificate if needed); restores the previous state if anything fails",
		Category:    "domains",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name"},
			{Name: "nginx_config", Type: "text", Required: true, Description: "Nginx configuration content"},
			{Name: "ssl_enabled", Type: "bool", Required: false, Default: "true", Description: "Whether SSL is enabled"},
			{Name: "ssl_email", Type: "b64", Required: false, Default: "admin@example.com", Description: "Email for SSL certificate"},
			txnVar,
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "file", Op: "write", Path: stagingPrefix + "{{domain}}.conf", Content: "{{nginx_config}}", Mode: "0644"},
			{Action: "exec", Command: applyDomainScript, Timeout: 420},
		},
	})

	add(&CommandTemplate{
		ID:          "remove_domain",
		Name:        "Remove Domain Configuration",
		Description: "Remove nginx configuration for a domain (both HTTP and passthrough) and regenerate consolidated config; restores on failure",
		Category:    "domains",
		Variables: []VariableDef{
			{Name: "domain", Type: "string", Required: true, Description: "Domain name to remove"},
			txnVar,
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: removeDomainScript, Timeout: 120},
		},
	})

	add(&CommandTemplate{
		ID:          "configure_php_fpm_pool",
		Name:        "Configure PHP-FPM Pool",
		Description: "Configure PHP-FPM pool settings (restores the previous pool config if php-fpm -t fails)",
		Category:    "php",
		Variables: []VariableDef{
			{Name: "version", Type: "string", Required: true, Description: "PHP version"},
			{Name: "max_children", Type: "int", Required: false, Default: "5", Description: "Max children processes"},
			{Name: "start_servers", Type: "int", Required: false, Default: "2", Description: "Start servers"},
			{Name: "min_spare_servers", Type: "int", Required: false, Default: "1", Description: "Min spare servers"},
			{Name: "max_spare_servers", Type: "int", Required: false, Default: "3", Description: "Max spare servers"},
			txnVar,
		},
		OnError: "stop",
		Steps: []Step{
			{Action: "exec", Command: configurePHPPoolScript, Timeout: 90},
		},
	})
}
