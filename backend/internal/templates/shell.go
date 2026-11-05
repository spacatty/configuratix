package templates

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/mail"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/idna"
)

// ShellQuote wraps a value in single quotes for safe interpolation into bash.
func ShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

var (
	fqdnRe       = regexp.MustCompile(`^(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$`)
	hostRe       = regexp.MustCompile(`^[A-Za-z0-9.:\[\]_-]{1,255}$`)
	phpVersionRe = regexp.MustCompile(`^[0-9]{1,2}\.[0-9]{1,2}$`)
	extensionRe  = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)
	extListRe    = regexp.MustCompile(`^[A-Za-z0-9_, ]*$`)
	safePathRe   = regexp.MustCompile(`^/[A-Za-z0-9._/@+*,=~-]*$`)
	serviceRe    = regexp.MustCompile(`^[A-Za-z0-9@._-]{1,128}$`)
	modeRe       = regexp.MustCompile(`^0?[0-7]{3,4}$`)
	sizeRe       = regexp.MustCompile(`^[0-9]+[kKmMgG]?$`)
	b64Re        = regexp.MustCompile(`^[A-Za-z0-9+/=]*$`)
	urlRe        = regexp.MustCompile(`^https?://[A-Za-z0-9._~:/?#\[\]@!&()*+,;=%-]+$`)
	txnRe        = regexp.MustCompile(`^[A-Za-z0-9_-]{8,80}$`)
	genericRe    = regexp.MustCompile(`^[^'"$` + "`" + `\\;|&<>(){}\n\r]*$`)
)

// ValidFQDN reports whether s is a syntactically valid (optionally wildcard) domain name.
func ValidFQDN(s string) bool { return len(s) <= 253 && fqdnRe.MatchString(s) }

// ValidHost reports whether s looks like an IP address or hostname (no shell metacharacters).
func ValidHost(s string) bool { return hostRe.MatchString(s) }

// ValidPort reports whether s is a TCP/UDP port number 1-65535.
func ValidPort(s string) bool {
	n, err := strconv.Atoi(s)
	return err == nil && n >= 1 && n <= 65535 && strconv.Itoa(n) == s
}

// CleanAbsPath cleans an absolute POSIX path and rejects anything that is not a plain safe path.
// It returns the cleaned path and false when the path is unsafe or not absolute.
func CleanAbsPath(p string) (string, bool) {
	if p == "" || !strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\x00\n\r") {
		return "", false
	}
	c := path.Clean(p)
	if !safePathRe.MatchString(c) {
		return "", false
	}
	return c, true
}

// NewTxnID returns a sortable unique transaction id used for backup/staging directories.
func NewTxnID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return time.Now().UTC().Format("20060102T150405Z") + "-" + hex.EncodeToString(b)
}

func isInt(s string) bool {
	if s == "" || len(s) > 9 {
		return false
	}
	_, err := strconv.Atoi(s)
	return err == nil && !strings.HasPrefix(s, "-")
}

func normBool(s string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1", "yes", "on":
		return "true", true
	case "false", "0", "no", "off", "":
		return "false", true
	}
	return "", false
}

// ValidationError is a user-facing validation failure (map it to HTTP 400).
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

func verr(field, format string, a ...interface{}) *ValidationError {
	return &ValidationError{Field: field, Message: fmt.Sprintf(format, a...)}
}

var idnaProfile = idna.New(idna.MapForLookup(), idna.Transitional(false), idna.StrictDomainName(false))

// NormalizeFQDN lowercases, strips a trailing dot, converts IDN to punycode (xn--) and
// validates the result. Underscores in labels and a leading "*." wildcard are allowed.
func NormalizeFQDN(s string) (string, error) {
	v := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(s)), ".")
	if v == "" {
		return "", verr("domain", "domain name is empty")
	}
	wildcard := strings.HasPrefix(v, "*.")
	rest := strings.TrimPrefix(v, "*.")
	ascii := rest
	for _, r := range rest {
		if r > 127 {
			conv, err := idnaProfile.ToASCII(rest)
			if err != nil {
				return "", verr("domain", "%q is not a valid internationalized domain name: %v", s, err)
			}
			ascii = conv
			break
		}
	}
	if wildcard {
		ascii = "*." + ascii
	}
	if !ValidFQDN(ascii) {
		return "", verr("domain", "%q is not a valid domain name (use letters, digits, hyphens or underscores per label, at least two labels; IDN and a leading \"*.\" are allowed)", s)
	}
	return ascii, nil
}

// ValidEmail accepts RFC 5322 addr-spec addresses (no display name, no control characters).
func ValidEmail(s string) bool {
	if s == "" || len(s) > 254 || strings.ContainsAny(s, "\x00\r\n\t ") {
		return false
	}
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && a.Name == "" && strings.Contains(s[strings.LastIndex(s, "@"):], ".")
}

// validateVar validates and normalizes one variable. Returns the (possibly normalized) value.
func validateVar(def VariableDef, value string) (string, error) {
	switch def.Type {
	case "b64", "secret":
		if (def.Name == "ssl_email" || def.Name == "email") && value != "" && !ValidEmail(value) {
			return "", verr(def.Name, "%q is not a valid email address", value)
		}
		// Encoded server side; templates decode with base64 -d.
		return base64.StdEncoding.EncodeToString([]byte(value)), nil
	case "port_range":
		return NormalizePortRange(value)
	case "txn":
		if value == "" {
			return NewTxnID(), nil
		}
		if !txnRe.MatchString(value) {
			return "", verr(def.Name, "invalid transaction id")
		}
		return value, nil
	}

	switch def.Name {
	case "domain":
		return NormalizeFQDN(value)
	case "port", "https_port", "http_port":
		if !ValidPort(value) {
			return "", verr(def.Name, "%s must be a port number between 1 and 65535 (got %q)", def.Name, value)
		}
		return value, nil
	case "max_children", "start_servers", "min_spare_servers", "max_spare_servers",
		"timeout", "lines", "size_mb", "duration", "count":
		if !isInt(value) {
			return "", verr(def.Name, "%s must be a non-negative whole number (got %q)", def.Name, value)
		}
		return value, nil
	case "protocol":
		if value != "tcp" && value != "udp" && value != "both" {
			return "", verr(def.Name, "protocol must be tcp, udp or both (got %q)", value)
		}
		return value, nil
	case "enabled", "ssl_enabled", "enable_http", "proxy_protocol", "reverse":
		if v, ok := normBool(value); ok {
			return v, nil
		}
		return "", verr(def.Name, "%s must be true or false (got %q)", def.Name, value)
	case "ssl_email", "email":
		if value == "" || ValidEmail(value) {
			return value, nil
		}
		return "", verr(def.Name, "%q is not a valid email address", value)
	case "target", "target_ip":
		if !ValidHost(value) {
			return "", verr(def.Name, "%q is not a valid IP address or hostname", value)
		}
		return value, nil
	case "version":
		if !phpVersionRe.MatchString(value) {
			return "", verr(def.Name, "%q is not a valid version (expected e.g. 8.3)", value)
		}
		return value, nil
	case "extension":
		if !extensionRe.MatchString(value) {
			return "", verr(def.Name, "%q is not a valid PHP extension name", value)
		}
		return value, nil
	case "extensions", "remove_extensions":
		if !extListRe.MatchString(value) {
			return "", verr(def.Name, "extension list may only contain letters, digits, underscores and commas")
		}
		return value, nil
	case "path", "target_path":
		c, ok := CleanAbsPath(value)
		if !ok {
			return "", verr(def.Name, "%q must be an absolute path without spaces, quotes or shell characters", value)
		}
		return c, nil
	case "url":
		if !urlRe.MatchString(value) || strings.ContainsAny(value, "'\"`$\\") {
			return "", verr(def.Name, "%q is not a valid http(s) URL", value)
		}
		return value, nil
	case "service":
		if !serviceRe.MatchString(value) {
			return "", verr(def.Name, "%q is not a valid service name", value)
		}
		return value, nil
	case "mode":
		if !modeRe.MatchString(value) {
			return "", verr(def.Name, "%q is not a valid octal file mode (e.g. 0644)", value)
		}
		return value, nil
	case "http_client_max_body_size":
		if !sizeRe.MatchString(value) {
			return "", verr(def.Name, "%q is not a valid nginx size (e.g. 100M)", value)
		}
		return value, nil
	case "http_extra_b64":
		if !b64Re.MatchString(value) {
			return "", verr(def.Name, "invalid base64 value")
		}
		return value, nil
	}

	// Free-form text: used only as file content or as an intentionally arbitrary command.
	if def.Type == "text" {
		return value, nil
	}
	if !genericRe.MatchString(value) {
		return "", verr(def.Name, "%s contains characters that are not allowed (quotes, $, `, backslash, ;, |, &, <, >, braces, parentheses or newlines)", def.Name)
	}
	return value, nil
}

// PrepareVars applies defaults, validates every declared variable and encodes b64/secret
// variables. Unknown variables are dropped. Returns an error suitable for a 400 response.
func (t *CommandTemplate) PrepareVars(vars map[string]string) (map[string]string, error) {
	out := make(map[string]string, len(t.Variables))
	for _, def := range t.Variables {
		value, ok := vars[def.Name]
		if !ok || (value == "" && def.Default != "") {
			if def.Required && !ok && def.Type != "txn" {
				return nil, fmt.Errorf("missing required variable %q", def.Name)
			}
			value = def.Default
		}
		if value == "" && !def.Required && def.Type != "txn" && def.Type != "b64" && def.Type != "secret" {
			out[def.Name] = ""
			continue
		}
		v, err := validateVar(def, value)
		if err != nil {
			return nil, err
		}
		out[def.Name] = v
	}
	for k, v := range vars {
		if _, declared := out[k]; declared {
			continue
		}
		// Undeclared variables are never referenced by the template; keep only harmless ones.
		if genericRe.MatchString(v) {
			out[k] = v
		}
	}
	return out, nil
}

// BuildPayload validates vars and returns the run payload.
func (t *CommandTemplate) BuildPayload(vars map[string]string) (json.RawMessage, map[string]string, error) {
	prepared, err := t.PrepareVars(vars)
	if err != nil {
		return nil, nil, err
	}
	data, err := json.Marshal(RunPayload{Steps: t.Steps, Vars: prepared, OnError: t.OnError})
	if err != nil {
		return nil, nil, err
	}
	return data, prepared, nil
}

// SafeToPayload is ToPayload with validation; on invalid vars it returns a payload whose single
// step fails with a clear marker instead of interpolating unsafe values into shell.
func (t *CommandTemplate) SafeToPayload(vars map[string]string) json.RawMessage {
	data, _, err := t.BuildPayload(vars)
	if err == nil {
		return data
	}
	msg := strings.NewReplacer("'", "", "\n", " ").Replace(err.Error())
	data, _ = json.Marshal(RunPayload{
		Steps:   []Step{{Action: "exec", Command: "echo 'CONFIGURATIX_RESULT|failed|" + msg + "'; exit 1", Timeout: 10}},
		OnError: "stop",
	})
	return data
}

// ===================== Transactional shell library =====================

// TxnShellLib defines bash helpers for transactional config changes that work with any
// agent version (it only relies on plain exec steps). Requires CFX_TXN to be set before it.
//
//	cfx_backup FILE...      record current state of files (content or absence) once per txn
//	cfx_restore             restore every recorded file (re-create content / delete if absent)
//	cfx_install SRC DST     atomically install SRC at DST (copy to tmp in same dir + mv)
//	cfx_nginx_up            reload nginx if active, start otherwise
//	cfx_nginx_test          run nginx -t, store output in CFX_NGINX_TEST_OUT, set CFX_FAIL_REASON on failure
//	cfx_result STATUS|...   print a CONFIGURATIX_RESULT marker line
//	cfx_txn_trap            EXIT trap: on failure restore + bring nginx back + print rolled_back marker
const TxnShellLib = `
CFX_BACKUP_ROOT="/var/lib/configuratix/backups"
CFX_TXN_DIR="$CFX_BACKUP_ROOT/$CFX_TXN"
CFX_STAGING_DIR="/var/lib/configuratix/staging/$CFX_TXN"
CFX_FAIL_REASON=""
CFX_SUCCESS_RESULT="applied"
CFX_NGINX_STOPPED=0
CFX_TXN_RESTORE=1
mkdir -p "$CFX_TXN_DIR"

cfx_result() { echo "CONFIGURATIX_RESULT|$*"; }

cfx_backup() {
    local f
    for f in "$@"; do
        [ -n "$f" ] || continue
        if [ -f "$CFX_TXN_DIR/manifest" ] && grep -qxF -- "$f" "$CFX_TXN_DIR/manifest"; then
            continue
        fi
        echo "$f" >> "$CFX_TXN_DIR/manifest"
        if [ -e "$f" ]; then
            mkdir -p "$CFX_TXN_DIR/root$(dirname "$f")"
            cp -a -- "$f" "$CFX_TXN_DIR/root$f"
        else
            mkdir -p "$CFX_TXN_DIR/absent$(dirname "$f")"
            : > "$CFX_TXN_DIR/absent$f"
        fi
    done
    return 0
}

cfx_restore() {
    [ -f "$CFX_TXN_DIR/manifest" ] || return 0
    local f
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        if [ -e "$CFX_TXN_DIR/root$f" ]; then
            mkdir -p "$(dirname "$f")"
            cp -a -- "$CFX_TXN_DIR/root$f" "$f" && echo "Restored $f"
        elif [ -e "$CFX_TXN_DIR/absent$f" ] && [ -e "$f" ]; then
            rm -f -- "$f" && echo "Removed $f (did not exist before)"
        fi
    done < "$CFX_TXN_DIR/manifest"
    return 0
}

cfx_install() {
    local src="$1" dst="$2" tmp
    mkdir -p "$(dirname "$dst")"
    tmp="$(dirname "$dst")/.cfx-tmp-$$-$(basename "$dst").tmp"
    cp -- "$src" "$tmp" && chmod 0644 "$tmp" && mv -f -- "$tmp" "$dst"
}

cfx_nginx_up() {
    if systemctl is-active --quiet nginx; then
        systemctl reload nginx
    else
        systemctl start nginx
    fi
}

cfx_nginx_test() {
    if CFX_NGINX_TEST_OUT="$(nginx -t 2>&1)"; then
        echo "$CFX_NGINX_TEST_OUT"
        return 0
    fi
    echo "$CFX_NGINX_TEST_OUT"
    CFX_FAIL_REASON="nginx -t failed: $(echo "$CFX_NGINX_TEST_OUT" | grep -m1 -E 'emerg|error' | sed 's/^nginx: //' | tr '|' '/' | cut -c1-300)"
    return 1
}

cfx_prune_backups() {
    ls -1dt "$CFX_BACKUP_ROOT"/*/ 2>/dev/null | tail -n +31 | xargs -r rm -rf
    find /var/lib/configuratix/staging -mindepth 1 -maxdepth 1 -mmin +1440 -exec rm -rf {} + 2>/dev/null
    return 0
}

cfx_txn_trap() {
    local rc=$?
    trap - EXIT
    set +e
    if [ "$rc" -ne 0 ]; then
        if [ "$CFX_TXN_RESTORE" = "1" ]; then
            echo ""
            echo "=== Rolling back (exit code $rc) ==="
            cfx_restore
        fi
        if nginx -t >/dev/null 2>&1; then
            cfx_nginx_up >/dev/null 2>&1 || true
            echo "Previous configuration is active, nginx test OK"
        else
            echo "WARNING: nginx -t still fails after restore:"
            nginx -t 2>&1 | tail -5
            [ "$CFX_NGINX_STOPPED" = "1" ] && systemctl start nginx >/dev/null 2>&1
        fi
        cfx_result "rolled_back|${CFX_FAIL_REASON:-script failed with exit code $rc}"
    else
        cfx_result "$CFX_SUCCESS_RESULT"
    fi
    rm -rf "$CFX_STAGING_DIR" 2>/dev/null
    cfx_prune_backups
    exit "$rc"
}
`

// TxnPrelude returns "CFX_TXN=<quoted>" plus the shell library, for scripts built in Go.
func TxnPrelude(txn string) string {
	return "CFX_TXN=" + ShellQuote(txn) + "\n" + TxnShellLib
}

// StagingPath returns the staging file path used for a transaction.
func StagingPath(txn, name string) string {
	return "/var/lib/configuratix/staging/" + txn + "/" + name
}

// NormalizePortRange accepts "80", "1000:2000" or "1000-2000" (normalized to the colon form
// used by ufw). Ranges must be ascending; ports are 1-65535.
func NormalizePortRange(s string) (string, error) {
	v := strings.ReplaceAll(strings.TrimSpace(s), "-", ":")
	parts := strings.Split(v, ":")
	if len(parts) == 1 && ValidPort(parts[0]) {
		return parts[0], nil
	}
	if len(parts) == 2 && ValidPort(parts[0]) && ValidPort(parts[1]) {
		a, _ := strconv.Atoi(parts[0])
		b, _ := strconv.Atoi(parts[1])
		if a < b {
			return v, nil
		}
		return "", verr("port", "port range %q must be ascending (e.g. 1000:2000)", s)
	}
	return "", verr("port", "%q is not a valid port or port range (use 8080, 1000:2000 or 1000-2000; ports 1-65535)", s)
}
