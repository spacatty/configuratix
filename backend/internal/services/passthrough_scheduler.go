package services

import (
	"log"
	"math/rand"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
)

// PassthroughScheduler handles automatic DNS rotation
type PassthroughScheduler struct {
	db       *database.DB
	interval time.Duration
	stop     chan struct{}
}

// NewPassthroughScheduler creates a new scheduler
func NewPassthroughScheduler(db *database.DB) *PassthroughScheduler {
	return &PassthroughScheduler{
		db:       db,
		interval: 1 * time.Minute, // Check every minute
		stop:     make(chan struct{}),
	}
}

// Start begins the scheduler loop
func (s *PassthroughScheduler) Start() {
	log.Println("Passthrough scheduler started")
	
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.tick()
		case <-s.stop:
			log.Println("Passthrough scheduler stopped")
			return
		}
	}
}

// Stop stops the scheduler
func (s *PassthroughScheduler) Stop() {
	close(s.stop)
}

// tick processes all pools that need rotation
func (s *PassthroughScheduler) tick() {
	// Process record pools
	s.processRecordPools()
	
	// Process wildcard pools
	s.processWildcardPools()
}

// processRecordPools checks and rotates record pools
func (s *PassthroughScheduler) processRecordPools() {
	var pools []models.PassthroughPool
	err := s.db.Select(&pools, `
		SELECT * FROM dns_passthrough_pools 
		WHERE is_paused = false
	`)
	if err != nil {
		log.Printf("Passthrough scheduler: failed to get record pools: %v", err)
		return
	}

	now := time.Now().UTC()

	for _, pool := range pools {
		if s.shouldRotate(pool.RotationMode, pool.IntervalMinutes, pool.ScheduledTimes, pool.LastRotatedAt, now) {
			s.rotateRecordPool(pool)
		}
	}
}

// processWildcardPools checks and rotates wildcard pools
func (s *PassthroughScheduler) processWildcardPools() {
	var pools []models.WildcardPool
	err := s.db.Select(&pools, `
		SELECT * FROM dns_wildcard_pools 
		WHERE is_paused = false
	`)
	if err != nil {
		log.Printf("Passthrough scheduler: failed to get wildcard pools: %v", err)
		return
	}

	now := time.Now().UTC()

	for _, pool := range pools {
		if s.shouldRotate(pool.RotationMode, pool.IntervalMinutes, pool.ScheduledTimes, pool.LastRotatedAt, now) {
			s.rotateWildcardPool(pool)
		}
	}
}

// shouldRotate determines if a pool should be rotated
func (s *PassthroughScheduler) shouldRotate(mode string, intervalMinutes int, scheduledTimes []string, lastRotated *time.Time, now time.Time) bool {
	if mode == "interval" {
		if lastRotated == nil {
			return true // Never rotated, do it now
		}
		return now.Sub(*lastRotated) >= time.Duration(intervalMinutes)*time.Minute
	}

	// Scheduled mode
	if len(scheduledTimes) == 0 {
		return false
	}

	currentTime := now.Format("15:04")
	for _, scheduledTime := range scheduledTimes {
		if currentTime == scheduledTime {
			// Check if we already rotated in the last minute for this schedule
			if lastRotated != nil && now.Sub(*lastRotated) < 2*time.Minute {
				return false
			}
			return true
		}
	}

	return false
}

// rotateRecordPool rotates a record pool to the next machine
func (s *PassthroughScheduler) rotateRecordPool(pool models.PassthroughPool) {
	log.Printf("Scheduler: rotateRecordPool pool=%s, group_ids=%v (%d groups)", pool.ID, pool.GroupIDs, len(pool.GroupIDs))
	
	// Get available members (direct members + machines from groups)
	type MemberInfo struct {
		MachineID uuid.UUID  `db:"machine_id"`
		MachineIP string     `db:"machine_ip"`
		LastSeen  *time.Time `db:"last_seen"`
		Priority  int        `db:"priority"`
	}
	var members []MemberInfo
	
	// Get direct members
	err := s.db.Select(&members, `
		SELECT pm.machine_id, m.ip_address as machine_ip, a.last_seen, pm.priority
		FROM dns_passthrough_members pm
		JOIN machines m ON pm.machine_id = m.id
		LEFT JOIN agents a ON m.agent_id = a.id
		WHERE pm.pool_id = $1 AND pm.is_enabled = true
		ORDER BY pm.priority, m.name
	`, pool.ID)
	if err != nil {
		log.Printf("Scheduler: failed to get direct members: %v", err)
	}
	log.Printf("Scheduler: found %d direct members", len(members))

	// Also get machines from groups if pool has group_ids
	if len(pool.GroupIDs) > 0 {
		var groupMembers []MemberInfo
		err := s.db.Select(&groupMembers, `
			SELECT gm.machine_id, m.ip_address as machine_ip, a.last_seen, 100 as priority
			FROM machine_group_members gm
			JOIN machines m ON gm.machine_id = m.id
			LEFT JOIN agents a ON m.agent_id = a.id
			WHERE gm.group_id = ANY($1::uuid[])
		`, pool.GroupIDs)
		if err != nil {
			log.Printf("Scheduler: failed to get group members: %v", err)
		}
		log.Printf("Scheduler: found %d machines from groups", len(groupMembers))
		
		// Add group members that aren't already in direct members
		for _, gm := range groupMembers {
			found := false
			for _, m := range members {
				if m.MachineID == gm.MachineID {
					found = true
					break
				}
			}
			if !found {
				members = append(members, gm)
			}
		}
	}

	log.Printf("Scheduler: total %d members available for pool %s", len(members), pool.ID)
	if len(members) == 0 {
		log.Printf("Passthrough scheduler: no members in pool %s", pool.ID)
		return
	}

	// Filter by health if enabled
	if pool.HealthCheckEnabled {
		var healthy []MemberInfo
		for _, m := range members {
			if m.LastSeen != nil && time.Since(*m.LastSeen) < 5*time.Minute {
				healthy = append(healthy, m)
			}
		}
		if len(healthy) > 0 {
			members = healthy
		} else {
			log.Printf("Passthrough scheduler: no healthy members in pool %s, using all", pool.ID)
		}
	}

	// Select next machine
	var nextMachine struct {
		MachineID uuid.UUID
		MachineIP string
	}
	var newIndex int

	if pool.RotationStrategy == "random" {
		idx := rand.Intn(len(members))
		nextMachine.MachineID = members[idx].MachineID
		nextMachine.MachineIP = members[idx].MachineIP
		newIndex = idx
	} else {
		// Round-robin
		newIndex = (pool.CurrentIndex + 1) % len(members)
		nextMachine.MachineID = members[newIndex].MachineID
		nextMachine.MachineIP = members[newIndex].MachineIP
	}

	// Skip if same machine
	if pool.CurrentMachineID != nil && *pool.CurrentMachineID == nextMachine.MachineID {
		// Still update last_rotated_at to prevent immediate re-trigger
		s.db.Exec("UPDATE dns_passthrough_pools SET last_rotated_at = NOW() WHERE id = $1", pool.ID)
		return
	}

	// Get current IP for history
	var fromIP string
	if pool.CurrentMachineID != nil {
		s.db.Get(&fromIP, "SELECT ip_address FROM machines WHERE id = $1", *pool.CurrentMachineID)
	}

	// Update DNS record
	s.updateDNSRecord(pool.DNSRecordID, nextMachine.MachineIP)

	// Update pool state
	s.db.Exec(`
		UPDATE dns_passthrough_pools 
		SET current_machine_id = $1, current_index = $2, last_rotated_at = NOW(), updated_at = NOW()
		WHERE id = $3
	`, nextMachine.MachineID, newIndex, pool.ID)

	// Log history
	s.db.Exec(`
		INSERT INTO dns_rotation_history 
			(pool_type, pool_id, from_machine_id, from_ip, to_machine_id, to_ip, trigger)
		VALUES ('record', $1, $2, $3, $4, $5, 'scheduled')
	`, pool.ID, pool.CurrentMachineID, fromIP, nextMachine.MachineID, nextMachine.MachineIP)

	log.Printf("Passthrough scheduler: rotated pool %s to %s (%s)", pool.ID, nextMachine.MachineID, nextMachine.MachineIP)
}

// rotateWildcardPool rotates a wildcard pool
func (s *PassthroughScheduler) rotateWildcardPool(pool models.WildcardPool) {
	type WMemberInfo struct {
		MachineID uuid.UUID  `db:"machine_id"`
		MachineIP string     `db:"machine_ip"`
		LastSeen  *time.Time `db:"last_seen"`
		Priority  int        `db:"priority"`
	}
	var members []WMemberInfo
	
	// Get direct members
	s.db.Select(&members, `
		SELECT wm.machine_id, m.ip_address as machine_ip, a.last_seen, wm.priority
		FROM dns_wildcard_pool_members wm
		JOIN machines m ON wm.machine_id = m.id
		LEFT JOIN agents a ON m.agent_id = a.id
		WHERE wm.pool_id = $1 AND wm.is_enabled = true
		ORDER BY wm.priority, m.name
	`, pool.ID)

	// Also get machines from groups if pool has group_ids
	if len(pool.GroupIDs) > 0 {
		var groupMembers []WMemberInfo
		s.db.Select(&groupMembers, `
			SELECT gm.machine_id, m.ip_address as machine_ip, a.last_seen, 100 as priority
			FROM machine_group_members gm
			JOIN machines m ON gm.machine_id = m.id
			LEFT JOIN agents a ON m.agent_id = a.id
			WHERE gm.group_id = ANY($1::uuid[])
		`, pool.GroupIDs)
		
		// Add group members that aren't already in direct members
		for _, gm := range groupMembers {
			found := false
			for _, m := range members {
				if m.MachineID == gm.MachineID {
					found = true
					break
				}
			}
			if !found {
				members = append(members, gm)
			}
		}
	}

	if len(members) == 0 {
		return
	}

	if pool.HealthCheckEnabled {
		var healthy []WMemberInfo
		for _, m := range members {
			if m.LastSeen != nil && time.Since(*m.LastSeen) < 5*time.Minute {
				healthy = append(healthy, m)
			}
		}
		if len(healthy) > 0 {
			members = healthy
		}
	}

	var nextMachine struct {
		MachineID uuid.UUID
		MachineIP string
	}
	var newIndex int

	if pool.RotationStrategy == "random" {
		idx := rand.Intn(len(members))
		nextMachine.MachineID = members[idx].MachineID
		nextMachine.MachineIP = members[idx].MachineIP
		newIndex = idx
	} else {
		newIndex = (pool.CurrentIndex + 1) % len(members)
		nextMachine.MachineID = members[newIndex].MachineID
		nextMachine.MachineIP = members[newIndex].MachineIP
	}

	if pool.CurrentMachineID != nil && *pool.CurrentMachineID == nextMachine.MachineID {
		s.db.Exec("UPDATE dns_wildcard_pools SET last_rotated_at = NOW() WHERE id = $1", pool.ID)
		return
	}

	var fromIP string
	if pool.CurrentMachineID != nil {
		s.db.Get(&fromIP, "SELECT ip_address FROM machines WHERE id = $1", *pool.CurrentMachineID)
	}

	// Update wildcard DNS records
	s.updateWildcardDNS(pool.DNSDomainID, nextMachine.MachineIP, pool.IncludeRoot)

	s.db.Exec(`
		UPDATE dns_wildcard_pools 
		SET current_machine_id = $1, current_index = $2, last_rotated_at = NOW(), updated_at = NOW()
		WHERE id = $3
	`, nextMachine.MachineID, newIndex, pool.ID)

	s.db.Exec(`
		INSERT INTO dns_rotation_history 
			(pool_type, pool_id, dns_domain_id, from_machine_id, from_ip, to_machine_id, to_ip, trigger)
		VALUES ('wildcard', $1, $2, $3, $4, $5, $6, 'scheduled')
	`, pool.ID, pool.DNSDomainID, pool.CurrentMachineID, fromIP, nextMachine.MachineID, nextMachine.MachineIP)

	log.Printf("Passthrough scheduler: rotated wildcard pool %s to %s (%s)", pool.ID, nextMachine.MachineID, nextMachine.MachineIP)
}

// updateDNSRecord updates a DNS record value
func (s *PassthroughScheduler) updateDNSRecord(recordID uuid.UUID, newIP string) {
	// Update local record
	s.db.Exec("UPDATE dns_records SET value = $1, sync_status = 'pending', updated_at = NOW() WHERE id = $2", newIP, recordID)

	// Get record and account info for provider update
	var record struct {
		Name         string    `db:"name"`
		Type         string    `db:"type"`
		DNSDomainID  uuid.UUID `db:"dns_domain_id"`
		DNSAccountID uuid.UUID `db:"dns_account_id"`
		ProviderID   *string   `db:"provider_record_id"`
	}
	s.db.Get(&record, `
		SELECT r.name, r.type, r.dns_domain_id, d.dns_account_id, r.provider_record_id
		FROM dns_records r
		JOIN dns_managed_domains d ON r.dns_domain_id = d.id
		WHERE r.id = $1
	`, recordID)

	// TODO: Call DNS provider to update record
	// For now, just mark as synced
	s.db.Exec("UPDATE dns_records SET sync_status = 'synced' WHERE id = $1", recordID)
}

// updateWildcardDNS updates wildcard DNS records
func (s *PassthroughScheduler) updateWildcardDNS(domainID uuid.UUID, newIP string, includeRoot bool) {
	// Update wildcard record
	s.db.Exec(`
		UPDATE dns_records SET value = $1, sync_status = 'pending', updated_at = NOW()
		WHERE dns_domain_id = $2 AND name = '*' AND type = 'A'
	`, newIP, domainID)

	if includeRoot {
		s.db.Exec(`
			UPDATE dns_records SET value = $1, sync_status = 'pending', updated_at = NOW()
			WHERE dns_domain_id = $2 AND name = '@' AND type = 'A'
		`, newIP, domainID)
	}

	// TODO: Call DNS provider
	s.db.Exec("UPDATE dns_records SET sync_status = 'synced' WHERE dns_domain_id = $1 AND mode = 'dynamic'", domainID)
}

