import { toast } from "sonner";

import { trackJob, type StatusTone } from "@/components/app";
import type { DomainJobsResponse } from "@/lib/api";

export type DNSProviderId = "cloudflare" | "desec" | "njalla" | "cloudns" | "dnspod";

export interface DNSProviderMeta {
  id: DNSProviderId;
  label: string;
  /** Two-letter monogram for the logo tile. */
  mark: string;
  blurb: string;
  /** Secondary credential (API ID / Auth ID). Absent → not used. */
  idField?: { label: string; placeholder: string; hint?: string };
  tokenField: { label: string; placeholder: string; hint: string };
  docsUrl: string;
  supportsProxied: boolean;
  minTtl?: number;
  /** Shown under the record editor. */
  recordHint?: string;
}

export const DNS_PROVIDERS: DNSProviderMeta[] = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    mark: "CF",
    blurb: "API token with Zone · DNS · Edit",
    tokenField: {
      label: "API token",
      placeholder: "Cloudflare API token",
      hint: "My Profile → API Tokens → Create token → “Edit zone DNS”. Global API keys are not supported.",
    },
    docsUrl: "https://dash.cloudflare.com/profile/api-tokens",
    supportsProxied: true,
    recordHint: "Proxied records are served through Cloudflare (orange cloud).",
  },
  {
    id: "desec",
    label: "deSEC",
    mark: "dS",
    blurb: "Free, DNSSEC-first, privacy-friendly",
    tokenField: { label: "Token", placeholder: "deSEC token", hint: "desec.io → Token management → Add token." },
    docsUrl: "https://desec.io/tokens",
    supportsProxied: false,
    minTtl: 3600,
    recordHint: "deSEC enforces a minimum TTL of 3600s.",
  },
  {
    id: "njalla",
    label: "Njalla",
    mark: "Nj",
    blurb: "Privacy-focused registrar DNS",
    tokenField: { label: "API token", placeholder: "Njalla API token", hint: "njal.la → Settings → API access → Add token." },
    docsUrl: "https://njal.la/settings/api/",
    supportsProxied: false,
  },
  {
    id: "cloudns",
    label: "ClouDNS",
    mark: "CD",
    blurb: "Auth ID + password (API user)",
    idField: { label: "Auth ID", placeholder: "12345", hint: "Use sub-12345 for a sub-user." },
    tokenField: { label: "Auth password", placeholder: "API user password", hint: "Reseller → API settings → add an API user." },
    docsUrl: "https://www.cloudns.net/api-settings/",
    supportsProxied: false,
    recordHint: "The free tier allows 3 zones.",
  },
  {
    id: "dnspod",
    label: "DNSPod",
    mark: "DP",
    blurb: "Tencent DNSPod token (ID + token)",
    idField: { label: "API ID", placeholder: "123456" },
    tokenField: { label: "API token", placeholder: "DNSPod token", hint: "Console → API keys → DNSPod token." },
    docsUrl: "https://console.dnspod.cn/account/token/token",
    supportsProxied: false,
  },
];

export function providerMeta(id: string | null | undefined): DNSProviderMeta | null {
  return DNS_PROVIDERS.find((p) => p.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */

export const NS_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  valid: { label: "NS OK", tone: "success" },
  pending: { label: "NS pending", tone: "warning" },
  invalid: { label: "NS mismatch", tone: "destructive" },
  external: { label: "External NS", tone: "info" },
  unknown: { label: "NS unchecked", tone: "muted" },
};

export function nsMeta(status: string | null | undefined) {
  return NS_STATUS[status ?? "unknown"] ?? NS_STATUS.unknown;
}

export const PROXY_MODE: Record<string, { label: string; short: string; description: string }> = {
  static: { label: "Static DNS", short: "Static", description: "Records are managed directly at the provider." },
  layer7: {
    label: "Layer 7 reverse proxy",
    short: "Layer 7",
    description: "Proxy machines terminate TLS (managed certificates) and forward HTTP(S) to the upstream.",
  },
  separate: {
    label: "Layer 4 passthrough",
    short: "Passthrough",
    description: "Raw TLS is passed through by SNI; each record has its own rotating machine pool.",
  },
  wildcard: {
    label: "Wildcard passthrough",
    short: "Wildcard",
    description: "One rotating pool serves *.domain (and optionally the root).",
  },
};

export function proxyModeMeta(mode: string | null | undefined) {
  return PROXY_MODE[mode ?? "static"] ?? PROXY_MODE.static;
}

export const SYNC_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  synced: { label: "Synced", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  local_only: { label: "Local only", tone: "warning" },
  remote_only: { label: "Remote only", tone: "info" },
  conflict: { label: "Conflict", tone: "destructive" },
  error: { label: "Error", tone: "destructive" },
};

export function syncMeta(status: string | null | undefined) {
  return SYNC_STATUS[status ?? "pending"] ?? { label: status ?? "Pending", tone: "muted" as StatusTone };
}

export const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX"] as const;

export function recordTypeVariant(type: string): "info" | "secondary" | "muted" | "warning" | "outline" {
  switch (type) {
    case "A":
    case "AAAA":
      return "info";
    case "CNAME":
      return "secondary";
    case "MX":
      return "warning";
    case "TXT":
      return "muted";
    default:
      return "outline";
  }
}

export const TTL_PRESETS = [
  { label: "Auto", value: 1 },
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "10 min", value: 600 },
  { label: "1 hour", value: 3600 },
  { label: "1 day", value: 86400 },
];

export function formatTtl(ttl: number | null | undefined): string {
  if (!ttl) return "—";
  if (ttl === 1) return "auto";
  if (ttl % 86400 === 0) return `${ttl / 86400}d`;
  if (ttl % 3600 === 0) return `${ttl / 3600}h`;
  if (ttl % 60 === 0) return `${ttl / 60}m`;
  return `${ttl}s`;
}

export function recordHost(name: string, fqdn: string): string {
  if (!name || name === "@") return fqdn;
  if (name.endsWith(`.${fqdn}`) || name === fqdn) return name;
  return `${name}.${fqdn}`;
}

/** Light validation per type. Returns an error message or null. */
export function validateRecordValue(type: string, value: string): string | null {
  const v = value.trim();
  if (!v) return "Value is required";
  if (type === "A" && !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v)) return "Not an IPv4 address";
  if (type === "AAAA" && !/^[0-9a-f:]+$/i.test(v)) return "Not an IPv6 address";
  if ((type === "CNAME" || type === "MX") && !/^[a-z0-9.-]+\.?$/i.test(v)) return "Not a hostname";
  return null;
}

/** Job ids a mutation may (or may not) return. */
export function jobIdsOf(res: unknown): string[] {
  if (!res || typeof res !== "object") return [];
  const r = res as DomainJobsResponse & { job_ids?: string[] };
  const ids = new Set<string>();
  if (r.job?.id) ids.add(r.job.id);
  if (r.job_id) ids.add(r.job_id);
  for (const id of r.job_ids ?? []) if (id) ids.add(id);
  for (const j of r.jobs ?? []) {
    const anyJ = j as { id?: string; job_id?: string };
    if (anyJ.id ?? anyJ.job_id) ids.add((anyJ.id ?? anyJ.job_id)!);
  }
  return [...ids];
}

/**
 * Track every job in a `{jobs, errors}` response (passthrough apply / L7 issue).
 * Uses the server's job titles; per-machine errors are surfaced in one toast.
 */
export function trackJobsFrom(res: unknown, fallbackTitle: string, onDone?: () => void): number {
  const r = (res ?? {}) as { jobs?: Array<{ id?: string; job_id?: string; title?: string | null }>; errors?: string[] };
  const ids = jobIdsOf(res);
  const titles = new Map<string, string | null | undefined>();
  for (const j of r.jobs ?? []) if (j.id ?? j.job_id) titles.set((j.id ?? j.job_id)!, j.title);
  ids.forEach((id) => trackJob(id, { title: titles.get(id) ?? fallbackTitle, onDone: () => onDone?.() }));
  if (r.errors?.length) toast.warning(`${fallbackTitle}: ${r.errors.length} machine(s) skipped`, { description: r.errors.join("\n") });
  else if (!ids.length) toast.info(`${fallbackTitle}: nothing to do`, { description: "No pool machines needed changes." });
  return ids.length;
}
