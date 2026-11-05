package handlers

import (
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"configuratix/backend/internal/database"

	"github.com/google/uuid"
)

// DashboardHandler serves GET /api/dashboard (permission-scoped summary).
type DashboardHandler struct {
	db      *database.DB
	updates *AgentUpdateHandler // optional: latest agent version for outdated_agents
}

func NewDashboardHandler(db *database.DB, updates *AgentUpdateHandler) *DashboardHandler {
	return &DashboardHandler{db: db, updates: updates}
}

type dashboardMachines struct {
	Total          int     `db:"total" json:"total"`
	Online         int     `db:"online" json:"online"`
	Offline        int     `db:"offline" json:"offline"`
	OutdatedAgents *int    `db:"-" json:"outdated_agents"`
	Updating       int     `db:"updating" json:"updating"`
	LatestVersion  *string `db:"-" json:"latest_agent_version"`
}

type dashboardDomains struct {
	Total           int  `db:"total" json:"total"`
	Healthy         int  `db:"healthy" json:"healthy"`
	Unhealthy       int  `db:"unhealthy" json:"unhealthy"`
	Unknown         int  `db:"unknown" json:"unknown"`
	ApplyFailed     int  `db:"apply_failed" json:"apply_failed"`
	Applying        int  `db:"applying" json:"applying"`
	SSLExpiringSoon *int `db:"-" json:"ssl_expiring_soon"`
}

type dashboardRecentFailed struct {
	ID           uuid.UUID  `db:"id" json:"id"`
	Title        string     `db:"title" json:"title"`
	MachineID    *uuid.UUID `db:"machine_id" json:"machine_id"`
	MachineTitle *string    `db:"machine_title" json:"machine_title"`
	FinishedAt   *time.Time `db:"finished_at" json:"finished_at"`
	ErrorMessage *string    `db:"error_message" json:"error_message"`
}

type dashboardTopMachine struct {
	ID      uuid.UUID `db:"id" json:"id"`
	Title   string    `db:"title" json:"title"`
	CPU     float64   `db:"cpu" json:"cpu"`
	MemPct  float64   `db:"mem_pct" json:"mem_pct"`
	DiskPct float64   `db:"disk_pct" json:"disk_pct"`
	Online  bool      `db:"online" json:"online"`
}

// GetDashboard: GET /api/dashboard
func (h *DashboardHandler) GetDashboard(w http.ResponseWriter, r *http.Request) {
	claims, userID, ok := requestClaims(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	super := claims.IsSuperAdmin()

	// Machine scope: "<cond>" on alias m with $1 = user id (no-op for superadmin).
	machineWhere := "TRUE"
	domainWhere := "TRUE"
	configWhere := "TRUE"
	args := []interface{}{}
	if !super {
		machineWhere = machineVisibilitySQL("m", 1)
		domainWhere = "(d.owner_id = $1 OR d.owner_id IS NULL)"
		configWhere = "(nc.owner_id = $1 OR nc.owner_id IS NULL)"
		args = append(args, userID)
	}

	resp := map[string]interface{}{"generated_at": time.Now().UTC()}
	// The sections are independent; run them concurrently so remote-DB latency doesn't add up.
	var mu sync.Mutex
	var wg sync.WaitGroup
	set := func(k string, v interface{}) { mu.Lock(); resp[k] = v; mu.Unlock() }
	run := func(f func()) { wg.Add(1); go func() { defer wg.Done(); f() }() }

	run(func() {
		var machines dashboardMachines
		if err := h.db.Get(&machines, `
		SELECT COUNT(*)::int AS total,
			COUNT(*) FILTER (WHERE a.last_seen > NOW() - INTERVAL '90 seconds')::int AS online,
			COUNT(*) FILTER (WHERE a.last_seen IS NULL OR a.last_seen <= NOW() - INTERVAL '90 seconds')::int AS offline,
			COUNT(*) FILTER (WHERE a.update_state IN `+updateInProgressSQL+`)::int AS updating
		FROM machines m LEFT JOIN agents a ON a.id = m.agent_id
		WHERE `+machineWhere, args...); err != nil {
			log.Printf("dashboard machines: %v", err)
		}
		if h.updates != nil {
			if info := h.updates.current(); info != nil && info.Version != "" {
				v := info.Version
				machines.LatestVersion = &v
				var n int
				if err := h.db.Get(&n, `SELECT COUNT(*)::int FROM machines m JOIN agents a ON a.id = m.agent_id
				WHERE a.version IS DISTINCT FROM $`+argN(len(args)+1)+` AND `+machineWhere, append(args, v)...); err == nil {
					machines.OutdatedAgents = &n
				}
			}
		}
		set("machines", machines)
	})

	run(func() {
		var domains dashboardDomains
		if err := h.db.Get(&domains, `
		SELECT COUNT(*)::int AS total,
			COUNT(*) FILTER (WHERE d.status = 'healthy')::int AS healthy,
			COUNT(*) FILTER (WHERE d.status = 'unhealthy')::int AS unhealthy,
			COUNT(*) FILTER (WHERE d.status NOT IN ('healthy', 'unhealthy') OR d.status IS NULL)::int AS unknown,
			COUNT(*) FILTER (WHERE d.apply_status = 'failed')::int AS apply_failed,
			COUNT(*) FILTER (WHERE d.apply_status IN ('pending', 'applying', 'removing'))::int AS applying
		FROM domains d WHERE `+domainWhere, args...); err != nil {
			log.Printf("dashboard domains: %v", err)
		}
		// L7 proxy certificates expiring within 30 days (only certificate data the system tracks).
		var expiring int
		if err := h.db.Get(&expiring, `SELECT COUNT(*)::int FROM dns_l7_certificates c JOIN machines m ON m.id = c.machine_id
		WHERE c.expires_at IS NOT NULL AND c.expires_at < NOW() + INTERVAL '30 days' AND `+machineWhere, args...); err == nil {
			domains.SSLExpiringSoon = &expiring
		}
		set("domains", domains)
	})

	run(func() {
		var configs struct {
			Total            int `db:"total" json:"total"`
			OutOfSync        int `db:"out_of_sync" json:"out_of_sync"`
			OutOfSyncDomains int `db:"out_of_sync_domains" json:"out_of_sync_domains"`
		}
		if err := h.db.Get(&configs, `
		WITH visible AS (SELECT nc.id, nc.updated_at FROM nginx_configs nc WHERE `+configWhere+`),
		stale AS (
			SELECT l.nginx_config_id, d.id FROM domain_config_links l
			JOIN visible v ON v.id = l.nginx_config_id
			JOIN domains d ON d.id = l.domain_id
			WHERE d.assigned_machine_id IS NOT NULL AND (d.last_applied_at IS NULL OR d.last_applied_at < v.updated_at))
		SELECT (SELECT COUNT(*) FROM visible)::int AS total,
			(SELECT COUNT(DISTINCT nginx_config_id) FROM stale)::int AS out_of_sync,
			(SELECT COUNT(*) FROM stale)::int AS out_of_sync_domains`, args...); err != nil {
			log.Printf("dashboard configs: %v", err)
		}
		set("nginx_configs", configs)
	})

	// Jobs (last 24h)
	jobsResp := map[string]interface{}{}
	var jobsMu sync.Mutex
	setJob := func(k string, v interface{}) { jobsMu.Lock(); jobsResp[k] = v; jobsMu.Unlock() }
	run(func() {
		if stats, err := (&JobsHandler{db: h.db}).jobStats(r, 24); err == nil {
			setJob("last24h", stats.Counts)
			setJob("total_24h", stats.Total)
			setJob("buckets", stats.Buckets)
			setJob("top_failing", stats.TopFailing)
		}
	})
	jobScopeSQL := "TRUE"
	if !super {
		jobScopeSQL = "m.id IS NOT NULL AND " + machineVisibilitySQL("m", 1)
	}
	run(func() {
		var running int
		h.db.Get(&running, `SELECT COUNT(*)::int FROM jobs j LEFT JOIN machines m ON m.agent_id = j.agent_id
		WHERE j.status = 'running' AND `+jobScopeSQL, args...)
		setJob("running", running)
	})
	run(func() {
		recent := []dashboardRecentFailed{}
		h.db.Select(&recent, `
		SELECT j.id, COALESCE(j.title, j.type) AS title, m.id AS machine_id,
			COALESCE(NULLIF(m.title, ''), m.hostname) AS machine_title, j.finished_at, j.error_message
		FROM jobs j LEFT JOIN machines m ON m.agent_id = j.agent_id
		WHERE j.status = 'failed' AND j.created_at > NOW() - INTERVAL '7 days' AND `+jobScopeSQL+`
		ORDER BY j.finished_at DESC NULLS LAST LIMIT 5`, args...)
		setJob("recent_failed", recent)
	})

	run(func() {
		var security struct {
			ActiveBans int `db:"active_bans" json:"active_bans"`
			Bans24h    int `db:"bans_24h" json:"bans_24h"`
		}
		if err := h.db.Get(&security, `
		SELECT COUNT(*) FILTER (WHERE is_active AND (expires_at IS NULL OR expires_at > NOW()))::int AS active_bans,
			COUNT(*) FILTER (WHERE banned_at > NOW() - INTERVAL '24 hours')::int AS bans_24h
		FROM security_ip_bans`); err == nil {
			set("security", security)
		} else {
			set("security", nil)
		}
	})

	run(func() {
		top := []dashboardTopMachine{}
		h.db.Select(&top, `
		SELECT m.id, COALESCE(NULLIF(m.title, ''), m.hostname, 'Unknown') AS title,
			COALESCE(m.cpu_percent, 0) AS cpu,
			CASE WHEN COALESCE(m.memory_total, 0) > 0 THEN ROUND((m.memory_used::numeric * 100 / m.memory_total), 1)::float8 ELSE 0 END AS mem_pct,
			CASE WHEN COALESCE(m.disk_total, 0) > 0 THEN ROUND((m.disk_used::numeric * 100 / m.disk_total), 1)::float8 ELSE 0 END AS disk_pct,
			COALESCE(a.last_seen > NOW() - INTERVAL '90 seconds', false) AS online
		FROM machines m LEFT JOIN agents a ON a.id = m.agent_id
		WHERE `+machineWhere+`
		ORDER BY online DESC, cpu DESC LIMIT 5`, args...)
		set("top_machines_by_cpu", top)
	})

	wg.Wait()
	resp["jobs"] = jobsResp
	writeJSON(w, http.StatusOK, resp)
}

func argN(n int) string { return strconv.Itoa(n) }
