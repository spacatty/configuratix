package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"

	"configuratix/backend/internal/database"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// PassthroughNginxGenerator generates nginx stream passthrough configs
type PassthroughNginxGenerator struct {
	db *database.DB
}

type PassthroughNginxConfigBundle struct {
	StreamConfig   string
	HTTPConfig     string
	L7Config       string
	L7Domains      []string
	L7DomainEmails map[string]string
}

type passthroughProxyProtocolState struct {
	Domain  string
	Enabled bool
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

// NewPassthroughNginxGenerator creates a new generator
func NewPassthroughNginxGenerator(db *database.DB) *PassthroughNginxGenerator {
	return &PassthroughNginxGenerator{db: db}
}

// GenerateForMachine generates nginx stream config for a specific proxy machine
func (g *PassthroughNginxGenerator) GenerateForMachine(machineID uuid.UUID) (PassthroughNginxConfigBundle, error) {
	// Get all record pools this machine is a member of (with domain listener_protocol)
	var recordPools []struct {
		PoolID            uuid.UUID `db:"pool_id"`
		TargetIP          string    `db:"target_ip"`
		TargetScheme      string    `db:"target_scheme"`
		TargetPort        int       `db:"target_port"`
		TargetPortHTTP    int       `db:"target_port_http"`
		PreserveHost      bool      `db:"preserve_host"`
		TLSVerifyUpstream bool      `db:"tls_verify_upstream"`
		SSLEmail          string    `db:"ssl_email"`
		RecordName        string    `db:"record_name"`
		DomainFQDN        string    `db:"domain_fqdn"`
		IsCurrent         bool      `db:"is_current"`
		ProxyMode         string    `db:"proxy_mode"`
		ListenerProtocol  string    `db:"listener_protocol"`
	}
	g.db.Select(&recordPools, `
		SELECT 
			pp.id as pool_id,
			pp.target_ip,
			COALESCE(pp.target_scheme, 'http') as target_scheme,
			pp.target_port,
			COALESCE(pp.target_port_http, 80) as target_port_http,
			COALESCE(pp.preserve_host, true) as preserve_host,
			COALESCE(pp.tls_verify_upstream, false) as tls_verify_upstream,
			COALESCE(pp.ssl_email, 'admin@example.com') as ssl_email,
			dr.name as record_name,
			dmd.fqdn as domain_fqdn,
			(pp.current_machine_id = $1) as is_current,
			COALESCE(dmd.proxy_mode, 'static') as proxy_mode,
			COALESCE(dmd.listener_protocol, 'http_and_https') as listener_protocol
		FROM dns_passthrough_members pm
		JOIN dns_passthrough_pools pp ON pm.pool_id = pp.id
		JOIN dns_records dr ON pp.dns_record_id = dr.id
		JOIN dns_managed_domains dmd ON dr.dns_domain_id = dmd.id
		WHERE pm.machine_id = $1 AND pm.is_enabled = true
	`, machineID)

	// Also get pools where this machine is in a group
	var groupRecordPools []struct {
		PoolID            uuid.UUID `db:"pool_id"`
		TargetIP          string    `db:"target_ip"`
		TargetScheme      string    `db:"target_scheme"`
		TargetPort        int       `db:"target_port"`
		TargetPortHTTP    int       `db:"target_port_http"`
		PreserveHost      bool      `db:"preserve_host"`
		TLSVerifyUpstream bool      `db:"tls_verify_upstream"`
		SSLEmail          string    `db:"ssl_email"`
		RecordName        string    `db:"record_name"`
		DomainFQDN        string    `db:"domain_fqdn"`
		ProxyMode         string    `db:"proxy_mode"`
		ListenerProtocol  string    `db:"listener_protocol"`
	}
	g.db.Select(&groupRecordPools, `
		SELECT DISTINCT
			pp.id as pool_id,
			pp.target_ip,
			COALESCE(pp.target_scheme, 'http') as target_scheme,
			pp.target_port,
			COALESCE(pp.target_port_http, 80) as target_port_http,
			COALESCE(pp.preserve_host, true) as preserve_host,
			COALESCE(pp.tls_verify_upstream, false) as tls_verify_upstream,
			COALESCE(pp.ssl_email, 'admin@example.com') as ssl_email,
			dr.name as record_name,
			dmd.fqdn as domain_fqdn,
			COALESCE(dmd.proxy_mode, 'static') as proxy_mode,
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
				PoolID            uuid.UUID `db:"pool_id"`
				TargetIP          string    `db:"target_ip"`
				TargetScheme      string    `db:"target_scheme"`
				TargetPort        int       `db:"target_port"`
				TargetPortHTTP    int       `db:"target_port_http"`
				PreserveHost      bool      `db:"preserve_host"`
				TLSVerifyUpstream bool      `db:"tls_verify_upstream"`
				SSLEmail          string    `db:"ssl_email"`
				RecordName        string    `db:"record_name"`
				DomainFQDN        string    `db:"domain_fqdn"`
				IsCurrent         bool      `db:"is_current"`
				ProxyMode         string    `db:"proxy_mode"`
				ListenerProtocol  string    `db:"listener_protocol"`
			}{
				PoolID:            p.PoolID,
				TargetIP:          p.TargetIP,
				TargetScheme:      p.TargetScheme,
				TargetPort:        p.TargetPort,
				TargetPortHTTP:    p.TargetPortHTTP,
				PreserveHost:      p.PreserveHost,
				TLSVerifyUpstream: p.TLSVerifyUpstream,
				SSLEmail:          p.SSLEmail,
				RecordName:        p.RecordName,
				DomainFQDN:        p.DomainFQDN,
				IsCurrent:         false,
				ProxyMode:         p.ProxyMode,
				ListenerProtocol:  p.ListenerProtocol,
			})
		}
	}

	var wildcardPools []struct {
		PoolID            uuid.UUID `db:"pool_id"`
		TargetIP          string    `db:"target_ip"`
		TargetScheme      string    `db:"target_scheme"`
		TargetPort        int       `db:"target_port"`
		TargetPortHTTP    int       `db:"target_port_http"`
		PreserveHost      bool      `db:"preserve_host"`
		TLSVerifyUpstream bool      `db:"tls_verify_upstream"`
		SSLEmail          string    `db:"ssl_email"`
		DomainFQDN        string    `db:"domain_fqdn"`
		IncludeRoot       bool      `db:"include_root"`
		IsCurrent         bool      `db:"is_current"`
		ProxyMode         string    `db:"proxy_mode"`
		ListenerProtocol  string    `db:"listener_protocol"`
	}
	g.db.Select(&wildcardPools, `
		SELECT 
			wp.id as pool_id,
			wp.target_ip,
			COALESCE(wp.target_scheme, 'http') as target_scheme,
			wp.target_port,
			COALESCE(wp.target_port_http, 80) as target_port_http,
			COALESCE(wp.preserve_host, true) as preserve_host,
			COALESCE(wp.tls_verify_upstream, false) as tls_verify_upstream,
			COALESCE(wp.ssl_email, 'admin@example.com') as ssl_email,
			dmd.fqdn as domain_fqdn,
			wp.include_root,
			(wp.current_machine_id = $1) as is_current,
			COALESCE(dmd.proxy_mode, 'static') as proxy_mode,
			COALESCE(dmd.listener_protocol, 'http_and_https') as listener_protocol
		FROM dns_wildcard_pool_members wm
		JOIN dns_wildcard_pools wp ON wm.pool_id = wp.id
		JOIN dns_managed_domains dmd ON wp.dns_domain_id = dmd.id
		WHERE wm.machine_id = $1 AND wm.is_enabled = true
	`, machineID)

	// Also get wildcard pools where this machine is in a group
	var groupWildcardPools []struct {
		PoolID            uuid.UUID `db:"pool_id"`
		TargetIP          string    `db:"target_ip"`
		TargetScheme      string    `db:"target_scheme"`
		TargetPort        int       `db:"target_port"`
		TargetPortHTTP    int       `db:"target_port_http"`
		PreserveHost      bool      `db:"preserve_host"`
		TLSVerifyUpstream bool      `db:"tls_verify_upstream"`
		SSLEmail          string    `db:"ssl_email"`
		DomainFQDN        string    `db:"domain_fqdn"`
		IncludeRoot       bool      `db:"include_root"`
		ProxyMode         string    `db:"proxy_mode"`
		ListenerProtocol  string    `db:"listener_protocol"`
	}
	g.db.Select(&groupWildcardPools, `
		SELECT DISTINCT
			wp.id as pool_id,
			wp.target_ip,
			COALESCE(wp.target_scheme, 'http') as target_scheme,
			wp.target_port,
			COALESCE(wp.target_port_http, 80) as target_port_http,
			COALESCE(wp.preserve_host, true) as preserve_host,
			COALESCE(wp.tls_verify_upstream, false) as tls_verify_upstream,
			COALESCE(wp.ssl_email, 'admin@example.com') as ssl_email,
			dmd.fqdn as domain_fqdn,
			wp.include_root,
			COALESCE(dmd.proxy_mode, 'static') as proxy_mode,
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
				PoolID            uuid.UUID `db:"pool_id"`
				TargetIP          string    `db:"target_ip"`
				TargetScheme      string    `db:"target_scheme"`
				TargetPort        int       `db:"target_port"`
				TargetPortHTTP    int       `db:"target_port_http"`
				PreserveHost      bool      `db:"preserve_host"`
				TLSVerifyUpstream bool      `db:"tls_verify_upstream"`
				SSLEmail          string    `db:"ssl_email"`
				DomainFQDN        string    `db:"domain_fqdn"`
				IncludeRoot       bool      `db:"include_root"`
				IsCurrent         bool      `db:"is_current"`
				ProxyMode         string    `db:"proxy_mode"`
				ListenerProtocol  string    `db:"listener_protocol"`
			}{
				PoolID:            p.PoolID,
				TargetIP:          p.TargetIP,
				TargetScheme:      p.TargetScheme,
				TargetPort:        p.TargetPort,
				TargetPortHTTP:    p.TargetPortHTTP,
				PreserveHost:      p.PreserveHost,
				TLSVerifyUpstream: p.TLSVerifyUpstream,
				SSLEmail:          p.SSLEmail,
				DomainFQDN:        p.DomainFQDN,
				IncludeRoot:       p.IncludeRoot,
				IsCurrent:         false,
				ProxyMode:         p.ProxyMode,
				ListenerProtocol:  p.ListenerProtocol,
			})
		}
	}

	if len(recordPools) == 0 && len(wildcardPools) == 0 {
		return PassthroughNginxConfigBundle{}, nil // No passthrough config needed
	}

	var proxyStates []passthroughProxyProtocolState
	g.db.Select(&proxyStates, `
		SELECT domain, BOOL_OR(enabled) AS enabled
		FROM (
			SELECT CASE WHEN dr.name = '@' THEN dmd.fqdn ELSE dr.name || '.' || dmd.fqdn END AS domain,
			       COALESCE(pp.proxy_protocol, true) AS enabled
			FROM dns_passthrough_pools pp
			JOIN dns_records dr ON pp.dns_record_id = dr.id
			JOIN dns_managed_domains dmd ON dr.dns_domain_id = dmd.id
			JOIN dns_passthrough_members pm ON pm.pool_id = pp.id
			WHERE pm.machine_id = $1 AND pm.is_enabled = true AND COALESCE(dmd.listener_protocol, 'http_and_https') != 'http_only' AND COALESCE(dmd.proxy_mode, 'static') = 'separate'
			UNION ALL
			SELECT CASE WHEN dr.name = '@' THEN dmd.fqdn ELSE dr.name || '.' || dmd.fqdn END AS domain,
			       COALESCE(pp.proxy_protocol, true) AS enabled
			FROM dns_passthrough_pools pp
			JOIN dns_records dr ON pp.dns_record_id = dr.id
			JOIN dns_managed_domains dmd ON dr.dns_domain_id = dmd.id
			JOIN machine_group_members gm ON gm.group_id = ANY(pp.group_ids)
			WHERE gm.machine_id = $1 AND COALESCE(dmd.listener_protocol, 'http_and_https') != 'http_only' AND COALESCE(dmd.proxy_mode, 'static') = 'separate'
			UNION ALL
			SELECT dmd.fqdn AS domain,
			       COALESCE(wp.proxy_protocol, true) AS enabled
			FROM dns_wildcard_pools wp
			JOIN dns_managed_domains dmd ON wp.dns_domain_id = dmd.id
			JOIN dns_wildcard_pool_members wm ON wm.pool_id = wp.id
			WHERE wm.machine_id = $1 AND wm.is_enabled = true AND COALESCE(dmd.listener_protocol, 'http_and_https') != 'http_only' AND COALESCE(dmd.proxy_mode, 'static') = 'wildcard'
			UNION ALL
			SELECT dmd.fqdn AS domain,
			       COALESCE(wp.proxy_protocol, true) AS enabled
			FROM dns_wildcard_pools wp
			JOIN dns_managed_domains dmd ON wp.dns_domain_id = dmd.id
			JOIN machine_group_members gm ON gm.group_id = ANY(wp.group_ids)
			WHERE gm.machine_id = $1 AND COALESCE(dmd.listener_protocol, 'http_and_https') != 'http_only' AND COALESCE(dmd.proxy_mode, 'static') = 'wildcard'
		) t
		GROUP BY domain
		ORDER BY domain
	`, machineID)
	proxyProtocolEnabled := false
	hasProxyProtocolEnabled := false
	hasProxyProtocolDisabled := false
	var proxyEnabledDomains []string
	var proxyDisabledDomains []string
	for _, state := range proxyStates {
		if state.Enabled {
			hasProxyProtocolEnabled = true
			proxyProtocolEnabled = true
			proxyEnabledDomains = append(proxyEnabledDomains, state.Domain)
		} else {
			hasProxyProtocolDisabled = true
			proxyDisabledDomains = append(proxyDisabledDomains, state.Domain)
		}
	}
	if hasProxyProtocolEnabled && hasProxyProtocolDisabled {
		return PassthroughNginxConfigBundle{}, fmt.Errorf("mixed HTTPS PROXY protocol settings for machine %s: nginx stream uses one shared listen 443 server, so PROXY protocol cannot be enabled per SNI domain; enabled=%s disabled=%s", machineID, strings.Join(proxyEnabledDomains, ", "), strings.Join(proxyDisabledDomains, ", "))
	}

	var streamConfig strings.Builder
	var httpConfig strings.Builder
	var l7Config strings.Builder
	l7DomainsSet := make(map[string]bool)
	l7DomainEmails := make(map[string]string)
	var l7Domains []string

	// Detect L4/L7 composition on this proxy machine.
	hasL4HTTPS := false
	hasL7 := false
	for _, pool := range wildcardPools {
		if pool.ProxyMode != "wildcard" && pool.ProxyMode != "layer7" {
			continue
		}
		if pool.ProxyMode == "layer7" {
			return PassthroughNginxConfigBundle{}, fmt.Errorf("layer7 proxy mode is currently unsupported for wildcard pools on machine %s; wildcard domain=%s requires DNS-01 wildcard certificate support", machineID, pool.DomainFQDN)
		}
	}
	for _, pool := range recordPools {
		if pool.ProxyMode == "static" {
			continue
		}
		if pool.ProxyMode == "layer7" {
			hasL7 = true
			continue
		}
		if pool.ListenerProtocol != "http_only" {
			hasL4HTTPS = true
			break
		}
	}
	if !hasL4HTTPS {
		for _, pool := range wildcardPools {
			if pool.ProxyMode != "wildcard" {
				continue
			}
			if pool.ListenerProtocol != "http_only" {
				hasL4HTTPS = true
				break
			}
		}
	}
	if hasL4HTTPS && hasL7 {
		return PassthroughNginxConfigBundle{}, fmt.Errorf("cannot mix layer4 passthrough and layer7 reverse proxy on machine %s: both require shared 443 listener ownership", machineID)
	}

	if hasL4HTTPS {
		streamConfig.WriteString("# Configuratix Passthrough Configuration\n")
		streamConfig.WriteString("# Auto-generated - DO NOT EDIT MANUALLY\n")
		streamConfig.WriteString("# Included from stream{} block in nginx.conf\n\n")
		// SNI map for HTTPS (port 443) - maps by TLS SNI to target:port
		streamConfig.WriteString("# SNI-based backend routing for HTTPS\n")
		streamConfig.WriteString("map $ssl_preread_server_name $backend_https {\n")
		streamConfig.WriteString("    default reject;\n")

		for _, pool := range recordPools {
			if pool.ProxyMode != "separate" {
				continue
			}
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
			if pool.ProxyMode != "wildcard" {
				continue
			}
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
		if pool.ProxyMode != "separate" {
			continue
		}
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
		if pool.ProxyMode != "wildcard" {
			continue
		}
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

	// Layer 7 reverse proxy config (TLS termination on proxy machine).
	if hasL7 {
		l7Config.WriteString("# Configuratix Layer7 Reverse Proxy Configuration\n")
		l7Config.WriteString("# Auto-generated - DO NOT EDIT MANUALLY\n\n")

		for _, pool := range recordPools {
			if pool.ProxyMode != "layer7" {
				continue
			}
			fullDomain := pool.DomainFQDN
			if pool.RecordName != "@" {
				fullDomain = pool.RecordName + "." + pool.DomainFQDN
			}

			targetScheme := strings.ToLower(pool.TargetScheme)
			if targetScheme != "https" {
				targetScheme = "http"
			}
			targetPort := pool.TargetPortHTTP
			if targetScheme == "https" {
				targetPort = pool.TargetPort
			}
			upstream := fmt.Sprintf("%s://%s:%d", targetScheme, pool.TargetIP, targetPort)

			// HTTP listener (always needed for ACME challenge).
			l7Config.WriteString("server {\n")
			l7Config.WriteString("    listen 80;\n")
			l7Config.WriteString(fmt.Sprintf("    server_name %s;\n\n", fullDomain))
			l7Config.WriteString("    location /.well-known/acme-challenge/ {\n")
			l7Config.WriteString("        root /var/www/configuratix-acme;\n")
			l7Config.WriteString("    }\n\n")
			if pool.ListenerProtocol == "http_only" {
				l7Config.WriteString("    location / {\n")
				l7Config.WriteString(fmt.Sprintf("        proxy_pass %s;\n", upstream))
				if pool.PreserveHost {
					l7Config.WriteString("        proxy_set_header Host $host;\n")
				}
				l7Config.WriteString("        proxy_set_header X-Real-IP $remote_addr;\n")
				l7Config.WriteString("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n")
				l7Config.WriteString("        proxy_set_header X-Forwarded-Proto $scheme;\n")
				l7Config.WriteString("        proxy_set_header X-Forwarded-Host $host;\n")
				l7Config.WriteString("        proxy_set_header X-Forwarded-Port $server_port;\n")
				l7Config.WriteString("        proxy_connect_timeout 10s;\n")
				l7Config.WriteString("        proxy_read_timeout 30m;\n")
				l7Config.WriteString("        proxy_send_timeout 30m;\n")
				if targetScheme == "https" {
					l7Config.WriteString("        proxy_ssl_server_name on;\n")
					if !pool.TLSVerifyUpstream {
						l7Config.WriteString("        proxy_ssl_verify off;\n")
					}
				}
				l7Config.WriteString("    }\n")
			} else {
				l7Config.WriteString("    location / {\n")
				l7Config.WriteString("        return 301 https://$host$request_uri;\n")
				l7Config.WriteString("    }\n")
			}
			l7Config.WriteString("}\n\n")

			if pool.ListenerProtocol != "http_only" {
				l7Config.WriteString("server {\n")
				l7Config.WriteString("    listen 443 ssl http2;\n")
				l7Config.WriteString(fmt.Sprintf("    server_name %s;\n\n", fullDomain))
				l7Config.WriteString(fmt.Sprintf("    ssl_certificate /etc/letsencrypt/live/%s/fullchain.pem;\n", fullDomain))
				l7Config.WriteString(fmt.Sprintf("    ssl_certificate_key /etc/letsencrypt/live/%s/privkey.pem;\n", fullDomain))
				l7Config.WriteString("    ssl_protocols TLSv1.2 TLSv1.3;\n\n")
				l7Config.WriteString("    location / {\n")
				l7Config.WriteString(fmt.Sprintf("        proxy_pass %s;\n", upstream))
				if pool.PreserveHost {
					l7Config.WriteString("        proxy_set_header Host $host;\n")
				}
				l7Config.WriteString("        proxy_set_header X-Real-IP $remote_addr;\n")
				l7Config.WriteString("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n")
				l7Config.WriteString("        proxy_set_header X-Forwarded-Proto $scheme;\n")
				l7Config.WriteString("        proxy_set_header X-Forwarded-Host $host;\n")
				l7Config.WriteString("        proxy_set_header X-Forwarded-Port $server_port;\n")
				l7Config.WriteString("        proxy_connect_timeout 10s;\n")
				l7Config.WriteString("        proxy_read_timeout 30m;\n")
				l7Config.WriteString("        proxy_send_timeout 30m;\n")
				if targetScheme == "https" {
					l7Config.WriteString("        proxy_ssl_server_name on;\n")
					if !pool.TLSVerifyUpstream {
						l7Config.WriteString("        proxy_ssl_verify off;\n")
					}
				}
				l7Config.WriteString("    }\n")
				l7Config.WriteString("}\n\n")

				if !l7DomainsSet[fullDomain] {
					l7DomainsSet[fullDomain] = true
					l7DomainEmails[fullDomain] = pool.SSLEmail
					l7Domains = append(l7Domains, fullDomain)
				}
			}
		}
	}
	sort.Strings(l7Domains)

	return PassthroughNginxConfigBundle{
		StreamConfig:   streamConfig.String(),
		HTTPConfig:     httpConfig.String(),
		L7Config:       l7Config.String(),
		L7Domains:      l7Domains,
		L7DomainEmails: l7DomainEmails,
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
	l7ConfigPath := "/etc/nginx/conf.d/configuratix/passthrough-dns-l7.conf"
	l7BootstrapPath := "/etc/nginx/conf.d/configuratix/passthrough-l7-bootstrap.conf"

	// Get agent_id for this machine
	var agentID *uuid.UUID
	err = g.db.Get(&agentID, "SELECT agent_id FROM machines WHERE id = $1", machineID)
	if err != nil || agentID == nil {
		return fmt.Errorf("machine %s has no agent", machineID)
	}

	needsStream := configs.StreamConfig != ""
	needsL7 := configs.L7Config != ""
	var certEmailFunc strings.Builder
	certEmailFunc.WriteString("cert_email() {\n")
	certEmailFunc.WriteString("  case \"$1\" in\n")
	for _, domain := range configs.L7Domains {
		email := configs.L7DomainEmails[domain]
		if email == "" {
			email = "admin@example.com"
		}
		certEmailFunc.WriteString(fmt.Sprintf("    %s) printf '%%s\\n' %s ;;\n", shellQuote(domain), shellQuote(email)))
	}
	certEmailFunc.WriteString("    *) printf '%s\\n' 'admin@example.com' ;;\n")
	certEmailFunc.WriteString("  esac\n")
	certEmailFunc.WriteString("}\n")
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
	ensureL7CertsScript := fmt.Sprintf(`
#!/bin/bash
set -e

DOMAINS="%s"
BOOTSTRAP_FILE="%s"
ACME_ROOT="/var/www/configuratix-acme"
STREAM_CONFIG_FILE="%s"
HTTP_CONFIG_FILE="%s"
L7_CONFIG_FILE="%s"
BACKUP_DIR="$(mktemp -d)"

%s

backup_config() {
  local file="$1"
  local name
  name="$(basename "$file")"
  if [ -f "$file" ]; then
    mv "$file" "$BACKUP_DIR/$name"
  fi
}

restore_config() {
  local file="$1"
  local name
  name="$(basename "$file")"
  if [ -f "$BACKUP_DIR/$name" ]; then
    mv "$BACKUP_DIR/$name" "$file"
  fi
}

restore_on_error() {
  echo "ERROR: L7 certificate bootstrap failed; restoring previous nginx configs"
  rm -f "$BOOTSTRAP_FILE"
  restore_config "$STREAM_CONFIG_FILE"
  restore_config "$HTTP_CONFIG_FILE"
  restore_config "$L7_CONFIG_FILE"
  rmdir "$BACKUP_DIR" 2>/dev/null || true
  if nginx -t; then
    if systemctl is-active --quiet nginx; then
      systemctl reload nginx || true
    else
      systemctl start nginx || true
    fi
  fi
  exit 1
}

trap restore_on_error ERR

echo "Preparing L7 proxy runtime"
mkdir -p /etc/nginx/conf.d/configuratix "$ACME_ROOT"

APT_UPDATED=false
ensure_package() {
  local binary="$1"
  local package="$2"
  if command -v "$binary" >/dev/null 2>&1; then
    return 0
  fi
  if [ "$APT_UPDATED" = "false" ]; then
    apt-get update -qq
    APT_UPDATED=true
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$package"
}

ensure_package nginx nginx
ensure_package certbot certbot
ensure_package curl curl
ensure_package openssl openssl

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then
  ufw allow 80/tcp >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
fi

mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/configuratix-nginx-reload <<'HOOK'
#!/bin/bash
set -e
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
fi
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/configuratix-nginx-reload

# Generated L4 configs own the same ports as L7. Remove them before ACME bootstrap
# so nginx cannot route HTTP-01 challenges through stale passthrough servers.
backup_config "$STREAM_CONFIG_FILE"
backup_config "$HTTP_CONFIG_FILE"
backup_config "$L7_CONFIG_FILE"

if [ -z "$DOMAINS" ]; then
  echo "No L7 domains require certificates"
  if nginx -t; then
    if systemctl is-active --quiet nginx; then
      systemctl reload nginx
    else
      systemctl start nginx
    fi
  fi
  trap - ERR
  rm -rf "$BACKUP_DIR"
  exit 0
fi

echo "Preparing HTTP-01 bootstrap for L7 domains: $DOMAINS"

cat > "$BOOTSTRAP_FILE" <<'HEADER'
# Configuratix L7 ACME bootstrap
# Auto-generated - temporary file

HEADER

for DOMAIN in $DOMAINS; do
cat >> "$BOOTSTRAP_FILE" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root $ACME_ROOT;
    }

    location / {
        return 200 "Configuratix ACME bootstrap\\n";
    }
}

EOF
done

nginx -t
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl start nginx
fi

for DOMAIN in $DOMAINS; do
  SSL_EMAIL="$(cert_email "$DOMAIN")"
  echo "Ensuring certificate for $DOMAIN with contact $SSL_EMAIL"
  certbot certonly \
    --webroot -w "$ACME_ROOT" \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --no-eff-email \
    --email "$SSL_EMAIL" \
    --keep-until-expiring \
    --cert-name "$DOMAIN"
done

trap - ERR
rm -rf "$BACKUP_DIR"
echo "L7 certificate bootstrap complete"
`, strings.Join(configs.L7Domains, " "), l7BootstrapPath, streamConfigPath, httpConfigPath, l7ConfigPath, certEmailFunc.String())
	// Final step: test config and restart nginx (not just reload, in case it's stopped)
	restartScript := fmt.Sprintf(`
#!/bin/bash
set -e

L7_CONFIG_FILE="%s"
L7_BOOTSTRAP_FILE="%s"
CLEAN_L7_BOOTSTRAP="%t"

# Remove temporary ACME bootstrap after final L7 config exists
if [ "$CLEAN_L7_BOOTSTRAP" = "true" ] && [ -f "$L7_CONFIG_FILE" ] && [ -f "$L7_BOOTSTRAP_FILE" ]; then
    rm -f "$L7_BOOTSTRAP_FILE"
fi

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
`, l7ConfigPath, l7BootstrapPath, needsL7)
	l7StatusScript := fmt.Sprintf(`
#!/bin/bash
set -e

DOMAINS="%s"

if [ -z "$DOMAINS" ]; then
  echo "No L7 certificate statuses to report"
  exit 0
fi

for DOMAIN in $DOMAINS; do
  CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  if [ ! -f "$CERT_PATH" ]; then
    echo "CONFIGURATIX_L7_CERT_STATUS|$DOMAIN|missing||certificate file not found"
    continue
  fi

  END_DATE="$(openssl x509 -enddate -noout -in "$CERT_PATH" | cut -d= -f2-)"
  EXPIRES_AT="$(date -u -d "$END_DATE" +"%%Y-%%m-%%dT%%H:%%M:%%SZ" 2>/dev/null || true)"
  ISSUER="$(openssl x509 -issuer -noout -in "$CERT_PATH" | sed 's/^issuer=//' | tr '|' '/')"
  if openssl x509 -checkend 2592000 -noout -in "$CERT_PATH" >/dev/null 2>&1; then
    STATUS="valid"
  else
    STATUS="expiring"
  fi

  echo "CONFIGURATIX_L7_CERT_STATUS|$DOMAIN|$STATUS|$EXPIRES_AT|$ISSUER"
done
`, strings.Join(configs.L7Domains, " "))
	l7CertTimeout := 300 + len(configs.L7Domains)*120
	if l7CertTimeout < 420 {
		l7CertTimeout = 420
	}
	steps := []map[string]interface{}{
		{"action": "exec", "command": setupScript, "timeout": 300},
	}
	if needsL7 {
		steps = append(steps, map[string]interface{}{"action": "exec", "command": ensureL7CertsScript, "timeout": l7CertTimeout})
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
	if configs.L7Config != "" {
		steps = append(steps, map[string]interface{}{"action": "file", "op": "write", "path": l7ConfigPath, "content": configs.L7Config, "mode": "0644"})
	} else {
		steps = append(steps, map[string]interface{}{"action": "file", "op": "delete", "path": l7ConfigPath})
		steps = append(steps, map[string]interface{}{"action": "file", "op": "delete", "path": l7BootstrapPath})
	}
	steps = append(steps, map[string]interface{}{"action": "exec", "command": restartScript, "timeout": 60})
	if needsL7 {
		steps = append(steps, map[string]interface{}{"action": "exec", "command": l7StatusScript, "timeout": 60})
	}

	payloadBytes, err := json.Marshal(map[string]interface{}{
		"steps":    steps,
		"on_error": "stop",
	})
	if err != nil {
		return fmt.Errorf("failed to build payload: %w", err)
	}
	payload := string(payloadBytes)

	var jobID uuid.UUID
	err = g.db.Get(&jobID, `
		INSERT INTO jobs (agent_id, type, payload_json, status)
		VALUES ($1, 'run', $2::jsonb, 'pending')
		RETURNING id
	`, agentID, payload)

	if err != nil {
		return fmt.Errorf("failed to create job: %w", err)
	}

	if len(configs.L7Domains) > 0 {
		_, _ = g.db.Exec(`
			DELETE FROM dns_l7_certificates
			WHERE machine_id = $1 AND NOT (domain = ANY($2::text[]))
		`, machineID, pq.Array(configs.L7Domains))
		for _, domain := range configs.L7Domains {
			_, _ = g.db.Exec(`
				INSERT INTO dns_l7_certificates (machine_id, domain, status, last_job_id, last_checked_at, updated_at)
				VALUES ($1, $2, 'issuing', $3, NOW(), NOW())
				ON CONFLICT (machine_id, domain) DO UPDATE SET
					status = EXCLUDED.status,
					last_job_id = EXCLUDED.last_job_id,
					last_error = NULL,
					last_checked_at = NOW(),
					updated_at = NOW()
			`, machineID, domain, jobID)
		}
	} else {
		_, _ = g.db.Exec("DELETE FROM dns_l7_certificates WHERE machine_id = $1", machineID)
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
L7_CONFIG_FILE="/etc/nginx/conf.d/configuratix/passthrough-dns-l7.conf"
L7_BOOTSTRAP_FILE="/etc/nginx/conf.d/configuratix/passthrough-l7-bootstrap.conf"

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
if [ -f "$L7_CONFIG_FILE" ]; then
    echo "Removing L7 passthrough config..."
    rm -f "$L7_CONFIG_FILE"
fi
if [ -f "$L7_BOOTSTRAP_FILE" ]; then
    echo "Removing L7 bootstrap config..."
    rm -f "$L7_BOOTSTRAP_FILE"
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

	g.db.Exec("DELETE FROM dns_l7_certificates WHERE machine_id = $1", machineID)

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
