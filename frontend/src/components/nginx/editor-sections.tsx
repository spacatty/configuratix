"use client";

import * as React from "react";
import {
  Ban,
  Cloud,
  Code2,
  FileCode,
  FolderX,
  Globe,
  Layers,
  ListFilter,
  Lock,
  LockOpen,
  Network,
  Plus,
  Route,
  ScanEye,
  Shield,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Waypoints,
} from "lucide-react";

import type { Landing, SecurityEndpointRule } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/app/states";
import { Code, EditorSection, Field, SwitchRow } from "@/components/nginx/fields";
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
    <EditorSection id="basics" title="Basics" icon={FileCode} description="Name, how the config is authored, and which layer it proxies at.">
      <Field label="Name" htmlFor="cfg-name" error={errors.name} hint="Shown in the domain assign picker. Use something like “node-app-ssl”.">
        <Input
          id="cfg-name"
          value={f.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="my-domain-config"
          aria-invalid={!!errors.name}
          autoFocus={!f.name}
        />
      </Field>
      <Field label="Authoring mode">
        <RadioGroup value={f.mode} onValueChange={(v) => set("mode", v as NginxFormState["mode"])} className="grid-cols-1 sm:grid-cols-2">
          <RadioCard value="auto" icon={<Layers />} title="UI builder" description="Structured form; Configuratix renders the server block per domain." />
          <RadioCard value="manual" icon={<Code2 />} title="Raw config" description="Write the nginx server block yourself." />
        </RadioGroup>
      </Field>
      {f.mode === "auto" && (
        <Field label="Proxy layer">
          <RadioGroup
            value={f.isPassthrough ? "l4" : "l7"}
            onValueChange={(v) => set("isPassthrough", v === "l4")}
            className="grid-cols-1 sm:grid-cols-2"
          >
            <RadioCard
              value="l7"
              icon={<Globe />}
              title="Layer 7 reverse proxy"
              description="TLS terminates here with proxy-managed certificates. Locations, CORS, PHP, security rules."
            />
            <RadioCard
              value="l4"
              icon={<Waypoints />}
              title="Layer 4 passthrough"
              description="Forward raw TCP/TLS to a backend by SNI, without terminating SSL. Advanced."
            />
          </RadioGroup>
        </Field>
      )}
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function PassthroughSection({ f, set, errors, warnings }: SectionProps) {
  return (
    <EditorSection id="passthrough" title="L4 passthrough" icon={Waypoints} description="Raw TCP/TLS forwarding on the shared :443 stream listener.">
      <Field label="Backend target" htmlFor="pt-target" error={errors.passthroughTarget} hint="The server that handles SSL and serves the content. Format: host:port">
        <Input
          id="pt-target"
          value={f.passthroughTarget}
          onChange={(e) => set("passthroughTarget", e.target.value)}
          placeholder="192.168.1.10:443 or backend.example.com:443"
          className="font-data"
          aria-invalid={!!errors.passthroughTarget}
          spellCheck={false}
        />
      </Field>

      <SwitchRow
        id="pt-http"
        icon={Route}
        title="HTTP routing on port 80"
        description="Routes plain HTTP by Host header to the backend HTTP port. Port 443 passthrough stays enabled."
        checked={f.passthroughHttpEnabled}
        onCheckedChange={(v) => set("passthroughHttpEnabled", v)}
      >
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
        <Field
          label="Max request body size (port 80)"
          htmlFor="pt-body"
          warning={warnings.passthroughHttpBodySize}
          hint={
            <>
              nginx <Code>client_max_body_size</Code>. Empty uses 100M, 0 disables the limit. Number with optional k/m/g suffix.
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
        <Field
          label="Extra port 80 directives"
          optional
          htmlFor="pt-extra"
          hint={
            <>
              Raw directives inserted inside <Code>location /</Code> of the port 80 server block. Invalid directives make <Code>nginx -t</Code> fail; the apply
              job then stops and the previous proxy config is restored.
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
        icon={ScanEye}
        title="Send PROXY protocol to HTTPS backends on this proxy"
        description="The stream module uses one shared :443 listener, so every HTTPS backend on the same proxy must use the same setting."
        checked={f.passthroughProxyProtocol}
        onCheckedChange={(v) => set("passthroughProxyProtocol", v)}
      />

      <Collapsible className="rounded-lg border border-warning/25 bg-warning/[0.05]">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px]">
          <TriangleAlert className="size-4 text-warning" />
          <span className="flex-1 font-medium">Backend setup required</span>
          <span className="text-xs text-muted-foreground group-data-[state=open]:hidden">Show steps</span>
          <span className="hidden text-xs text-muted-foreground group-data-[state=open]:inline">Hide</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t border-warning/20 px-3.5 py-3 text-xs text-muted-foreground">
          <div>
            <p className="mb-1">
              <span className="text-foreground">Step 1.</span> Create a simple HTTP config on the backend to test and get a certificate:
            </p>
            <pre className="font-data overflow-x-auto rounded-md border border-border bg-background/70 p-2.5 text-[11.5px] text-foreground/85">{`server {
    listen 80;
    server_name domain.com;

    location / {
        default_type text/plain;
        return 200 "OK";
    }
}`}</pre>
          </div>
          <p>
            <span className="text-foreground">Step 2.</span> Run <Code>certbot --nginx -d domain.com</Code>
          </p>
          <div>
            <p className="mb-1">
              <span className="text-foreground">Optional.</span> If PROXY protocol is on, make the backend accept it for HTTPS:
            </p>
            <pre className="font-data overflow-x-auto rounded-md border border-border bg-background/70 p-2.5 text-[11.5px] text-foreground/85">{`server {
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
}`}</pre>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function SslSection({ f, set, errors }: SectionProps) {
  return (
    <EditorSection id="ssl" title="SSL / TLS" icon={Lock} description="Certificates are issued with Let's Encrypt when the domain is applied.">
      <RadioGroup value={f.sslMode} onValueChange={(v) => set("sslMode", v)} className="grid-cols-1 sm:grid-cols-2">
        <RadioCard value="disabled" icon={<LockOpen />} title="Disabled" description="Port 80 only, no certificate." />
        <RadioCard value="allow_http" icon={<Lock />} title="Allow HTTP" description="Serve on 80 and 443." />
        <RadioCard value="redirect_https" icon={<Lock />} title="Force HTTPS" description="Redirect 80 → 443." />
        <RadioCard value="https_only" icon={<ShieldCheck />} title="HTTPS only" description="443 only; no port 80 listener (hardens SSL issuance)." />
      </RadioGroup>
      {f.sslMode !== "disabled" && (
        <Field label="Certificate email" optional htmlFor="ssl-email" error={errors.sslEmail} hint="Let's Encrypt expiry notices go here.">
          <Input
            id="ssl-email"
            type="email"
            value={f.sslEmail}
            onChange={(e) => set("sslEmail", e.target.value)}
            placeholder="admin@example.com"
            className="max-w-sm"
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
    <EditorSection id="proxy" title="Proxy / real IP" icon={Cloud} description="Recover the client IP when traffic arrives through a CDN or load balancer.">
      <SwitchRow
        id="proxy-on"
        title="Extract real client IP"
        description="Adds set_real_ip_from + real_ip_header so logs, bans and rate limits see the visitor, not the proxy."
        checked={f.proxyEnabled}
        onCheckedChange={(v) => set("proxyEnabled", v)}
      >
        <RadioGroup value={f.proxyType} onValueChange={(v) => set("proxyType", v as ProxyType)} className="grid-cols-1 md:grid-cols-3">
          <RadioCard value="cloudflare" title="Cloudflare" description="Trust Cloudflare ranges, read CF-Connecting-IP." />
          <RadioCard value="proxy_protocol" title="PROXY protocol" description="Read the IP from the PROXY header." />
          <RadioCard value="custom" title="Custom" description="Trust your ranges, read X-Forwarded-For." />
        </RadioGroup>
        {f.proxyType === "custom" && (
          <Field label="Trusted IP ranges" htmlFor="proxy-ips" warning={warnings.customTrustedIPs} hint="Comma-separated CIDRs.">
            <Input
              id="proxy-ips"
              value={f.customTrustedIPs}
              onChange={(e) => set("customTrustedIPs", e.target.value)}
              placeholder="10.0.0.0/8, 192.168.0.0/16"
              className="font-data"
            />
          </Field>
        )}
        {f.proxyType === "proxy_protocol" && (
          <SwitchRow
            id="proxy-pp-listen"
            title="Use proxy_protocol on listen"
            description="Listen with proxy_protocol on a dedicated port (the upstream L4 proxy sends to it)."
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
    <EditorSection id="php" title="PHP" icon={Code2} description="Serve PHP through PHP-FPM from static locations.">
      <SwitchRow
        id="php-on"
        title="Enable PHP-FPM"
        description={
          staticCount > 0
            ? `Applies to ${staticCount} static location${staticCount === 1 ? "" : "s"}: index.php is preferred and a \\.php$ handler is added.`
            : "Only static locations run PHP — add one under Locations."
        }
        checked={f.enablePHP}
        onCheckedChange={(v) => set("enablePHP", v)}
      />
      {f.enablePHP && (
        <p className="text-xs text-muted-foreground">
          Uses the machine&apos;s installed PHP runtime socket (<Code>/run/php/php&lt;version&gt;-fpm.sock</Code>). Install a runtime from the machine&apos;s PHP tab.
        </p>
      )}
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function SecuritySection({ f, set }: SectionProps) {
  return (
    <EditorSection id="security" title="Security & headers" icon={Shield} description="Hardening defaults, CORS and request blocking.">
      <div className="grid gap-3 md:grid-cols-2">
        <SwitchRow
          id="sec-autoindex"
          icon={FolderX}
          title="Deny directory listing"
          description="autoindex off"
          checked={f.autoindexOff}
          onCheckedChange={(v) => set("autoindexOff", v)}
        />
        <SwitchRow
          id="sec-catchall"
          icon={Ban}
          title="Deny unmatched paths"
          description="Adds location / { deny all; } when no root location exists."
          checked={f.denyAllCatchall}
          onCheckedChange={(v) => set("denyAllCatchall", v)}
        />
      </div>
      <SwitchRow
        id="sec-cors"
        icon={Globe}
        title="CORS headers"
        description="Access-Control-Allow-* headers on every response."
        checked={f.corsEnabled}
        onCheckedChange={(v) => set("corsEnabled", v)}
      >
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-[13px]">Allow all origins</span>
            <span className="block text-xs text-muted-foreground">Origin *, methods GET/POST/PUT/DELETE/OPTIONS, any header.</span>
          </span>
          <SwitchInline checked={f.corsAllowAll} onCheckedChange={(v) => set("corsAllowAll", v)} />
        </label>
      </SwitchRow>
      <div className="grid gap-3 md:grid-cols-2">
        <SwitchRow
          id="sec-ua"
          icon={ScanEye}
          title="User-agent blocking"
          description="Block bots and scrapers from the global UA pattern list."
          checked={f.uaBlocking}
          onCheckedChange={(v) => set("uaBlocking", v)}
        />
        <SwitchRow
          id="sec-ep"
          icon={ListFilter}
          title="Endpoint allowlist"
          description="Ban IPs that request paths outside the allowed patterns."
          checked={f.endpointBlocking}
          onCheckedChange={(v) => set("endpointBlocking", v)}
        />
      </div>
    </EditorSection>
  );
}

function SwitchInline(props: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return <Switch {...props} />;
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
      icon={ListFilter}
      description={
        enabled ? "Allowed path patterns (case-insensitive regex on the request URI). Anything else triggers an IP ban." : "Turn on “Endpoint allowlist” under Security to use these rules."
      }
    >
      {pendingCreate && (
        <p className="text-xs text-muted-foreground">Rules you add here are created together with the config when you save.</p>
      )}
      <div className="overflow-hidden rounded-lg border border-border">
        {rules.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {enabled ? "No rules — every path is blocked while the allowlist is on." : "No rules."}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rules.map((r) => (
              <li key={r.id} className="group flex items-center gap-3 px-3 py-1.5">
                <code className="font-data min-w-0 flex-1 truncate text-[12.5px]">{r.pattern}</code>
                {r.description && <span className="hidden max-w-[40%] truncate text-xs text-muted-foreground sm:inline">{r.description}</span>}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete rule ${r.pattern}`}
                  className="text-destructive opacity-60 group-hover:opacity-100 hover:text-destructive"
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
      </div>
      <div className="flex flex-wrap items-start gap-2">
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
            aria-invalid={!!regexErr}
            spellCheck={false}
          />
          {regexErr && <p className="mt-1 text-xs text-destructive">{regexErr}</p>}
        </div>
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" className="h-8 w-44 text-xs" />
        <Button type="button" variant="outline" size="sm" onClick={() => void add()} disabled={!pattern.trim() || !!regexErr || busy}>
          {busy ? <Spinner /> : <Plus />}
          Add rule
        </Button>
      </div>
    </EditorSection>
  );
}

/* -------------------------------------------------------------------------- */

export function LocationsSection({ f, set, errors, warnings, landings }: SectionProps & { landings: Landing[] }) {
  return (
    <EditorSection
      id="locations"
      title="Locations"
      icon={Route}
      description="Order matters — nginx picks exact matches first, then regexes in order, then the longest prefix."
    >
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
      icon={Code2}
      description="Written as-is for each domain. Applies are transactional: if nginx -t fails, the previous config is restored."
    >
      <div className="h-[560px] overflow-hidden rounded-lg border border-border">
        <NginxMonaco value={f.rawText} onChange={(v) => set("rawText", v)} />
      </div>
      {warnings.rawText && <p className="text-xs text-warning">{warnings.rawText}</p>}
    </EditorSection>
  );
}
