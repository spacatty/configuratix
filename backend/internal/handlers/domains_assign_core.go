package handlers

import (
	"encoding/json"
	"fmt"
	"log"

	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
)

// assignDomainCore performs machine/config assignment and agent jobs (shared by single and bulk assign).
func (h *DomainsHandler) assignDomainCore(id uuid.UUID, req AssignDomainRequest) error {
	var currentMachineID *uuid.UUID
	h.db.Get(&currentMachineID, "SELECT assigned_machine_id FROM domains WHERE id = $1", id)

	tx, err := h.db.Beginx()
	if err != nil {
		log.Printf("Failed to start transaction: %v", err)
		return fmt.Errorf("failed to assign domain: %w", err)
	}
	defer tx.Rollback()

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
		return fmt.Errorf("failed to assign domain: %w", err)
	}

	if req.ConfigID != nil {
		tx.Exec("DELETE FROM domain_config_links WHERE domain_id = $1", id)
		_, err = tx.Exec(`
			INSERT INTO domain_config_links (domain_id, nginx_config_id)
			VALUES ($1, $2)
		`, id, req.ConfigID)
		if err != nil {
			log.Printf("Failed to link config: %v", err)
			return fmt.Errorf("failed to link config: %w", err)
		}
	}

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
			var securityCfg *SecurityConfig

			var secCheck struct {
				UABlockingEnabled       bool `json:"ua_blocking_enabled"`
				EndpointBlockingEnabled bool `json:"endpoint_blocking_enabled"`
			}
			json.Unmarshal(config.StructuredJSON, &secCheck)

			if secCheck.UABlockingEnabled || secCheck.EndpointBlockingEnabled {
				securityCfg = &SecurityConfig{}

				if secCheck.UABlockingEnabled {
					var patterns []string
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

			nginxConfig = generateNginxFromStructured(config.StructuredJSON, domainFQDN, phpVersion, securityCfg)
		}
	}

	if currentMachineID != nil && (req.MachineID == nil || *currentMachineID != *req.MachineID) {
		var oldAgentID uuid.UUID
		tx.Get(&oldAgentID, "SELECT agent_id FROM machines WHERE id = $1", currentMachineID)
		if oldAgentID != uuid.Nil {
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

	if req.MachineID != nil && req.ConfigID != nil {
		var newAgentID uuid.UUID
		tx.Get(&newAgentID, "SELECT agent_id FROM machines WHERE id = $1", req.MachineID)
		if newAgentID != uuid.Nil {
			if isPassthroughConfig(configJSON) {
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

				var landingStructured struct {
					Locations []struct {
						StaticType            string `json:"static_type"`
						LandingID             string `json:"landing_id"`
						Root                  string `json:"root"`
						Index                 string `json:"index"`
						UsePHP                bool   `json:"use_php"`
						ReplaceLandingContent *bool  `json:"replace_landing_content"`
					} `json:"locations"`
				}
				json.Unmarshal(configJSON, &landingStructured)

				for _, loc := range landingStructured.Locations {
					if loc.StaticType == "landing" && loc.LandingID != "" {
						landingUUID, err := uuid.Parse(loc.LandingID)
						if err != nil {
							continue
						}

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

						index := loc.Index
						if index == "" {
							if landing.Type == "php" {
								index = "index.php"
							} else {
								index = "index.html"
							}
						}

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
			}
		}
	}

	if cerr := tx.Commit(); cerr != nil {
		log.Printf("Failed to commit transaction: %v", cerr)
		return fmt.Errorf("failed to assign domain: %w", cerr)
	}
	return nil
}
