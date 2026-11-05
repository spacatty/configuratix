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
		FQDN                      string     `db:"fqdn"`
		AssignedMachineID         *uuid.UUID `db:"assigned_machine_id"`
		MachineIP                 *string    `db:"machine_ip"`
		Status                    string     `db:"status"`
		HealthCheckExpectedStatus int        `db:"health_check_expected_status"`
		HealthCheckPath           *string    `db:"health_check_path"`
	}

	err = db.Get(&row, `
		SELECT d.fqdn, d.assigned_machine_id, d.status, d.health_check_expected_status, d.health_check_path,
			COALESCE(m.primary_ip, m.ip_address) AS machine_ip
		FROM domains d
		LEFT JOIN machines m ON d.assigned_machine_id = m.id
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
		FQDN:               row.FQDN,
		AssignedMachineID:  assignedStr,
		MachineIP:          row.MachineIP,
		ExpectedHTTPStatus: row.HealthCheckExpectedStatus,
	}
	if row.HealthCheckPath != nil {
		in.Path = *row.HealthCheckPath
	}
	res := Check(in)
	newStatus = res.Status
	var checkErr *string
	if res.Error != "" {
		checkErr = &res.Error
	}

	// updated_at only changes with the status (it feeds other change tracking).
	_, err = db.Exec(`
		UPDATE domains SET status = $1::text, last_check_at = NOW(),
			last_check_status_code = $3, last_check_response_ms = $4, last_check_error = $5,
			updated_at = CASE WHEN status::text IS DISTINCT FROM $1::text THEN NOW() ELSE updated_at END
		WHERE id = $2
	`, newStatus, id, res.StatusCode, res.ResponseMS, checkErr)
	return newStatus, err
}
