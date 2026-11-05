package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

// MachineNginxHandler serves the machine nginx view (inventory, drift, test, reload).
type MachineNginxHandler struct {
	db *database.DB
}

func NewMachineNginxHandler(db *database.DB) *MachineNginxHandler {
	return &MachineNginxHandler{db: db}
}

// agentHas reports whether the agent advertised a capability (agents.capabilities, migration 040).
// Old agents (no capabilities) return false.
func agentHas(ctx context.Context, db *database.DB, agentID uuid.UUID, capability string) bool {
	var ok bool
	err := db.GetContext(ctx, &ok, `
		SELECT COALESCE(
			CASE jsonb_typeof(capabilities)
				WHEN 'array' THEN capabilities ? $2
				WHEN 'object' THEN COALESCE((capabilities ->> $2)::boolean, capabilities ? $2)
				ELSE false END, false)
		FROM agents WHERE id = $1`, agentID, capability)
	return err == nil && ok
}

// nginxInventoryScript lists every nginx config file (read-only) with size, mtime, sha256,
// plus nginx -t output and service state. Works on any agent version (single exec step).
const nginxInventoryScript = `
set +e
echo "CFX_NGINX_ACTIVE|$(systemctl is-active nginx 2>/dev/null | head -1)"
echo "CFX_NGINX_VERSION|$(nginx -v 2>&1 | head -1 | tr '|' '/')"
CFX_T="$(nginx -t 2>&1)"
echo "CFX_NGINX_TEST_RC|$?"
echo "CFX_NGINX_TEST_B64|$(printf '%s' "$CFX_T" | base64 | tr -d '\n')"
for f in /etc/nginx/nginx.conf /etc/nginx/conf.d/* /etc/nginx/conf.d/configuratix/* /etc/nginx/stream.d/* \
         /etc/nginx/sites-enabled/* /etc/nginx/sites-available/* /etc/nginx/snippets/configuratix*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    [ -d "$f" ] && continue
    size=$(stat -L -c %s "$f" 2>/dev/null || echo 0)
    mtime=$(stat -L -c %Y "$f" 2>/dev/null || echo 0)
    sum=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)
    link=$(readlink "$f" 2>/dev/null)
    printf 'CFX_FILE|%s|%s|%s|%s|%s\n' "$f" "$size" "$mtime" "$sum" "$link"
done
echo "CFX_DONE|1"
`

// NginxFile is one entry of the machine nginx inventory.
type NginxFile struct {
	Path           string     `json:"path"`
	Name           string     `json:"name"`
	Category       string     `json:"category"` // configuratix_domain|configuratix_passthrough|configuratix_stream|configuratix_snippet|system|site|other
	State          string     `json:"state"`    // active|disabled|backup|inactive
	Size           int64      `json:"size"`
	MTime          *time.Time `json:"mtime"`
	SHA256         string     `json:"sha256"`
	LinkTarget     string     `json:"link_target,omitempty"`
	Managed        bool       `json:"managed"`
	DomainFQDN     *string    `json:"domain_fqdn,omitempty"`
	DomainID       *uuid.UUID `json:"domain_id,omitempty"`
	NginxConfigID  *uuid.UUID `json:"nginx_config_id,omitempty"`
	ExpectedSHA256 *string    `json:"expected_sha256,omitempty"`
	Drift          bool       `json:"drift"`
}

type nginxStatus struct {
	Active     bool   `json:"active"`
	State      string `json:"state"`
	TestOK     bool   `json:"test_ok"`
	TestOutput string `json:"test_output"`
	Version    string `json:"version"`
}

type missingDomainFile struct {
	DomainID      uuid.UUID  `json:"domain_id"`
	FQDN          string     `json:"fqdn"`
	ExpectedPath  string     `json:"expected_path"`
	NginxConfigID *uuid.UUID `json:"nginx_config_id"`
}

type machineNginxResponse struct {
	MachineID      uuid.UUID           `json:"machine_id"`
	JobID          uuid.UUID           `json:"job_id"`
	Nginx          nginxStatus         `json:"nginx"`
	Files          []NginxFile         `json:"files"`
	MissingDomains []missingDomainFile `json:"missing_domains"`
	FetchedAt      time.Time           `json:"fetched_at"`
}

// GetMachineNginx: GET /api/machines/{id}/nginx[?job_id=<previous inventory job>]
// Runs a read-only inventory job and waits up to ~20s. If the agent is slower, responds
// 202 {"pending": true, "job_id": ...}; call again with ?job_id= to fetch the parsed result.
func (h *MachineNginxHandler) GetMachineNginx(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canAccessMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	agentID, err := machineAgentID(h.db, machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}

	var jobID uuid.UUID
	if v := r.URL.Query().Get("job_id"); v != "" {
		jobID, err = uuid.Parse(v)
		if err != nil {
			http.Error(w, "Invalid job_id", http.StatusBadRequest)
			return
		}
		var owner uuid.UUID
		if err := h.db.Get(&owner, "SELECT agent_id FROM jobs WHERE id = $1 AND action = 'nginx_inventory'", jobID); err != nil || owner != agentID {
			http.Error(w, "Inventory job not found", http.StatusNotFound)
			return
		}
	} else if err := h.db.Get(&jobID, `SELECT id FROM jobs
		WHERE agent_id = $1 AND action = 'nginx_inventory' AND status IN ('pending', 'running')
		ORDER BY created_at DESC LIMIT 1`, agentID); err == nil {
		// A scan is already in flight (double mount, second tab): share it instead of queueing another.
	} else {
		payload, _ := json.Marshal(map[string]interface{}{
			"steps":    []map[string]interface{}{{"action": "exec", "command": nginxInventoryScript, "timeout": 30}},
			"on_error": "continue",
		})
		job, err := jobs.Create(r.Context(), h.db, jobs.Spec{
			AgentID:        agentID,
			Payload:        json.RawMessage(payload),
			Action:         "nginx_inventory",
			Title:          "Read nginx configuration",
			EntityType:     jobs.EntityMachine,
			EntityID:       machineID.String(),
			CreatedBy:      jobs.UserID(r),
			TimeoutSeconds: 90,
		})
		if err != nil {
			log.Printf("Failed to create nginx inventory job: %v", err)
			http.Error(w, "Failed to create job", http.StatusInternalServerError)
			return
		}
		jobID = job.ID
	}

	job, err := waitForJob(r.Context(), h.db, jobID, 20*time.Second)
	if job == nil {
		http.Error(w, "Failed to read job", http.StatusInternalServerError)
		return
	}
	if !models.IsTerminalJobStatus(job.Status) {
		writeJSON(w, http.StatusAccepted, map[string]interface{}{"pending": true, "job_id": jobID, "status": job.Status})
		return
	}
	logs := nullStringToString(job.Logs)
	if !hasMarkerLine(logs, "CFX_DONE|1") {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error": "inventory job did not complete", "job_id": jobID, "status": job.Status, "logs": tail(logs, 4000),
		})
		return
	}

	resp := machineNginxResponse{MachineID: machineID, JobID: jobID, Files: []NginxFile{}, MissingDomains: []missingDomainFile{}, FetchedAt: time.Now().UTC()}
	if job.FinishedAt != nil {
		resp.FetchedAt = job.FinishedAt.UTC()
	}
	resp.Nginx, resp.Files = parseNginxInventory(logs)
	h.annotate(machineID, &resp)
	writeJSON(w, http.StatusOK, resp)
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func parseNginxInventory(logs string) (nginxStatus, []NginxFile) {
	var st nginxStatus
	files := []NginxFile{}
	for _, line := range strings.Split(logs, "\n") {
		line = strings.TrimRight(line, "\r")
		if !strings.HasPrefix(line, "CFX_") {
			continue
		}
		parts := strings.Split(line, "|")
		switch parts[0] {
		case "CFX_NGINX_ACTIVE":
			if len(parts) > 1 {
				st.State = strings.TrimSpace(parts[1])
				st.Active = st.State == "active"
			}
		case "CFX_NGINX_VERSION":
			if len(parts) > 1 {
				st.Version = strings.TrimSpace(strings.TrimPrefix(strings.Join(parts[1:], "|"), "nginx version: "))
			}
		case "CFX_NGINX_TEST_RC":
			st.TestOK = len(parts) > 1 && strings.TrimSpace(parts[1]) == "0"
		case "CFX_NGINX_TEST_B64":
			if len(parts) > 1 {
				if b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(parts[1])); err == nil {
					st.TestOutput = string(b)
				}
			}
		case "CFX_FILE":
			if len(parts) < 6 {
				continue
			}
			// Path may (rarely) contain '|': the last 4 fields are fixed.
			n := len(parts)
			p := strings.Join(parts[1:n-4], "|")
			f := NginxFile{Path: p, Name: path.Base(p), SHA256: parts[n-2], LinkTarget: parts[n-1]}
			f.Size, _ = strconv.ParseInt(parts[n-4], 10, 64)
			if sec, err := strconv.ParseInt(parts[n-3], 10, 64); err == nil && sec > 0 {
				t := time.Unix(sec, 0).UTC()
				f.MTime = &t
			}
			f.Category, f.State = classifyNginxFile(p)
			f.Managed = strings.HasPrefix(f.Category, "configuratix_")
			files = append(files, f)
		}
	}
	// sites-available entries are active only when linked from sites-enabled.
	enabled := map[string]bool{}
	for _, f := range files {
		if strings.HasPrefix(f.Path, "/etc/nginx/sites-enabled/") && f.LinkTarget != "" {
			t := f.LinkTarget
			if !strings.HasPrefix(t, "/") {
				t = path.Join("/etc/nginx/sites-enabled", t)
			}
			enabled[path.Clean(t)] = true
		}
	}
	for i := range files {
		if strings.HasPrefix(files[i].Path, "/etc/nginx/sites-available/") && files[i].State == "active" && !enabled[files[i].Path] {
			files[i].State = "inactive"
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return st, files
}

// stripStateSuffix removes .disabled/.bak/... suffixes and returns the base name and state.
func stripStateSuffix(name string) (string, string) {
	for _, s := range []string{".disabled-by-manual", ".disabled"} {
		if strings.HasSuffix(name, s) {
			return strings.TrimSuffix(name, s), "disabled"
		}
	}
	for _, s := range []string{".configuratix-backup", ".bak", ".backup", ".orig", ".old", "~", ".dpkg-old", ".dpkg-dist", ".dpkg-new"} {
		if strings.HasSuffix(name, s) {
			return strings.TrimSuffix(name, s), "backup"
		}
	}
	return name, "active"
}

func classifyNginxFile(p string) (category, state string) {
	dir := path.Dir(p)
	base, st := stripStateSuffix(path.Base(p))
	state = st
	switch {
	case p == "/etc/nginx/nginx.conf":
		category = "system"
	case dir == "/etc/nginx/conf.d/configuratix":
		if strings.HasPrefix(base, "passthrough-") {
			category = "configuratix_passthrough"
		} else {
			category = "configuratix_domain"
		}
		if state == "active" && !strings.HasSuffix(base, ".conf") {
			state = "inactive"
		}
	case dir == "/etc/nginx/stream.d":
		category = "configuratix_stream"
		if state == "active" && !strings.HasSuffix(base, ".conf") {
			state = "inactive"
		}
	case dir == "/etc/nginx/snippets" && strings.HasPrefix(base, "configuratix"):
		category = "configuratix_snippet"
	case dir == "/etc/nginx/conf.d":
		category = "system"
		if state == "active" && !strings.HasSuffix(base, ".conf") {
			state = "inactive"
		}
	case dir == "/etc/nginx/sites-enabled" || dir == "/etc/nginx/sites-available":
		category = "site"
	default:
		category = "other"
	}
	return
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// annotate links files to domains/configs and computes drift against what the DB would write.
func (h *MachineNginxHandler) annotate(machineID uuid.UUID, resp *machineNginxResponse) {
	var domains []struct {
		ID       uuid.UUID  `db:"id"`
		FQDN     string     `db:"fqdn"`
		ConfigID *uuid.UUID `db:"config_id"`
	}
	h.db.Select(&domains, `
		SELECT d.id, d.fqdn, (SELECT nginx_config_id FROM domain_config_links WHERE domain_id = d.id LIMIT 1) AS config_id
		FROM domains d WHERE d.assigned_machine_id = $1`, machineID)

	byFQDN := map[string]int{}
	for i, d := range domains {
		key := strings.ToLower(d.FQDN)
		if n, err := templates.NormalizeFQDN(d.FQDN); err == nil {
			key = n
		}
		byFQDN[key] = i
	}
	seen := map[string]bool{}
	expectedCache := map[uuid.UUID]*string{}
	mID := machineID

	for i := range resp.Files {
		f := &resp.Files[i]
		if f.Category != "configuratix_domain" {
			continue
		}
		base, _ := stripStateSuffix(f.Name)
		fqdn := strings.TrimSuffix(base, ".conf")
		idx, ok := byFQDN[strings.ToLower(fqdn)]
		if !ok {
			fq := fqdn
			f.DomainFQDN = &fq
			continue
		}
		d := domains[idx]
		f.DomainFQDN = &d.FQDN
		f.DomainID = &d.ID
		f.NginxConfigID = d.ConfigID
		if f.State != "active" {
			continue
		}
		seen[d.ID.String()] = true
		if d.ConfigID == nil {
			continue
		}
		exp, cached := expectedCache[d.ID]
		if !cached {
			rendered, cfgJSON, err := renderDomainNginxConfig(h.db, h.db, fileFQDN(d.FQDN), *d.ConfigID, &mID)
			if err == nil && !isPassthroughConfig(cfgJSON) && rendered != "" {
				s := sha256Hex(rendered)
				exp = &s
			}
			expectedCache[d.ID] = exp
		}
		if exp != nil {
			f.ExpectedSHA256 = exp
			f.Drift = *exp != f.SHA256
		}
	}

	// Passthrough-generated files (DNS management pools).
	if bundle, err := NewPassthroughNginxGenerator(h.db).GenerateForMachine(machineID); err == nil {
		expected := map[string]string{
			"/etc/nginx/stream.d/configuratix-passthrough.conf":        bundle.StreamConfig,
			"/etc/nginx/conf.d/configuratix/passthrough-dns-http.conf": bundle.HTTPConfig,
			"/etc/nginx/conf.d/configuratix/passthrough-dns-l7.conf":   bundle.L7Config,
		}
		for i := range resp.Files {
			f := &resp.Files[i]
			want, ok := expected[f.Path]
			if !ok || f.State != "active" {
				continue
			}
			if want == "" {
				f.Drift = true // file exists but the DB would not generate it
				continue
			}
			s := sha256Hex(want)
			f.ExpectedSHA256 = &s
			f.Drift = s != f.SHA256
		}
	}

	for _, d := range domains {
		if seen[d.ID.String()] || d.ConfigID == nil {
			continue
		}
		// Passthrough-mode domains have no per-domain HTTP file.
		var cfgJSON json.RawMessage
		h.db.Get(&cfgJSON, "SELECT structured_json FROM nginx_configs WHERE id = $1", *d.ConfigID)
		if isPassthroughConfig(cfgJSON) {
			continue
		}
		resp.MissingDomains = append(resp.MissingDomains, missingDomainFile{
			DomainID: d.ID, FQDN: d.FQDN, ExpectedPath: "/etc/nginx/conf.d/configuratix/" + fileFQDN(d.FQDN) + ".conf", NginxConfigID: d.ConfigID,
		})
	}
}

// TestMachineNginx: POST /api/machines/{id}/nginx/test[?wait=0]
// Creates an "nginx -t" job; by default waits up to 20s and returns {job_id, status, test_ok, output}.
func (h *MachineNginxHandler) TestMachineNginx(w http.ResponseWriter, r *http.Request) {
	h.runNginxJob(w, r, "nginx_test", "Test nginx configuration",
		"nginx -t 2>&1; RC=$?; echo \"CFX_NGINX_TEST_RC|$RC\"; exit $RC", r.URL.Query().Get("wait") != "0")
}

// ReloadMachineNginx: POST /api/machines/{id}/nginx/reload[?wait=1]
// Tests and reloads (or starts) nginx. Never reloads a config that fails nginx -t.
func (h *MachineNginxHandler) ReloadMachineNginx(w http.ResponseWriter, r *http.Request) {
	script := `if ! nginx -t 2>&1; then echo "CFX_NGINX_TEST_RC|1"; echo "CONFIGURATIX_RESULT|failed|nginx -t failed, not reloading"; exit 1; fi
echo "CFX_NGINX_TEST_RC|0"
if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi || { echo "CONFIGURATIX_RESULT|failed|reload failed"; exit 1; }
sleep 1
systemctl is-active nginx
echo "CONFIGURATIX_RESULT|applied"`
	h.runNginxJob(w, r, "nginx_reload", "Reload nginx", script, r.URL.Query().Get("wait") == "1")
}

func (h *MachineNginxHandler) runNginxJob(w http.ResponseWriter, r *http.Request, action, title, script string, wait bool) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canManageMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	agentID, err := machineAgentID(h.db, machineID)
	if err != nil {
		http.Error(w, "Machine not found or no agent connected", http.StatusNotFound)
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"steps":    []map[string]interface{}{{"action": "exec", "command": script, "timeout": 60}},
		"on_error": "stop",
	})
	job, err := jobs.Create(r.Context(), h.db, jobs.Spec{
		AgentID:    agentID,
		Payload:    json.RawMessage(payload),
		Action:     action,
		Title:      title,
		EntityType: jobs.EntityMachine,
		EntityID:   machineID.String(),
		CreatedBy:  jobs.UserID(r),
	})
	if err != nil {
		http.Error(w, "Failed to create job", http.StatusInternalServerError)
		return
	}
	if !wait {
		writeJSON(w, http.StatusAccepted, jobCreatedResponse(job))
		return
	}
	done, _ := waitForJob(r.Context(), h.db, job.ID, 20*time.Second)
	if done == nil {
		done = job
	}
	logs := nullStringToString(done.Logs)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"job_id":   job.ID,
		"status":   done.Status,
		"finished": models.IsTerminalJobStatus(done.Status),
		"test_ok":  hasMarkerLine(logs, "CFX_NGINX_TEST_RC|0"),
		"output":   logs,
	})
}

// hasMarkerLine reports whether a log line starts with marker (echoed commands start with "$ ").
func hasMarkerLine(logs, marker string) bool {
	for _, line := range strings.Split(logs, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), marker) {
			return true
		}
	}
	return false
}

// fileFQDN is the normalized (punycode, lowercase) name used for config files and server_name.
func fileFQDN(fqdn string) string {
	if n, err := templates.NormalizeFQDN(fqdn); err == nil {
		return n
	}
	return fqdn
}

// GetMachineNginxExpected: GET /api/machines/{id}/nginx/expected?path=<abs path>
// Returns exactly what Configuratix would write for a managed file (same renderer as drift).
// 404 for unmanaged paths or managed paths the DB would not generate for this machine.
func (h *MachineNginxHandler) GetMachineNginxExpected(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	if !canAccessMachineID(h.db, r, machineID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	p, ok := templates.CleanAbsPath(r.URL.Query().Get("path"))
	if !ok {
		http.Error(w, "path must be an absolute path", http.StatusBadRequest)
		return
	}

	type source struct {
		Kind          string     `json:"kind"` // domain | passthrough_stream | passthrough_http | passthrough_l7
		DomainID      *uuid.UUID `json:"domain_id,omitempty"`
		NginxConfigID *uuid.UUID `json:"nginx_config_id,omitempty"`
	}
	respond := func(content string, src source) {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"path": p, "content": content, "sha256": sha256Hex(content), "source": src,
		})
	}

	passthroughFiles := map[string]string{
		"/etc/nginx/stream.d/configuratix-passthrough.conf":        "passthrough_stream",
		"/etc/nginx/conf.d/configuratix/passthrough-dns-http.conf": "passthrough_http",
		"/etc/nginx/conf.d/configuratix/passthrough-dns-l7.conf":   "passthrough_l7",
	}
	if kind, ok := passthroughFiles[p]; ok {
		bundle, err := NewPassthroughNginxGenerator(h.db).GenerateForMachine(machineID)
		if err != nil {
			http.Error(w, "Failed to render passthrough config", http.StatusInternalServerError)
			return
		}
		content := map[string]string{
			"passthrough_stream": bundle.StreamConfig,
			"passthrough_http":   bundle.HTTPConfig,
			"passthrough_l7":     bundle.L7Config,
		}[kind]
		if content == "" {
			http.Error(w, "Configuratix does not generate this file for this machine", http.StatusNotFound)
			return
		}
		respond(content, source{Kind: kind})
		return
	}

	dir, base := path.Dir(p), path.Base(p)
	if dir != "/etc/nginx/conf.d/configuratix" || !strings.HasSuffix(base, ".conf") || strings.HasPrefix(base, "passthrough-") {
		http.Error(w, "Not a Configuratix-managed file", http.StatusNotFound)
		return
	}
	fqdn := strings.TrimSuffix(base, ".conf")

	var domains []struct {
		ID       uuid.UUID  `db:"id"`
		FQDN     string     `db:"fqdn"`
		ConfigID *uuid.UUID `db:"config_id"`
	}
	h.db.Select(&domains, `
		SELECT d.id, d.fqdn, (SELECT nginx_config_id FROM domain_config_links WHERE domain_id = d.id LIMIT 1) AS config_id
		FROM domains d WHERE d.assigned_machine_id = $1`, machineID)
	for _, d := range domains {
		if fileFQDN(d.FQDN) != fqdn {
			continue
		}
		if d.ConfigID == nil {
			http.Error(w, "Domain has no nginx config assigned", http.StatusNotFound)
			return
		}
		mID := machineID
		rendered, cfgJSON, err := renderDomainNginxConfig(h.db, h.db, fqdn, *d.ConfigID, &mID)
		if err != nil {
			http.Error(w, "Failed to render config: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if isPassthroughConfig(cfgJSON) || rendered == "" {
			http.Error(w, "Passthrough domains have no per-domain HTTP config file", http.StatusNotFound)
			return
		}
		id, cid := d.ID, *d.ConfigID
		respond(rendered, source{Kind: "domain", DomainID: &id, NginxConfigID: &cid})
		return
	}
	http.Error(w, "No domain assigned to this machine matches this file", http.StatusNotFound)
}
