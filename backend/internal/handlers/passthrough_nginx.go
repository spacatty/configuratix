package handlers

import (
	"encoding/json"
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

type PassthroughNginxConfigBundle struct {
	StreamConfig string
	HTTPConfig   string
}

// NewPassthroughNginxGenerator creates a new generator
func NewPassthroughNginxGenerator(db *database.DB) *PassthroughNginxGenerator {
	return &PassthroughNginxGenerator{db: db}
}

// GenerateForMachine generates nginx stream config for a specific proxy machine
func (g *PassthroughNginxGenerator) GenerateForMachine(machineID uuid.UUID) (PassthroughNginxConfigBundle, error) {
	// Get all record pools this machine is a member of (with domain listener_protocol)
	var recordPools []struct {
		PoolID           uuid.UUID `db:"pool_id"`
		TargetIP         string    `db:"target_ip"`
		TargetPort       int       `db:"target_port"`
		TargetPortHTTP   int       `db:"target_port_http"`
		RecordName       string    `db:"record_name"`
		DomainFQDN       string    `db:"domain_fqdn"`
		IsCurrent        bool      `db:"is_current"`
		ListenerProtocol string    `db:"listener_protocol"`
	}
	g.db.Select(&recordPools, `
		SELECT 
			pp.id as pool_id,
			pp.target_ip,
			pp.target_port,
			COALESCE(pp.target_port_http, 80) as target_port_http,
			dr.name as record_name,
			dmd.fqdn as domain_fqdn,
			(pp.current_machine_id = $1) as is_current,
			COALESCE(dmd.listener_protocol, 'http_and_https') as listener_protocol
		FROM dns_passthrough_members pm
		JOIN dns_passthrough_pools pp ON pm.pool_id = pp.id
		JOIN dns_records dr ON pp.dns_record_id = dr.id
		JOIN dns_managed_domains dmd ON dr.dns_domain_id = dmd.id
		WHERE pm.machine_id = $1 AND pm.is_enabled = true
	`, machineID)

	// Also get pools where this machine is in a group
	var groupRecordPools []struct {
		PoolID           uuid.UUID `db:"pool_id"`
		TargetIP         string    `db:"target_ip"`
		TargetPort       int       `db:"target_port"`
		TargetPortHTTP   int       `db:"target_port_http"`
		RecordName       string    `db:"record_name"`
		DomainFQDN       string    `db:"domain_fqdn"`
		ListenerProtocol string    `db:"listener_protocol"`
	}
	g.db.Select(&groupRecordPools, `
		SELECT DISTINCT
			pp.id as pool_id,
			pp.target_ip,
			pp.target_port,
			COALESCE(pp.target_port_http, 80) as target_port_http,
			dr.name as record_name,
			dmd.fqdn as domain_fqdn,
			COALESCE(dmd.listener_protocol, 'http_and_https') as listener_protocol
		FROM dns_passthrough_pools pp
		JOIN dns_records dr ON pp.dns_record_id = dr.id
		JOIN dns_managed_domains dmd ON dr.dns_domain_id = dmd.id
		JOIN machine_group_members gm ON gm.group_id = ANY(pp.group_ids)
		WHERE gm.machine_id = $1
	`, machineID)

	// Merge group pools (deduplicate by pool_id)
	poolIDs := make(map[uuid.UUID]bool)
	for _, p := range recordPools {
		poolIDs[p.PoolID] = true
	}
	for _, p := range groupRecordPools {
		if !poolIDs[p.PoolID] {
			recordPools = append(recordPools, struct {
				PoolID           uuid.UUID `db:"pool_id"`
				TargetIP         string    `db:"target_ip"`
				TargetPort       int       `db:"target_port"`
				TargetPortHTTP   int       `db:"target_port_http"`
				RecordName       string    `db:"record_name"`
				DomainFQDN       string    `db:"domain_fqdn"`
				IsCurrent        bool      `db:"is_current"`
				ListenerProtocol string    `db:"listener_protocol"`
			}{
				PoolID:           p.PoolID,
				TargetIP:         p.TargetIP,
				TargetPort:       p.TargetPort,
				TargetPortHTTP:   p.TargetPortHTTP,
				RecordName:       p.RecordName,
				DomainFQDN:       p.DomainFQDN,
				IsCurrent:        false,
				ListenerProtocol: p.ListenerProtocol,
			})
		}
	}

	var wildcardPools []struct {
		PoolID           uuid.UUID `db:"pool_id"`
		TargetIP         string    `db:"target_ip"`
		TargetPort       int       `db:"target_port"`
		TargetPortHTTP   int       `db:"target_port_http"`
		DomainFQDN       string    `db:"domain_fqdn"`
		IncludeRoot      bool      `db:"include_root"`
		IsCurrent        bool      `db:"is_current"`
		ListenerProtocol string    `db:"listener_protocol"`
	}
	g.db.Select(&wildcardPools, `
		SELECT 
			wp.id as pool_id,
			wp.target_ip,
			wp.target_port,
			COALESCE(wp.target_port_http, 80) as target_port_http,
			dmd.fqdn as domain_fqdn,
			wp.include_root,
			(wp.current_machine_id = $1) as is_current,
			COALESCE(dmd.listener_protocol, 'http_and_https') as listener_protocol
		FROM dns_wildcard_pool_members wm
		JOIN dns_wildcard_pools wp ON wm.pool_id = wp.id
		JOIN dns_managed_domains dmd ON wp.dns_domain_id = dmd.id
		WHERE wm.machine_id = $1 AND wm.is_enabled = true
	`, machineID)

	// Also get wildcard pools where this machine is in a group
	var groupWildcardPools []struct {
		PoolID           uuid.UUID `db:"pool_id"`
		TargetIP         string    `db:"target_ip"`
		TargetPort       int       `db:"target_port"`
		TargetPortHTTP   int       `db:"target_port_http"`
		DomainFQDN       string    `db:"domain_fqdn"`
		IncludeRoot      bool      `db:"include_root"`
		ListenerProtocol string    `db:"listener_protocol"`
	}
	g.db.Select(&groupWildcardPools, `
		SELECT DISTINCT
			wp.id as pool_id,
			wp.target_ip,
			wp.target_port,
			COALESCE(wp.target_port_http, 80) as target_port_http,
			dmd.fqdn as domain_fqdn,
			wp.include_root,
			COALESCE(dmd.listener_protocol, 'http_and_https') as listener_protocol
		FROM dns_wildcard_pools wp
		JOIN dns_managed_domains dmd ON wp.dns_domain_id = dmd.id
		JOIN machine_group_members gm ON gm.group_id = ANY(wp.group_ids)
		WHERE gm.machine_id = $1
	`, machineID)

	// Merge group wildcard pools
	wildcardPoolIDs := make(map[uuid.UUID]bool)
	for _, p := range wildcardPools {
		wildcardPoolIDs[p.PoolID] = true
	}
	for _, p := range groupWildcardPools {
		if !wildcardPoolIDs[p.PoolID] {
			wildcardPools = append(wildcardPools, struct {
				PoolID           uuid.UUID `db:"pool_id"`
				TargetIP         string    `db:"target_ip"`
				TargetPort       int       `db:"target_port"`
				TargetPortHTTP   int       `db:"target_port_http"`
				DomainFQDN       string    `db:"domain_fqdn"`
				IncludeRoot      bool      `db:"include_root"`
				IsCurrent        bool      `db:"is_current"`
				ListenerProtocol string    `db:"listener_protocol"`
			}{
				PoolID:           p.PoolID,
				TargetIP:         p.TargetIP,
				TargetPort:       p.TargetPort,
				TargetPortHTTP:   p.TargetPortHTTP,
				DomainFQDN:       p.DomainFQDN,
				IncludeRoot:      p.IncludeRoot,
				IsCurrent:        false,
				ListenerProtocol: p.ListenerProtocol,
			})
		}
	}

	if len(recordPools) == 0 && len(wildcardPools) == 0 {
		return PassthroughNginxConfigBundle{}, nil // No passthrough config needed
	}

	// Check if any pool has proxy_protocol enabled (direct members + group members)
	var proxyProtocolEnabled bool
	var proxyProtocolCount int
	g.db.Get(&proxyProtocolCount, `
		SELECT COUNT(*) FROM (
			-- Direct record pool members
			SELECT 1 FROM dns_passthrough_pools pp
			JOIN dns_passthrough_members pm ON pm.pool_id = pp.id
			WHERE pm.machine_id = $1 AND pm.is_enabled = true AND COALESCE(pp.proxy_protocol, true) = true
			UNION ALL
			-- Record pool members via groups
			SELECT 1 FROM dns_passthrough_pools pp
			JOIN machine_group_members gm ON gm.group_id = ANY(pp.group_ids)
			WHERE gm.machine_id = $1 AND COALESCE(pp.proxy_protocol, true) = true
			UNION ALL
			-- Direct wildcard pool members
			SELECT 1 FROM dns_wildcard_pools wp
			JOIN dns_wildcard_pool_members wm ON wm.pool_id = wp.id
			WHERE wm.machine_id = $1 AND wm.is_enabled = true AND COALESCE(wp.proxy_protocol, true) = true
			UNION ALL
			-- Wildcard pool members via groups
			SELECT 1 FROM dns_wildcard_pools wp
			JOIN machine_group_members gm ON gm.group_id = ANY(wp.group_ids)
			WHERE gm.machine_id = $1 AND COALESCE(wp.proxy_protocol, true) = true
		) t
	`, machineID)
	proxyProtocolEnabled = proxyProtocolCount > 0

	var streamConfig strings.Builder
	var httpConfig strings.Builder

	// Emit HTTPS (port 443) only when at least one domain allows HTTPS (not http_only)
	hasHTTPS := false
	for _, pool := range recordPools {
		if pool.ListenerProtocol != "http_only" {
			hasHTTPS = true
			break
		}
	}
	if !hasHTTPS {
		for _, pool := range wildcardPools {
			if pool.ListenerProtocol != "http_only" {
				hasHTTPS = true
				break
			}
		}
	}

	if hasHTTPS {
		streamConfig.WriteString("# Configuratix Passthrough Configuration\n")
		streamConfig.WriteString("# Auto-generated - DO NOT EDIT MANUALLY\n")
		streamConfig.WriteString("# Included from stream{} block in nginx.conf\n\n")
		// SNI map for HTTPS (port 443) - maps by TLS SNI to target:port
		streamConfig.WriteString("# SNI-based backend routing for HTTPS\n")
		streamConfig.WriteString("map $ssl_preread_server_name $backend_https {\n")
		streamConfig.WriteString("    default reject;\n")

		for _, pool := range recordPools {
			if pool.ListenerProtocol == "http_only" {
				continue
			}
			fullDomain := pool.DomainFQDN
			if pool.RecordName != "@" {
				fullDomain = pool.RecordName + "." + pool.DomainFQDN
			}
			streamConfig.WriteString(fmt.Sprintf("    %s %s:%d;\n", fullDomain, pool.TargetIP, pool.TargetPort))
		}

		for _, pool := range wildcardPools {
			if pool.ListenerProtocol == "http_only" {
				continue
			}
			streamConfig.WriteString(fmt.Sprintf("    ~^.+\\.%s$ %s:%d;\n",
				strings.ReplaceAll(pool.DomainFQDN, ".", "\\."), pool.TargetIP, pool.TargetPort))
			if pool.IncludeRoot {
				streamConfig.WriteString(fmt.Sprintf("    %s %s:%d;\n", pool.DomainFQDN, pool.TargetIP, pool.TargetPort))
			}
		}
		streamConfig.WriteString("}\n\n")

		// Reject upstream
		streamConfig.WriteString("# Reject upstream (closed connection)\n")
		streamConfig.WriteString("upstream reject {\n")
		streamConfig.WriteString("    server 127.0.0.1:1 down;\n")
		streamConfig.WriteString("}\n\n")

		// Server block for HTTPS passthrough (port 443)
		streamConfig.WriteString("# HTTPS Passthrough (TLS SNI-based routing)\n")
		streamConfig.WriteString("server {\n")
		streamConfig.WriteString("    listen 443;\n")
		streamConfig.WriteString("    ssl_preread on;\n")
		streamConfig.WriteString("    proxy_pass $backend_https;\n")
		if proxyProtocolEnabled {
			streamConfig.WriteString("    proxy_protocol on;\n") // Send PROXY protocol to backend for real client IP
		}
		streamConfig.WriteString("    proxy_connect_timeout 10s;\n")
		streamConfig.WriteString("    proxy_timeout 30m;\n")
		streamConfig.WriteString("}\n\n")
	}

	// Note: HTTP (port 80) passthrough is tricky because there's no SNI for plain HTTP.
	// We use nginx's preread module to look at the first bytes - if it's TLS, we route via SNI.
	// For plain HTTP, we need to use the Host header which requires layer 7 inspection.
	//
	// Approach: Create separate upstream blocks and use the same target as HTTPS.
	// The target server handles Host-based routing in its HTTP config.

	httpTargets := make(map[string]string) // domain -> target:port
	for _, pool := range recordPools {
		if pool.ListenerProtocol == "https_only" {
			continue
		}
		fullDomain := pool.DomainFQDN
		if pool.RecordName != "@" {
			fullDomain = pool.RecordName + "." + pool.DomainFQDN
		}
		httpTargets[fullDomain] = fmt.Sprintf("%s:%d", pool.TargetIP, pool.TargetPortHTTP)
	}
	for _, pool := range wildcardPools {
		if pool.ListenerProtocol == "https_only" {
			continue
		}
		httpTargets["*."+pool.DomainFQDN] = fmt.Sprintf("%s:%d", pool.TargetIP, pool.TargetPortHTTP)
		if pool.IncludeRoot {
			httpTargets[pool.DomainFQDN] = fmt.Sprintf("%s:%d", pool.TargetIP, pool.TargetPortHTTP)
		}
	}

	if len(httpTargets) > 0 {
		httpConfig.WriteString("# Configuratix HTTP Passthrough Configuration\n")
		httpConfig.WriteString("# Auto-generated - DO NOT EDIT MANUALLY\n\n")
		for domain, target := range httpTargets {
			httpConfig.WriteString("server {\n")
			httpConfig.WriteString("    listen 80;\n")
			httpConfig.WriteString(fmt.Sprintf("    server_name %s;\n\n", domain))
			httpConfig.WriteString("    location / {\n")
			httpConfig.WriteString(fmt.Sprintf("        proxy_pass http://%s;\n", target))
			httpConfig.WriteString("        proxy_set_header Host $host;\n")
			httpConfig.WriteString("        proxy_set_header X-Real-IP $remote_addr;\n")
			httpConfig.WriteString("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n")
			httpConfig.WriteString("        proxy_set_header X-Forwarded-Proto $scheme;\n")
			httpConfig.WriteString("        proxy_connect_timeout 10s;\n")
			httpConfig.WriteString("        proxy_read_timeout 30m;\n")
			httpConfig.WriteString("        proxy_send_timeout 30m;\n")
			httpConfig.WriteString("    }\n")
			httpConfig.WriteString("}\n\n")
		}
	}

	return PassthroughNginxConfigBundle{
		StreamConfig: streamConfig.String(),
		HTTPConfig:   httpConfig.String(),
	}, nil
}

// ApplyToMachine sends a job to apply the config on a machine
func (g *PassthroughNginxGenerator) ApplyToMachine(machineID uuid.UUID) error {
	configs, err := g.GenerateForMachine(machineID)
	if err != nil {
		return err
	}

	// Create a job to write the config
	// Note: stream blocks must be in a file included by nginx.conf, not in conf.d
	// The config goes to /etc/nginx/stream.d/ or /etc/nginx/conf.d/stream/
	streamConfigPath := "/etc/nginx/stream.d/configuratix-passthrough.conf"
	httpConfigPath := "/etc/nginx/conf.d/configuratix/passthrough-dns-http.conf"

	// Get agent_id for this machine
	var agentID *uuid.UUID
	err = g.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID)
	if err != nil || agentID == nil {
		return fmt.Errorf("machine %s has no agent", machineID)
	}

	needsStream := configs.StreamConfig != ""
	setupScript := fmt.Sprintf(`
#!/bin/bash
set -e

# Setup nginx stream passthrough
NGINX_CONF="/etc/nginx/nginx.conf"
NEED_STREAM="%t"

echo "=== Configuratix Passthrough Setup ==="

mkdir -p /etc/nginx/stream.d /etc/nginx/conf.d/configuratix

STREAM_AVAILABLE=false

if [ "$NEED_STREAM" = "true" ]; then
# Check if already loaded via modules-enabled
if [ -f /etc/nginx/modules-enabled/50-mod-stream.conf ] || \
   ls /etc/nginx/modules-enabled/*stream* 2>/dev/null | grep -q .; then
    echo "Stream module is auto-loaded via modules-enabled"
    STREAM_AVAILABLE=true
fi

# If not auto-loaded, check if dynamic module exists
if [ "$STREAM_AVAILABLE" = false ] && [ -f /usr/lib/nginx/modules/ngx_stream_module.so ]; then
    if ! grep -q "load_module.*ngx_stream_module" "$NGINX_CONF"; then
        echo "Adding stream module load directive..."
        sed -i '1i load_module /usr/lib/nginx/modules/ngx_stream_module.so;' "$NGINX_CONF"
    fi
    STREAM_AVAILABLE=true
fi

# If still not available, install it
if [ "$STREAM_AVAILABLE" = false ]; then
    echo "Installing nginx stream module..."
    apt-get update -qq
    if apt-cache show libnginx-mod-stream >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y libnginx-mod-stream
    elif apt-cache show nginx-extras >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y nginx-extras
    else
        echo "ERROR: Cannot install stream module"
        exit 1
    fi
fi

if ! grep -qE "^stream\s*\{" "$NGINX_CONF"; then
    echo "" >> "$NGINX_CONF"
    echo "# SSL Passthrough configuration (Configuratix)" >> "$NGINX_CONF"
    echo "stream {" >> "$NGINX_CONF"
    echo "    include /etc/nginx/stream.d/*.conf;" >> "$NGINX_CONF"
    echo "}" >> "$NGINX_CONF"
    echo "Added stream block to nginx.conf"
elif ! grep -q "include /etc/nginx/stream.d" "$NGINX_CONF"; then
    sed -i '/^stream\s*{/a\    include /etc/nginx/stream.d/*.conf;' "$NGINX_CONF"
    echo "Added stream.d include to existing stream block"
fi

if nginx -t 2>&1 | grep -q "unknown directive.*stream"; then
    echo "ERROR: Stream module still not working after setup"
    exit 1
fi
fi

echo "Passthrough setup complete"
`, needsStream)
	// Final step: test config and restart nginx (not just reload, in case it's stopped)
	restartScript := `
#!/bin/bash
set -e

# Test config
nginx -t

# Start or reload nginx
if systemctl is-active --quiet nginx; then
    echo "Reloading nginx..."
    systemctl reload nginx
else
    echo "Starting nginx..."
    systemctl start nginx
fi

# Verify it's actually running
sleep 1
if ! systemctl is-active --quiet nginx; then
    echo "ERROR: Nginx failed to start!"
    journalctl -u nginx --no-pager -n 20
    exit 1
fi

echo "Nginx is running successfully"
`
	steps := []map[string]interface{}{
		{"action": "exec", "command": setupScript, "timeout": 300},
	}
	if configs.StreamConfig != "" {
		steps = append(steps, map[string]interface{}{"action": "file", "op": "write", "path": streamConfigPath, "content": configs.StreamConfig, "mode": "0644"})
	} else {
		steps = append(steps, map[string]interface{}{"action": "file", "op": "delete", "path": streamConfigPath})
	}
	if configs.HTTPConfig != "" {
		steps = append(steps, map[string]interface{}{"action": "file", "op": "write", "path": httpConfigPath, "content": configs.HTTPConfig, "mode": "0644"})
	} else {
		steps = append(steps, map[string]interface{}{"action": "file", "op": "delete", "path": httpConfigPath})
	}
	steps = append(steps, map[string]interface{}{"action": "exec", "command": restartScript, "timeout": 60})

	payloadBytes, err := json.Marshal(map[string]interface{}{
		"steps":    steps,
		"on_error": "stop",
	})
	if err != nil {
		return fmt.Errorf("failed to build payload: %w", err)
	}
	payload := string(payloadBytes)

	_, err = g.db.Exec(`
		INSERT INTO jobs (agent_id, type, payload_json, status)
		VALUES ($1, 'run', $2::jsonb, 'pending')
	`, agentID, payload)

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

// RemoveFromMachine removes passthrough config and re-enables disabled sites
func (g *PassthroughNginxGenerator) RemoveFromMachine(machineID uuid.UUID) error {
	// Check if machine is still in any pools
	var count int
	g.db.Get(&count, `
		SELECT COUNT(*) FROM (
			SELECT machine_id FROM dns_passthrough_members WHERE machine_id = $1 AND is_enabled = true
			UNION ALL
			SELECT machine_id FROM dns_wildcard_pool_members WHERE machine_id = $1 AND is_enabled = true
		) t
	`, machineID)

	if count > 0 {
		// Machine is still in pools, just regenerate the config
		return g.ApplyToMachine(machineID)
	}

	// Machine is not in any pools, remove passthrough config
	var agentID *uuid.UUID
	err := g.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID)
	if err != nil || agentID == nil {
		return fmt.Errorf("machine %s has no agent", machineID)
	}

	cleanupScript := `
#!/bin/bash
set -e

STREAM_CONFIG_FILE="/etc/nginx/stream.d/configuratix-passthrough.conf"
HTTP_CONFIG_FILE="/etc/nginx/conf.d/configuratix/passthrough-dns-http.conf"

echo "=== Configuratix Passthrough Cleanup ==="

# 1. Remove generated passthrough configs
if [ -f "$STREAM_CONFIG_FILE" ]; then
    echo "Removing stream passthrough config..."
    rm -f "$STREAM_CONFIG_FILE"
fi
if [ -f "$HTTP_CONFIG_FILE" ]; then
    echo "Removing HTTP passthrough config..."
    rm -f "$HTTP_CONFIG_FILE"
fi

# 2. Restart nginx
nginx -t
if systemctl is-active --quiet nginx; then
    systemctl reload nginx
else
    systemctl start nginx
fi

echo "Passthrough cleanup complete"
`

	payload := fmt.Sprintf(`{
		"steps": [
			{"action": "exec", "command": %q, "timeout": 120}
		],
		"on_error": "stop"
	}`, cleanupScript)

	_, err = g.db.Exec(`
		INSERT INTO jobs (agent_id, type, payload_json, status)
		VALUES ($1, 'run', $2::jsonb, 'pending')
	`, agentID, payload)

	if err != nil {
		return fmt.Errorf("failed to create cleanup job: %w", err)
	}

	log.Printf("Created passthrough cleanup job for machine %s", machineID)
	return nil
}

// ApplyToAllPoolMembers applies config to all members of a pool (direct + group members)
func (g *PassthroughNginxGenerator) ApplyToAllPoolMembers(poolID uuid.UUID, isWildcard bool) error {
	var machineIDs []uuid.UUID

	if isWildcard {
		// Get direct members
		g.db.Select(&machineIDs, `
			SELECT machine_id FROM dns_wildcard_pool_members 
			WHERE pool_id = $1 AND is_enabled = true
		`, poolID)

		// Also get machines from groups
		var groupMachineIDs []uuid.UUID
		g.db.Select(&groupMachineIDs, `
			SELECT DISTINCT gm.machine_id
			FROM dns_wildcard_pools wp
			JOIN machine_group_members gm ON gm.group_id = ANY(wp.group_ids)
			WHERE wp.id = $1
		`, poolID)

		// Merge and dedupe
		seen := make(map[uuid.UUID]bool)
		for _, id := range machineIDs {
			seen[id] = true
		}
		for _, id := range groupMachineIDs {
			if !seen[id] {
				machineIDs = append(machineIDs, id)
				seen[id] = true
			}
		}
	} else {
		// Get direct members
		g.db.Select(&machineIDs, `
			SELECT machine_id FROM dns_passthrough_members 
			WHERE pool_id = $1 AND is_enabled = true
		`, poolID)

		// Also get machines from groups
		var groupMachineIDs []uuid.UUID
		g.db.Select(&groupMachineIDs, `
			SELECT DISTINCT gm.machine_id
			FROM dns_passthrough_pools pp
			JOIN machine_group_members gm ON gm.group_id = ANY(pp.group_ids)
			WHERE pp.id = $1
		`, poolID)

		// Merge and dedupe
		seen := make(map[uuid.UUID]bool)
		for _, id := range machineIDs {
			seen[id] = true
		}
		for _, id := range groupMachineIDs {
			if !seen[id] {
				machineIDs = append(machineIDs, id)
				seen[id] = true
			}
		}
	}

	for _, machineID := range machineIDs {
		if err := g.ApplyToMachine(machineID); err != nil {
			log.Printf("Failed to apply config to machine %s: %v", machineID, err)
		}
	}

	return nil
}
