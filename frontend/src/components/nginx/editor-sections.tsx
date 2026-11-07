"use client";

import * as React from "react";
import { ChevronRight, Code2, Globe, Layers, Lock, LockOpen, Network, Plus, ShieldCheck, Trash2, TriangleAlert, Waypoints } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Landing, SecurityEndpointRule } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/app/states";
import { Code, EditorSection, Field, Segmented, SwitchList, SwitchRow } from "@/components/nginx/fields";
import type { FieldErrors, NginxFormState, ProxyType } from "@/components/nginx/form-state";
import { LocationsEditor } from "@/components/nginx/location-editor";
import { NginxMonaco } from "@/components/nginx/nginx-monaco";

export interface SectionProps {
  f: NginxFormState;
  set: <K extends keyof NginxFormState>(key: K, value: NginxFormState[K]) => void;
  errors: FieldErrors;
  warnings: FieldErrors;
}

/* -------------------------------------------------------------------------- */

export function BasicsSection({ f, set, errors }: SectionProps) {
  return (
    <EditorSection id="basics" title="Basics" description="Name, how the config is authored, and which layer it proxies at.">
      <Field label="Name" htmlFor="cfg-name" error={errors.name} hint="Shown in the domain assign picker. Use something like “node-app-ssl”.">
        <Input
          id="cfg-name"
          value={f.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="my-domain-config"
          aria-invalid={!!errors.name}
          autoFocus={!f.name}
          className="max-w-md"
        />
      </Field>
      <div className="grid gap-5 @2xl:grid-cols-2">
        <Field label="Authoring mode">
          <Segmented
            label="Authoring mode"
            value={f.mode}
            onValueChange={(v) => set("mode", v)}
            options={[
              { value: "auto", label: "UI builder", icon: Layers, description: "Structured form; Configuratix renders the server block per domain." },
              { value: "manual", label: "Raw config", icon: Code2, description: "You write the nginx server block yourself." },
            ]}
          />
        </Field>
        {f.mode === "auto" && (
          <Field label="Proxy layer">
            <Segmented
              label="Proxy layer"
              value={f.isPassthrough ? "l4" : "l7"}
              onValueChange={(v) => set("isPassthrough", v === "l4")}
              options={[
                {
                  value: "l7",
                  label: "L7 reverse proxy",
                  icon: Globe,
                  description: "TLS terminates here with proxy-managed certificates. Locations, CORS, PHP, security rules.",
                },
                {
                  value: "l4",
                  label: "L4 passthrough",
                  icon: Waypoints,
                  description: "Forwards raw TCP/TLS to a backend by SNI without terminating SSL. Advanced.",
                },
              ]}
            />
          </Field>
        )}
      </div>
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

const SETUP_STEP_1 = `server {
    listen 80;
    server_name domain.com;

    location / {
        default_type text/plain;
        return 200 "OK";
    }
}`;

const SETUP_PROXY_PROTOCOL = `server {
    listen 80;
    listen 443 ssl proxy_protocol;
    server_name domain.com;

    # Real IP from PROXY Protocol
    set_real_ip_from 0.0.0.0/0;
    real_ip_header proxy_protocol;

    ssl_certificate /etc/letsencrypt/live/domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/domain.com/privkey.pem;

    location / {
        # Your app config
    }
}`;

function Snippet({ children }: { children: string }) {
  return <pre className="font-data overflow-x-auto rounded-md bg-background/80 p-3 text-[11.5px] leading-relaxed text-foreground/85">{children}</pre>;
}

export function PassthroughSection({ f, set, errors, warnings }: SectionProps) {
  return (
    <EditorSection id="passthrough" title="L4 passthrough" description="Raw TCP/TLS forwarding on the shared :443 stream listener.">
      <Field label="Backend target" htmlFor="pt-target" error={errors.passthroughTarget} hint="The server that handles SSL and serves the content. Format: host:port">
        <Input
          id="pt-target"
          value={f.passthroughTarget}
          onChange={(e) => set("passthroughTarget", e.target.value)}
          placeholder="192.168.1.10:443 or backend.example.com:443"
          className="font-data max-w-md"
          aria-invalid={!!errors.passthroughTarget}
          spellCheck={false}
        />
      </Field>

      <SwitchList>
        <SwitchRow
          id="pt-http"
          title="HTTP routing on port 80"
          description="Routes plain HTTP by Host header to the backend HTTP port. Port 443 passthrough stays enabled."
          checked={f.passthroughHttpEnabled}
          onCheckedChange={(v) => set("passthroughHttpEnabled", v)}
        >
          <Alert variant="info">
            <Network />
            <AlertTitle>Port 80 is a real nginx HTTP proxy</AlertTitle>
            <AlertDescription>
              <p>
                When the domain is proxied through Cloudflare (or any CDN) to this proxy over HTTP (for example with “Allow direct HTTP requests” on the
                backend), all requests hit this port 80 block. Its limits (body size, timeouts) apply before the request reaches the backend, so errors like
                413 Request Entity Too Large come from this proxy, not from the backend. Port 443 passthrough is raw TCP and is not affected.
              </p>
              <p>Changes apply when the domain is (re)applied to the proxy.</p>
            </AlertDescription>
          </Alert>
          <div className="grid gap-5 @lg:grid-cols-2">
            <Field label="Backend HTTP port" htmlFor="pt-port" error={errors.passthroughHttpPort}>
              <Input
                id="pt-port"
                type="number"
                min={1}
                max={65535}
                value={f.passthroughHttpPort}
                onChange={(e) => set("passthroughHttpPort", Number(e.target.value) || 80)}
                className="font-data w-32"
              />
            </Field>
            <Field
              label="Max request body size"
              htmlFor="pt-body"
              warning={warnings.passthroughHttpBodySize}
              hint={
                <>
                  <Code>client_max_body_size</Code>. Empty uses 100M, 0 disables the limit.
                </>
              }
            >
              <Input
                id="pt-body"
                value={f.passthroughHttpBodySize}
                onChange={(e) => set("passthroughHttpBodySize", e.target.value)}
                placeholder="100M"
                className="font-data w-40"
              />
            </Field>
          </div>
          <Field
            label="Extra port 80 directives"
            optional
            htmlFor="pt-extra"
            hint={
              <>
                Inserted inside <Code>location /</Code> of the port 80 server block. Invalid directives make <Code>nginx -t</Code> fail; the apply job then
                stops and the previous proxy config is restored.
              </>
            }
          >
            <Textarea
              id="pt-extra"
              value={f.passthroughHttpExtra}
              onChange={(e) => set("passthroughHttpExtra", e.target.value)}
              placeholder={"proxy_buffering off;\nproxy_request_buffering off;"}
              className="font-data min-h-[90px] text-xs"
              spellCheck={false}
            />
          </Field>
        </SwitchRow>

        <SwitchRow
          id="pt-pp"
          title="Send PROXY protocol to HTTPS backends"
          description="The stream module uses one shared :443 listener, so every HTTPS backend on the same proxy must use the same setting."
          checked={f.passthroughProxyProtocol}
          onCheckedChange={(v) => set("passthroughProxyProtocol", v)}
        />
      </SwitchList>

      <Collapsible className="rounded-md bg-warning/[0.06]">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px]">
          <TriangleAlert className="size-4 text-warning" />
          <span className="flex-1 font-medium">Backend setup required</span>
          <span className="text-xs text-muted-foreground">Steps</span>
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 px-3 pt-0.5 pb-3 pl-9 text-xs text-muted-foreground">
          <div className="space-y-1.5">
            <p>
              <span className="text-foreground">Step 1.</span> Create a simple HTTP config on the backend to test and get a certificate:
            </p>
            <Snippet>{SETUP_STEP_1}</Snippet>
          </div>
          <p>
            <span className="text-foreground">Step 2.</span> Run <Code>certbot --nginx -d domain.com</Code>
          </p>
          <div className="space-y-1.5">
            <p>
              <span className="text-foreground">Optional.</span> If PROXY protocol is on, make the backend accept it for HTTPS:
            </p>
            <Snippet>{SETUP_PROXY_PROTOCOL}</Snippet>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function SslSection({ f, set, errors }: SectionProps) {
  return (
    <EditorSection id="ssl" title="SSL / TLS" description="Certificates are issued with Let's Encrypt when the domain is applied.">
      <Field label="Mode">
        <Segmented
          label="SSL mode"
          value={f.sslMode}
          onValueChange={(v) => set("sslMode", v)}
          options={[
            { value: "disabled", label: "Disabled", icon: LockOpen, description: "Port 80 only, no certificate." },
            { value: "allow_http", label: "Allow HTTP", icon: Lock, description: "Serves on both 80 and 443." },
            { value: "redirect_https", label: "Force HTTPS", icon: Lock, description: "Redirects port 80 to 443." },
            { value: "https_only", label: "HTTPS only", icon: ShieldCheck, description: "443 only, no port 80 listener (hardens SSL issuance)." },
          ]}
        />
      </Field>
      {f.sslMode !== "disabled" && (
        <Field label="Certificate email" optional htmlFor="ssl-email" error={errors.sslEmail} hint="Let's Encrypt expiry notices go here.">
          <Input
            id="ssl-email"
            type="email"
            value={f.sslEmail}
            onChange={(e) => set("sslEmail", e.target.value)}
            placeholder="admin@example.com"
            className="max-w-md"
            aria-invalid={!!errors.sslEmail}
          />
        </Field>
      )}
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function ProxySection({ f, set, errors, warnings }: SectionProps) {
  return (
    <EditorSection id="proxy" title="Proxy / real IP" description="Recover the client IP when traffic arrives through a CDN or load balancer.">
      <SwitchRow
        id="proxy-on"
        title="Extract real client IP"
        description={
          <>
            Adds <Code>set_real_ip_from</Code> and <Code>real_ip_header</Code> so logs, bans and rate limits see the visitor, not the proxy.
          </>
        }
        checked={f.proxyEnabled}
        onCheckedChange={(v) => set("proxyEnabled", v)}
      >
        <Field label="Source">
          <Segmented
            label="Real IP source"
            value={f.proxyType}
            onValueChange={(v) => set("proxyType", v as ProxyType)}
            options={[
              { value: "cloudflare", label: "Cloudflare", description: "Trusts Cloudflare ranges and reads CF-Connecting-IP." },
              { value: "proxy_protocol", label: "PROXY protocol", description: "Reads the client IP from the PROXY protocol header." },
              { value: "custom", label: "Custom", description: "Trusts your ranges and reads X-Forwarded-For." },
            ]}
          />
        </Field>
        {f.proxyType === "custom" && (
          <Field label="Trusted IP ranges" htmlFor="proxy-ips" warning={warnings.customTrustedIPs} hint="Comma-separated CIDRs.">
            <Input
              id="proxy-ips"
              value={f.customTrustedIPs}
              onChange={(e) => set("customTrustedIPs", e.target.value)}
              placeholder="10.0.0.0/8, 192.168.0.0/16"
              className="font-data max-w-md"
            />
          </Field>
        )}
        {f.proxyType === "proxy_protocol" && (
          <SwitchRow
            id="proxy-pp-listen"
            title="Use proxy_protocol on listen"
            description="Listens with proxy_protocol on a dedicated port (the upstream L4 proxy sends to it)."
            checked={f.useProxyProtocol}
            onCheckedChange={(v) => set("useProxyProtocol", v)}
          >
            <Field label="Port" htmlFor="proxy-pp-port" error={errors.proxyProtocolPort}>
              <Input
                id="proxy-pp-port"
                type="number"
                value={f.proxyProtocolPort}
                onChange={(e) => set("proxyProtocolPort", parseInt(e.target.value) || 8443)}
                className="font-data w-28"
              />
            </Field>
          </SwitchRow>
        )}
      </SwitchRow>
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function PhpSection({ f, set }: SectionProps) {
  const staticCount = f.locations.filter((l) => l.type === "static").length;
  return (
    <EditorSection id="php" title="PHP" description="Serve PHP through PHP-FPM from static locations.">
      <SwitchRow
        id="php-on"
        title="Enable PHP-FPM"
        description={
          staticCount > 0
            ? `Applies to ${staticCount} static location${staticCount === 1 ? "" : "s"}: index.php is preferred and a \\.php$ handler is added.`
            : "Only static locations run PHP; add one under Locations."
        }
        checked={f.enablePHP}
        onCheckedChange={(v) => set("enablePHP", v)}
      >
        <p className="text-xs text-muted-foreground">
          Uses the machine&apos;s installed PHP runtime socket (<Code>/run/php/php&lt;version&gt;-fpm.sock</Code>). Install a runtime from the machine&apos;s PHP
          tab.
        </p>
      </SwitchRow>
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function SecuritySection({ f, set }: SectionProps) {
  return (
    <EditorSection id="security" title="Security & headers" description="Hardening defaults, CORS and request blocking.">
      <SwitchList>
        <SwitchRow
          id="sec-autoindex"
          title="Deny directory listing"
          description={<Code>autoindex off;</Code>}
          checked={f.autoindexOff}
          onCheckedChange={(v) => set("autoindexOff", v)}
        />
        <SwitchRow
          id="sec-catchall"
          title="Deny unmatched paths"
          description={
            <>
              Adds <Code>location / {"{ deny all; }"}</Code> when no root location exists.
            </>
          }
          checked={f.denyAllCatchall}
          onCheckedChange={(v) => set("denyAllCatchall", v)}
        />
        <SwitchRow
          id="sec-cors"
          title="CORS headers"
          description="Access-Control-Allow-* headers on every response."
          checked={f.corsEnabled}
          onCheckedChange={(v) => set("corsEnabled", v)}
        >
          <SwitchRow
            id="sec-cors-all"
            title="Allow all origins"
            description="Origin *, methods GET/POST/PUT/DELETE/OPTIONS, any header."
            checked={f.corsAllowAll}
            onCheckedChange={(v) => set("corsAllowAll", v)}
          />
        </SwitchRow>
        <SwitchRow
          id="sec-ua"
          title="User-agent blocking"
          description="Blocks bots and scrapers from the global UA pattern list."
          checked={f.uaBlocking}
          onCheckedChange={(v) => set("uaBlocking", v)}
        />
        <SwitchRow
          id="sec-ep"
          title="Endpoint allowlist"
          description="Bans IPs that request paths outside the allowed patterns under Endpoint rules."
          checked={f.endpointBlocking}
          onCheckedChange={(v) => set("endpointBlocking", v)}
        />
      </SwitchList>
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function EndpointRulesSection({
  enabled,
  rules,
  onAdd,
  onDelete,
  pendingCreate,
}: {
  enabled: boolean;
  rules: SecurityEndpointRule[];
  onAdd: (pattern: string, description: string) => Promise<void>;
  onDelete: (rule: SecurityEndpointRule) => Promise<void>;
  /** True when the config isn't saved yet: rules are created on save. */
  pendingCreate?: boolean;
}) {
  const [pattern, setPattern] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  let regexErr: string | null = null;
  if (pattern.trim()) {
    try {
      new RegExp(pattern.trim());
    } catch {
      regexErr = "Not a valid regular expression";
    }
  }
  const add = async () => {
    if (!pattern.trim() || regexErr) return;
    setBusy(true);
    try {
      await onAdd(pattern.trim(), desc.trim());
      setPattern("");
      setDesc("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorSection
      id="endpoints"
      title="Endpoint rules"
      description={
        <>
          {enabled
            ? "Allowed path patterns (case-insensitive regex on the request URI). Anything else triggers an IP ban."
            : "Turn on “Endpoint allowlist” under Security to enforce these rules."}
          {pendingCreate && " Rules added here are created with the config when you save."}
        </>
      }
    >
      <div className="overflow-hidden rounded-md border border-border">
        {rules.length > 0 && (
          <ul className={cn("divide-y divide-border", !enabled && "opacity-60")}>
            {rules.map((r) => (
              <li key={r.id} className="group flex h-9 items-center gap-3 pr-1.5 pl-3">
                <code className="font-data min-w-0 flex-1 truncate text-[12.5px]">{r.pattern}</code>
                {r.description && <span className="hidden max-w-[40%] truncate text-xs text-muted-foreground sm:inline">{r.description}</span>}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete rule ${r.pattern}`}
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  disabled={deleting === r.id}
                  onClick={async () => {
                    setDeleting(r.id);
                    try {
                      await onDelete(r);
                    } finally {
                      setDeleting(null);
                    }
                  }}
                >
                  {deleting === r.id ? <Spinner /> : <Trash2 />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {rules.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {enabled ? "No rules yet: every path is blocked while the allowlist is on." : "No rules yet."}
          </p>
        )}
        <div className="flex flex-wrap items-start gap-2 border-t border-border bg-surface-2/40 p-2">
          <div className="min-w-[200px] flex-1">
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              placeholder="^/api/.*"
              className="font-data h-8 text-xs"
              aria-label="Pattern"
              aria-invalid={!!regexErr}
              spellCheck={false}
            />
            {regexErr && <p className="mt-1 text-xs text-destructive">{regexErr}</p>}
          </div>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" aria-label="Description" className="h-8 w-44 text-xs" />
          <Button type="button" variant="outline" size="sm" onClick={() => void add()} disabled={!pattern.trim() || !!regexErr || busy}>
            {busy ? <Spinner /> : <Plus />}
            Add rule
          </Button>
        </div>
      </div>
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function LocationsSection({ f, set, errors, warnings, landings }: SectionProps & { landings: Landing[] }) {
  return (
    <EditorSection id="locations" title="Locations" description="Order matters: nginx picks exact matches first, then regexes in order, then the longest prefix.">
      <LocationsEditor
        locations={f.locations}
        onChange={(next) => set("locations", next)}
        landings={landings}
        enablePHP={f.enablePHP}
        errors={errors}
        warnings={warnings}
      />
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function RawSection({ f, set, warnings }: SectionProps) {
  return (
    <EditorSection
      id="raw"
      title="Raw configuration"
      description={
        <>
          Written as-is for each domain; use <Code>$host</Code> or hardcode the server_name. Applies are transactional: if <Code>nginx -t</Code> fails, the
          previous config is restored.
        </>
      }
    >
      <div className="h-[calc(100svh-280px)] min-h-[480px] overflow-hidden rounded-md border border-border">
        <NginxMonaco value={f.rawText} onChange={(v) => set("rawText", v)} />
      </div>
      {warnings.rawText && <p className="text-xs text-warning">{warnings.rawText}</p>}
    </EditorSection>
  );
}
