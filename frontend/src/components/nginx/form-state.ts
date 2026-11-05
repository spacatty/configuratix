import type { LocationConfig, NginxConfig, NginxConfigStructured, SecurityEndpointRule } from "@/lib/api";

export type ProxyType = "cloudflare" | "proxy_protocol" | "custom";

/** Flat editor state for one nginx config (mirrors every field of the structured form). */
export interface NginxFormState {
  name: string;
  /** "auto" = structured (UI builder), "manual" = raw text. */
  mode: "auto" | "manual";
  rawText: string;

  // L4 passthrough
  isPassthrough: boolean;
  passthroughTarget: string;
  passthroughHttpEnabled: boolean;
  passthroughHttpPort: number;
  passthroughProxyProtocol: boolean;
  passthroughHttpBodySize: string;
  passthroughHttpExtra: string;

  // L7
  sslMode: string;
  sslEmail: string;
  corsEnabled: boolean;
  corsAllowAll: boolean;
  enablePHP: boolean;
  autoindexOff: boolean;
  denyAllCatchall: boolean;
  locations: LocationConfig[];

  // Proxy / real IP
  proxyEnabled: boolean;
  proxyType: ProxyType;
  useProxyProtocol: boolean;
  proxyProtocolPort: number;
  customTrustedIPs: string;

  // Security
  uaBlocking: boolean;
  endpointBlocking: boolean;
}

export const DEFAULT_LOCATION: LocationConfig = { path: "/", match_type: "prefix", type: "proxy", proxy_url: "" };

export function defaultFormState(): NginxFormState {
  return {
    name: "",
    mode: "auto",
    rawText: "",
    isPassthrough: false,
    passthroughTarget: "",
    passthroughHttpEnabled: true,
    passthroughHttpPort: 80,
    passthroughProxyProtocol: false,
    passthroughHttpBodySize: "",
    passthroughHttpExtra: "",
    sslMode: "allow_http",
    sslEmail: "",
    corsEnabled: true,
    corsAllowAll: true,
    enablePHP: false,
    autoindexOff: true,
    denyAllCatchall: true,
    locations: [{ ...DEFAULT_LOCATION }],
    proxyEnabled: false,
    proxyType: "cloudflare",
    useProxyProtocol: false,
    proxyProtocolPort: 8443,
    customTrustedIPs: "",
    uaBlocking: false,
    endpointBlocking: false,
  };
}

/** Build editor state from a saved config (same defaults as the legacy dialog). */
export function stateFromConfig(config: NginxConfig): NginxFormState {
  const s = defaultFormState();
  s.name = config.name;
  s.mode = config.mode === "manual" ? "manual" : "auto";
  s.rawText = config.raw_text || "";
  const st = config.structured_json as NginxConfigStructured | null;
  if (st) {
    s.isPassthrough = st.is_passthrough ?? false;
    s.passthroughTarget = st.passthrough_target || "";
    s.passthroughHttpEnabled = st.passthrough_http_enabled ?? true;
    s.passthroughHttpPort = st.passthrough_http_port ?? 80;
    s.passthroughProxyProtocol = st.passthrough_proxy_protocol ?? false;
    s.passthroughHttpBodySize = st.passthrough_http_client_max_body_size || "";
    s.passthroughHttpExtra = st.passthrough_http_extra_directives || "";
    s.sslMode = st.ssl_mode || "allow_http";
    s.sslEmail = st.ssl_email || "";
    s.corsEnabled = st.cors?.enabled ?? true;
    s.corsAllowAll = st.cors?.allow_all ?? true;
    s.autoindexOff = st.autoindex_off ?? true;
    s.denyAllCatchall = st.deny_all_catchall ?? true;
    s.locations = st.locations && st.locations.length ? st.locations.map((l) => ({ ...l })) : [{ ...DEFAULT_LOCATION }];
    s.enablePHP = st.locations?.some((l) => l.use_php) ?? false;
    s.proxyEnabled = st.proxy_settings?.enabled ?? false;
    s.proxyType = st.proxy_settings?.proxy_type || "cloudflare";
    s.useProxyProtocol = st.proxy_settings?.use_proxy_protocol ?? false;
    s.proxyProtocolPort = st.proxy_settings?.proxy_protocol_port || 8443;
    s.customTrustedIPs = st.proxy_settings?.custom_trusted_ips || "";
    s.uaBlocking = st.ua_blocking_enabled ?? false;
    s.endpointBlocking = st.endpoint_blocking_enabled ?? false;
  }
  return s;
}

/** True when the structured json has its own security flags (else the security API is authoritative). */
export function hasStructuredSecurityFlags(config: NginxConfig): boolean {
  const st = config.structured_json as NginxConfigStructured | null;
  return st?.ua_blocking_enabled !== undefined || st?.endpoint_blocking_enabled !== undefined;
}

/** Editor state → structured_json (identical rules to the legacy create/update handlers). */
export function structuredFromState(f: NginxFormState): NginxConfigStructured {
  const locationsWithPHP = f.locations.map((loc) => ({ ...loc, use_php: loc.type === "static" ? f.enablePHP : false }));
  return {
    is_passthrough: f.isPassthrough,
    passthrough_target: f.isPassthrough ? f.passthroughTarget : undefined,
    passthrough_http_enabled: f.isPassthrough ? f.passthroughHttpEnabled : undefined,
    passthrough_http_port: f.isPassthrough ? f.passthroughHttpPort : undefined,
    passthrough_proxy_protocol: f.isPassthrough ? f.passthroughProxyProtocol : undefined,
    passthrough_http_client_max_body_size: f.isPassthrough ? f.passthroughHttpBodySize.trim() || undefined : undefined,
    passthrough_http_extra_directives: f.isPassthrough ? f.passthroughHttpExtra.trim() || undefined : undefined,
    ssl_mode: f.sslMode,
    ssl_email: f.sslEmail || undefined,
    locations: f.isPassthrough ? [] : locationsWithPHP,
    cors: f.isPassthrough ? null : { enabled: f.corsEnabled, allow_all: f.corsAllowAll },
    autoindex_off: f.isPassthrough ? undefined : f.autoindexOff,
    deny_all_catchall: f.isPassthrough ? undefined : f.denyAllCatchall,
    proxy_settings: f.proxyEnabled
      ? {
          enabled: f.proxyEnabled,
          proxy_type: f.proxyType,
          use_proxy_protocol: f.useProxyProtocol,
          proxy_protocol_port: f.proxyProtocolPort,
          custom_trusted_ips: f.customTrustedIPs,
        }
      : undefined,
    ua_blocking_enabled: f.uaBlocking,
    endpoint_blocking_enabled: f.endpointBlocking,
  };
}

/** Payload for create/update. */
export function payloadFromState(f: NginxFormState) {
  return {
    name: f.name.trim(),
    mode: f.mode,
    structured_json: f.mode === "auto" ? structuredFromState(f) : undefined,
    raw_text: f.mode === "manual" ? f.rawText : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type FieldErrors = Partial<Record<string, string>>;

const HOST_PORT = /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):(\d{1,5})$/;
const BODY_SIZE = /^\d+[kKmMgG]?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidBodySize(v: string) {
  return v.trim() === "" || BODY_SIZE.test(v.trim());
}

/** Errors block saving; warnings are shown inline only. */
export function validateForm(f: NginxFormState): { errors: FieldErrors; warnings: FieldErrors } {
  const errors: FieldErrors = {};
  const warnings: FieldErrors = {};
  if (!f.name.trim()) errors.name = "Name is required";
  if (f.mode === "manual") {
    if (!f.rawText.trim()) warnings.rawText = "The raw config is empty";
    else {
      const open = (f.rawText.match(/{/g) ?? []).length;
      const close = (f.rawText.match(/}/g) ?? []).length;
      if (open !== close) warnings.rawText = `Unbalanced braces: ${open} “{” vs ${close} “}”`;
    }
    return { errors, warnings };
  }
  if (f.isPassthrough) {
    if (!f.passthroughTarget.trim()) errors.passthroughTarget = "Backend target is required (host:port)";
    else {
      const m = HOST_PORT.exec(f.passthroughTarget.trim());
      if (!m) errors.passthroughTarget = "Use host:port, e.g. 10.0.0.5:443";
      else if (Number(m[2]) < 1 || Number(m[2]) > 65535) errors.passthroughTarget = "Port must be 1–65535";
    }
    if (f.passthroughHttpEnabled && (f.passthroughHttpPort < 1 || f.passthroughHttpPort > 65535)) errors.passthroughHttpPort = "Port must be 1–65535";
    if (!isValidBodySize(f.passthroughHttpBodySize)) warnings.passthroughHttpBodySize = "Invalid size, 100M will be used.";
    return { errors, warnings };
  }
  if (f.sslMode !== "disabled" && f.sslEmail && !EMAIL.test(f.sslEmail)) errors.sslEmail = "Not a valid email";
  if (f.proxyEnabled && f.proxyType === "custom" && !f.customTrustedIPs.trim()) warnings.customTrustedIPs = "No trusted ranges — real IP won't be extracted";
  if (f.proxyEnabled && f.proxyType === "proxy_protocol" && f.useProxyProtocol && (f.proxyProtocolPort < 1 || f.proxyProtocolPort > 65535))
    errors.proxyProtocolPort = "Port must be 1–65535";
  const seen = new Set<string>();
  f.locations.forEach((l, i) => {
    const key = `${l.match_type || "prefix"}:${l.path}`;
    if (!l.path.trim()) errors[`loc.${i}.path`] = "Path is required";
    else if ((l.match_type ?? "prefix") !== "regex" && !l.path.startsWith("/") && !l.path.startsWith("@")) errors[`loc.${i}.path`] = "Path must start with /";
    else if ((l.match_type ?? "prefix") === "regex") {
      try {
        new RegExp(l.path);
      } catch {
        warnings[`loc.${i}.path`] = "Regex looks invalid";
      }
    }
    if (seen.has(key)) errors[`loc.${i}.path`] = "Duplicate location";
    seen.add(key);
    if (l.type === "proxy") {
      if (!l.proxy_url?.trim()) warnings[`loc.${i}.proxy_url`] = "No upstream — this location will be empty";
      else if (!/^https?:\/\/\S+$/.test(l.proxy_url.trim())) errors[`loc.${i}.proxy_url`] = "Must start with http:// or https://";
    } else if (l.static_type === "landing" && !l.landing_id) {
      warnings[`loc.${i}.landing_id`] = "Pick the static content to deploy";
    }
  });
  if (f.endpointBlocking) {
    /* rule list validated by the server */
  }
  return { errors, warnings };
}

/** Section a field error belongs to (for the nav error dots). */
export function sectionOfField(key: string): string {
  if (key === "name" || key === "rawText") return key === "name" ? "basics" : "raw";
  if (key.startsWith("passthrough")) return "passthrough";
  if (key === "sslEmail") return "ssl";
  if (key.startsWith("proxy") || key === "customTrustedIPs") return "proxy";
  if (key.startsWith("loc.")) return "locations";
  return "basics";
}

/** Endpoint rule not yet persisted (create flow). */
export type PendingEndpointRule = SecurityEndpointRule & { pending?: true };

export const SSL_MODE_LABELS: Record<string, string> = {
  disabled: "Disabled",
  allow_http: "Allow HTTP",
  redirect_https: "Force HTTPS",
  https_only: "HTTPS only",
};
