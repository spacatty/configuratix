package domainhealth

import (
	"sync"

	"configuratix/backend/internal/database"

	"github.com/google/uuid"
)

var domainLocks sync.Map // domain id string -> *sync.Mutex

// RunCheckAndPersist loads the domain by id, runs a health check, and updates status / last_check_at.
// A per-domain mutex prevents overlapping checks for the same domain from corrupting state.
func RunCheckAndPersist(db *database.DB, id uuid.UUID) (newStatus string, err error) {
	key := id.String()
	v, _ := domainLocks.LoadOrStore(key, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	var row struct {
		FQDN              string     `db:"fqdn"`
		AssignedMachineID *uuid.UUID `db:"assigned_machine_id"`
		MachineIP         *string    `db:"machine_ip"`
		Status            string     `db:"status"`
		effectiveRow
	}

	err = db.Get(&row, `
		SELECT d.fqdn, d.assigned_machine_id, d.status, `+EffectiveRulesColumns+`,
			COALESCE(m.primary_ip, m.ip_address) AS machine_ip
		FROM domains d
		LEFT JOIN machines m ON d.assigned_machine_id = m.id
		LEFT JOIN health_check_presets hp ON hp.id = d.health_check_preset_id
		WHERE d.id = $1
	`, id)
	if err != nil {
		return "", err
	}

	var assignedStr *string
	if row.AssignedMachineID != nil {
		s := row.AssignedMachineID.String()
		assignedStr = &s
	}

	in := Input{
		FQDN:              row.FQDN,
		AssignedMachineID: assignedStr,
		MachineIP:         row.MachineIP,
		Rules:             row.rules(),
	}
	res := Check(in)
	newStatus = res.Status
	var checkErr *string
	if res.Error != "" {
		checkErr = &res.Error
	}
	// The response is only kept when the check failed, for debugging.
	var headers, body *string
	truncated := false
	if newStatus != "healthy" && res.StatusCode != nil {
		headers, body, truncated = &res.Headers, &res.Body, res.BodyTruncated
	}

	// updated_at only changes with the status (it feeds other change tracking).
	_, err = db.Exec(`
		UPDATE domains SET status = $1::text, last_check_at = NOW(),
			last_check_status_code = $3, last_check_response_ms = $4, last_check_error = $5,
			last_check_response_headers = $6, last_check_response_body = $7, last_check_body_truncated = $8,
			updated_at = CASE WHEN status::text IS DISTINCT FROM $1::text THEN NOW() ELSE updated_at END
		WHERE id = $2
	`, newStatus, id, res.StatusCode, res.ResponseMS, checkErr, headers, body, truncated)
	return newStatus, err
}

// EffectiveRulesColumns selects a domain's effective rules; the query must alias domains as d
// and LEFT JOIN health_check_presets as hp on d.health_check_preset_id.
const EffectiveRulesColumns = `
	COALESCE(hp.path, d.health_check_path, '/') AS eff_path,
	COALESCE(hp.expected_status, d.health_check_expected, d.health_check_expected_status::text, '200') AS eff_expected,
	COALESCE(CASE WHEN hp.id IS NOT NULL THEN hp.body_contains ELSE d.health_check_body_contains END, '') AS eff_body_contains,
	COALESCE(hp.timeout_seconds, d.health_check_timeout_seconds, 0) AS eff_timeout_seconds`

type effectiveRow struct {
	Path           string `db:"eff_path"`
	Expected       string `db:"eff_expected"`
	BodyContains   string `db:"eff_body_contains"`
	TimeoutSeconds int    `db:"eff_timeout_seconds"`
}

func (r effectiveRow) rules() Rules {
	return Rules{Path: r.Path, Expected: r.Expected, BodyContains: r.BodyContains, TimeoutSeconds: r.TimeoutSeconds}
}

// RunChecksConcurrently checks many domains with a bounded number of parallel probes.
// The callback receives each domain's result; it may be called from several goroutines.
func RunChecksConcurrently(db *database.DB, ids []uuid.UUID, workers int, done func(id uuid.UUID, status string, err error)) {
	if workers < 1 {
		workers = 1
	}
	ch := make(chan uuid.UUID)
	var wg sync.WaitGroup
	for i := 0; i < workers && i < len(ids); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range ch {
				st, err := RunCheckAndPersist(db, id)
				done(id, st, err)
			}
		}()
	}
	for _, id := range ids {
		ch <- id
	}
	close(ch)
	wg.Wait()
}
