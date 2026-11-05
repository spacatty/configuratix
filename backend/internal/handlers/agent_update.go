package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobhooks"
	"configuratix/backend/internal/jobs"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

// CurrentAgentVersion is only a fallback. The target agent version is read
// from $AGENT_VERSION, else from agent-binaries/version.json ("version").
// The backend injects it into the agent build via -ldflags -X main.Version.
const CurrentAgentVersion = "0.6.0"

// SupportedAgentArches are built and served by the backend (linux only).
var SupportedAgentArches = []string{"amd64", "arm64"}

const (
	defaultAgentArch = "amd64"
	// agentUpdateTimeout: an update not confirmed by a heartbeat in this time fails.
	agentUpdateTimeout = 5 * time.Minute
	// AgentOnlineThreshold: an agent is online when last_seen is newer than this.
	AgentOnlineThreshold = 90 * time.Second
)

// updateInProgressSQL lists agents.update_state values of an unfinished update.
const updateInProgressSQL = `('pending','downloading','verifying','installing','restarting')`

func isUpdateInProgress(s string) bool {
	switch s {
	case "pending", "downloading", "verifying", "installing", "restarting":
		return true
	}
	return false
}

// AgentUpdateHandler handles agent update distribution
type AgentUpdateHandler struct {
	db          *database.DB
	binaryDir   string
	versionInfo *AgentVersionInfo
	versionLock sync.RWMutex
	buildLock   sync.Mutex
}

// AgentArchInfo is the per-architecture binary info.
type AgentArchInfo struct {
	Checksum string `json:"checksum"` // SHA256 of the binary
	Size     int64  `json:"size"`
}

// AgentVersionInfo contains version information for the agent.
// Checksum/Size are the amd64 values (kept for agents <= 0.5.x).
type AgentVersionInfo struct {
	Version   string                   `json:"version"`
	Checksum  string                   `json:"checksum,omitempty"`
	Size      int64                    `json:"size,omitempty"`
	UpdatedAt string                   `json:"updated_at,omitempty"`
	Arches    map[string]AgentArchInfo `json:"arches,omitempty"`
}

var (
	activeUpdateHandler   *AgentUpdateHandler
	activeUpdateHandlerMu sync.RWMutex
)

// AgentTargetVersion returns the agent version currently distributed.
func AgentTargetVersion() string {
	activeUpdateHandlerMu.RLock()
	h := activeUpdateHandler
	activeUpdateHandlerMu.RUnlock()
	if h != nil {
		h.versionLock.RLock()
		info := h.versionInfo
		h.versionLock.RUnlock()
		if info != nil && info.Version != "" {
			return info.Version
		}
	}
	return resolveTargetVersion("")
}

// IsAgentOutdated reports whether version is older than the distributed one.
func IsAgentOutdated(version string) bool {
	target := AgentTargetVersion()
	if version == "" || target == "" {
		return false
	}
	return compareVersions(version, target) < 0
}

// compareVersions compares dotted numeric versions ("0.5.3" < "0.6.0").
// Non-numeric parts compare lexically.
func compareVersions(a, b string) int {
	pa := strings.Split(strings.TrimPrefix(a, "v"), ".")
	pb := strings.Split(strings.TrimPrefix(b, "v"), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		sa, sb := "0", "0"
		if i < len(pa) {
			sa = pa[i]
		}
		if i < len(pb) {
			sb = pb[i]
		}
		na, ea := strconv.Atoi(sa)
		nb, eb := strconv.Atoi(sb)
		switch {
		case ea == nil && eb == nil:
			if na != nb {
				if na < nb {
					return -1
				}
				return 1
			}
		default:
			if sa != sb {
				if sa < sb {
					return -1
				}
				return 1
			}
		}
	}
	return 0
}

func binaryName(arch string) string {
	if arch == defaultAgentArch {
		return "configuratix-agent" // legacy name, also used by uploads / install.sh
	}
	return "configuratix-agent-" + arch
}

func validArch(arch string) bool {
	for _, a := range SupportedAgentArches {
		if a == arch {
			return true
		}
	}
	return false
}

// resolveTargetVersion: $AGENT_VERSION > version.json > CurrentAgentVersion.
func resolveTargetVersion(fileVersion string) string {
	if v := strings.TrimSpace(os.Getenv("AGENT_VERSION")); v != "" {
		return v
	}
	if fileVersion != "" {
		return fileVersion
	}
	return CurrentAgentVersion
}

// NewAgentUpdateHandler creates a new agent update handler
func NewAgentUpdateHandler(db *database.DB, binaryDir string) *AgentUpdateHandler {
	h := &AgentUpdateHandler{
		db:        db,
		binaryDir: binaryDir,
	}

	// Auto-build agent on startup
	h.buildAgentIfNeeded()

	activeUpdateHandlerMu.Lock()
	activeUpdateHandler = h
	activeUpdateHandlerMu.Unlock()
	return h
}

func (h *AgentUpdateHandler) readVersionFile() *AgentVersionInfo {
	data, err := os.ReadFile(filepath.Join(h.binaryDir, "version.json"))
	if err != nil {
		return nil
	}
	var info AgentVersionInfo
	if err := json.Unmarshal(data, &info); err != nil {
		log.Printf("Failed to parse agent version file: %v", err)
		return nil
	}
	if info.Arches == nil {
		info.Arches = map[string]AgentArchInfo{}
	}
	// Legacy file (single amd64 binary).
	if _, ok := info.Arches[defaultAgentArch]; !ok && info.Checksum != "" {
		info.Arches[defaultAgentArch] = AgentArchInfo{Checksum: info.Checksum, Size: info.Size}
	}
	return &info
}

func fileSHA256(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	hasher := sha256.New()
	n, err := io.Copy(hasher, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hasher.Sum(nil)), n, nil
}

// buildAgentIfNeeded (re)builds every arch whose binary is missing, doesn't
// match the recorded checksum, or was built for another version.
func (h *AgentUpdateHandler) buildAgentIfNeeded() {
	if err := os.MkdirAll(h.binaryDir, 0755); err != nil {
		log.Printf("Failed to create agent binary directory: %v", err)
		return
	}
	existing := h.readVersionFile()
	fileVersion := ""
	if existing != nil {
		fileVersion = existing.Version
	}
	target := resolveTargetVersion(fileVersion)

	var need []string
	for _, arch := range SupportedAgentArches {
		ok := existing != nil && existing.Version == target
		if ok {
			ai, has := existing.Arches[arch]
			sum, _, err := fileSHA256(filepath.Join(h.binaryDir, binaryName(arch)))
			ok = has && ai.Checksum != "" && err == nil && sum == ai.Checksum
		}
		if !ok {
			need = append(need, arch)
		}
	}

	if len(need) == 0 {
		log.Printf("Agent binaries v%s already exist (%s), skipping build", target, strings.Join(SupportedAgentArches, ", "))
		h.loadVersionInfo()
		return
	}

	log.Printf("=== Building agent binary v%s for %s ===", target, strings.Join(need, ", "))
	if err := h.buildArches(target, need, existing); err != nil {
		log.Printf("ERROR: Failed to build agent: %v", err)
		log.Printf("Agent auto-update will not work for the failed architectures until rebuilt")
	}
	h.loadVersionInfo()
}

// buildArches builds the given arches in parallel and records them in
// version.json (keeping other arches if they belong to the same version).
func (h *AgentUpdateHandler) buildArches(version string, arches []string, existing *AgentVersionInfo) error {
	h.buildLock.Lock()
	defer h.buildLock.Unlock()

	info := &AgentVersionInfo{Version: version, Arches: map[string]AgentArchInfo{}}
	if existing != nil && existing.Version == version {
		for k, v := range existing.Arches {
			info.Arches[k] = v
		}
	}

	type res struct {
		arch string
		ai   AgentArchInfo
		err  error
	}
	results := make(chan res, len(arches))
	for _, arch := range arches {
		go func(arch string) {
			ai, err := h.buildAgent(version, arch)
			results <- res{arch, ai, err}
		}(arch)
	}
	var errs []string
	for range arches {
		r := <-results
		if r.err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", r.arch, r.err))
			delete(info.Arches, r.arch)
			continue
		}
		info.Arches[r.arch] = r.ai
	}
	if len(info.Arches) == 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	if err := h.writeVersionInfo(info); err != nil {
		return err
	}
	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}

func (h *AgentUpdateHandler) writeVersionInfo(info *AgentVersionInfo) error {
	if a, ok := info.Arches[defaultAgentArch]; ok {
		info.Checksum, info.Size = a.Checksum, a.Size
	} else {
		info.Checksum, info.Size = "", 0
	}
	info.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	data, _ := json.MarshalIndent(info, "", "  ")
	path := filepath.Join(h.binaryDir, "version.json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0644); err != nil {
		return fmt.Errorf("failed to write version file: %v", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("failed to write version file: %v", err)
	}
	h.versionLock.Lock()
	h.versionInfo = info
	h.versionLock.Unlock()
	return nil
}

func findAgentSourceDir() (string, error) {
	cwd, _ := os.Getwd()
	for _, d := range []string{"../agent", "agent"} {
		if _, err := os.Stat(filepath.Join(d, "go.mod")); err == nil {
			return d, nil
		}
	}
	return "", fmt.Errorf("agent source directory not found (tried ../agent and agent from %s)", cwd)
}

// buildAgent compiles the agent binary for linux/<arch> with the version injected.
func (h *AgentUpdateHandler) buildAgent(version, arch string) (AgentArchInfo, error) {
	agentDir, err := findAgentSourceDir()
	if err != nil {
		return AgentArchInfo{}, err
	}
	absBinaryDir, err := filepath.Abs(h.binaryDir)
	if err != nil {
		return AgentArchInfo{}, fmt.Errorf("failed to get absolute path: %v", err)
	}
	if err := os.MkdirAll(absBinaryDir, 0755); err != nil {
		return AgentArchInfo{}, fmt.Errorf("failed to create binary directory: %v", err)
	}
	if _, err := exec.LookPath("go"); err != nil {
		return AgentArchInfo{}, fmt.Errorf("go not found in PATH: %v", err)
	}

	binaryPath := filepath.Join(absBinaryDir, binaryName(arch))
	tempPath := binaryPath + ".tmp"
	ldflags := "-s -w -X main.Version=" + version
	cmd := exec.Command("go", "build", "-trimpath", "-ldflags", ldflags, "-o", tempPath, "./cmd/agent")
	cmd.Dir = agentDir
	cmd.Env = append(os.Environ(), "GOOS=linux", "GOARCH="+arch, "CGO_ENABLED=0")
	log.Printf("Running: GOOS=linux GOARCH=%s go build -ldflags %q -o %s ./cmd/agent (in %s)", arch, ldflags, tempPath, agentDir)
	if output, err := cmd.CombinedOutput(); err != nil {
		os.Remove(tempPath)
		return AgentArchInfo{}, fmt.Errorf("go build failed: %v\nOutput: %s", err, string(output))
	}

	checksum, size, err := fileSHA256(tempPath)
	if err != nil {
		os.Remove(tempPath)
		return AgentArchInfo{}, fmt.Errorf("failed to calculate checksum: %v", err)
	}
	os.Chmod(tempPath, 0755)
	if err := os.Rename(tempPath, binaryPath); err != nil {
		os.Remove(tempPath)
		return AgentArchInfo{}, fmt.Errorf("failed to move binary: %v", err)
	}
	log.Printf("Agent binary published: version=%s arch=%s size=%d checksum=%s...", version, arch, size, checksum[:16])
	return AgentArchInfo{Checksum: checksum, Size: size}, nil
}

// loadVersionInfo reads version info from the binary directory
func (h *AgentUpdateHandler) loadVersionInfo() {
	info := h.readVersionFile()
	if info == nil {
		log.Printf("No agent version file found in %s", h.binaryDir)
		return
	}
	h.versionLock.Lock()
	h.versionInfo = info
	h.versionLock.Unlock()
	arches := make([]string, 0, len(info.Arches))
	for a := range info.Arches {
		arches = append(arches, a)
	}
	log.Printf("Agent version loaded: %s (arches: %s)", info.Version, strings.Join(arches, ", "))
}

func (h *AgentUpdateHandler) current() *AgentVersionInfo {
	h.versionLock.RLock()
	defer h.versionLock.RUnlock()
	return h.versionInfo
}

func requestArch(r *http.Request) string {
	arch := strings.TrimSpace(r.URL.Query().Get("arch"))
	switch arch {
	case "":
		return defaultAgentArch
	case "x86_64":
		return "amd64"
	case "aarch64":
		return "arm64"
	}
	return arch
}

// GetVersion returns the distributed agent version. ?arch= selects which
// arch's checksum/size fill the legacy top-level fields (default amd64).
func (h *AgentUpdateHandler) GetVersion(w http.ResponseWriter, r *http.Request) {
	info := h.current()
	if info == nil {
		http.Error(w, "No agent version available", http.StatusNotFound)
		return
	}
	arch := requestArch(r)
	out := AgentVersionInfo{Version: info.Version, UpdatedAt: info.UpdatedAt, Arches: info.Arches}
	if a, ok := info.Arches[arch]; ok {
		out.Checksum, out.Size = a.Checksum, a.Size
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// DownloadAgent serves the agent binary (?arch=amd64|arm64, default amd64).
// Headers: X-Agent-Version, X-Agent-Checksum (sha256, required by agents
// >= 0.6.0 and verified by 0.5.x), X-Agent-Arch.
func (h *AgentUpdateHandler) DownloadAgent(w http.ResponseWriter, r *http.Request) {
	info := h.current()
	if info == nil {
		http.Error(w, "No agent binary available", http.StatusNotFound)
		return
	}
	arch := requestArch(r)
	if !validArch(arch) {
		http.Error(w, "Unsupported architecture", http.StatusBadRequest)
		return
	}
	ai, ok := info.Arches[arch]
	if !ok || ai.Checksum == "" {
		http.Error(w, "No agent binary available for "+arch, http.StatusNotFound)
		return
	}

	file, err := os.Open(filepath.Join(h.binaryDir, binaryName(arch)))
	if err != nil {
		log.Printf("Failed to open agent binary: %v", err)
		http.Error(w, "Agent binary not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		http.Error(w, "Failed to stat binary", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=configuratix-agent")
	w.Header().Set("X-Agent-Version", info.Version)
	w.Header().Set("X-Agent-Checksum", ai.Checksum)
	w.Header().Set("X-Agent-Arch", arch)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", stat.Size()))

	io.Copy(w, file)
}

// UploadAgent allows uploading a new agent binary (admin only).
// Form fields: version (required), arch (default amd64), binary (file).
func (h *AgentUpdateHandler) UploadAgent(w http.ResponseWriter, r *http.Request) {
	version := r.FormValue("version")
	if version == "" {
		http.Error(w, "Version is required", http.StatusBadRequest)
		return
	}
	arch := strings.TrimSpace(r.FormValue("arch"))
	if arch == "" {
		arch = defaultAgentArch
	}
	if !validArch(arch) {
		http.Error(w, "Unsupported architecture", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("binary")
	if err != nil {
		http.Error(w, "Binary file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if err := os.MkdirAll(h.binaryDir, 0755); err != nil {
		http.Error(w, "Failed to create binary directory", http.StatusInternalServerError)
		return
	}

	finalPath := filepath.Join(h.binaryDir, binaryName(arch))
	tempPath := finalPath + ".tmp"
	tempFile, err := os.Create(tempPath)
	if err != nil {
		http.Error(w, "Failed to create temp file", http.StatusInternalServerError)
		return
	}
	hasher := sha256.New()
	size, err := io.Copy(io.MultiWriter(tempFile, hasher), file)
	tempFile.Close()
	if err != nil {
		os.Remove(tempPath)
		http.Error(w, "Failed to write binary", http.StatusInternalServerError)
		return
	}
	checksum := hex.EncodeToString(hasher.Sum(nil))
	if err := os.Rename(tempPath, finalPath); err != nil {
		os.Remove(tempPath)
		http.Error(w, "Failed to finalize binary", http.StatusInternalServerError)
		return
	}
	os.Chmod(finalPath, 0755)

	h.buildLock.Lock()
	info := &AgentVersionInfo{Version: version, Arches: map[string]AgentArchInfo{}}
	if cur := h.current(); cur != nil && cur.Version == version {
		for k, v := range cur.Arches {
			info.Arches[k] = v
		}
	}
	info.Arches[arch] = AgentArchInfo{Checksum: checksum, Size: size}
	err = h.writeVersionInfo(info)
	h.buildLock.Unlock()
	if err != nil {
		log.Printf("Failed to write version file: %v", err)
	}

	log.Printf("Agent binary uploaded: version=%s arch=%s size=%d checksum=%s...", version, arch, size, checksum[:16])

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

// ReloadVersion reloads version info from disk
func (h *AgentUpdateHandler) ReloadVersion(w http.ResponseWriter, r *http.Request) {
	h.loadVersionInfo()
	info := h.current()
	if info == nil {
		http.Error(w, "No version info loaded", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

// RebuildAgent forces a rebuild of all agent binaries
func (h *AgentUpdateHandler) RebuildAgent(w http.ResponseWriter, r *http.Request) {
	log.Printf("Force rebuilding agent binaries...")
	fileVersion := ""
	existing := h.readVersionFile()
	if existing != nil {
		fileVersion = existing.Version
	}
	if err := h.buildArches(resolveTargetVersion(fileVersion), SupportedAgentArches, nil); err != nil {
		log.Printf("Failed to rebuild agent: %v", err)
		http.Error(w, fmt.Sprintf("Failed to rebuild agent: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.current())
}

type agentUpdateRow struct {
	AgentID         uuid.UUID  `db:"agent_id"`
	MachineID       uuid.UUID  `db:"machine_id"`
	Version         string     `db:"version"`
	Arch            string     `db:"arch"`
	UpdateState     string     `db:"update_state"`
	UpdateStartedAt *time.Time `db:"update_started_at"`
	LastSeen        *time.Time `db:"last_seen"`
}

const agentUpdateRowSelect = `
	SELECT a.id AS agent_id, m.id AS machine_id, COALESCE(a.version, '') AS version,
		COALESCE(a.arch, '') AS arch, COALESCE(a.update_state, '') AS update_state,
		a.update_started_at, a.last_seen
	FROM agents a JOIN machines m ON m.agent_id = a.id`

func (row *agentUpdateRow) updating() bool {
	return isUpdateInProgress(row.UpdateState) && row.UpdateStartedAt != nil &&
		time.Since(*row.UpdateStartedAt) < 2*agentUpdateTimeout
}

func (row *agentUpdateRow) online() bool {
	return row.LastSeen != nil && time.Since(*row.LastSeen) < AgentOnlineThreshold
}

// startAgentUpdate creates the update_agent job and marks the agent pending.
func (h *AgentUpdateHandler) startAgentUpdate(ctx context.Context, r *http.Request, row *agentUpdateRow, target string) (uuid.UUID, error) {
	tx, err := h.db.BeginTxx(ctx, nil)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback()

	job, err := jobs.Create(ctx, tx, jobs.Spec{
		AgentID:        row.AgentID,
		Type:           "update_agent",
		Payload:        map[string]string{"action": "update", "target_version": target},
		Title:          "Update agent to " + target,
		Action:         "update_agent",
		EntityType:     jobs.EntityMachine,
		EntityID:       row.MachineID.String(),
		CreatedBy:      jobs.UserID(r),
		TimeoutSeconds: int((agentUpdateTimeout + time.Minute).Seconds()),
	})
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE agents SET update_state = 'pending', update_target_version = $2,
			update_started_at = NOW(), update_job_id = $3, last_update_error = NULL
		WHERE id = $1
	`, row.AgentID, target, job.ID); err != nil {
		return uuid.Nil, err
	}
	return job.ID, tx.Commit()
}

func writeJSONStatus(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// TriggerMachineUpdate creates an update job for a specific machine.
// 409 when an update is already running or the agent is up to date (?force=true overrides the latter).
func (h *AgentUpdateHandler) TriggerMachineUpdate(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}
	info := h.current()
	if info == nil || info.Version == "" {
		http.Error(w, "No agent version available", http.StatusNotFound)
		return
	}

	var row agentUpdateRow
	if err := h.db.Get(&row, agentUpdateRowSelect+` WHERE m.id = $1`, machineID); err != nil {
		http.Error(w, "Machine not found", http.StatusNotFound)
		return
	}
	force := r.URL.Query().Get("force") == "true" || r.URL.Query().Get("force") == "1"

	if row.updating() {
		http.Error(w, "Agent update already in progress ("+row.UpdateState+")", http.StatusConflict)
		return
	}
	if !force && row.Version == info.Version {
		http.Error(w, "Agent is already on version "+info.Version, http.StatusConflict)
		return
	}
	if row.Arch != "" {
		if ai, ok := info.Arches[row.Arch]; !ok || ai.Checksum == "" {
			http.Error(w, "No agent binary available for architecture "+row.Arch, http.StatusConflict)
			return
		}
	}

	jobID, err := h.startAgentUpdate(r.Context(), r, &row, info.Version)
	if err != nil {
		log.Printf("Failed to create update job: %v", err)
		http.Error(w, "Failed to create update job", http.StatusInternalServerError)
		return
	}
	log.Printf("Created update job %s for machine %s (%s -> %s)", jobID, machineID, row.Version, info.Version)

	writeJSONStatus(w, http.StatusOK, map[string]string{
		"job_id":         jobID.String(),
		"machine_id":     machineID.String(),
		"status":         "pending",
		"target_version": info.Version,
	})
}

// TriggerAllUpdates creates update jobs for all online machines with outdated
// agents, skipping agents already updating, up to date, offline, or whose
// architecture has no binary.
func (h *AgentUpdateHandler) TriggerAllUpdates(w http.ResponseWriter, r *http.Request) {
	info := h.current()
	if info == nil || info.Version == "" {
		http.Error(w, "No agent version available", http.StatusNotFound)
		return
	}
	latestVersion := info.Version

	var rows []agentUpdateRow
	if err := h.db.Select(&rows, agentUpdateRowSelect); err != nil {
		log.Printf("Failed to query agents: %v", err)
		http.Error(w, "Failed to query agents", http.StatusInternalServerError)
		return
	}

	var created, upToDate, updating, offline, noBinary, failed int
	outdated := 0
	for i := range rows {
		row := &rows[i]
		if row.Version == latestVersion {
			upToDate++
			continue
		}
		outdated++
		if row.updating() {
			updating++
			continue
		}
		if !row.online() {
			offline++
			continue
		}
		arch := row.Arch
		if arch == "" {
			arch = defaultAgentArch // pre-0.6 agents don't report arch; only amd64 was ever served
		}
		if ai, ok := info.Arches[arch]; !ok || ai.Checksum == "" {
			noBinary++
			continue
		}
		jobID, err := h.startAgentUpdate(r.Context(), r, row, latestVersion)
		if err != nil {
			log.Printf("Failed to create update job for agent %s: %v", row.AgentID, err)
			failed++
			continue
		}
		created++
		log.Printf("Created update job %s for machine %s (current: %s, latest: %s)", jobID, row.MachineID, row.Version, latestVersion)
	}

	writeJSONStatus(w, http.StatusOK, map[string]interface{}{
		"latest_version":       latestVersion,
		"agents_found":         outdated, // outdated agents (legacy field name)
		"jobs_created":         created,
		"skipped_up_to_date":   upToDate,
		"skipped_updating":     updating,
		"skipped_offline":      offline,
		"skipped_no_binary":    noBinary,
		"failed":               failed,
		"total_agents_checked": len(rows),
	})
}

// --- update state machine (heartbeat / job update / reaper) ---------------

// processUpdateHeartbeat advances agents.update_state from a heartbeat: a
// heartbeat reporting the target version confirms the update; v2 agents also
// report their own progress / rollback.
func (h *AgentHandler) processUpdateHeartbeat(ctx context.Context, agentID uuid.UUID, req *HeartbeatRequest) {
	var a struct {
		State  string     `db:"update_state"`
		Target string     `db:"update_target_version"`
		JobID  *uuid.UUID `db:"update_job_id"`
	}
	err := h.db.GetContext(ctx, &a, `
		SELECT COALESCE(update_state, '') AS update_state, COALESCE(update_target_version, '') AS update_target_version, update_job_id
		FROM agents WHERE id = $1`, agentID)
	if err != nil || !isUpdateInProgress(a.State) {
		return
	}
	sameJob := req.UpdateJobID == "" || a.JobID == nil || req.UpdateJobID == a.JobID.String()

	if a.Target != "" && req.Version == a.Target {
		confirmAgentUpdate(ctx, h.db, agentID, a.JobID, req.Version)
		return
	}
	if !sameJob {
		return
	}
	switch req.UpdateState {
	case "rolled_back":
		msg := req.UpdateError
		if msg == "" {
			msg = "agent rolled back to " + req.Version
		}
		finishAgentUpdate(ctx, h.db, agentID, a.JobID, "rolled_back", msg)
	case "failed":
		msg := req.UpdateError
		if msg == "" {
			msg = "agent reported update failure"
		}
		finishAgentUpdate(ctx, h.db, agentID, a.JobID, "failed", msg)
	case "downloading", "verifying", "installing", "restarting":
		h.db.ExecContext(ctx, `UPDATE agents SET update_state = $2 WHERE id = $1 AND update_state IN `+updateInProgressSQL, agentID, req.UpdateState)
	}
}

// confirmAgentUpdate completes the update job once the target version is seen.
func confirmAgentUpdate(ctx context.Context, db *database.DB, agentID uuid.UUID, jobID *uuid.UUID, version string) {
	if _, err := db.ExecContext(ctx, `
		UPDATE agents SET update_state = 'confirmed', last_update_error = NULL
		WHERE id = $1 AND update_state IN `+updateInProgressSQL, agentID); err != nil {
		log.Printf("Failed to confirm agent update for %s: %v", agentID, err)
		return
	}
	if jobID == nil {
		return
	}
	res, err := db.ExecContext(ctx, `
		UPDATE jobs SET status = 'completed', finished_at = NOW(), updated_at = NOW(),
			started_at = COALESCE(started_at, NOW()), error_message = NULL,
			logs = COALESCE(logs, '') || $2
		WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')
	`, *jobID, "\n[server] Agent reported version "+version+" - update confirmed.\n")
	if err != nil {
		log.Printf("Failed to complete update job %s: %v", *jobID, err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("Agent %s confirmed update to %s (job %s)", agentID, version, *jobID)
		jobhooks.OnJobFinished(context.Background(), db, jobID.String())
	}
}

// finishAgentUpdate marks an unconfirmed update failed / rolled_back.
func finishAgentUpdate(ctx context.Context, db *database.DB, agentID uuid.UUID, jobID *uuid.UUID, stateVal, msg string) {
	if _, err := db.ExecContext(ctx, `
		UPDATE agents SET update_state = $2, last_update_error = $3
		WHERE id = $1 AND update_state IN `+updateInProgressSQL, agentID, stateVal, msg); err != nil {
		log.Printf("Failed to mark agent update %s for %s: %v", stateVal, agentID, err)
		return
	}
	if jobID == nil {
		return
	}
	res, err := db.ExecContext(ctx, `
		UPDATE jobs SET status = 'failed', finished_at = NOW(), updated_at = NOW(),
			error_message = $2, logs = COALESCE(logs, '') || $3
		WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')
	`, *jobID, msg, "\n[server] Update "+stateVal+": "+msg+"\n")
	if err != nil {
		log.Printf("Failed to fail update job %s: %v", *jobID, err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("Agent %s update %s (job %s): %s", agentID, stateVal, *jobID, msg)
		jobhooks.OnJobFinished(context.Background(), db, jobID.String())
	}
}

// reapStaleAgentUpdates fails updates not confirmed within agentUpdateTimeout.
func reapStaleAgentUpdates(ctx context.Context, db *database.DB) {
	var rows []struct {
		ID    uuid.UUID      `db:"id"`
		JobID *uuid.UUID     `db:"update_job_id"`
		State sql.NullString `db:"update_state"`
	}
	err := db.SelectContext(ctx, &rows, `
		SELECT id, update_job_id, update_state FROM agents
		WHERE update_state IN `+updateInProgressSQL+`
		AND update_started_at < NOW() - make_interval(secs => $1)
	`, agentUpdateTimeout.Seconds())
	if err != nil {
		log.Printf("Agent update reaper: %v", err)
		return
	}
	for _, r := range rows {
		msg := fmt.Sprintf("update not confirmed within %s (last state: %s)", agentUpdateTimeout, r.State.String)
		finishAgentUpdate(ctx, db, r.ID, r.JobID, "failed", msg)
	}
}
