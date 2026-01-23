package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

// PassthroughHandler handles DNS passthrough pool operations
type PassthroughHandler struct {
	db          *database.DB
	dnsProvider *DNSHandler                 // For DNS record updates
	nginx       *PassthroughNginxGenerator  // For nginx config generation
}

// NewPassthroughHandler creates a new PassthroughHandler
func NewPassthroughHandler(db *database.DB, dnsHandler *DNSHandler) *PassthroughHandler {
	return &PassthroughHandler{
		db:          db,
		dnsProvider: dnsHandler,
		nginx:       NewPassthroughNginxGenerator(db),
	}
}

// =============== Record Pool Handlers ===============

// GetRecordPool gets the passthrough pool for a specific DNS record
func (h *PassthroughHandler) GetRecordPool(w http.ResponseWriter, r *http.Request) {
	recordID, err := uuid.Parse(mux.Vars(r)["recordId"])
	if err != nil {
		http.Error(w, "Invalid record ID", http.StatusBadRequest)
		return
	}

	var pool models.PassthroughPool
	err = h.db.Get(&pool, `
		SELECT * FROM dns_passthrough_pools WHERE dns_record_id = $1
	`, recordID)
	if err == sql.ErrNoRows {
		http.Error(w, "Pool not found", http.StatusNotFound)
		return
	} else if err != nil {
		log.Printf("Failed to get pool: %v", err)
		http.Error(w, "Failed to get pool", http.StatusInternalServerError)
		return
	}

	// Get direct members with machine details
	var members []models.PassthroughMemberWithMachine
	h.db.Select(&members, `
		SELECT pm.*, m.name as machine_name, m.ip_address as machine_ip, a.last_seen
		FROM dns_passthrough_members pm
		JOIN machines m ON pm.machine_id = m.id
		LEFT JOIN agents a ON m.agent_id = a.id
		WHERE pm.pool_id = $1
		ORDER BY pm.priority, m.name
	`, pool.ID)

	// Compute online status
	for i := range members {
		if members[i].LastSeen != nil {
			members[i].IsOnline = time.Since(*members[i].LastSeen) < 5*time.Minute
		}
	}

	// Get groups info
	var groups []models.MachineGroupWithCount
	if len(pool.GroupIDs) > 0 {
		h.db.Select(&groups, `
			SELECT g.*, COUNT(DISTINCT gm.machine_id) as item_count
			FROM machine_groups g
			LEFT JOIN machine_group_members gm ON g.id = gm.group_id
			WHERE g.id = ANY($1::uuid[])
			GROUP BY g.id
		`, pool.GroupIDs)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"pool":    pool,
		"members": members,
		"groups":  groups,
	})
}

// CreateOrUpdateRecordPool creates or updates a passthrough pool for a record
func (h *PassthroughHandler) CreateOrUpdateRecordPool(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	recordID, err := uuid.Parse(mux.Vars(r)["recordId"])
	if err != nil {
		http.Error(w, "Invalid record ID", http.StatusBadRequest)
		return
	}

	// Verify access to the record's domain
	var domainOwnerID uuid.UUID
	err = h.db.Get(&domainOwnerID, `
		SELECT d.owner_id FROM dns_records r
		JOIN dns_managed_domains d ON r.dns_domain_id = d.id
		WHERE r.id = $1
	`, recordID)
	if err != nil {
		http.Error(w, "Record not found", http.StatusNotFound)
		return
	}
	if domainOwnerID != userID && !claims.IsSuperAdmin() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req struct {
		TargetIP           string   `json:"target_ip"`
		TargetPort         int      `json:"target_port"`
		RotationStrategy   string   `json:"rotation_strategy"`
		RotationMode       string   `json:"rotation_mode"`
		IntervalMinutes    int      `json:"interval_minutes"`
		ScheduledTimes     []string `json:"scheduled_times"`
		HealthCheckEnabled bool     `json:"health_check_enabled"`
		MachineIDs         []string `json:"machine_ids"`
		GroupIDs           []string `json:"group_ids"` // Machine groups for dynamic membership
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.TargetIP == "" {
		http.Error(w, "Target IP is required", http.StatusBadRequest)
		return
	}
	if req.TargetPort == 0 {
		req.TargetPort = 443
	}
	if req.RotationStrategy == "" {
		req.RotationStrategy = "round_robin"
	}
	if req.RotationMode == "" {
		req.RotationMode = "interval"
	}
	if req.IntervalMinutes == 0 {
		req.IntervalMinutes = 60
	}

	scheduledTimesJSON, _ := json.Marshal(req.ScheduledTimes)
	groupIDsArray := pq.StringArray(req.GroupIDs)

	// Upsert pool
	var pool models.PassthroughPool
	err = h.db.Get(&pool, `
		INSERT INTO dns_passthrough_pools 
			(dns_record_id, target_ip, target_port, rotation_strategy, rotation_mode, 
			 interval_minutes, scheduled_times, health_check_enabled, group_ids)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (dns_record_id) DO UPDATE SET
			target_ip = EXCLUDED.target_ip,
			target_port = EXCLUDED.target_port,
			rotation_strategy = EXCLUDED.rotation_strategy,
			rotation_mode = EXCLUDED.rotation_mode,
			interval_minutes = EXCLUDED.interval_minutes,
			scheduled_times = EXCLUDED.scheduled_times,
			health_check_enabled = EXCLUDED.health_check_enabled,
			group_ids = EXCLUDED.group_ids,
			updated_at = NOW()
		RETURNING *
	`, recordID, req.TargetIP, req.TargetPort, req.RotationStrategy, req.RotationMode,
		req.IntervalMinutes, scheduledTimesJSON, req.HealthCheckEnabled, groupIDsArray)
	if err != nil {
		log.Printf("Failed to upsert pool: %v", err)
		http.Error(w, "Failed to save pool", http.StatusInternalServerError)
		return
	}

	// Update record mode to 'dynamic'
	h.db.Exec("UPDATE dns_records SET mode = 'dynamic' WHERE id = $1", recordID)

	// Update members
	if len(req.MachineIDs) > 0 {
		// Delete existing members
		h.db.Exec("DELETE FROM dns_passthrough_members WHERE pool_id = $1", pool.ID)

		// Insert new members
		for i, machineIDStr := range req.MachineIDs {
			machineID, err := uuid.Parse(machineIDStr)
			if err != nil {
				continue
			}
			h.db.Exec(`
				INSERT INTO dns_passthrough_members (pool_id, machine_id, priority, is_enabled)
				VALUES ($1, $2, $3, true)
			`, pool.ID, machineID, i)
		}
	}

	// If no current machine is set, select the first one
	if pool.CurrentMachineID == nil && len(req.MachineIDs) > 0 {
		firstMachineID, _ := uuid.Parse(req.MachineIDs[0])
		h.db.Exec("UPDATE dns_passthrough_pools SET current_machine_id = $1 WHERE id = $2", firstMachineID, pool.ID)
		
		// Update DNS record to point to this machine
		h.updateDNSRecordToMachine(recordID, firstMachineID, "manual")
	}

	// Regenerate and deploy nginx configs to all pool members
	// This ensures target_ip changes are propagated
	go func() {
		if err := h.nginx.ApplyToAllPoolMembers(pool.ID, false); err != nil {
			log.Printf("Failed to apply nginx configs for pool %s: %v", pool.ID, err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pool)
}

// DeleteRecordPool deletes a passthrough pool and switches record back to static
func (h *PassthroughHandler) DeleteRecordPool(w http.ResponseWriter, r *http.Request) {
	recordID, err := uuid.Parse(mux.Vars(r)["recordId"])
	if err != nil {
		http.Error(w, "Invalid record ID", http.StatusBadRequest)
		return
	}

	// Get pool and members before deletion for nginx cleanup
	var pool models.PassthroughPool
	var machineIDs []uuid.UUID
	if err := h.db.Get(&pool, "SELECT * FROM dns_passthrough_pools WHERE dns_record_id = $1", recordID); err == nil {
		h.db.Select(&machineIDs, "SELECT machine_id FROM dns_passthrough_members WHERE pool_id = $1", pool.ID)
	}

	// Delete pool (cascade deletes members)
	h.db.Exec("DELETE FROM dns_passthrough_pools WHERE dns_record_id = $1", recordID)

	// Switch record back to static mode
	h.db.Exec("UPDATE dns_records SET mode = 'static' WHERE id = $1", recordID)

	// Regenerate nginx configs for affected machines (pool is now removed)
	go func() {
		for _, machineID := range machineIDs {
			if err := h.nginx.ApplyToMachine(machineID); err != nil {
				log.Printf("Failed to update nginx config for machine %s after pool deletion: %v", machineID, err)
			}
		}
	}()

	w.WriteHeader(http.StatusNoContent)
}

// RotateRecordPool manually triggers a rotation
func (h *PassthroughHandler) RotateRecordPool(w http.ResponseWriter, r *http.Request) {
	poolID, err := uuid.Parse(mux.Vars(r)["poolId"])
	if err != nil {
		http.Error(w, "Invalid pool ID", http.StatusBadRequest)
		return
	}

	var pool models.PassthroughPool
	err = h.db.Get(&pool, "SELECT * FROM dns_passthrough_pools WHERE id = $1", poolID)
	if err != nil {
		http.Error(w, "Pool not found", http.StatusNotFound)
		return
	}

	nextMachine, err := h.selectNextMachine(pool.ID, pool.RotationStrategy, pool.CurrentIndex, pool.HealthCheckEnabled, "record")
	if err != nil {
		http.Error(w, "No available machines", http.StatusBadRequest)
		return
	}

	// Perform rotation
	err = h.rotateToMachine(pool.ID, pool.DNSRecordID, nextMachine, "record", "manual")
	if err != nil {
		log.Printf("Rotation failed: %v", err)
		http.Error(w, "Rotation failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "rotated"})
}

// PauseRecordPool pauses rotation for a pool
func (h *PassthroughHandler) PauseRecordPool(w http.ResponseWriter, r *http.Request) {
	poolID, err := uuid.Parse(mux.Vars(r)["poolId"])
	if err != nil {
		http.Error(w, "Invalid pool ID", http.StatusBadRequest)
		return
	}

	h.db.Exec("UPDATE dns_passthrough_pools SET is_paused = true, updated_at = NOW() WHERE id = $1", poolID)
	w.WriteHeader(http.StatusOK)
}

// ResumeRecordPool resumes rotation for a pool
func (h *PassthroughHandler) ResumeRecordPool(w http.ResponseWriter, r *http.Request) {
	poolID, err := uuid.Parse(mux.Vars(r)["poolId"])
	if err != nil {
		http.Error(w, "Invalid pool ID", http.StatusBadRequest)
		return
	}

	h.db.Exec("UPDATE dns_passthrough_pools SET is_paused = false, updated_at = NOW() WHERE id = $1", poolID)
	w.WriteHeader(http.StatusOK)
}

// GetRotationHistory gets rotation history for a pool
func (h *PassthroughHandler) GetRotationHistory(w http.ResponseWriter, r *http.Request) {
	poolID, err := uuid.Parse(mux.Vars(r)["poolId"])
	if err != nil {
		http.Error(w, "Invalid pool ID", http.StatusBadRequest)
		return
	}

	var history []models.RotationHistoryWithDetails
	h.db.Select(&history, `
		SELECT rh.*,
			COALESCE(fm.name, '') as from_machine_name,
			COALESCE(tm.name, '') as to_machine_name
		FROM dns_rotation_history rh
		LEFT JOIN machines fm ON rh.from_machine_id = fm.id
		LEFT JOIN machines tm ON rh.to_machine_id = tm.id
		WHERE rh.pool_id = $1
		ORDER BY rh.rotated_at DESC
		LIMIT 50
	`, poolID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// =============== Wildcard Pool Handlers ===============

// GetWildcardPool gets the wildcard pool for a domain
func (h *PassthroughHandler) GetWildcardPool(w http.ResponseWriter, r *http.Request) {
	domainID, err := uuid.Parse(mux.Vars(r)["domainId"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var pool models.WildcardPool
	err = h.db.Get(&pool, `SELECT * FROM dns_wildcard_pools WHERE dns_domain_id = $1`, domainID)
	if err == sql.ErrNoRows {
		http.Error(w, "Pool not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Failed to get pool", http.StatusInternalServerError)
		return
	}

	// Get direct members
	var members []models.WildcardMemberWithMachine
	h.db.Select(&members, `
		SELECT wm.*, m.name as machine_name, m.ip_address as machine_ip, a.last_seen
		FROM dns_wildcard_pool_members wm
		JOIN machines m ON wm.machine_id = m.id
		LEFT JOIN agents a ON m.agent_id = a.id
		WHERE wm.pool_id = $1
		ORDER BY wm.priority, m.name
	`, pool.ID)

	for i := range members {
		if members[i].LastSeen != nil {
			members[i].IsOnline = time.Since(*members[i].LastSeen) < 5*time.Minute
		}
	}

	// Get groups info
	var groups []models.MachineGroupWithCount
	if len(pool.GroupIDs) > 0 {
		h.db.Select(&groups, `
			SELECT g.*, COUNT(DISTINCT gm.machine_id) as item_count
			FROM machine_groups g
			LEFT JOIN machine_group_members gm ON g.id = gm.group_id
			WHERE g.id = ANY($1::uuid[])
			GROUP BY g.id
		`, pool.GroupIDs)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"pool":    pool,
		"members": members,
		"groups":  groups,
	})
}

// CreateOrUpdateWildcardPool creates or updates a wildcard pool for a domain
func (h *PassthroughHandler) CreateOrUpdateWildcardPool(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	domainID, err := uuid.Parse(mux.Vars(r)["domainId"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var ownerID uuid.UUID
	err = h.db.Get(&ownerID, "SELECT owner_id FROM dns_managed_domains WHERE id = $1", domainID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}
	if ownerID != userID && !claims.IsSuperAdmin() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req struct {
		IncludeRoot        bool     `json:"include_root"`
		TargetIP           string   `json:"target_ip"`
		TargetPort         int      `json:"target_port"`
		RotationStrategy   string   `json:"rotation_strategy"`
		RotationMode       string   `json:"rotation_mode"`
		IntervalMinutes    int      `json:"interval_minutes"`
		ScheduledTimes     []string `json:"scheduled_times"`
		HealthCheckEnabled bool     `json:"health_check_enabled"`
		MachineIDs         []string `json:"machine_ids"`
		GroupIDs           []string `json:"group_ids"` // Machine groups for dynamic membership
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.TargetIP == "" {
		http.Error(w, "Target IP is required", http.StatusBadRequest)
		return
	}
	if req.TargetPort == 0 {
		req.TargetPort = 443
	}
	if req.RotationStrategy == "" {
		req.RotationStrategy = "round_robin"
	}
	if req.RotationMode == "" {
		req.RotationMode = "interval"
	}
	if req.IntervalMinutes == 0 {
		req.IntervalMinutes = 60
	}

	scheduledTimesJSON, _ := json.Marshal(req.ScheduledTimes)
	groupIDsArray := pq.StringArray(req.GroupIDs)

	var pool models.WildcardPool
	err = h.db.Get(&pool, `
		INSERT INTO dns_wildcard_pools 
			(dns_domain_id, include_root, target_ip, target_port, rotation_strategy, 
			 rotation_mode, interval_minutes, scheduled_times, health_check_enabled, group_ids)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (dns_domain_id) DO UPDATE SET
			include_root = EXCLUDED.include_root,
			target_ip = EXCLUDED.target_ip,
			target_port = EXCLUDED.target_port,
			rotation_strategy = EXCLUDED.rotation_strategy,
			rotation_mode = EXCLUDED.rotation_mode,
			interval_minutes = EXCLUDED.interval_minutes,
			scheduled_times = EXCLUDED.scheduled_times,
			health_check_enabled = EXCLUDED.health_check_enabled,
			group_ids = EXCLUDED.group_ids,
			updated_at = NOW()
		RETURNING *
	`, domainID, req.IncludeRoot, req.TargetIP, req.TargetPort, req.RotationStrategy,
		req.RotationMode, req.IntervalMinutes, scheduledTimesJSON, req.HealthCheckEnabled, groupIDsArray)
	if err != nil {
		log.Printf("Failed to upsert wildcard pool: %v", err)
		http.Error(w, "Failed to save pool", http.StatusInternalServerError)
		return
	}

	// Update domain proxy mode
	h.db.Exec("UPDATE dns_managed_domains SET proxy_mode = 'wildcard' WHERE id = $1", domainID)

	// Update members
	if len(req.MachineIDs) > 0 {
		h.db.Exec("DELETE FROM dns_wildcard_pool_members WHERE pool_id = $1", pool.ID)
		for i, machineIDStr := range req.MachineIDs {
			machineID, err := uuid.Parse(machineIDStr)
			if err != nil {
				continue
			}
			h.db.Exec(`
				INSERT INTO dns_wildcard_pool_members (pool_id, machine_id, priority, is_enabled)
				VALUES ($1, $2, $3, true)
			`, pool.ID, machineID, i)
		}
	}

	// Set initial machine if not set
	if pool.CurrentMachineID == nil && len(req.MachineIDs) > 0 {
		firstMachineID, _ := uuid.Parse(req.MachineIDs[0])
		h.db.Exec("UPDATE dns_wildcard_pools SET current_machine_id = $1 WHERE id = $2", firstMachineID, pool.ID)
		
		// Update wildcard DNS record
		h.updateWildcardDNS(domainID, firstMachineID, pool.IncludeRoot, "manual")
	}

	// Regenerate and deploy nginx configs to all pool members
	// This ensures target_ip changes are propagated
	go func() {
		if err := h.nginx.ApplyToAllPoolMembers(pool.ID, true); err != nil {
			log.Printf("Failed to apply nginx configs for wildcard pool %s: %v", pool.ID, err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pool)
}

// DeleteWildcardPool deletes a wildcard pool
func (h *PassthroughHandler) DeleteWildcardPool(w http.ResponseWriter, r *http.Request) {
	domainID, err := uuid.Parse(mux.Vars(r)["domainId"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	// Get pool and members before deletion for nginx cleanup
	var pool models.WildcardPool
	var machineIDs []uuid.UUID
	if err := h.db.Get(&pool, "SELECT * FROM dns_wildcard_pools WHERE dns_domain_id = $1", domainID); err == nil {
		h.db.Select(&machineIDs, "SELECT machine_id FROM dns_wildcard_pool_members WHERE pool_id = $1", pool.ID)
	}

	h.db.Exec("DELETE FROM dns_wildcard_pools WHERE dns_domain_id = $1", domainID)
	h.db.Exec("UPDATE dns_managed_domains SET proxy_mode = 'separate' WHERE id = $1", domainID)

	// Regenerate nginx configs for affected machines (pool is now removed)
	go func() {
		for _, machineID := range machineIDs {
			if err := h.nginx.ApplyToMachine(machineID); err != nil {
				log.Printf("Failed to update nginx config for machine %s after wildcard pool deletion: %v", machineID, err)
			}
		}
	}()

	w.WriteHeader(http.StatusNoContent)
}

// RotateWildcardPool manually triggers a rotation
func (h *PassthroughHandler) RotateWildcardPool(w http.ResponseWriter, r *http.Request) {
	poolID, err := uuid.Parse(mux.Vars(r)["poolId"])
	if err != nil {
		http.Error(w, "Invalid pool ID", http.StatusBadRequest)
		return
	}

	var pool models.WildcardPool
	err = h.db.Get(&pool, "SELECT * FROM dns_wildcard_pools WHERE id = $1", poolID)
	if err != nil {
		http.Error(w, "Pool not found", http.StatusNotFound)
		return
	}

	nextMachine, err := h.selectNextMachineWildcard(pool.ID, pool.RotationStrategy, pool.CurrentIndex, pool.HealthCheckEnabled)
	if err != nil {
		http.Error(w, "No available machines", http.StatusBadRequest)
		return
	}

	// Perform rotation
	err = h.rotateWildcardToMachine(pool.ID, pool.DNSDomainID, nextMachine, pool.IncludeRoot, "manual")
	if err != nil {
		log.Printf("Wildcard rotation failed: %v", err)
		http.Error(w, "Rotation failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "rotated"})
}

// PauseWildcardPool pauses rotation
func (h *PassthroughHandler) PauseWildcardPool(w http.ResponseWriter, r *http.Request) {
	poolID, _ := uuid.Parse(mux.Vars(r)["poolId"])
	h.db.Exec("UPDATE dns_wildcard_pools SET is_paused = true, updated_at = NOW() WHERE id = $1", poolID)
	w.WriteHeader(http.StatusOK)
}

// ResumeWildcardPool resumes rotation
func (h *PassthroughHandler) ResumeWildcardPool(w http.ResponseWriter, r *http.Request) {
	poolID, _ := uuid.Parse(mux.Vars(r)["poolId"])
	h.db.Exec("UPDATE dns_wildcard_pools SET is_paused = false, updated_at = NOW() WHERE id = $1", poolID)
	w.WriteHeader(http.StatusOK)
}

// =============== Helper Methods ===============

// selectNextMachine selects the next machine based on strategy
// Includes both direct members AND machines from groups
func (h *PassthroughHandler) selectNextMachine(poolID uuid.UUID, strategy string, currentIndex int, healthCheck bool, poolType string) (*models.PassthroughMemberWithMachine, error) {
	// Get pool to check for group_ids
	var pool models.PassthroughPool
	if err := h.db.Get(&pool, "SELECT * FROM dns_passthrough_pools WHERE id = $1", poolID); err != nil {
		return nil, err
	}

	// Get direct members
	var members []models.PassthroughMemberWithMachine
	h.db.Select(&members, `
		SELECT pm.*, m.name as machine_name, m.ip_address as machine_ip, a.last_seen
		FROM dns_passthrough_members pm
		JOIN machines m ON pm.machine_id = m.id
		LEFT JOIN agents a ON m.agent_id = a.id
		WHERE pm.pool_id = $1 AND pm.is_enabled = true
		ORDER BY pm.priority, m.name
	`, poolID)

	// Add machines from groups (deduplicated)
	if len(pool.GroupIDs) > 0 {
		var groupMachines []struct {
			MachineID   uuid.UUID  `db:"machine_id"`
			MachineName string     `db:"machine_name"`
			MachineIP   string     `db:"machine_ip"`
			LastSeen    *time.Time `db:"last_seen"`
		}
		h.db.Select(&groupMachines, `
			SELECT DISTINCT m.id as machine_id, m.name as machine_name, m.ip_address as machine_ip, a.last_seen
			FROM machine_group_members gm
			JOIN machines m ON gm.machine_id = m.id
			LEFT JOIN agents a ON m.agent_id = a.id
			WHERE gm.group_id = ANY($1::uuid[])
		`, pool.GroupIDs)

		// Add group machines that aren't already direct members
		existingIDs := make(map[uuid.UUID]bool)
		for _, m := range members {
			existingIDs[m.MachineID] = true
		}
		for _, gm := range groupMachines {
			if !existingIDs[gm.MachineID] {
				members = append(members, models.PassthroughMemberWithMachine{
					PassthroughMember: models.PassthroughMember{
						PoolID:    poolID,
						MachineID: gm.MachineID,
						IsEnabled: true,
					},
					MachineName: gm.MachineName,
					MachineIP:   gm.MachineIP,
					LastSeen:    gm.LastSeen,
				})
			}
		}
	}

	if len(members) == 0 {
		return nil, sql.ErrNoRows
	}

	// Filter by health if enabled
	if healthCheck {
		var healthy []models.PassthroughMemberWithMachine
		for _, m := range members {
			if m.LastSeen != nil && time.Since(*m.LastSeen) < 5*time.Minute {
				healthy = append(healthy, m)
			}
		}
		if len(healthy) > 0 {
			members = healthy
		}
		// If no healthy machines, use all as fallback
	}

	if len(members) == 0 {
		return nil, sql.ErrNoRows
	}

	var selected *models.PassthroughMemberWithMachine
	if strategy == "random" {
		selected = &members[rand.Intn(len(members))]
	} else {
		// Round-robin
		nextIndex := (currentIndex + 1) % len(members)
		selected = &members[nextIndex]
	}

	return selected, nil
}

// selectNextMachineWildcard is same logic for wildcard pools
// Includes both direct members AND machines from groups
func (h *PassthroughHandler) selectNextMachineWildcard(poolID uuid.UUID, strategy string, currentIndex int, healthCheck bool) (*models.WildcardMemberWithMachine, error) {
	// Get pool to check for group_ids
	var pool models.WildcardPool
	if err := h.db.Get(&pool, "SELECT * FROM dns_wildcard_pools WHERE id = $1", poolID); err != nil {
		return nil, err
	}

	// Get direct members
	var members []models.WildcardMemberWithMachine
	h.db.Select(&members, `
		SELECT wm.*, m.name as machine_name, m.ip_address as machine_ip, a.last_seen
		FROM dns_wildcard_pool_members wm
		JOIN machines m ON wm.machine_id = m.id
		LEFT JOIN agents a ON m.agent_id = a.id
		WHERE wm.pool_id = $1 AND wm.is_enabled = true
		ORDER BY wm.priority, m.name
	`, poolID)

	// Add machines from groups (deduplicated)
	if len(pool.GroupIDs) > 0 {
		var groupMachines []struct {
			MachineID   uuid.UUID  `db:"machine_id"`
			MachineName string     `db:"machine_name"`
			MachineIP   string     `db:"machine_ip"`
			LastSeen    *time.Time `db:"last_seen"`
		}
		h.db.Select(&groupMachines, `
			SELECT DISTINCT m.id as machine_id, m.name as machine_name, m.ip_address as machine_ip, a.last_seen
			FROM machine_group_members gm
			JOIN machines m ON gm.machine_id = m.id
			LEFT JOIN agents a ON m.agent_id = a.id
			WHERE gm.group_id = ANY($1::uuid[])
		`, pool.GroupIDs)

		// Add group machines that aren't already direct members
		existingIDs := make(map[uuid.UUID]bool)
		for _, m := range members {
			existingIDs[m.MachineID] = true
		}
		for _, gm := range groupMachines {
			if !existingIDs[gm.MachineID] {
				members = append(members, models.WildcardMemberWithMachine{
					WildcardPoolMember: models.WildcardPoolMember{
						PoolID:    poolID,
						MachineID: gm.MachineID,
						IsEnabled: true,
					},
					MachineName: gm.MachineName,
					MachineIP:   gm.MachineIP,
					LastSeen:    gm.LastSeen,
				})
			}
		}
	}

	if len(members) == 0 {
		return nil, sql.ErrNoRows
	}

	if healthCheck {
		var healthy []models.WildcardMemberWithMachine
		for _, m := range members {
			if m.LastSeen != nil && time.Since(*m.LastSeen) < 5*time.Minute {
				healthy = append(healthy, m)
			}
		}
		if len(healthy) > 0 {
			members = healthy
		}
	}

	if len(members) == 0 {
		return nil, sql.ErrNoRows
	}

	var selected *models.WildcardMemberWithMachine
	if strategy == "random" {
		selected = &members[rand.Intn(len(members))]
	} else {
		nextIndex := (currentIndex + 1) % len(members)
		selected = &members[nextIndex]
	}

	return selected, nil
}

// rotateToMachine performs the actual rotation for a record pool
func (h *PassthroughHandler) rotateToMachine(poolID, recordID uuid.UUID, member *models.PassthroughMemberWithMachine, poolType, trigger string) error {
	// Get current state for history
	var pool models.PassthroughPool
	h.db.Get(&pool, "SELECT * FROM dns_passthrough_pools WHERE id = $1", poolID)

	var fromIP string
	if pool.CurrentMachineID != nil {
		h.db.Get(&fromIP, "SELECT ip_address FROM machines WHERE id = $1", *pool.CurrentMachineID)
	}

	// Update DNS record
	err := h.updateDNSRecordToMachine(recordID, member.MachineID, trigger)
	if err != nil {
		return err
	}

	// Get new index for round-robin
	var newIndex int
	h.db.Get(&newIndex, `
		SELECT COALESCE(
			(SELECT row_number - 1 FROM (
				SELECT machine_id, ROW_NUMBER() OVER (ORDER BY priority, machine_id) as row_number
				FROM dns_passthrough_members WHERE pool_id = $1 AND is_enabled = true
			) t WHERE machine_id = $2),
			0
		)
	`, poolID, member.MachineID)

	// Update pool state
	h.db.Exec(`
		UPDATE dns_passthrough_pools 
		SET current_machine_id = $1, current_index = $2, last_rotated_at = NOW(), updated_at = NOW()
		WHERE id = $3
	`, member.MachineID, newIndex, poolID)

	// Log history
	h.db.Exec(`
		INSERT INTO dns_rotation_history 
			(pool_type, pool_id, from_machine_id, from_ip, to_machine_id, to_ip, trigger)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, poolType, poolID, pool.CurrentMachineID, fromIP, member.MachineID, member.MachineIP, trigger)

	return nil
}

// rotateWildcardToMachine performs rotation for wildcard pool
func (h *PassthroughHandler) rotateWildcardToMachine(poolID, domainID uuid.UUID, member *models.WildcardMemberWithMachine, includeRoot bool, trigger string) error {
	var pool models.WildcardPool
	h.db.Get(&pool, "SELECT * FROM dns_wildcard_pools WHERE id = $1", poolID)

	var fromIP string
	if pool.CurrentMachineID != nil {
		h.db.Get(&fromIP, "SELECT ip_address FROM machines WHERE id = $1", *pool.CurrentMachineID)
	}

	// Update wildcard DNS
	err := h.updateWildcardDNS(domainID, member.MachineID, includeRoot, trigger)
	if err != nil {
		return err
	}

	// Update pool state
	var newIndex int
	h.db.Get(&newIndex, `
		SELECT COALESCE(
			(SELECT row_number - 1 FROM (
				SELECT machine_id, ROW_NUMBER() OVER (ORDER BY priority, machine_id) as row_number
				FROM dns_wildcard_pool_members WHERE pool_id = $1 AND is_enabled = true
			) t WHERE machine_id = $2),
			0
		)
	`, poolID, member.MachineID)

	h.db.Exec(`
		UPDATE dns_wildcard_pools 
		SET current_machine_id = $1, current_index = $2, last_rotated_at = NOW(), updated_at = NOW()
		WHERE id = $3
	`, member.MachineID, newIndex, poolID)

	// Log history
	h.db.Exec(`
		INSERT INTO dns_rotation_history 
			(pool_type, pool_id, dns_domain_id, from_machine_id, from_ip, to_machine_id, to_ip, trigger)
		VALUES ('wildcard', $1, $2, $3, $4, $5, $6, $7)
	`, poolID, domainID, pool.CurrentMachineID, fromIP, member.MachineID, member.MachineIP, trigger)

	return nil
}

// updateDNSRecordToMachine updates a DNS record to point to a machine's IP
func (h *PassthroughHandler) updateDNSRecordToMachine(recordID, machineID uuid.UUID, trigger string) error {
	// Get machine IP
	var machineIP string
	err := h.db.Get(&machineIP, "SELECT ip_address FROM machines WHERE id = $1", machineID)
	if err != nil {
		return err
	}

	// Get record and domain info
	var record struct {
		Name         string    `db:"name"`
		DNSDomainID  uuid.UUID `db:"dns_domain_id"`
		DNSAccountID uuid.UUID `db:"dns_account_id"`
	}
	err = h.db.Get(&record, `
		SELECT r.name, r.dns_domain_id, d.dns_account_id
		FROM dns_records r
		JOIN dns_managed_domains d ON r.dns_domain_id = d.id
		WHERE r.id = $1
	`, recordID)
	if err != nil {
		return err
	}

	// Get DNS account and provider
	var account struct {
		Provider    string `db:"provider"`
		Credentials string `db:"credentials"`
	}
	err = h.db.Get(&account, "SELECT provider, credentials FROM dns_accounts WHERE id = $1", record.DNSAccountID)
	if err != nil {
		return err
	}

	// Get domain name
	var domainName string
	h.db.Get(&domainName, "SELECT name FROM dns_managed_domains WHERE id = $1", record.DNSDomainID)

	// Update via DNS provider
	// This would call the appropriate provider's UpdateRecord method
	log.Printf("DNS Passthrough: Updating %s.%s to %s (trigger: %s)", record.Name, domainName, machineIP, trigger)

	// Update local record
	h.db.Exec("UPDATE dns_records SET value = $1, sync_status = 'pending', updated_at = NOW() WHERE id = $2", machineIP, recordID)

	// TODO: Actually call the DNS provider to update the record
	// For now, mark as synced (in production, this would be async)
	h.db.Exec("UPDATE dns_records SET sync_status = 'synced' WHERE id = $1", recordID)

	return nil
}

// updateWildcardDNS updates wildcard DNS records
func (h *PassthroughHandler) updateWildcardDNS(domainID, machineID uuid.UUID, includeRoot bool, trigger string) error {
	var machineIP string
	h.db.Get(&machineIP, "SELECT ip_address FROM machines WHERE id = $1", machineID)

	var domain struct {
		Name         string    `db:"name"`
		DNSAccountID uuid.UUID `db:"dns_account_id"`
	}
	h.db.Get(&domain, "SELECT name, dns_account_id FROM dns_managed_domains WHERE id = $1", domainID)

	log.Printf("DNS Passthrough: Updating *.%s to %s (trigger: %s, include_root: %v)", domain.Name, machineIP, trigger, includeRoot)

	// Update or create wildcard record
	h.db.Exec(`
		INSERT INTO dns_records (dns_domain_id, name, type, value, mode, sync_status)
		VALUES ($1, '*', 'A', $2, 'dynamic', 'pending')
		ON CONFLICT (dns_domain_id, name, type) DO UPDATE SET
			value = $2, sync_status = 'pending', updated_at = NOW()
	`, domainID, machineIP)

	if includeRoot {
		h.db.Exec(`
			INSERT INTO dns_records (dns_domain_id, name, type, value, mode, sync_status)
			VALUES ($1, '@', 'A', $2, 'dynamic', 'pending')
			ON CONFLICT (dns_domain_id, name, type) DO UPDATE SET
				value = $2, sync_status = 'pending', updated_at = NOW()
		`, domainID, machineIP)
	}

	// TODO: Call DNS provider
	h.db.Exec("UPDATE dns_records SET sync_status = 'synced' WHERE dns_domain_id = $1 AND mode = 'dynamic'", domainID)

	return nil
}

// GetDomainProxyMode gets the proxy mode for a domain
func (h *PassthroughHandler) GetDomainProxyMode(w http.ResponseWriter, r *http.Request) {
	domainID, err := uuid.Parse(mux.Vars(r)["domainId"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var proxyMode string
	err = h.db.Get(&proxyMode, "SELECT COALESCE(proxy_mode, 'separate') FROM dns_managed_domains WHERE id = $1", domainID)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"proxy_mode": proxyMode})
}

// SetDomainProxyMode sets the proxy mode for a domain
func (h *PassthroughHandler) SetDomainProxyMode(w http.ResponseWriter, r *http.Request) {
	domainID, err := uuid.Parse(mux.Vars(r)["domainId"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var req struct {
		ProxyMode string `json:"proxy_mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.ProxyMode != "separate" && req.ProxyMode != "wildcard" {
		http.Error(w, "Invalid proxy mode", http.StatusBadRequest)
		return
	}

	h.db.Exec("UPDATE dns_managed_domains SET proxy_mode = $1 WHERE id = $2", req.ProxyMode, domainID)

	w.WriteHeader(http.StatusOK)
}

// GetNginxConfig returns the generated nginx passthrough config for a machine
func (h *PassthroughHandler) GetNginxConfig(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["machineId"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	config, err := h.nginx.GenerateForMachine(machineID)
	if err != nil {
		http.Error(w, "Failed to generate config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(config))
}

// ApplyNginxConfig triggers nginx config deployment to a machine
func (h *PassthroughHandler) ApplyNginxConfig(w http.ResponseWriter, r *http.Request) {
	machineID, err := uuid.Parse(mux.Vars(r)["machineId"])
	if err != nil {
		http.Error(w, "Invalid machine ID", http.StatusBadRequest)
		return
	}

	if err := h.nginx.ApplyToMachine(machineID); err != nil {
		log.Printf("Failed to apply nginx config: %v", err)
		http.Error(w, "Failed to apply config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "applied"})
}

// ApplyPoolNginxConfigs triggers nginx config deployment to all pool members
func (h *PassthroughHandler) ApplyPoolNginxConfigs(w http.ResponseWriter, r *http.Request) {
	poolID, err := uuid.Parse(mux.Vars(r)["poolId"])
	if err != nil {
		http.Error(w, "Invalid pool ID", http.StatusBadRequest)
		return
	}

	isWildcard := r.URL.Query().Get("wildcard") == "true"

	if err := h.nginx.ApplyToAllPoolMembers(poolID, isWildcard); err != nil {
		log.Printf("Failed to apply nginx configs: %v", err)
		http.Error(w, "Failed to apply configs", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "applied"})
}

