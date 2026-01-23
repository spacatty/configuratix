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
	// Get all record pools this machine is a member of
	var recordPools []struct {
		PoolID         uuid.UUID `db:"pool_id"`
		TargetIP       string    `db:"target_ip"`
		TargetPort     int       `db:"target_port"`
		TargetPortHTTP int       `db:"target_port_http"`
		RecordName     string    `db:"record_name"`
		DomainFQDN     string    `db:"domain_fqdn"`
		IsCurrent      bool      `db:"is_current"`
	}
	g.db.Select(&recordPools, `
		SELECT 
			pp.id as pool_id,
			pp.target_ip,
			pp.target_port,
			COALESCE(pp.target_port_http, 80) as target_port_http,
			dr.name as record_name,
			dmd.fqdn as domain_fqdn,
			(pp.current_machine_id = $1) as is_current
		FROM dns_passthrough_members pm
		JOIN dns_passthrough_pools pp ON pm.pool_id = pp.id
		JOIN dns_records dr ON pp.dns_record_id = dr.id
		JOIN dns_managed_domains dmd ON dr.dns_domain_id = dmd.id
		WHERE pm.machine_id = $1 AND pm.is_enabled = true
	`, machineID)

	// Also get pools where this machine is in a group
	var groupRecordPools []struct {
		PoolID         uuid.UUID `db:"pool_id"`
		TargetIP       string    `db:"target_ip"`
		TargetPort     int       `db:"target_port"`
		TargetPortHTTP int       `db:"target_port_http"`
		RecordName     string    `db:"record_name"`
		DomainFQDN     string    `db:"domain_fqdn"`
	}
	g.db.Select(&groupRecordPools, `
		SELECT DISTINCT
			pp.id as pool_id,
			pp.target_ip,
			pp.target_port,
			COALESCE(pp.target_port_http, 80) as target_port_http,
			dr.name as record_name,
			dmd.fqdn as domain_fqdn
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
				PoolID         uuid.UUID `db:"pool_id"`
				TargetIP       string    `db:"target_ip"`
				TargetPort     int       `db:"target_port"`
				TargetPortHTTP int       `db:"target_port_http"`
				RecordName     string    `db:"record_name"`
				DomainFQDN     string    `db:"domain_fqdn"`
				IsCurrent      bool      `db:"is_current"`
			}{
				PoolID:         p.PoolID,
				TargetIP:       p.TargetIP,
				TargetPort:     p.TargetPort,
				TargetPortHTTP: p.TargetPortHTTP,
				RecordName:     p.RecordName,
				DomainFQDN:     p.DomainFQDN,
				IsCurrent:      false,
			})
		}
	}

	var wildcardPools []struct {
		PoolID         uuid.UUID `db:"pool_id"`
		TargetIP       string    `db:"target_ip"`
		TargetPort     int       `db:"target_port"`
		TargetPortHTTP int       `db:"target_port_http"`
		DomainFQDN     string    `db:"domain_fqdn"`
		IncludeRoot    bool      `db:"include_root"`
		IsCurrent      bool      `db:"is_current"`
	}
	g.db.Select(&wildcardPools, `
		SELECT 
			wp.id as pool_id,
			wp.target_ip,
			wp.target_port,
			COALESCE(wp.target_port_http, 80) as target_port_http,
			dmd.fqdn as domain_fqdn,
			wp.include_root,
			(wp.current_machine_id = $1) as is_current
		FROM dns_wildcard_pool_members wm
		JOIN dns_wildcard_pools wp ON wm.pool_id = wp.id
		JOIN dns_managed_domains dmd ON wp.dns_domain_id = dmd.id
		WHERE wm.machine_id = $1 AND wm.is_enabled = true
	`, machineID)

	// Also get wildcard pools where this machine is in a group
	var groupWildcardPools []struct {
		PoolID         uuid.UUID `db:"pool_id"`
		TargetIP       string    `db:"target_ip"`
		TargetPort     int       `db:"target_port"`
		TargetPortHTTP int       `db:"target_port_http"`
		DomainFQDN     string    `db:"domain_fqdn"`
		IncludeRoot    bool      `db:"include_root"`
	}
	g.db.Select(&groupWildcardPools, `
		SELECT DISTINCT
			wp.id as pool_id,
			wp.target_ip,
			wp.target_port,
			COALESCE(wp.target_port_http, 80) as target_port_http,
			dmd.fqdn as domain_fqdn,
			wp.include_root
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
				PoolID         uuid.UUID `db:"pool_id"`
				TargetIP       string    `db:"target_ip"`
				TargetPort     int       `db:"target_port"`
				TargetPortHTTP int       `db:"target_port_http"`
				DomainFQDN     string    `db:"domain_fqdn"`
				IncludeRoot    bool      `db:"include_root"`
				IsCurrent      bool      `db:"is_current"`
			}{
				PoolID:         p.PoolID,
				TargetIP:       p.TargetIP,
				TargetPort:     p.TargetPort,
				TargetPortHTTP: p.TargetPortHTTP,
				DomainFQDN:     p.DomainFQDN,
				IncludeRoot:    p.IncludeRoot,
				IsCurrent:      false,
			})
		}
	}

	if len(recordPools) == 0 && len(wildcardPools) == 0 {
		return "", nil // No passthrough config needed
	}

	// Generate config
	// NOTE: This file is included FROM WITHIN a stream{} block in nginx.conf
	// So we do NOT wrap with stream{} here - only the inner directives
	var config strings.Builder
	config.WriteString("# Configuratix Passthrough Configuration\n")
	config.WriteString("# Auto-generated - DO NOT EDIT MANUALLY\n")
	config.WriteString("# Included from stream{} block in nginx.conf\n\n")

	// SNI map for HTTPS (port 443) - maps by TLS SNI to target:port
	config.WriteString("# SNI-based backend routing for HTTPS\n")
	config.WriteString("map $ssl_preread_server_name $backend_https {\n")
	config.WriteString("    default reject;\n")

	for _, pool := range recordPools {
		fullDomain := pool.DomainFQDN
		if pool.RecordName != "@" {
			fullDomain = pool.RecordName + "." + pool.DomainFQDN
		}
		config.WriteString(fmt.Sprintf("    %s %s:%d;\n", fullDomain, pool.TargetIP, pool.TargetPort))
	}

	for _, pool := range wildcardPools {
		config.WriteString(fmt.Sprintf("    ~^.+\\.%s$ %s:%d;\n",
			strings.ReplaceAll(pool.DomainFQDN, ".", "\\."), pool.TargetIP, pool.TargetPort))
		if pool.IncludeRoot {
			config.WriteString(fmt.Sprintf("    %s %s:%d;\n", pool.DomainFQDN, pool.TargetIP, pool.TargetPort))
		}
	}
	config.WriteString("}\n\n")

	// Note: HTTP (port 80) SNI map is not useful since plain HTTP has no SNI.
	// HTTP routing is handled directly in the server block below.

	// Reject upstream
	config.WriteString("# Reject upstream (closed connection)\n")
	config.WriteString("upstream reject {\n")
	config.WriteString("    server 127.0.0.1:1 down;\n")
	config.WriteString("}\n\n")

	// Server block for HTTPS passthrough (port 443)
	config.WriteString("# HTTPS Passthrough (TLS SNI-based routing)\n")
	config.WriteString("server {\n")
	config.WriteString("    listen 443;\n")
	config.WriteString("    ssl_preread on;\n")
	config.WriteString("    proxy_pass $backend_https;\n")
	config.WriteString("    proxy_connect_timeout 10s;\n")
	config.WriteString("    proxy_timeout 30m;\n")
	config.WriteString("}\n\n")

	// Note: HTTP (port 80) passthrough is tricky because there's no SNI for plain HTTP.
	// We use nginx's preread module to look at the first bytes - if it's TLS, we route via SNI.
	// For plain HTTP, we need to use the Host header which requires layer 7 inspection.
	// 
	// Approach: Create separate upstream blocks and use the same target as HTTPS.
	// The target server handles Host-based routing in its HTTP config.
	
	// Generate upstreams for each unique target (for HTTP port mapping)
	httpTargets := make(map[string]string) // domain -> target:port
	for _, pool := range recordPools {
		fullDomain := pool.DomainFQDN
		if pool.RecordName != "@" {
			fullDomain = pool.RecordName + "." + pool.DomainFQDN
		}
		httpTargets[fullDomain] = fmt.Sprintf("%s:%d", pool.TargetIP, pool.TargetPortHTTP)
	}
	for _, pool := range wildcardPools {
		// For wildcards, just use the root domain as key
		httpTargets["wildcard_"+pool.DomainFQDN] = fmt.Sprintf("%s:%d", pool.TargetIP, pool.TargetPortHTTP)
		if pool.IncludeRoot {
			httpTargets[pool.DomainFQDN] = fmt.Sprintf("%s:%d", pool.TargetIP, pool.TargetPortHTTP)
		}
	}

	// If all HTTP targets are the same, create a simple server block
	// Otherwise, create multiple server blocks or use a default
	uniqueHTTPTargets := make(map[string]bool)
	for _, target := range httpTargets {
		uniqueHTTPTargets[target] = true
	}

	if len(uniqueHTTPTargets) == 1 {
		// Single target - simple passthrough
		var target string
		for t := range uniqueHTTPTargets {
			target = t
			break
		}
		config.WriteString("# HTTP Passthrough (all traffic to single target)\n")
		config.WriteString("server {\n")
		config.WriteString("    listen 80;\n")
		config.WriteString(fmt.Sprintf("    proxy_pass %s;\n", target))
		config.WriteString("    proxy_connect_timeout 10s;\n")
		config.WriteString("    proxy_timeout 30m;\n")
		config.WriteString("}\n")
	} else if len(uniqueHTTPTargets) > 1 {
		// Multiple targets - need layer 7 for proper routing
		// For now, use the first target as default and add a comment
		var defaultTarget string
		for t := range uniqueHTTPTargets {
			defaultTarget = t
			break
		}
		config.WriteString("# HTTP Passthrough\n")
		config.WriteString("# NOTE: Multiple HTTP targets configured. Layer 4 cannot route by Host header.\n")
		config.WriteString("# All HTTP traffic goes to default target. Target server handles Host routing.\n")
		config.WriteString("server {\n")
		config.WriteString("    listen 80;\n")
		config.WriteString(fmt.Sprintf("    proxy_pass %s;\n", defaultTarget))
		config.WriteString("    proxy_connect_timeout 10s;\n")
		config.WriteString("    proxy_timeout 30m;\n")
		config.WriteString("}\n")
	}

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
	// Note: stream blocks must be in a file included by nginx.conf, not in conf.d
	// The config goes to /etc/nginx/stream.d/ or /etc/nginx/conf.d/stream/
	configPath := "/etc/nginx/stream.d/configuratix-passthrough.conf"
	
	// Get agent_id for this machine
	var agentID *uuid.UUID
	err = g.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID)
	if err != nil || agentID == nil {
		return fmt.Errorf("machine %s has no agent", machineID)
	}
	
	// Use 'run' job with multiple steps:
	// 1. Disable conflicting sites-enabled configs
	// 2. Install stream module if needed
	// 3. Ensure nginx.conf includes stream.d
	// 4. Write the config
	// 5. Reload nginx
	setupScript := `
#!/bin/bash
set -e

# Setup nginx stream passthrough
NGINX_CONF="/etc/nginx/nginx.conf"
SITES_ENABLED="/etc/nginx/sites-enabled"
SITES_AVAILABLE="/etc/nginx/sites-available"

echo "=== Configuratix Passthrough Setup ==="

# 1. Disable sites-enabled configs that listen on ports 80/443
# (Stream passthrough needs exclusive access to these ports)
# We MOVE files to sites-disabled because nginx's include glob still matches renamed files
echo "Checking for conflicting site configs..."
SITES_DISABLED="/etc/nginx/sites-disabled-by-passthrough"
mkdir -p "$SITES_DISABLED"

if [ -d "$SITES_ENABLED" ]; then
    for conf in "$SITES_ENABLED"/*; do
        [ -f "$conf" ] || [ -L "$conf" ] || continue
        confname=$(basename "$conf")
        
        # Check if this config listens on 80 or 443
        if grep -qE 'listen\s+(80|443)' "$conf" 2>/dev/null; then
            echo "Disabling $confname (listens on 80/443)..."
            mv "$conf" "$SITES_DISABLED/$confname"
        fi
    done
fi

# Also remove any leftover .disabled-by-passthrough files from previous runs
rm -f "$SITES_ENABLED"/*.disabled-by-passthrough 2>/dev/null || true

# Also check sites-available symlinks that might conflict
# (the above handles symlinks too since we check sites-enabled)

# 2. Create stream.d directory
mkdir -p /etc/nginx/stream.d

# 3. Check if stream module is available
STREAM_AVAILABLE=false

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

# 4. Add stream block to nginx.conf if missing
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

# 5. Final module test
if nginx -t 2>&1 | grep -q "unknown directive.*stream"; then
    echo "ERROR: Stream module still not working after setup"
    exit 1
fi

echo "Stream setup complete"
`
	// Final step: test config and restart nginx (not just reload, in case it's stopped)
	restartScript := `
#!/bin/bash
set -e

# Kill any orphaned nginx processes that might be holding ports
pkill -9 nginx 2>/dev/null || true
sleep 1

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
	payload := fmt.Sprintf(`{
		"steps": [
			{"action": "exec", "command": %q, "timeout": 300},
			{"action": "file", "op": "write", "path": %q, "content": %q, "mode": "0644"},
			{"action": "exec", "command": %q, "timeout": 60}
		],
		"on_error": "stop"
	}`, setupScript, configPath, config, restartScript)
	
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

SITES_ENABLED="/etc/nginx/sites-enabled"
SITES_DISABLED="/etc/nginx/sites-disabled-by-passthrough"
CONFIG_FILE="/etc/nginx/stream.d/configuratix-passthrough.conf"

echo "=== Configuratix Passthrough Cleanup ==="

# 1. Remove passthrough config
if [ -f "$CONFIG_FILE" ]; then
    echo "Removing passthrough config..."
    rm -f "$CONFIG_FILE"
fi

# 2. Re-enable sites that were disabled by passthrough
echo "Re-enabling disabled sites..."
if [ -d "$SITES_DISABLED" ]; then
    for conf in "$SITES_DISABLED"/*; do
        [ -f "$conf" ] || continue
        confname=$(basename "$conf")
        echo "Re-enabling $confname..."
        mv "$conf" "$SITES_ENABLED/$confname"
    done
    rmdir "$SITES_DISABLED" 2>/dev/null || true
fi

# Also clean up old-style disabled files if any
for conf in "$SITES_ENABLED"/*.disabled-by-passthrough; do
    [ -f "$conf" ] || continue
    newname="${conf%.disabled-by-passthrough}"
    mv "$conf" "$newname"
done

# 3. Restart nginx
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

