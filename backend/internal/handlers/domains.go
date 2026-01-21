package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

func generateNginxFromStructured(structuredJSON json.RawMessage, domain string) string {
	var structured struct {
		SSLMode   string `json:"ssl_mode"`
		Locations []struct {
			Path       string `json:"path"`
			Type       string `json:"type"`
			StaticType string `json:"static_type"`
			ProxyURL   string `json:"proxy_url"`
			Root       string `json:"root"`
			Index      string `json:"index"`
			LandingID  string `json:"landing_id"`
			UsePHP     bool   `json:"use_php"`
		} `json:"locations"`
		CORS struct {
			Enabled  bool `json:"enabled"`
			AllowAll bool `json:"allow_all"`
		} `json:"cors"`
	}
	json.Unmarshal(structuredJSON, &structured)

	config := "server {\n"
	config += "    listen 80;\n"
	if structured.SSLMode != "disabled" {
		config += "    listen 443 ssl;\n"
	}
	config += "    server_name " + domain + ";\n\n"

	if structured.SSLMode != "disabled" {
		config += "    ssl_certificate /etc/letsencrypt/live/" + domain + "/fullchain.pem;\n"
		config += "    ssl_certificate_key /etc/letsencrypt/live/" + domain + "/privkey.pem;\n\n"
	}

	if structured.CORS.Enabled && structured.CORS.AllowAll {
		config += "    add_header 'Access-Control-Allow-Origin' '*' always;\n"
		config += "    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;\n"
		config += "    add_header 'Access-Control-Allow-Headers' '*' always;\n\n"
	}

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

			// PHP-FPM configuration
			if loc.UsePHP {
				config += "\n"
				config += "        location ~ \\.php$ {\n"
				config += "            include snippets/fastcgi-php.conf;\n"
				config += "            fastcgi_pass unix:/run/php/php-fpm.sock;\n"
				config += "            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n"
				config += "            include fastcgi_params;\n"
				config += "        }\n"
			} else {
				config += "        try_files $uri $uri/ =404;\n"
			}
		}
		config += "    }\n\n"
	}

	config += "}\n"
	return config
}

type DomainsHandler struct {
	db *database.DB
}

func NewDomainsHandler(db *database.DB) *DomainsHandler {
	return &DomainsHandler{db: db}
}

type DomainWithConfig struct {
	models.Domain
	MachineName   *string    `db:"machine_name" json:"machine_name"`
	MachineIP     *string    `db:"machine_ip" json:"machine_ip"`
	ConfigID      *uuid.UUID `db:"config_id" json:"config_id"`
	ConfigName    *string    `db:"config_name" json:"config_name"`
}

// ListDomains returns all domains with their machine and config info
func (h *DomainsHandler) ListDomains(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var domains []DomainWithConfig
	var err error

	if claims.IsSuperAdmin() {
		err = h.db.Select(&domains, `
			SELECT d.*, 
				m.hostname as machine_name, 
				m.ip_address as machine_ip,
				dcl.nginx_config_id as config_id,
				nc.name as config_name
			FROM domains d
			LEFT JOIN machines m ON d.assigned_machine_id = m.id
			LEFT JOIN domain_config_links dcl ON d.id = dcl.domain_id
			LEFT JOIN nginx_configs nc ON dcl.nginx_config_id = nc.id
			ORDER BY d.created_at DESC
		`)
	} else {
		err = h.db.Select(&domains, `
			SELECT d.*, 
				m.hostname as machine_name, 
				m.ip_address as machine_ip,
				dcl.nginx_config_id as config_id,
				nc.name as config_name
			FROM domains d
			LEFT JOIN machines m ON d.assigned_machine_id = m.id
			LEFT JOIN domain_config_links dcl ON d.id = dcl.domain_id
			LEFT JOIN nginx_configs nc ON dcl.nginx_config_id = nc.id
			WHERE d.owner_id = $1 OR d.owner_id IS NULL
			ORDER BY d.created_at DESC
		`, userID)
	}
	if err != nil {
		log.Printf("Failed to list domains: %v", err)
		http.Error(w, "Failed to list domains", http.StatusInternalServerError)
		return
	}

	if domains == nil {
		domains = []DomainWithConfig{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(domains)
}

// GetDomain returns a single domain by ID
func (h *DomainsHandler) GetDomain(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var domain DomainWithConfig
	err = h.db.Get(&domain, `
		SELECT d.*, 
			m.hostname as machine_name, 
			m.ip_address as machine_ip,
			dcl.nginx_config_id as config_id,
			nc.name as config_name
		FROM domains d
		LEFT JOIN machines m ON d.assigned_machine_id = m.id
		LEFT JOIN domain_config_links dcl ON d.id = dcl.domain_id
		LEFT JOIN nginx_configs nc ON dcl.nginx_config_id = nc.id
		WHERE d.id = $1
	`, id)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(domain)
}

type CreateDomainRequest struct {
	FQDN string `json:"fqdn"`
}

// CreateDomain creates a new domain
func (h *DomainsHandler) CreateDomain(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value("claims").(*auth.Claims)
	userID, _ := uuid.Parse(claims.UserID)

	var req CreateDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.FQDN == "" {
		http.Error(w, "FQDN is required", http.StatusBadRequest)
		return
	}

	var domain models.Domain
	err := h.db.Get(&domain, `
		INSERT INTO domains (fqdn, owner_id, status)
		VALUES ($1, $2, 'idle')
		RETURNING *
	`, req.FQDN, userID)
	if err != nil {
		log.Printf("Failed to create domain: %v", err)
		http.Error(w, "Failed to create domain (may already exist)", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(domain)
}

type AssignDomainRequest struct {
	MachineID *uuid.UUID `json:"machine_id"`
	ConfigID  *uuid.UUID `json:"config_id"`
}

// AssignDomain assigns a domain to a machine and config
func (h *DomainsHandler) AssignDomain(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var req AssignDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get current assignment to check if we need to remove from old machine
	var currentMachineID *uuid.UUID
	h.db.Get(&currentMachineID, "SELECT assigned_machine_id FROM domains WHERE id = $1", id)

	// Start transaction
	tx, err := h.db.Beginx()
	if err != nil {
		log.Printf("Failed to start transaction: %v", err)
		http.Error(w, "Failed to assign domain", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Update domain assignment
	status := "idle"
	if req.MachineID != nil {
		status = "linked"
	}

	_, err = tx.Exec(`
		UPDATE domains 
		SET assigned_machine_id = $1, status = $2, updated_at = NOW()
		WHERE id = $3
	`, req.MachineID, status, id)
	if err != nil {
		log.Printf("Failed to update domain: %v", err)
		http.Error(w, "Failed to assign domain", http.StatusInternalServerError)
		return
	}

	// Update config link
	if req.ConfigID != nil {
		// Remove existing link
		tx.Exec("DELETE FROM domain_config_links WHERE domain_id = $1", id)
		// Add new link
		_, err = tx.Exec(`
			INSERT INTO domain_config_links (domain_id, nginx_config_id)
			VALUES ($1, $2)
		`, id, req.ConfigID)
		if err != nil {
			log.Printf("Failed to link config: %v", err)
			http.Error(w, "Failed to link config", http.StatusInternalServerError)
			return
		}
	}

	// Create jobs to apply/remove config on machines
	// Get domain and config info for job payload
	var domainFQDN string
	tx.Get(&domainFQDN, "SELECT fqdn FROM domains WHERE id = $1", id)

	var nginxConfig string
	if req.ConfigID != nil {
		var config struct {
			StructuredJSON json.RawMessage `db:"structured_json"`
			RawText        *string         `db:"raw_text"`
			Mode           string          `db:"mode"`
		}
		tx.Get(&config, "SELECT structured_json, raw_text, mode FROM nginx_configs WHERE id = $1", req.ConfigID)
		
		if config.Mode == "manual" && config.RawText != nil {
			nginxConfig = *config.RawText
		} else {
			// Generate nginx config from structured JSON
			nginxConfig = generateNginxFromStructured(config.StructuredJSON, domainFQDN)
		}
	}

	// If old machine exists and different from new, create remove_domain job
	if currentMachineID != nil && (req.MachineID == nil || *currentMachineID != *req.MachineID) {
		var oldAgentID uuid.UUID
		tx.Get(&oldAgentID, "SELECT agent_id FROM machines WHERE id = $1", currentMachineID)
		if oldAgentID != uuid.Nil {
			payload, _ := json.Marshal(map[string]string{"domain": domainFQDN})
			tx.Exec(`
				INSERT INTO jobs (agent_id, type, payload_json, status)
				VALUES ($1, 'remove_domain', $2, 'pending')
			`, oldAgentID, payload)
		}
	}

	// If new machine exists, create apply_domain job
	if req.MachineID != nil && req.ConfigID != nil {
		var newAgentID uuid.UUID
		tx.Get(&newAgentID, "SELECT agent_id FROM machines WHERE id = $1", req.MachineID)
		if newAgentID != uuid.Nil {
			payload, _ := json.Marshal(map[string]interface{}{
				"domain":       domainFQDN,
				"nginx_config": nginxConfig,
				"ssl_mode":     "allow_http",
			})
			tx.Exec(`
				INSERT INTO jobs (agent_id, type, payload_json, status)
				VALUES ($1, 'apply_domain', $2, 'pending')
			`, newAgentID, payload)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		http.Error(w, "Failed to assign domain", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Domain assigned"})
}

// UpdateDomainNotes updates the notes for a domain
func (h *DomainsHandler) UpdateDomainNotes(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Notes string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	_, err = h.db.Exec("UPDATE domains SET notes_md = $1, updated_at = NOW() WHERE id = $2", req.Notes, id)
	if err != nil {
		log.Printf("Failed to update domain notes: %v", err)
		http.Error(w, "Failed to update domain", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Notes updated"})
}

// DeleteDomain deletes a domain
func (h *DomainsHandler) DeleteDomain(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid domain ID", http.StatusBadRequest)
		return
	}

	// TODO: Create remove_domain job if assigned to a machine

	_, err = h.db.Exec("DELETE FROM domains WHERE id = $1", id)
	if err != nil {
		log.Printf("Failed to delete domain: %v", err)
		http.Error(w, "Failed to delete domain", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

