package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/domainhealth"

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
		if err := h.assignDomainCore(id, assignReq); err != nil {
			log.Printf("bulk assign %s: %v", id, err)
			errors = append(errors, itemErr{ID: sid, Error: err.Error()})
			continue
		}
		okCount++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":     okCount,
		"errors": errors,
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

	res, err := h.db.Exec(`
		DELETE FROM domains d
		WHERE d.id = ANY($1)
	`, pq.Array(ids))
	if err != nil {
		log.Printf("bulk delete domains: %v", err)
		http.Error(w, "Failed to delete domains", http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int64{"deleted": n})
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
	ExpectedHTTPStatus int `json:"expected_http_status"`
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
	if code < 100 || code > 599 {
		http.Error(w, "expected_http_status must be between 100 and 599", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec(`
		UPDATE domains SET health_check_expected_status = $1, updated_at = NOW() WHERE id = $2
	`, code, id)
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
