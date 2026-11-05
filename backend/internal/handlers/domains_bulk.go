package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/domainhealth"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

func (h *DomainsHandler) domainAccessible(claims *auth.Claims, userID uuid.UUID, domainID uuid.UUID) bool {
	if claims.IsSuperAdmin() {
		return true
	}
	var ok bool
	_ = h.db.Get(&ok, `
		SELECT EXISTS(
			SELECT 1 FROM domains WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL)
		)
	`, domainID, userID)
	return ok
}

type bulkDomainIDsRequest struct {
	DomainIDs []string `json:"domain_ids"`
}

// BulkAssignDomains assigns machine + config to many domains.
func (h *DomainsHandler) BulkAssignDomains(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req struct {
		bulkDomainIDsRequest
		MachineID *uuid.UUID `json:"machine_id"`
		ConfigID  *uuid.UUID `json:"config_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	type itemErr struct {
		ID    string `json:"id"`
		Error string `json:"error"`
	}
	var errors []itemErr
	var allJobs []*models.Job
	okCount := 0

	for _, sid := range req.DomainIDs {
		id, err := uuid.Parse(sid)
		if err != nil {
			errors = append(errors, itemErr{ID: sid, Error: "invalid id"})
			continue
		}
		if !h.domainAccessible(claims, userID, id) {
			errors = append(errors, itemErr{ID: sid, Error: "forbidden"})
			continue
		}
		assignReq := AssignDomainRequest{MachineID: req.MachineID, ConfigID: req.ConfigID}
		created, err := h.assignDomainCore(id, assignReq, jobs.UserID(r))
		if err != nil {
			log.Printf("bulk assign %s: %v", id, err)
			errors = append(errors, itemErr{ID: sid, Error: err.Error()})
			continue
		}
		allJobs = append(allJobs, created...)
		okCount++
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":     okCount,
		"errors": errors,
		"jobs":   jobsResponse(allJobs),
	})
}

// BulkDeleteDomains deletes many domains the user can access.
func (h *DomainsHandler) BulkDeleteDomains(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req bulkDomainIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	ids := make([]uuid.UUID, 0, len(req.DomainIDs))
	for _, sid := range req.DomainIDs {
		id, err := uuid.Parse(sid)
		if err != nil {
			continue
		}
		if h.domainAccessible(claims, userID, id) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"deleted": 0})
		return
	}

	n, created, warnings, err := deleteDomainsWithCleanup(r.Context(), h.db, ids, &userID)
	if err != nil {
		log.Printf("bulk delete domains: %v", err)
		http.Error(w, "Failed to delete domains", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"deleted": n, "jobs": jobsResponse(created), "warnings": warnings})
}

// bulkCheckWorkers bounds parallel probes so a large selection doesn't open hundreds of connections.
const bulkCheckWorkers = 8

type bulkCheckResult struct {
	ID     string `json:"id"`
	Status string `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
}

// accessibleDomainIDs splits ids into those the user may touch and per-id errors for the rest.
func (h *DomainsHandler) accessibleDomainIDs(claims *auth.Claims, userID uuid.UUID, sids []string) ([]uuid.UUID, []bulkCheckResult) {
	ids := make([]uuid.UUID, 0, len(sids))
	errs := []bulkCheckResult{}
	for _, sid := range sids {
		id, err := uuid.Parse(sid)
		if err != nil {
			errs = append(errs, bulkCheckResult{ID: sid, Error: "invalid id"})
			continue
		}
		if !h.domainAccessible(claims, userID, id) {
			errs = append(errs, bulkCheckResult{ID: sid, Error: "forbidden"})
			continue
		}
		ids = append(ids, id)
	}
	return ids, errs
}

// runChecks probes the domains in parallel and returns one result per id, in input order.
func (h *DomainsHandler) runChecks(ids []uuid.UUID) []bulkCheckResult {
	out := make([]bulkCheckResult, len(ids))
	index := make(map[uuid.UUID]int, len(ids))
	for i, id := range ids {
		index[id] = i
	}
	var mu sync.Mutex
	domainhealth.RunChecksConcurrently(h.db, ids, bulkCheckWorkers, func(id uuid.UUID, st string, err error) {
		res := bulkCheckResult{ID: id.String(), Status: st}
		if err != nil {
			res = bulkCheckResult{ID: id.String(), Error: err.Error()}
		}
		mu.Lock()
		out[index[id]] = res
		mu.Unlock()
	})
	return out
}

// BulkCheckDomains runs an immediate health check for each domain.
func (h *DomainsHandler) BulkCheckDomains(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req bulkDomainIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	ids, errs := h.accessibleDomainIDs(claims, userID, req.DomainIDs)
	writeJSON(w, http.StatusOK, map[string]interface{}{"results": append(h.runChecks(ids), errs...)})
}

// healthCheckSettings picks a preset or custom rules; exactly one of the two must be set.
type healthCheckSettings struct {
	PresetID *uuid.UUID          `json:"preset_id"`
	Rules    *domainhealth.Rules `json:"rules"`
}

// apply validates the settings and writes them to the domains. Custom rules detach any preset.
// On error it returns the HTTP status to answer with.
func (s healthCheckSettings) apply(h *DomainsHandler, claims *auth.Claims, userID uuid.UUID, ids []uuid.UUID) (int64, int, error) {
	if s.PresetID != nil {
		if !presetAccessible(h.db, claims, userID, *s.PresetID) {
			return 0, http.StatusBadRequest, fmt.Errorf("preset not found")
		}
		res, err := h.db.Exec(`UPDATE domains SET health_check_preset_id = $2 WHERE id = ANY($1)`, pq.Array(ids), *s.PresetID)
		if err != nil {
			return 0, http.StatusInternalServerError, err
		}
		n, _ := res.RowsAffected()
		return n, 0, nil
	}
	if s.Rules == nil {
		return 0, http.StatusBadRequest, fmt.Errorf("preset_id or rules is required")
	}
	rules, err := s.Rules.Normalize()
	if err != nil {
		return 0, http.StatusBadRequest, err
	}
	spec, _ := domainhealth.ParseStatusSpec(rules.Expected)
	res, err := h.db.Exec(`
		UPDATE domains SET
			health_check_preset_id = NULL,
			health_check_path = NULLIF($2, '/'),
			health_check_expected = $3,
			health_check_expected_status = $4,
			health_check_body_contains = NULLIF($5, ''),
			health_check_timeout_seconds = NULLIF($6::int, $7::int)
		WHERE id = ANY($1)
	`, pq.Array(ids), rules.Path, rules.Expected, spec.FirstCode(), rules.BodyContains, rules.TimeoutSeconds, domainhealth.DefaultTimeoutSeconds)
	if err != nil {
		return 0, http.StatusInternalServerError, err
	}
	n, _ := res.RowsAffected()
	return n, 0, nil
}

func writeSettingsError(w http.ResponseWriter, code int, err error) {
	if code == http.StatusInternalServerError {
		log.Printf("health check settings: %v", err)
		http.Error(w, "Failed to update health check settings", code)
		return
	}
	http.Error(w, err.Error(), code)
}

// UpdateDomainHealthCheck points a domain at a preset or sets its own rules.
func (h *DomainsHandler) UpdateDomainHealthCheck(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}
	if !h.domainAccessible(claims, userID, id) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	var req healthCheckSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if _, code, err := req.apply(h, claims, userID, []uuid.UUID{id}); err != nil {
		writeSettingsError(w, code, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Health check settings updated"})
}

// BulkHealthCheck optionally sets a preset or custom rules on many domains, then optionally runs checks.
func (h *DomainsHandler) BulkHealthCheck(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req struct {
		bulkDomainIDsRequest
		healthCheckSettings
		Run bool `json:"run"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	ids, errs := h.accessibleDomainIDs(claims, userID, req.DomainIDs)
	var updated int64
	if len(ids) > 0 && (req.PresetID != nil || req.Rules != nil) {
		n, code, err := req.healthCheckSettings.apply(h, claims, userID, ids)
		if err != nil {
			writeSettingsError(w, code, err)
			return
		}
		updated = n
	}

	results := []bulkCheckResult{}
	if req.Run && len(ids) > 0 {
		// Unassigned domains have nothing to probe; their status stays idle.
		var assigned []uuid.UUID
		if err := h.db.Select(&assigned, `SELECT id FROM domains WHERE id = ANY($1) AND assigned_machine_id IS NOT NULL`, pq.Array(ids)); err != nil {
			log.Printf("bulk health check: %v", err)
		}
		results = h.runChecks(assigned)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"updated": updated,
		"results": results,
		"errors":  errs,
	})
}

// TriggerDomainHealthCheck runs an immediate health check for one domain.
func (h *DomainsHandler) TriggerDomainHealthCheck(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}
	if !h.domainAccessible(claims, userID, id) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	st, err := domainhealth.RunCheckAndPersist(h.db, id)
	if err != nil {
		log.Printf("trigger health check: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": st})
}
