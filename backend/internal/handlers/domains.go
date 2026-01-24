package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"configuratix/backend/internal/auth"
	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

// escapeNginxRegex escapes special characters for use in Nginx regex
func escapeNginxRegex(pattern string) string {
	// Escape double quotes and backslashes for Nginx string context
	result := strings.ReplaceAll(pattern, `\`, `\\`)
	result = strings.ReplaceAll(result, `"`, `\"`)
	return result
}

// structuredConfig is used for parsing the structured JSON
type structuredConfig struct {
	IsPassthrough           bool   `json:"is_passthrough"`
	PassthroughTarget       string `json:"passthrough_target"`
	SSLMode                 string `json:"ssl_mode"`
	AutoindexOff            *bool  `json:"autoindex_off"`
	DenyAllCatchall         *bool  `json:"deny_all_catchall"`
	UABlockingEnabled       bool   `json:"ua_blocking_enabled"`
	EndpointBlockingEnabled bool   `json:"endpoint_blocking_enabled"`
	Locations               []struct {
		Path       string `json:"path"`
		MatchType  string `json:"match_type"`
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

// isPassthroughConfig checks if the structured JSON is a passthrough config
func isPassthroughConfig(structuredJSON json.RawMessage) bool {
	var cfg structuredConfig
	json.Unmarshal(structuredJSON, &cfg)
	return cfg.IsPassthrough
}

// getPassthroughTarget returns the passthrough target from structured JSON
func getPassthroughTarget(structuredJSON json.RawMessage) string {
	var cfg structuredConfig
	json.Unmarshal(structuredJSON, &cfg)
	return cfg.PassthroughTarget
}

// SecurityConfig holds security settings for Nginx config generation
type SecurityConfig struct {
	UAPatterns    []string // Regex patterns for blocked user agents
	EndpointRules []string // Allowed endpoint regex patterns
}

// generateNginxFromStructured creates nginx config from structured JSON
// phpVersion is optional - if provided, uses the specific PHP-FPM socket, otherwise uses default
// securityCfg is optional security configuration for UA/endpoint blocking
func generateNginxFromStructured(structuredJSON json.RawMessage, domain string, phpVersion string, securityCfg *SecurityConfig) string {
	var structured structuredConfig
	json.Unmarshal(structuredJSON, &structured)

	// Passthrough configs don't generate HTTP server blocks
	if structured.IsPassthrough {
		return "" // Return empty - passthrough uses stream config instead
	}

	// Default values for security settings
	autoindexOff := structured.AutoindexOff == nil || *structured.AutoindexOff
	denyAllCatchall := structured.DenyAllCatchall == nil || *structured.DenyAllCatchall

	config := "server {\n"
	config += "    listen 80;\n"
	if structured.SSLMode != "disabled" {
		config += "    listen 443 ssl http2;\n"
	}
	config += "    server_name " + domain + ";\n\n"

	if structured.SSLMode != "disabled" {
		config += "    ssl_certificate /etc/letsencrypt/live/" + domain + "/fullchain.pem;\n"
		config += "    ssl_certificate_key /etc/letsencrypt/live/" + domain + "/privkey.pem;\n"
		config += "    ssl_protocols TLSv1.2 TLSv1.3;\n\n"
	}

	// Security settings
	if autoindexOff {
		config += "    # Deny directory listing\n"
		config += "    autoindex off;\n\n"
	}

	// Security blocking with proper logging
	hasSecurityBlocking := (structured.UABlockingEnabled && securityCfg != nil && len(securityCfg.UAPatterns) > 0) ||
		(structured.EndpointBlockingEnabled && securityCfg != nil && len(securityCfg.EndpointRules) > 0)

	if hasSecurityBlocking {
		// Set variables to track block reason
		config += "    # Security blocking variables\n"
		config += "    set $security_block \"\";\n"
		config += "    set $block_reason \"\";\n\n"
	}

	// User-Agent blocking
	if structured.UABlockingEnabled && securityCfg != nil && len(securityCfg.UAPatterns) > 0 {
		config += "    # Block bad user agents\n"
		for _, pattern := range securityCfg.UAPatterns {
			config += "    if ($http_user_agent ~* \"" + escapeNginxRegex(pattern) + "\") {\n"
			config += "        set $security_block \"1\";\n"
			config += "        set $block_reason \"blocked_ua\";\n"
			config += "    }\n"
		}
		config += "\n"
	}

	// Endpoint blocking (allowlist mode)
	if structured.EndpointBlockingEnabled && securityCfg != nil && len(securityCfg.EndpointRules) > 0 {
		config += "    # Endpoint allowlist - block requests not matching allowed patterns\n"
		config += "    set $endpoint_allowed 0;\n"
		for _, pattern := range securityCfg.EndpointRules {
			config += "    if ($request_uri ~* \"" + escapeNginxRegex(pattern) + "\") { set $endpoint_allowed 1; }\n"
		}
		config += "    if ($endpoint_allowed = 0) {\n"
		config += "        set $security_block \"1\";\n"
		config += "        set $block_reason \"invalid_endpoint\";\n"
		config += "    }\n\n"
	}

	// Add error_page and blocked location if security is enabled
	if hasSecurityBlocking {
		config += "    # Redirect blocked requests to logging location\n"
		config += "    if ($security_block = \"1\") { return 493; }\n"
		config += "    error_page 493 = @security_blocked;\n\n"
	}

	if structured.CORS.Enabled && structured.CORS.AllowAll {
		config += "    add_header 'Access-Control-Allow-Origin' '*' always;\n"
		config += "    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;\n"
		config += "    add_header 'Access-Control-Allow-Headers' '*' always;\n\n"
	}

	// Determine PHP-FPM socket path
	phpSocket := "/run/php/php-fpm.sock" // Default fallback
	if phpVersion != "" {
		phpSocket = "/run/php/php" + phpVersion + "-fpm.sock"
	}

	// Track if we need a global PHP handler and what root to use
	var phpEnabled bool
	var phpRoot string

	// Check if user has a root "/" location defined
	hasRootLocation := false
	for _, loc := range structured.Locations {
		if loc.Path == "/" && (loc.MatchType == "" || loc.MatchType == "prefix") {
			hasRootLocation = true
			break
		}
	}

	// Add deny all catch-all first if enabled and user doesn't have root location
	if denyAllCatchall && !hasRootLocation {
		config += "    # Deny all by default\n"
		config += "    location / {\n"
		config += "        deny all;\n"
		config += "    }\n\n"
	}

	for _, loc := range structured.Locations {
		// Build location directive based on match type
		locationDirective := "    location "
		switch loc.MatchType {
		case "exact":
			locationDirective += "= "
		case "regex":
			locationDirective += "~ "
		case "case_insensitive_regex":
			locationDirective += "~* "
		// "prefix" or empty = default prefix match (no modifier)
		}
		locationDirective += loc.Path + " {\n"
		config += locationDirective
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
			indexValue := loc.Index
			if indexValue == "" {
				indexValue = "index.html index.htm"
			}
			if loc.UsePHP {
				// Add PHP files to index
				if indexValue != "" && !strings.Contains(indexValue, "index.php") {
					indexValue = "index.php " + indexValue
				}
				phpEnabled = true
				if phpRoot == "" && loc.Root != "" {
					phpRoot = loc.Root
				}
			}
			config += "        index " + indexValue + ";\n"
			config += "        try_files $uri $uri/ =404;\n"
		}
		config += "    }\n\n"
	}

	// Add PHP handler at server level if any location uses PHP
	if phpEnabled {
		config += "    # PHP-FPM handler\n"
		config += "    location ~ \\.php$ {\n"
		if phpRoot != "" {
			config += "        root " + phpRoot + ";\n"
		}
		config += "        try_files $uri =404;\n"
		config += "        fastcgi_split_path_info ^(.+\\.php)(/.+)$;\n"
		config += "        fastcgi_pass unix:" + phpSocket + ";\n"
		config += "        fastcgi_index index.php;\n"
		config += "        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n"
		config += "        include fastcgi_params;\n"
		config += "    }\n\n"
	}

	// Add security blocked location for logging
	if hasSecurityBlocking {
		config += "    # Security blocked location - logs blocked requests for agent to process\n"
		config += "    location @security_blocked {\n"
		config += "        internal;\n"
		config += "        access_log /var/log/nginx/security-blocked.log combined;\n"
		config += "        return 403;\n"
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
	ID                uuid.UUID  `db:"id" json:"id"`
	FQDN              string     `db:"fqdn" json:"fqdn"`
	OwnerID           *uuid.UUID `db:"owner_id" json:"owner_id"`
	AssignedMachineID *uuid.UUID `db:"assigned_machine_id" json:"assigned_machine_id"`
	Status            string     `db:"status" json:"status"`
	NotesMD           *string    `db:"notes_md" json:"notes_md"`
	LastCheckAt       *time.Time `db:"last_check_at" json:"last_check_at"`
	CreatedAt         time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time  `db:"updated_at" json:"updated_at"`
	MachineName       *string    `db:"machine_name" json:"machine_name"`
	MachineIP         *string    `db:"machine_ip" json:"machine_ip"`
	ConfigID          *uuid.UUID `db:"config_id" json:"config_id"`
	ConfigName        *string    `db:"config_name" json:"config_name"`
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
	var configJSON json.RawMessage
	if req.ConfigID != nil {
		var config struct {
			StructuredJSON json.RawMessage `db:"structured_json"`
			RawText        *string         `db:"raw_text"`
			Mode           string          `db:"mode"`
		}
		tx.Get(&config, "SELECT structured_json, raw_text, mode FROM nginx_configs WHERE id = $1", req.ConfigID)
		configJSON = config.StructuredJSON
		
		// Look up PHP version for the target machine if available
		phpVersion := ""
		if req.MachineID != nil {
			var runtime struct {
				Version string `db:"version"`
				Status  string `db:"status"`
			}
			err := tx.Get(&runtime, "SELECT version, status FROM php_runtimes WHERE machine_id = $1", req.MachineID)
			if err == nil && runtime.Status == "installed" {
				phpVersion = runtime.Version
			}
		}
		
		if config.Mode == "manual" && config.RawText != nil {
			nginxConfig = *config.RawText
		} else {
			// Fetch security configuration for this nginx config
			var securityCfg *SecurityConfig

			// Parse structured JSON to check if security is enabled
			var secCheck struct {
				UABlockingEnabled       bool `json:"ua_blocking_enabled"`
				EndpointBlockingEnabled bool `json:"endpoint_blocking_enabled"`
			}
			json.Unmarshal(config.StructuredJSON, &secCheck)

			if secCheck.UABlockingEnabled || secCheck.EndpointBlockingEnabled {
				securityCfg = &SecurityConfig{}

				// Fetch UA patterns if UA blocking is enabled (using main db, not transaction)
				if secCheck.UABlockingEnabled {
					var patterns []string
					// Use DISTINCT to avoid duplicates, only get 'contains' patterns (not 'exact')
					// Skip empty patterns and single-char patterns that are too broad
					err := h.db.Select(&patterns, `
						SELECT DISTINCT pattern FROM security_ua_patterns 
						WHERE is_active = true 
						  AND match_type = 'contains'
						  AND pattern != ''
						  AND pattern != '-'
						  AND LENGTH(pattern) > 2
					`)
					if err != nil {
						log.Printf("Warning: Failed to fetch UA patterns: %v", err)
					} else {
						securityCfg.UAPatterns = patterns
						log.Printf("Loaded %d UA patterns for blocking", len(patterns))
					}
				}

				// Fetch endpoint rules if endpoint blocking is enabled (using main db, not transaction)
				if secCheck.EndpointBlockingEnabled {
					var rules []string
					err := h.db.Select(&rules, `
						SELECT pattern FROM security_endpoint_rules 
						WHERE nginx_config_id = $1
					`, req.ConfigID)
					if err != nil {
						log.Printf("Warning: Failed to fetch endpoint rules: %v", err)
					} else {
						securityCfg.EndpointRules = rules
						log.Printf("Loaded %d endpoint rules for blocking", len(rules))
					}
				}
			}

			// Generate nginx config from structured JSON with PHP version and security config
			nginxConfig = generateNginxFromStructured(config.StructuredJSON, domainFQDN, phpVersion, securityCfg)
		}
	}

	// If old machine exists and different from new, create remove_domain job using template
	if currentMachineID != nil && (req.MachineID == nil || *currentMachineID != *req.MachineID) {
		var oldAgentID uuid.UUID
		tx.Get(&oldAgentID, "SELECT agent_id FROM machines WHERE id = $1", currentMachineID)
		if oldAgentID != uuid.Nil {
			// Use template-based job
			removeCmd := templates.GetCommand("remove_domain")
			if removeCmd != nil {
				payload := removeCmd.ToPayload(map[string]string{"domain": domainFQDN})
				tx.Exec(`
					INSERT INTO jobs (agent_id, type, payload_json, status)
					VALUES ($1, 'run', $2, 'pending')
				`, oldAgentID, payload)
			}
		}
	}

	// If new machine exists, create apply_domain job using template
	if req.MachineID != nil && req.ConfigID != nil {
		var newAgentID uuid.UUID
		tx.Get(&newAgentID, "SELECT agent_id FROM machines WHERE id = $1", req.MachineID)
		if newAgentID != uuid.Nil {
			// Check if this is a passthrough config
			if isPassthroughConfig(configJSON) {
				// Use passthrough template
				passthroughTarget := getPassthroughTarget(configJSON)
				applyCmd := templates.GetCommand("apply_passthrough_domain")
				if applyCmd != nil {
					payload := applyCmd.ToPayload(map[string]string{
						"domain": domainFQDN,
						"target": passthroughTarget,
					})
					tx.Exec(`
						INSERT INTO jobs (agent_id, type, payload_json, status)
						VALUES ($1, 'run', $2, 'pending')
					`, newAgentID, payload)
				}
			} else {
				// Regular HTTP config
				// Determine if SSL is enabled and get SSL email
				sslEnabled := "true"
				sslEmail := "admin@example.com"
				var structured struct {
					SSLMode  string `json:"ssl_mode"`
					SSLEmail string `json:"ssl_email"`
				}
				json.Unmarshal(configJSON, &structured)
				if structured.SSLMode == "disabled" {
					sslEnabled = "false"
				}
				if structured.SSLEmail != "" {
					sslEmail = structured.SSLEmail
				}

				// Use template-based job
				applyCmd := templates.GetCommand("apply_domain")
				if applyCmd != nil {
					payload := applyCmd.ToPayload(map[string]string{
						"domain":       domainFQDN,
						"nginx_config": nginxConfig,
						"ssl_enabled":  sslEnabled,
						"ssl_email":    sslEmail,
					})
					tx.Exec(`
						INSERT INTO jobs (agent_id, type, payload_json, status)
						VALUES ($1, 'run', $2, 'pending')
					`, newAgentID, payload)
				}

			// Check for landing deployments in the config
			var landingStructured struct {
				Locations []struct {
					StaticType            string `json:"static_type"`
					LandingID             string `json:"landing_id"`
					Root                  string `json:"root"`
					Index                 string `json:"index"`
					UsePHP                bool   `json:"use_php"`
					ReplaceLandingContent *bool  `json:"replace_landing_content"` // default true
				} `json:"locations"`
			}
			json.Unmarshal(configJSON, &landingStructured)

			for _, loc := range landingStructured.Locations {
				if loc.StaticType == "landing" && loc.LandingID != "" {
					landingUUID, err := uuid.Parse(loc.LandingID)
					if err != nil {
						continue
					}

					// Get landing info
					var landing struct {
						StoragePath string `db:"storage_path"`
						Type        string `db:"type"`
						FileName    string `db:"file_name"`
					}
					err = tx.Get(&landing, "SELECT storage_path, type, file_name FROM landings WHERE id = $1", landingUUID)
					if err != nil {
						log.Printf("Failed to get landing %s: %v", loc.LandingID, err)
						continue
					}

					// Create deploy_landing job
					index := loc.Index
					if index == "" {
						if landing.Type == "php" {
							index = "index.php"
						} else {
							index = "index.html"
						}
					}

					// Default replace_content to true if not specified
					replaceContent := loc.ReplaceLandingContent == nil || *loc.ReplaceLandingContent

					deployPayload, _ := json.Marshal(map[string]interface{}{
						"landing_id":      loc.LandingID,
						"storage_path":    landing.StoragePath,
						"target_path":     loc.Root,
						"index_file":      index,
						"use_php":         loc.UsePHP,
						"replace_content": replaceContent,
					})
					tx.Exec(`
						INSERT INTO jobs (agent_id, type, payload_json, status)
						VALUES ($1, 'deploy_landing', $2, 'pending')
					`, newAgentID, deployPayload)
				}
			}
			} // end of else block for non-passthrough
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

