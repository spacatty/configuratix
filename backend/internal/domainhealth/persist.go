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
	}

	err = db.Get(&row, `
		SELECT d.fqdn, d.assigned_machine_id, d.status, d.health_check_expected_status,
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
	newStatus = ComputeStatus(in)

	if newStatus != row.Status {
		_, err = db.Exec(`
			UPDATE domains SET status = $1, last_check_at = NOW(), updated_at = NOW()
			WHERE id = $2
		`, newStatus, id)
		if err != nil {
			return newStatus, err
		}
	} else {
		_, err = db.Exec(`UPDATE domains SET last_check_at = NOW() WHERE id = $1`, id)
	}
	return newStatus, err
}
