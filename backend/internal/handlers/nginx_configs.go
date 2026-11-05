package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

type NginxConfigsHandler struct {
	db *database.DB
}

func NewNginxConfigsHandler(db *database.DB) *NginxConfigsHandler {
	return &NginxConfigsHandler{db: db}
}

// ListNginxConfigs returns all nginx configs
func (h *NginxConfigsHandler) ListNginxConfigs(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var configs []models.NginxConfig
	var err error

	if claims.IsSuperAdmin() {
		err = h.db.Select(&configs, `
			SELECT * FROM nginx_configs
			ORDER BY created_at DESC
		`)
	} else {
		err = h.db.Select(&configs, `
			SELECT * FROM nginx_configs
			WHERE owner_id = $1 OR owner_id IS NULL
			ORDER BY created_at DESC
		`, userID)
	}
	if err != nil {
		log.Printf("Failed to list nginx configs: %v", err)
		http.Error(w, "Failed to list nginx configs", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, h.withDomains(configs))
}

// GetNginxConfig returns a single nginx config by ID
func (h *NginxConfigsHandler) GetNginxConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var config models.NginxConfig
	err = h.db.Get(&config, "SELECT * FROM nginx_configs WHERE id = $1", id)
	if err != nil {
		http.Error(w, "Config not found", http.StatusNotFound)
		return
	}
	if !h.canUseConfig(r, &config) {
		http.Error(w, "Config not found", http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, h.withDomains([]models.NginxConfig{config})[0])
}

type CreateNginxConfigRequest struct {
	Name           string                        `json:"name"`
	Mode           string                        `json:"mode"`
	StructuredJSON *models.NginxConfigStructured `json:"structured_json"`
	RawText        *string                       `json:"raw_text"`
}

// CreateNginxConfig creates a new nginx config
func (h *NginxConfigsHandler) CreateNginxConfig(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateNginxConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	if req.Mode == "" {
		req.Mode = "auto"
	}

	var structuredJSON []byte
	var err error
	if req.StructuredJSON != nil {
		structuredJSON, err = json.Marshal(req.StructuredJSON)
		if err != nil {
			http.Error(w, "Invalid structured config", http.StatusBadRequest)
			return
		}
	}

	var config models.NginxConfig
	err = h.db.Get(&config, `
		INSERT INTO nginx_configs (name, owner_id, mode, structured_json, raw_text)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING *
	`, req.Name, userID, req.Mode, jsonOrNull(structuredJSON), req.RawText)
	if err != nil {
		log.Printf("Failed to create nginx config: %v", err)
		http.Error(w, "Failed to create nginx config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(config)
}

type UpdateNginxConfigRequest struct {
	Name           *string                       `json:"name"`
	Mode           *string                       `json:"mode"`
	StructuredJSON *models.NginxConfigStructured `json:"structured_json"`
	RawText        *string                       `json:"raw_text"`
}

// UpdateNginxConfig updates an existing nginx config
func (h *NginxConfigsHandler) UpdateNginxConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var req UpdateNginxConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get existing config
	var existing models.NginxConfig
	err = h.db.Get(&existing, "SELECT * FROM nginx_configs WHERE id = $1", id)
	if err != nil {
		http.Error(w, "Config not found", http.StatusNotFound)
		return
	}
	if !h.canUseConfig(r, &existing) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	// Update fields
	name := existing.Name
	if req.Name != nil {
		name = *req.Name
	}

	mode := existing.Mode
	if req.Mode != nil {
		mode = *req.Mode
	}

	var structuredJSON []byte
	if req.StructuredJSON != nil {
		structuredJSON, err = json.Marshal(req.StructuredJSON)
		if err != nil {
			http.Error(w, "Invalid structured config", http.StatusBadRequest)
			return
		}
	} else {
		structuredJSON = existing.StructuredJSON
	}

	rawText := existing.RawText
	if req.RawText != nil {
		rawText = req.RawText
	}

	var config models.NginxConfig
	err = h.db.Get(&config, `
		UPDATE nginx_configs 
		SET name = $1, mode = $2, structured_json = $3, raw_text = $4, updated_at = NOW()
		WHERE id = $5
		RETURNING *
	`, name, mode, jsonOrNull(structuredJSON), rawText, id)
	if err != nil {
		log.Printf("Failed to update nginx config: %v", err)
		http.Error(w, "Failed to update nginx config", http.StatusInternalServerError)
		return
	}

	// Not pushed automatically: domains become out_of_sync until POST /api/nginx-configs/{id}/apply.
	writeJSON(w, http.StatusOK, h.withDomains([]models.NginxConfig{config})[0])
}

// DeleteNginxConfig deletes an nginx config
func (h *NginxConfigsHandler) DeleteNginxConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}

	var existing models.NginxConfig
	if err := h.db.Get(&existing, "SELECT * FROM nginx_configs WHERE id = $1", id); err != nil {
		http.Error(w, "Config not found", http.StatusNotFound)
		return
	}
	if !h.canUseConfig(r, &existing) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	_, err = h.db.Exec("DELETE FROM nginx_configs WHERE id = $1", id)
	if err != nil {
		log.Printf("Failed to delete nginx config: %v", err)
		http.Error(w, "Failed to delete nginx config", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GenerateNginxConfig generates raw nginx config from structured form
func GenerateNginxConfig(structured *models.NginxConfigStructured, domain string) string {
	config := "server {\n"
	config += "    listen 80;\n"

	if structured.SSLMode != "disabled" {
		config += "    listen 443 ssl;\n"
	}

	config += "    server_name " + domain + ";\n\n"

	// SSL configuration
	if structured.SSLMode != "disabled" {
		config += "    ssl_certificate /etc/letsencrypt/live/" + domain + "/fullchain.pem;\n"
		config += "    ssl_certificate_key /etc/letsencrypt/live/" + domain + "/privkey.pem;\n\n"

		if structured.SSLMode == "redirect_https" {
			config += "    if ($scheme != \"https\") {\n"
			config += "        return 301 https://$host$request_uri;\n"
			config += "    }\n\n"
		}
	}

	// CORS configuration
	if structured.CORS != nil && structured.CORS.Enabled {
		if structured.CORS.AllowAll {
			config += "    add_header 'Access-Control-Allow-Origin' '*' always;\n"
			config += "    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;\n"
			config += "    add_header 'Access-Control-Allow-Headers' '*' always;\n\n"
		}
	}

	// Locations
	for _, loc := range structured.Locations {
		config += "    location " + loc.Path + " {\n"

		if loc.Type == "proxy" && loc.ProxyURL != "" {
			config += "        proxy_pass " + loc.ProxyURL + ";\n"
			config += "        proxy_set_header Host $host;\n"
			config += "        proxy_set_header X-Real-IP $remote_addr;\n"
			config += "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
			config += "        proxy_set_header X-Forwarded-Proto $scheme;\n"
		} else if loc.Type == "static" {
			if loc.Root != "" {
				config += "        root " + loc.Root + ";\n"
			}
			if loc.Index != "" {
				config += "        index " + loc.Index + ";\n"
			}
			config += "        try_files $uri $uri/ =404;\n"
		}

		config += "    }\n\n"
	}

	config += "}\n"
	return config
}

// ===================== Domains using a config / re-apply =====================

// NginxConfigDomain is a domain that uses an nginx config.
type NginxConfigDomain struct {
	ID             uuid.UUID  `db:"id" json:"id"`
	FQDN           string     `db:"fqdn" json:"fqdn"`
	MachineID      *uuid.UUID `db:"machine_id" json:"machine_id"`
	MachineTitle   *string    `db:"machine_title" json:"machine_title"`
	ApplyStatus    *string    `db:"apply_status" json:"apply_status"`
	LastAppliedAt  *time.Time `db:"last_applied_at" json:"last_applied_at"`
	LastApplyError *string    `db:"last_apply_error" json:"last_apply_error"`
	LastJobID      *uuid.UUID `db:"last_job_id" json:"last_job_id"`
	OutOfSync      bool       `db:"out_of_sync" json:"out_of_sync"`
	ConfigID       uuid.UUID  `db:"config_id" json:"-"`
}

// NginxConfigWithDomains is the list/detail representation of an nginx config.
type NginxConfigWithDomains struct {
	models.NginxConfig
	DomainsCount   int                 `json:"domains_count"`
	OutOfSyncCount int                 `json:"out_of_sync_count"`
	Domains        []NginxConfigDomain `json:"domains"`
}

func (h *NginxConfigsHandler) configDomains(configIDs []uuid.UUID) map[uuid.UUID][]NginxConfigDomain {
	out := map[uuid.UUID][]NginxConfigDomain{}
	if len(configIDs) == 0 {
		return out
	}
	var rows []NginxConfigDomain
	err := h.db.Select(&rows, `
		SELECT d.id, d.fqdn, d.assigned_machine_id AS machine_id,
			COALESCE(NULLIF(m.title, ''), m.hostname) AS machine_title,
			d.apply_status, d.last_applied_at, d.last_apply_error, d.last_job_id,
			COALESCE(d.assigned_machine_id IS NOT NULL AND (d.last_applied_at IS NULL OR d.last_applied_at < nc.updated_at), false) AS out_of_sync,
			dcl.nginx_config_id AS config_id
		FROM domain_config_links dcl
		JOIN domains d ON d.id = dcl.domain_id
		JOIN nginx_configs nc ON nc.id = dcl.nginx_config_id
		LEFT JOIN machines m ON m.id = d.assigned_machine_id
		WHERE dcl.nginx_config_id = ANY($1)
		ORDER BY d.fqdn`, pq.Array(configIDs))
	if err != nil {
		log.Printf("Failed to load config domains: %v", err)
		return out
	}
	for _, row := range rows {
		out[row.ConfigID] = append(out[row.ConfigID], row)
	}
	return out
}

func (h *NginxConfigsHandler) withDomains(configs []models.NginxConfig) []NginxConfigWithDomains {
	ids := make([]uuid.UUID, 0, len(configs))
	for _, c := range configs {
		ids = append(ids, c.ID)
	}
	byConfig := h.configDomains(ids)
	out := make([]NginxConfigWithDomains, 0, len(configs))
	for _, c := range configs {
		ds := byConfig[c.ID]
		if ds == nil {
			ds = []NginxConfigDomain{}
		}
		item := NginxConfigWithDomains{NginxConfig: c, DomainsCount: len(ds), Domains: ds}
		for _, d := range ds {
			if d.OutOfSync {
				item.OutOfSyncCount++
			}
		}
		out = append(out, item)
	}
	return out
}

func (h *NginxConfigsHandler) canUseConfig(r *http.Request, cfg *models.NginxConfig) bool {
	claims, userID, ok := requestClaims(r)
	if !ok {
		return false
	}
	return claims.IsSuperAdmin() || cfg.OwnerID == nil || *cfg.OwnerID == userID
}

// ApplyNginxConfig creates apply jobs for every assigned domain that uses the config.
// POST /api/nginx-configs/{id}/apply  body (optional): {"domain_ids": ["..."], "only_out_of_sync": true}
func (h *NginxConfigsHandler) ApplyNginxConfig(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(mux.Vars(r)["id"])
	if err != nil {
		http.Error(w, "Invalid config ID", http.StatusBadRequest)
		return
	}
	var cfg models.NginxConfig
	if err := h.db.Get(&cfg, "SELECT * FROM nginx_configs WHERE id = $1", id); err != nil {
		http.Error(w, "Config not found", http.StatusNotFound)
		return
	}
	if !h.canUseConfig(r, &cfg) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	var req struct {
		DomainIDs     []uuid.UUID `json:"domain_ids"`
		OnlyOutOfSync bool        `json:"only_out_of_sync"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	only := map[uuid.UUID]bool{}
	for _, d := range req.DomainIDs {
		only[d] = true
	}

	type itemResult struct {
		DomainID uuid.UUID                `json:"domain_id"`
		FQDN     string                   `json:"fqdn"`
		JobID    *uuid.UUID               `json:"job_id,omitempty"`
		Jobs     []map[string]interface{} `json:"jobs,omitempty"`
		Error    string                   `json:"error,omitempty"`
	}
	results := []itemResult{}
	allJobs := []map[string]interface{}{}
	userID := jobs.UserID(r)

	for _, d := range h.configDomains([]uuid.UUID{id})[id] {
		if len(only) > 0 && !only[d.ID] {
			continue
		}
		if req.OnlyOutOfSync && !d.OutOfSync {
			continue
		}
		res := itemResult{DomainID: d.ID, FQDN: d.FQDN}
		switch {
		case d.MachineID == nil:
			res.Error = "not assigned to a machine"
		case !canManageMachineID(h.db, r, *d.MachineID):
			res.Error = "access denied to machine"
		default:
			created, err := applyDomainNow(r.Context(), h.db, d.ID, userID)
			if err != nil {
				res.Error = err.Error()
			} else {
				res.JobID = &created[0].ID
				for _, j := range created {
					jr := jobCreatedResponse(j)
					res.Jobs = append(res.Jobs, jr)
					allJobs = append(allJobs, jr)
				}
			}
		}
		results = append(results, res)
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"config_id": id,
		"results":   results,
		"jobs":      allJobs,
	})
}

// jsonOrNull stores a JSON null instead of SQL NULL/empty bytes: an empty []byte is not
// valid jsonb, and models.NginxConfig.StructuredJSON can't scan SQL NULL.
func jsonOrNull(b []byte) string {
	if len(b) == 0 {
		return "null"
	}
	return string(b)
}
