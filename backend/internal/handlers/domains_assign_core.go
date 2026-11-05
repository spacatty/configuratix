package handlers

import (
	"context"
	"strings"
	"encoding/json"
	"fmt"
	"log"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/jobs"
	"configuratix/backend/internal/models"
	"configuratix/backend/internal/templates"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

// renderDomainNginxConfig renders the nginx config the DB would write for a domain using the
// given nginx config on the given machine (machine is used for the PHP-FPM socket version).
// Returns the rendered text (empty for passthrough configs) and the structured JSON.
func renderDomainNginxConfig(q sqlx.Queryer, db *database.DB, fqdn string, configID uuid.UUID, machineID *uuid.UUID) (string, json.RawMessage, error) {
	var config struct {
		StructuredJSON json.RawMessage `db:"structured_json"`
		RawText        *string         `db:"raw_text"`
		Mode           string          `db:"mode"`
	}
	if err := sqlx.Get(q, &config, "SELECT structured_json, raw_text, COALESCE(mode, 'auto') AS mode FROM nginx_configs WHERE id = $1", configID); err != nil {
		return "", nil, fmt.Errorf("nginx config not found: %w", err)
	}

	if config.Mode == "manual" && config.RawText != nil {
		return *config.RawText, config.StructuredJSON, nil
	}
	if isPassthroughConfig(config.StructuredJSON) {
		return "", config.StructuredJSON, nil
	}

	phpVersion := ""
	if machineID != nil {
		var runtime struct {
			Version string `db:"version"`
			Status  string `db:"status"`
		}
		if err := sqlx.Get(q, &runtime, "SELECT version, status FROM php_runtimes WHERE machine_id = $1", *machineID); err == nil && runtime.Status == "installed" {
			phpVersion = runtime.Version
		}
	}

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
			err := db.Select(&patterns, `
				SELECT DISTINCT pattern FROM security_ua_patterns
				WHERE is_active = true
				  AND match_type = 'contains'
				  AND pattern != ''
				  AND pattern != '-'
				  AND LENGTH(pattern) > 2
				ORDER BY pattern
			`)
			if err != nil {
				log.Printf("Warning: Failed to fetch UA patterns: %v", err)
			} else {
				securityCfg.UAPatterns = patterns
			}
		}
		if secCheck.EndpointBlockingEnabled {
			var rules []string
			err := db.Select(&rules, `
				SELECT pattern FROM security_endpoint_rules
				WHERE nginx_config_id = $1 ORDER BY pattern
			`, configID)
			if err != nil {
				log.Printf("Warning: Failed to fetch endpoint rules: %v", err)
			} else {
				securityCfg.EndpointRules = rules
			}
		}
	}

	return generateNginxFromStructured(config.StructuredJSON, fqdn, phpVersion, securityCfg), config.StructuredJSON, nil
}

// queueDomainApply creates the apply jobs for a domain on a machine (apply_domain or
// apply_passthrough_domain, plus deploy_landing jobs) inside tx and marks the domain
// apply_status=pending/last_job_id. Returns the created jobs (main apply job first).
func queueDomainApply(ctx context.Context, tx *sqlx.Tx, db *database.DB, domainID uuid.UUID, fqdn string,
	machineID, configID uuid.UUID, createdBy *uuid.UUID) ([]*models.Job, error) {

	var agentID *uuid.UUID
	if err := tx.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID); err != nil || agentID == nil {
		return nil, fmt.Errorf("machine has no agent connected")
	}

	// Punycode / lowercase so server_name, file names and certbot agree.
	normalized, err := templates.NormalizeFQDN(fqdn)
	if err != nil {
		return nil, err
	}
	fqdn = normalized

	nginxConfig, configJSON, err := renderDomainNginxConfig(tx, db, fqdn, configID, &machineID)
	if err != nil {
		return nil, err
	}
	if isPassthroughConfig(configJSON) && strings.HasPrefix(fqdn, "*.") {
		return nil, &templates.ValidationError{Field: "domain", Message: "wildcard domains are not supported with SSL passthrough configs (SNI routing needs exact host names)"}
	}

	var created []*models.Job
	var mainSpec jobs.Spec
	if isPassthroughConfig(configJSON) {
		values := getPassthroughApplyValues(configJSON)
		httpEnabled := "false"
		if getPassthroughHTTPEnabled(configJSON) {
			httpEnabled = "true"
		}
		mainSpec, err = jobs.FromTemplate("apply_passthrough_domain", map[string]string{
			"domain":                    fqdn,
			"target":                    values["target"],
			"https_port":                values["https_port"],
			"http_port":                 values["http_port"],
			"enable_http":               httpEnabled,
			"proxy_protocol":            values["proxy_protocol"],
			"http_client_max_body_size": values["http_client_max_body_size"],
			"http_extra_b64":            values["http_extra_b64"],
		})
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
		mainSpec, err = jobs.FromTemplate("apply_domain", map[string]string{
			"domain":       fqdn,
			"nginx_config": nginxConfig,
			"ssl_enabled":  sslEnabled,
			"ssl_email":    sslEmail,
		})
	}
	if err != nil {
		return nil, fmt.Errorf("cannot build apply job for %s: %w", fqdn, err)
	}
	mainSpec.AgentID = *agentID
	mainSpec.EntityType = jobs.EntityDomain
	mainSpec.EntityID = domainID.String()
	mainSpec.CreatedBy = createdBy
	mainJob, err := jobs.Create(ctx, tx, mainSpec)
	if err != nil {
		return nil, err
	}
	created = append(created, mainJob)

	if _, err := tx.Exec(`UPDATE domains SET apply_status = 'pending', last_job_id = $1, last_apply_error = NULL, updated_at = NOW()
		WHERE id = $2`, mainJob.ID, domainID); err != nil {
		return nil, err
	}

	if isPassthroughConfig(configJSON) {
		return created, nil
	}

	// Static content (landing) deployments referenced by locations.
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
		if loc.StaticType != "landing" || loc.LandingID == "" {
			continue
		}
		landingUUID, err := uuid.Parse(loc.LandingID)
		if err != nil {
			continue
		}
		var landing struct {
			Name        string `db:"name"`
			StoragePath string `db:"storage_path"`
			Type        string `db:"type"`
			FileName    string `db:"file_name"`
		}
		if err := tx.Get(&landing, "SELECT name, storage_path, type, file_name FROM landings WHERE id = $1", landingUUID); err != nil {
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

		job, err := jobs.Create(ctx, tx, jobs.Spec{
			AgentID: *agentID,
			Type:    "deploy_landing",
			Payload: map[string]interface{}{
				"landing_id":      loc.LandingID,
				"storage_path":    landing.StoragePath,
				"target_path":     loc.Root,
				"index_file":      index,
				"use_php":         loc.UsePHP,
				"replace_content": replaceContent,
			},
			Action:     "deploy_landing",
			Title:      fmt.Sprintf("Deploy landing '%s' → %s", landing.Name, fqdn),
			EntityType: jobs.EntityDomain,
			EntityID:   domainID.String(),
			CreatedBy:  createdBy,
		})
		if err != nil {
			return nil, err
		}
		created = append(created, job)
	}
	return created, nil
}

// queueDomainRemove creates a remove_domain job on a machine. markDomain=true records it as
// the domain's last job (used when the domain is unassigned, not when it moves).
func queueDomainRemove(ctx context.Context, tx *sqlx.Tx, domainID uuid.UUID, fqdn string, machineID uuid.UUID,
	createdBy *uuid.UUID, markDomain bool) (*models.Job, error) {
	var agentID *uuid.UUID
	if err := tx.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID); err != nil || agentID == nil {
		return nil, nil // no agent: nothing to clean up remotely
	}
	spec, err := jobs.FromTemplate("remove_domain", map[string]string{"domain": fqdn})
	if err != nil {
		return nil, err
	}
	spec.AgentID = *agentID
	spec.EntityType = jobs.EntityDomain
	spec.EntityID = domainID.String()
	spec.CreatedBy = createdBy
	job, err := jobs.Create(ctx, tx, spec)
	if err != nil {
		return nil, err
	}
	if markDomain {
		tx.Exec(`UPDATE domains SET apply_status = 'removing', last_job_id = $1, last_apply_error = NULL, updated_at = NOW()
			WHERE id = $2`, job.ID, domainID)
	}
	return job, nil
}

// assignDomainCore performs machine/config assignment and agent jobs (shared by single and bulk assign).
func (h *DomainsHandler) assignDomainCore(id uuid.UUID, req AssignDomainRequest, createdBy *uuid.UUID) ([]*models.Job, error) {
	ctx := context.Background()
	var currentMachineID *uuid.UUID
	h.db.Get(&currentMachineID, "SELECT assigned_machine_id FROM domains WHERE id = $1", id)

	tx, err := h.db.Beginx()
	if err != nil {
		log.Printf("Failed to start transaction: %v", err)
		return nil, fmt.Errorf("failed to assign domain: %w", err)
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
		return nil, fmt.Errorf("failed to assign domain: %w", err)
	}

	if req.ConfigID != nil {
		tx.Exec("DELETE FROM domain_config_links WHERE domain_id = $1", id)
		_, err = tx.Exec(`
			INSERT INTO domain_config_links (domain_id, nginx_config_id)
			VALUES ($1, $2)
		`, id, req.ConfigID)
		if err != nil {
			log.Printf("Failed to link config: %v", err)
			return nil, fmt.Errorf("failed to link config: %w", err)
		}
	}

	var created []*models.Job
	var domainFQDN string
	tx.Get(&domainFQDN, "SELECT fqdn FROM domains WHERE id = $1", id)

	if currentMachineID != nil && (req.MachineID == nil || *currentMachineID != *req.MachineID) {
		// Moving away from (or unassigning) the old machine: clean it up there.
		if rj, err := queueDomainRemove(ctx, tx, id, domainFQDN, *currentMachineID, createdBy, req.MachineID == nil); err != nil {
			return nil, fmt.Errorf("failed to queue removal: %w", err)
		} else if rj != nil {
			created = append(created, rj)
		}
	}
	if req.MachineID == nil {
		tx.Exec(`UPDATE domains SET apply_status = CASE WHEN apply_status = 'removing' THEN 'removing' ELSE NULL END WHERE id = $1`, id)
	}

	if req.MachineID != nil && req.ConfigID != nil {
		applied, err := queueDomainApply(ctx, tx, h.db, id, domainFQDN, *req.MachineID, *req.ConfigID, createdBy)
		if err != nil {
			return nil, err
		}
		created = append(applied, created...)
	}

	if cerr := tx.Commit(); cerr != nil {
		log.Printf("Failed to commit transaction: %v", cerr)
		return nil, fmt.Errorf("failed to assign domain: %w", cerr)
	}
	return created, nil
}

// applyDomainNow re-applies a domain's current machine+config. Returns the created jobs.
func applyDomainNow(ctx context.Context, db *database.DB, domainID uuid.UUID, createdBy *uuid.UUID) ([]*models.Job, error) {
	var d struct {
		FQDN      string     `db:"fqdn"`
		MachineID *uuid.UUID `db:"assigned_machine_id"`
		ConfigID  *uuid.UUID `db:"config_id"`
	}
	if err := db.Get(&d, `SELECT d.fqdn, d.assigned_machine_id,
			(SELECT nginx_config_id FROM domain_config_links WHERE domain_id = d.id LIMIT 1) AS config_id
		FROM domains d WHERE d.id = $1`, domainID); err != nil {
		return nil, fmt.Errorf("domain not found")
	}
	if d.MachineID == nil || d.ConfigID == nil {
		return nil, fmt.Errorf("domain %s has no machine or nginx config assigned", d.FQDN)
	}
	tx, err := db.Beginx()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	created, err := queueDomainApply(ctx, tx, db, domainID, d.FQDN, *d.MachineID, *d.ConfigID, createdBy)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created, nil
}

// deleteDomainsWithCleanup deletes domains and, for each one still assigned to a machine,
// queues a transactional remove_domain job on that machine in the same transaction.
// Domains whose name cannot be cleaned up safely are still deleted; a warning is returned.
func deleteDomainsWithCleanup(ctx context.Context, db *database.DB, ids []uuid.UUID, createdBy *uuid.UUID) (int64, []*models.Job, []string, error) {
	tx, err := db.Beginx()
	if err != nil {
		return 0, nil, nil, err
	}
	defer tx.Rollback()

	var rows []struct {
		ID        uuid.UUID  `db:"id"`
		FQDN      string     `db:"fqdn"`
		MachineID *uuid.UUID `db:"assigned_machine_id"`
	}
	if err := tx.Select(&rows, `SELECT id, fqdn, assigned_machine_id FROM domains WHERE id = ANY($1) FOR UPDATE`, pq.Array(ids)); err != nil {
		return 0, nil, nil, err
	}
	var created []*models.Job
	var warnings []string
	for _, d := range rows {
		if d.MachineID == nil {
			continue
		}
		job, err := queueDomainRemove(ctx, tx, d.ID, d.FQDN, *d.MachineID, createdBy, false)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: config not removed from machine: %v", d.FQDN, err))
			continue
		}
		if job != nil {
			created = append(created, job)
		}
	}
	res, err := tx.Exec(`DELETE FROM domains WHERE id = ANY($1)`, pq.Array(ids))
	if err != nil {
		return 0, nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, nil, err
	}
	n, _ := res.RowsAffected()
	return n, created, warnings, nil
}

func jobsResponse(created []*models.Job) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(created))
	for _, j := range created {
		out = append(out, jobCreatedResponse(j))
	}
	return out
}
