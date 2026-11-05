import type { NginxFormState } from "@/components/nginx/form-state";
import { isValidBodySize } from "@/components/nginx/form-state";

/**
 * Client-side preview of what the backend renders for a domain
 * (port of `generateNginxFromStructured` in backend/internal/handlers/domains.go).
 * UA patterns come from the global security list, so they appear as a placeholder.
 * The server remains the source of truth — this is a preview.
 */

const CF_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CF_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

function esc(p: string) {
  return p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function generatePreview(f: NginxFormState, domain: string, endpointPatterns: string[], phpVersion = ""): string {
  if (f.mode === "manual") return f.rawText;
  if (f.isPassthrough) return passthroughPreview(f, domain);

  const autoindexOff = f.autoindexOff;
  const denyAllCatchall = f.denyAllCatchall;
  let c = "server {\n";
  const useProxyProtocol = f.proxyEnabled && f.useProxyProtocol;
  const ppPort = f.proxyEnabled && f.proxyProtocolPort > 0 ? f.proxyProtocolPort : 443;
  const listenHTTP = f.sslMode !== "https_only";
  if (useProxyProtocol) {
    if (listenHTTP) c += `    listen ${ppPort} proxy_protocol;\n`;
    if (f.sslMode !== "disabled") c += `    listen ${ppPort} ssl http2 proxy_protocol;\n`;
  } else {
    if (listenHTTP) c += "    listen 80;\n";
    if (f.sslMode !== "disabled") c += "    listen 443 ssl http2;\n";
  }
  c += `    server_name ${domain};\n\n`;
  if (f.sslMode !== "disabled") {
    c += `    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;\n`;
    c += `    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;\n`;
    c += "    ssl_protocols TLSv1.2 TLSv1.3;\n\n";
  }
  c += "    # Banned IPs (works with real_ip for Cloudflare etc)\n";
  c += "    include /etc/nginx/snippets/configuratix-bans.conf;\n\n";

  if (f.proxyEnabled) {
    c += "    # Real IP extraction from proxy\n";
    if (f.proxyType === "cloudflare") {
      for (const ip of [...CF_V4, ...CF_V6]) c += `    set_real_ip_from ${ip};\n`;
      c += "    real_ip_header CF-Connecting-IP;\n    real_ip_recursive on;\n\n";
    } else if (f.proxyType === "proxy_protocol") {
      c += "    set_real_ip_from 0.0.0.0/0;\n    set_real_ip_from ::/0;\n    real_ip_header proxy_protocol;\n    real_ip_recursive on;\n\n";
    } else {
      for (const ip of f.customTrustedIPs.split(",").map((s) => s.trim()).filter(Boolean)) c += `    set_real_ip_from ${ip};\n`;
      c += "    real_ip_header X-Forwarded-For;\n    real_ip_recursive on;\n\n";
    }
  }

  if (autoindexOff) c += "    # Deny directory listing\n    autoindex off;\n\n";

  const ua = f.uaBlocking;
  const ep = f.endpointBlocking && endpointPatterns.length > 0;
  const sec = ua || ep;
  if (sec) c += '    # Security blocking variables\n    set $security_block "";\n    set $block_reason "";\n\n';
  if (ua) {
    c += "    # Block bad user agents (patterns from Security → UA patterns)\n";
    c += '    if ($http_user_agent ~* "<pattern>") {\n        set $security_block "1";\n        set $block_reason "blocked_ua";\n    }\n    # … one block per pattern\n\n';
  }
  if (ep) {
    c += "    # Endpoint allowlist - block requests not matching allowed patterns\n    set $endpoint_allowed 0;\n";
    for (const p of endpointPatterns) c += `    if ($request_uri ~* "${esc(p)}") { set $endpoint_allowed 1; }\n`;
    c += '    if ($endpoint_allowed = 0) {\n        set $security_block "1";\n        set $block_reason "invalid_endpoint";\n    }\n\n';
  }
  if (sec) c += '    # Redirect blocked requests to logging location\n    if ($security_block = "1") { return 493; }\n    error_page 493 = @security_blocked;\n\n';

  if (f.corsEnabled && f.corsAllowAll) {
    c += "    add_header 'Access-Control-Allow-Origin' '*' always;\n";
    c += "    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;\n";
    c += "    add_header 'Access-Control-Allow-Headers' '*' always;\n\n";
  }

  const phpSocket = phpVersion ? `/run/php/php${phpVersion}-fpm.sock` : "/run/php/php-fpm.sock";
  let phpEnabled = false;
  let phpRoot = "";
  const hasRoot = f.locations.some((l) => l.path === "/" && (!l.match_type || l.match_type === "prefix"));
  if (denyAllCatchall && !hasRoot) c += "    # Deny all by default\n    location / {\n        deny all;\n    }\n\n";

  for (const l of f.locations) {
    const usePHP = l.type === "static" ? f.enablePHP : false;
    let mod = "";
    if (l.match_type === "exact") mod = "= ";
    else if (l.match_type === "regex") mod = "~ ";
    else if (l.match_type === "case_insensitive_regex") mod = "~* ";
    c += `    location ${mod}${l.path} {\n`;
    if (l.type === "proxy" && l.proxy_url) {
      c += `        proxy_pass ${l.proxy_url};\n`;
      c += "        proxy_set_header Host $host;\n";
      c += "        proxy_set_header X-Real-IP $remote_addr;\n";
      c += "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n";
      c += "        proxy_set_header X-Forwarded-Proto $scheme;\n";
    } else if (l.type === "static") {
      if (l.root) c += `        root ${l.root};\n`;
      let index = l.index || "index.html index.htm";
      if (usePHP) {
        if (!index.includes("index.php")) index = `index.php ${index}`;
        phpEnabled = true;
        if (!phpRoot && l.root) phpRoot = l.root;
      }
      c += `        index ${index};\n`;
      c += "        try_files $uri $uri/ =404;\n";
    }
    c += "    }\n\n";
  }

  if (phpEnabled) {
    c += "    # PHP-FPM handler\n    location ~ \\.php$ {\n";
    if (phpRoot) c += `        root ${phpRoot};\n`;
    c += "        try_files $uri =404;\n";
    c += "        fastcgi_split_path_info ^(.+\\.php)(/.+)$;\n";
    c += `        fastcgi_pass unix:${phpSocket};\n`;
    c += "        fastcgi_index index.php;\n";
    c += "        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n";
    c += "        include fastcgi_params;\n    }\n\n";
  }
  if (sec) {
    c += "    # Security blocked location - logs blocked requests for agent to process\n";
    c += "    location @security_blocked {\n        internal;\n        access_log /var/log/nginx/security-blocked.log combined;\n        return 403;\n    }\n\n";
  }
  c += "}\n";
  return c;
}

function passthroughPreview(f: NginxFormState, domain: string): string {
  const target = f.passthroughTarget.trim() || "<backend-host>:443";
  const host = target.replace(/:\d+$/, "");
  const body = isValidBodySize(f.passthroughHttpBodySize) && f.passthroughHttpBodySize.trim() ? f.passthroughHttpBodySize.trim() : "100M";
  let c = "# Layer 4 passthrough (approximate preview)\n";
  c += "# stream.d/configuratix-passthrough.conf — one shared :443 listener routed by SNI\n";
  c += "map $ssl_preread_server_name $configuratix_upstream {\n";
  c += `    ${domain}    ${target};\n`;
  c += "    # … other passthrough domains on this proxy\n}\n\n";
  c += "server {\n    listen 443;\n    ssl_preread on;\n    proxy_pass $configuratix_upstream;\n";
  if (f.passthroughProxyProtocol) c += "    proxy_protocol on;\n";
  c += "}\n";
  if (f.passthroughHttpEnabled) {
    c += "\n# conf.d — port 80, routed by Host header\n";
    c += `server {\n    listen 80;\n    server_name ${domain};\n\n    location / {\n`;
    c += `        client_max_body_size ${body};\n`;
    c += `        proxy_pass http://${host}:${f.passthroughHttpPort || 80};\n`;
    c += "        proxy_set_header Host $host;\n";
    c += "        proxy_set_header X-Real-IP $remote_addr;\n";
    c += "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n";
    if (f.passthroughHttpExtra.trim()) {
      c += "        # extra directives\n";
      for (const line of f.passthroughHttpExtra.trim().split("\n")) c += `        ${line.trim()}\n`;
    }
    c += "    }\n}\n";
  }
  return c;
}
