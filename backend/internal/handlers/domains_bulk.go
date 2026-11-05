package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/domainhealth"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
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

// BulkCheckDomains runs an immediate health check for each domain.
func (h *DomainsHandler) BulkCheckDomains(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req bulkDomainIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	type result struct {
		ID     string `json:"id"`
		Status string `json:"status,omitempty"`
		Error  string `json:"error,omitempty"`
	}
	out := make([]result, 0, len(req.DomainIDs))

	for _, sid := range req.DomainIDs {
		id, err := uuid.Parse(sid)
		if err != nil {
			out = append(out, result{ID: sid, Error: "invalid id"})
			continue
		}
		if !h.domainAccessible(claims, userID, id) {
			out = append(out, result{ID: sid, Error: "forbidden"})
			continue
		}
		st, err := domainhealth.RunCheckAndPersist(h.db, id)
		if err != nil {
			out = append(out, result{ID: sid, Error: err.Error()})
			continue
		}
		out = append(out, result{ID: sid, Status: st})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"results": out})
}

type updateHealthCheckRequest struct {
	ExpectedHTTPStatus int     `json:"expected_http_status"` // 0 = keep current
	Path               *string `json:"path"`                 // optional; "" or "/" resets to "/"
}

// UpdateDomainHealthCheck sets the expected HTTP status for health checks (default 200).
func (h *DomainsHandler) UpdateDomainHealthCheck(w http.ResponseWriter, r *http.Request) {
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

	var req updateHealthCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	code := req.ExpectedHTTPStatus
	if code != 0 && (code < 100 || code > 599) {
		http.Error(w, "expected_http_status must be between 100 and 599", http.StatusBadRequest)
		return
	}
	setPath := req.Path != nil
	var path *string
	if setPath {
		p := strings.TrimSpace(*req.Path)
		if !domainhealth.ValidPath(p) {
			http.Error(w, "path must start with / and contain no spaces or control characters (max 512 chars)", http.StatusBadRequest)
			return
		}
		if p != "" && p != "/" {
			path = &p
		}
	}
	if code == 0 && !setPath {
		http.Error(w, "expected_http_status or path is required", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE domains SET
			health_check_expected_status = CASE WHEN $1 > 0 THEN $1 ELSE health_check_expected_status END,
			health_check_path = CASE WHEN $3 THEN $4 ELSE health_check_path END
		WHERE id = $2
	`, code, id, setPath, path)
	if err != nil {
		log.Printf("update health check: %v", err)
		http.Error(w, "Failed to update", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Health check settings updated"})
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
