// Package jobs is the single place where agent jobs are created.
//
// Every job gets a human title, an optional logical action (template id), an entity link
// (entity_type/entity_id) and the creating user, so the Jobs UI can show meaningful rows and
// jobhooks can update entity state when the job finishes.
package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// Entity types
const (
	EntityDomain      = "domain"
	EntityNginxConfig = "nginx_config"
	EntityMachine     = "machine"
	EntityDNSDomain   = "dns_domain"
	EntityLanding     = "landing"
	EntityPHPRuntime  = "php_runtime"
	EntityPassthrough = "passthrough"
	EntityCommand     = "command"
	EntityFile        = "file"
	EntityAgent       = "agent"
)

// Querier is satisfied by *database.DB, *sqlx.DB and *sqlx.Tx.
type Querier interface {
	sqlx.QueryerContext
}

// Spec describes a job to create.
type Spec struct {
	ID             uuid.UUID   // optional; generated when zero
	AgentID        uuid.UUID   // required
	Type           string      // defaults to "run"
	Payload        interface{} // json.RawMessage, []byte, string or any JSON-marshalable value
	Title          string      // human title; derived from Action/Type when empty
	Action         string      // logical action, usually the template id (apply_domain, ...)
	EntityType     string
	EntityID       string
	CreatedBy      *uuid.UUID
	TimeoutSeconds int // 0 = derived from step timeouts
	ParentJobID    *uuid.UUID
	Attempts       int
}

// Create inserts a pending job and returns it.
func Create(ctx context.Context, q Querier, spec Spec) (*models.Job, error) {
	if spec.AgentID == uuid.Nil {
		return nil, fmt.Errorf("jobs.Create: agent id is required")
	}
	if spec.ID == uuid.Nil {
		spec.ID = uuid.New()
	}
	if spec.Type == "" {
		spec.Type = "run"
	}
	payload, err := marshalPayload(spec.Payload)
	if err != nil {
		return nil, err
	}
	if spec.Title == "" {
		spec.Title = defaultTitle(spec)
	}
	spec.Title = truncate(spec.Title, 200)
	if spec.TimeoutSeconds <= 0 {
		spec.TimeoutSeconds = estimateTimeout(spec.Type, payload)
	}

	var job models.Job
	err = sqlx.GetContext(ctx, q, &job, `
		INSERT INTO jobs (id, agent_id, type, payload_json, status, title, action, created_by,
			entity_type, entity_id, timeout_seconds, parent_job_id, attempts, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'pending', $5, NULLIF($6, ''), $7, NULLIF($8, ''), NULLIF($9, ''), $10, $11, $12, NOW(), NOW())
		RETURNING `+models.JobColumns,
		spec.ID, spec.AgentID, spec.Type, payload, spec.Title, spec.Action, spec.CreatedBy,
		spec.EntityType, spec.EntityID, spec.TimeoutSeconds, spec.ParentJobID, spec.Attempts)
	if err != nil {
		return nil, fmt.Errorf("failed to create job: %w", err)
	}
	return &job, nil
}

// FromTemplate validates vars against a command template and returns a Spec with payload,
// action and title filled in. The caller sets AgentID/Entity/CreatedBy.
func FromTemplate(templateID string, vars map[string]string) (Spec, error) {
	cmd := templates.GetCommand(templateID)
	if cmd == nil {
		return Spec{}, fmt.Errorf("unknown command template %q", templateID)
	}
	payload, _, err := cmd.BuildPayload(vars)
	if err != nil {
		return Spec{}, err
	}
	return Spec{
		Type:    "run",
		Payload: payload,
		Action:  templateID,
		Title:   TemplateTitle(templateID, vars),
	}, nil
}

// UserID returns the authenticated user's id from the request context (nil when absent).
func UserID(r *http.Request) *uuid.UUID {
	if r == nil {
		return nil
	}
	claims, ok := r.Context().Value("claims").(*auth.Claims)
	if !ok || claims == nil {
		return nil
	}
	id, err := uuid.Parse(claims.UserID)
	if err != nil {
		return nil
	}
	return &id
}

// TemplateTitle renders the human title for a template run.
func TemplateTitle(templateID string, vars map[string]string) string {
	v := func(k string) string { return strings.TrimSpace(vars[k]) }
	onOff := func(k string) string {
		if b, _ := normBool(v(k)); b {
			return "enable"
		}
		return "disable"
	}
	switch templateID {
	case "change_ssh_port":
		return "Change SSH port → " + v("port")
	case "change_root_password":
		return "Change root password"
	case "toggle_ufw":
		return "Toggle UFW · " + onOff("enabled")
	case "ufw_allow_port":
		return fmt.Sprintf("UFW allow %s/%s", v("port"), orDefault(v("protocol"), "tcp"))
	case "ufw_delete_port":
		return fmt.Sprintf("UFW delete %s/%s", v("port"), orDefault(v("protocol"), "tcp"))
	case "toggle_fail2ban":
		return "Toggle Fail2ban · " + onOff("enabled")
	case "apply_nginx_config", "apply_domain":
		return "Apply nginx config · " + v("domain")
	case "remove_nginx_config":
		return "Remove nginx config · " + v("domain")
	case "remove_domain":
		return "Remove domain · " + v("domain")
	case "issue_ssl_cert":
		return "Issue SSL certificate · " + v("domain")
	case "apply_passthrough_domain":
		t := "Apply passthrough · " + v("domain")
		if v("target") != "" {
			t += " → " + v("target")
		}
		return t
	case "install_php_runtime", "install_php":
		return "Install PHP " + v("version")
	case "sync_php_extensions":
		return "Update PHP " + v("version") + " extensions"
	case "remove_php_runtime":
		return "Remove PHP " + v("version")
	case "switch_php_version":
		return "Switch PHP → " + v("version")
	case "install_php_extension":
		return "Install PHP extension " + v("extension")
	case "remove_php_extension":
		return "Remove PHP extension " + v("extension")
	case "get_php_runtime_info":
		return "Read PHP runtime info"
	case "configure_php_fpm_pool":
		return "Configure PHP-FPM pool " + v("version")
	case "read_file":
		return "Read file " + v("path")
	case "write_file", "write_nginx_config", "write_php_config":
		return "Write file " + v("path")
	case "write_sshd_config":
		return "Write file /etc/ssh/sshd_config"
	case "restart_service":
		return "Restart service · " + v("service")
	case "install_package":
		return "Install package · " + v("package")
	case "exec_command":
		return CommandTitle(v("command"))
	case "nginx_test_reload":
		return "Test & reload nginx"
	case "deploy_landing":
		return "Deploy landing → " + v("target_path")
	}
	if cmd := templates.GetCommand(templateID); cmd != nil {
		if strings.HasPrefix(templateID, "speedtest_") || templateID == "network_info" {
			return "Network test · " + cmd.Name
		}
		return "Run command '" + cmd.Name + "'"
	}
	return "Run " + templateID
}

// CommandTitle renders a title for an ad-hoc shell command.
func CommandTitle(command string) string {
	return "Run command '" + shorten(maskSecretAssignments(command), 50) + "'"
}

// secretAssignRe matches "password=...", "token: ..." style assignments in commands.
var secretAssignRe = regexp.MustCompile(`(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?)[^\s'"]+`)

// maskSecretAssignments hides assigned secret values so they never end up in job titles.
func maskSecretAssignments(s string) string {
	return secretAssignRe.ReplaceAllString(s, "${1}••••••")
}

func defaultTitle(spec Spec) string {
	if spec.Action != "" {
		return TemplateTitle(spec.Action, nil)
	}
	switch spec.Type {
	case "update_agent":
		return "Update agent"
	case "deploy_landing":
		return "Deploy landing"
	case "bootstrap_machine":
		return "Bootstrap machine"
	}
	return "Run job"
}

func marshalPayload(p interface{}) ([]byte, error) {
	switch v := p.(type) {
	case nil:
		return []byte("{}"), nil
	case json.RawMessage:
		return v, nil
	case []byte:
		return v, nil
	case string:
		return []byte(v), nil
	default:
		return json.Marshal(v)
	}
}

// estimateTimeout sums step timeouts (agent default 300s for exec) plus a margin.
func estimateTimeout(jobType string, payload []byte) int {
	if jobType != "run" {
		return 900
	}
	var p struct {
		Steps []struct {
			Action  string `json:"action"`
			Timeout int    `json:"timeout"`
		} `json:"steps"`
	}
	if json.Unmarshal(payload, &p) != nil || len(p.Steps) == 0 {
		return 600
	}
	total := 60
	for _, s := range p.Steps {
		switch {
		case s.Timeout > 0:
			total += s.Timeout
		case s.Action == "exec" || s.Action == "script":
			total += 300
		default:
			total += 60
		}
	}
	return total
}

func normBool(s string) (bool, bool) {
	switch strings.ToLower(s) {
	case "true", "1", "yes", "on":
		return true, true
	}
	return false, true
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func shorten(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
