package handlers

import (
	"fmt"
	"log"
	"strings"

	"configuratix/backend/internal/database"

	"github.com/google/uuid"
)

// PassthroughNginxGenerator generates nginx stream passthrough configs
type PassthroughNginxGenerator struct {
	db *database.DB
}

// NewPassthroughNginxGenerator creates a new generator
func NewPassthroughNginxGenerator(db *database.DB) *PassthroughNginxGenerator {
	return &PassthroughNginxGenerator{db: db}
}

// GenerateForMachine generates nginx stream config for a specific proxy machine
func (g *PassthroughNginxGenerator) GenerateForMachine(machineID uuid.UUID) (string, error) {
	// Get all pools this machine is a member of
	var recordPools []struct {
		PoolID      uuid.UUID `db:"pool_id"`
		TargetIP    string    `db:"target_ip"`
		TargetPort  int       `db:"target_port"`
		RecordName  string    `db:"record_name"`
		DomainFQDN  string    `db:"domain_fqdn"`
		IsCurrent   bool      `db:"is_current"`
	}
	g.db.Select(&recordPools, `
		SELECT 
			pp.id as pool_id,
			pp.target_ip,
			pp.target_port,
			dr.name as record_name,
			dmd.fqdn as domain_fqdn,
			(pp.current_machine_id = $1) as is_current
		FROM dns_passthrough_members pm
		JOIN dns_passthrough_pools pp ON pm.pool_id = pp.id
		JOIN dns_records dr ON pp.dns_record_id = dr.id
		JOIN dns_managed_domains dmd ON dr.dns_domain_id = dmd.id
		WHERE pm.machine_id = $1 AND pm.is_enabled = true
	`, machineID)

	var wildcardPools []struct {
		PoolID      uuid.UUID `db:"pool_id"`
		TargetIP    string    `db:"target_ip"`
		TargetPort  int       `db:"target_port"`
		DomainFQDN  string    `db:"domain_fqdn"`
		IncludeRoot bool      `db:"include_root"`
		IsCurrent   bool      `db:"is_current"`
	}
	g.db.Select(&wildcardPools, `
		SELECT 
			wp.id as pool_id,
			wp.target_ip,
			wp.target_port,
			dmd.fqdn as domain_fqdn,
			wp.include_root,
			(wp.current_machine_id = $1) as is_current
		FROM dns_wildcard_pool_members wm
		JOIN dns_wildcard_pools wp ON wm.pool_id = wp.id
		JOIN dns_managed_domains dmd ON wp.dns_domain_id = dmd.id
		WHERE wm.machine_id = $1 AND wm.is_enabled = true
	`, machineID)

	if len(recordPools) == 0 && len(wildcardPools) == 0 {
		return "", nil // No passthrough config needed
	}

	// Generate config
	var config strings.Builder
	config.WriteString("# Configuratix Passthrough Configuration\n")
	config.WriteString("# Auto-generated - DO NOT EDIT MANUALLY\n\n")

	config.WriteString("stream {\n")

	// SNI map
	config.WriteString("    # SNI-based backend routing\n")
	config.WriteString("    map $ssl_preread_server_name $backend {\n")

	// Default
	config.WriteString("        default reject;\n")

	// Record pools
	for _, pool := range recordPools {
		fullDomain := pool.DomainFQDN
		if pool.RecordName != "@" {
			fullDomain = pool.RecordName + "." + pool.DomainFQDN
		}
		config.WriteString(fmt.Sprintf("        %s %s:%d;\n", fullDomain, pool.TargetIP, pool.TargetPort))
	}

	// Wildcard pools
	for _, pool := range wildcardPools {
		// Wildcard entry
		config.WriteString(fmt.Sprintf("        ~^.+\\.%s$ %s:%d;\n", 
			strings.ReplaceAll(pool.DomainFQDN, ".", "\\."), pool.TargetIP, pool.TargetPort))
		// Root domain if included
		if pool.IncludeRoot {
			config.WriteString(fmt.Sprintf("        %s %s:%d;\n", pool.DomainFQDN, pool.TargetIP, pool.TargetPort))
		}
	}

	config.WriteString("    }\n\n")

	// Upstream for reject
	config.WriteString("    # Reject upstream (closed connection)\n")
	config.WriteString("    upstream reject {\n")
	config.WriteString("        server 127.0.0.1:1 down;\n")
	config.WriteString("    }\n\n")

	// Server block for HTTPS passthrough
	config.WriteString("    # HTTPS Passthrough (TLS)\n")
	config.WriteString("    server {\n")
	config.WriteString("        listen 443;\n")
	config.WriteString("        ssl_preread on;\n")
	config.WriteString("        proxy_pass $backend;\n")
	config.WriteString("        proxy_connect_timeout 10s;\n")
	config.WriteString("        proxy_timeout 30m;\n")
	config.WriteString("    }\n\n")

	// HTTP redirect server (optional, forward to HTTPS)
	config.WriteString("    # HTTP to HTTPS redirect (optional)\n")
	config.WriteString("    server {\n")
	config.WriteString("        listen 80;\n")
	config.WriteString("        proxy_pass $backend;\n")
	config.WriteString("        proxy_connect_timeout 10s;\n")
	config.WriteString("    }\n")

	config.WriteString("}\n")

	return config.String(), nil
}

// ApplyToMachine sends a job to apply the config on a machine
func (g *PassthroughNginxGenerator) ApplyToMachine(machineID uuid.UUID) error {
	config, err := g.GenerateForMachine(machineID)
	if err != nil {
		return err
	}

	if config == "" {
		log.Printf("No passthrough config for machine %s", machineID)
		return nil
	}

	// Create a job to write the config
	configPath := "/etc/nginx/conf.d/configuratix-passthrough.conf"
	
	_, err = g.db.Exec(`
		INSERT INTO jobs (machine_id, type, payload, status)
		VALUES ($1, 'file', $2::jsonb, 'pending')
	`, machineID, fmt.Sprintf(`{"path": "%s", "content": %q, "mode": "0644", "reload": "nginx"}`, configPath, config))

	if err != nil {
		return fmt.Errorf("failed to create job: %w", err)
	}

	// Mark nginx config as applied for this machine in all its pools
	g.db.Exec(`
		UPDATE dns_passthrough_members 
		SET nginx_config_applied = true 
		WHERE machine_id = $1
	`, machineID)

	g.db.Exec(`
		UPDATE dns_wildcard_pool_members 
		SET nginx_config_applied = true 
		WHERE machine_id = $1
	`, machineID)

	log.Printf("Created passthrough config job for machine %s", machineID)
	return nil
}

// ApplyToAllPoolMembers applies config to all members of a pool
func (g *PassthroughNginxGenerator) ApplyToAllPoolMembers(poolID uuid.UUID, isWildcard bool) error {
	var machineIDs []uuid.UUID

	if isWildcard {
		g.db.Select(&machineIDs, `
			SELECT machine_id FROM dns_wildcard_pool_members 
			WHERE pool_id = $1 AND is_enabled = true
		`, poolID)
	} else {
		g.db.Select(&machineIDs, `
			SELECT machine_id FROM dns_passthrough_members 
			WHERE pool_id = $1 AND is_enabled = true
		`, poolID)
	}

	for _, machineID := range machineIDs {
		if err := g.ApplyToMachine(machineID); err != nil {
			log.Printf("Failed to apply config to machine %s: %v", machineID, err)
		}
	}

	return nil
}

