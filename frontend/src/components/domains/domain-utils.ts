import type { Domain, DomainJobsResponse, HealthCheckPreset, HealthCheckRules, Job } from "@/lib/api";
import type { StatusTone } from "@/components/app";

/* -------------------------------------------------------------------------- */
/* Apex grouping                                                              */
/* -------------------------------------------------------------------------- */

/** Common 2-label public suffixes so `shop.example.co.uk` groups under `example.co.uk`. */
const TWO_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.kr", "co.za", "co.in",
  "com.br", "com.cn", "com.tr", "com.mx", "com.ar", "com.ua", "com.pl", "com.ru",
]);

/** Returns the apex/root domain for grouping (e.g. "sub.sample.com" → "sample.com"). */
export function getApexDomain(fqdn: string): string {
  const parts = fqdn.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length < 2) return fqdn;
  const lastTwo = parts.slice(-2).join(".");
  if (parts.length >= 3 && TWO_LABEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/** Subdomain part before the apex ("a.b.example.com" → "a.b"), or "" for the apex itself. */
export function subdomainPart(fqdn: string): string {
  const apex = getApexDomain(fqdn);
  if (fqdn.toLowerCase() === apex) return "";
  return fqdn.slice(0, fqdn.length - apex.length - 1);
}

/** Sort: by apex, apex itself first in each group, then alphabetically. */
export function sortDomainsByApex<T extends { fqdn: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const apexA = getApexDomain(a.fqdn);
    const apexB = getApexDomain(b.fqdn);
    if (apexA !== apexB) return apexA.localeCompare(apexB);
    const aIsApex = a.fqdn.toLowerCase() === apexA;
    const bIsApex = b.fqdn.toLowerCase() === apexB;
    if (aIsApex !== bIsApex) return aIsApex ? -1 : 1;
    return a.fqdn.localeCompare(b.fqdn);
  });
}

/* -------------------------------------------------------------------------- */
/* Fuzzy config suggestion                                                    */
/* -------------------------------------------------------------------------- */

/** Fuzzy subsequence match of a config name (e.g. `land` matches `Landing Page`). */
export function fuzzyConfigMatch(configName: string | null | undefined, query: string): boolean {
  if (!configName || !query.trim()) return false;
  const nl = configName.toLowerCase();
  const ql = query.toLowerCase().trim();
  if (nl.includes(ql)) return true;
  let i = 0;
  for (const c of nl) {
    if (c === ql[i]) i++;
    if (i >= ql.length) return true;
  }
  return false;
}

/**
 * Suggest a config for a domain: configs whose name fuzzy-matches the domain's
 * leftmost label or the apex's first label ("landing.example.com" → "Landing page").
 */
export function suggestConfigFor<C extends { id: string; name: string }>(fqdn: string, configs: C[]): C | null {
  const sub = subdomainPart(fqdn).split(".")[0];
  const apexLabel = getApexDomain(fqdn).split(".")[0];
  const tokens = [sub, apexLabel].filter((t) => t && t.length >= 3 && t !== "www");
  for (const t of tokens) {
    const exact = configs.find((c) => c.name.toLowerCase().includes(t.toLowerCase()));
    if (exact) return exact;
  }
  for (const t of tokens) {
    const fuzzy = configs.find((c) => fuzzyConfigMatch(c.name, t));
    if (fuzzy) return fuzzy;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Multi-domain paste parsing                                                 */
/* -------------------------------------------------------------------------- */

const FQDN_RE = /^(?=.{1,253}$)(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}[a-z0-9]$/i;

export type ParsedDomainLine =
  | { fqdn: string; status: "ok" }
  | { fqdn: string; status: "duplicate" | "exists" | "invalid"; reason: string };

/** Normalise one pasted token (strip scheme, path, port, trailing dot, whitespace). */
export function normalizeFqdn(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.replace(/[/?#].*$/, "");
  s = s.replace(/:\d+$/, "");
  s = s.replace(/\.$/, "");
  return s;
}

/** Split pasted text on newlines / commas / whitespace and validate each entry. */
export function parseDomainList(text: string, existing: Iterable<string>): ParsedDomainLine[] {
  const known = new Set([...existing].map((x) => x.toLowerCase()));
  const seen = new Set<string>();
  const out: ParsedDomainLine[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (!token.trim()) continue;
    const fqdn = normalizeFqdn(token);
    if (!fqdn) continue;
    if (!FQDN_RE.test(fqdn)) out.push({ fqdn, status: "invalid", reason: "Not a valid hostname" });
    else if (seen.has(fqdn)) out.push({ fqdn, status: "duplicate", reason: "Listed twice" });
    else if (known.has(fqdn)) out.push({ fqdn, status: "exists", reason: "Already added" });
    else out.push({ fqdn, status: "ok" });
    seen.add(fqdn);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Health / apply status                                                      */
/* -------------------------------------------------------------------------- */

export type DomainHealth = "healthy" | "unhealthy" | "unknown" | "unassigned";

export function domainHealth(d: Pick<Domain, "status" | "assigned_machine_id">): DomainHealth {
  if (d.status === "healthy") return "healthy";
  if (d.status === "unhealthy") return "unhealthy";
  if (!d.assigned_machine_id) return "unassigned";
  return "unknown";
}

export const HEALTH_LABEL: Record<DomainHealth, string> = {
  healthy: "Healthy",
  unhealthy: "Unhealthy",
  unknown: "Unknown",
  unassigned: "Unassigned",
};

export type ApplyState = "applied" | "applying" | "pending" | "failed" | "removing" | "out_of_sync" | "none";

export function domainApplyState(d: Domain): ApplyState {
  const s = (d.apply_status ?? "").toLowerCase();
  if (s === "applying" || s === "removing" || s === "pending" || s === "failed") return s;
  if (s === "applied") return d.out_of_sync ? "out_of_sync" : "applied";
  // Older backends: derive from last job + assignment
  const js = (d.last_job_status ?? "").toLowerCase();
  if (js === "running") return "applying";
  if (js === "pending") return "pending";
  if (js === "failed") return "failed";
  if (d.assigned_machine_id && d.config_id) return d.out_of_sync ? "out_of_sync" : js === "completed" ? "applied" : "none";
  return "none";
}

export const APPLY_META: Record<ApplyState, { label: string; tone: StatusTone; pulse: boolean }> = {
  applied: { label: "Applied", tone: "success", pulse: false },
  applying: { label: "Applying", tone: "info", pulse: true },
  pending: { label: "Queued", tone: "muted", pulse: true },
  failed: { label: "Failed", tone: "destructive", pulse: false },
  removing: { label: "Removing", tone: "info", pulse: true },
  out_of_sync: { label: "Out of sync", tone: "warning", pulse: false },
  none: { label: "Not applied", tone: "muted", pulse: false },
};

export function isApplyActive(d: Domain): boolean {
  const s = domainApplyState(d);
  return s === "applying" || s === "pending" || s === "removing";
}

/* -------------------------------------------------------------------------- */
/* Job refs from mutation responses                                           */
/* -------------------------------------------------------------------------- */

/** Pull every job id out of whatever shape a domain mutation returned. */
export function extractJobIds(res: DomainJobsResponse | null | undefined): string[] {
  if (!res || typeof res !== "object") return [];
  const ids = new Set<string>();
  if (res.job?.id) ids.add(res.job.id);
  if (res.job_id) ids.add(res.job_id);
  for (const id of res.job_ids ?? []) if (id) ids.add(id);
  for (const j of res.jobs ?? []) {
    const anyJ = j as { id?: string; job_id?: string };
    const id = anyJ.id ?? anyJ.job_id;
    if (id) ids.add(id);
  }
  return [...ids];
}

/** The "main" job (job / job_id first, else first of jobs). */
export function primaryJob(res: DomainJobsResponse | null | undefined): Job | string | null {
  if (!res) return null;
  if (res.job?.id) return res.job;
  if (res.job_id) return res.job_id;
  const ids = extractJobIds(res);
  return ids[0] ?? null;
}

/** Job ids with server-provided titles (JobCreated carries `title`). */
export function extractJobs(res: DomainJobsResponse | null | undefined): { id: string; title: string | null }[] {
  const titles = new Map<string, string | null>();
  for (const j of res?.jobs ?? []) {
    const anyJ = j as { id?: string; job_id?: string; title?: string | null };
    const id = anyJ.id ?? anyJ.job_id;
    if (id) titles.set(id, anyJ.title ?? null);
  }
  if (res?.job?.id) titles.set(res.job.id, res.job.title ?? titles.get(res.job.id) ?? null);
  return extractJobIds(res).map((id) => ({ id, title: titles.get(id) ?? null }));
}

/* -------------------------------------------------------------------------- */
/* Health check rules                                                         */
/* -------------------------------------------------------------------------- */

export const DEFAULT_CHECK_TIMEOUT = 15;

export const DEFAULT_CHECK_RULES: HealthCheckRules = { path: "/", expected: "200", body_contains: "", timeout_seconds: DEFAULT_CHECK_TIMEOUT };

/** Rules the next check of this domain uses (the preset's when one is attached). */
export function domainCheckRules(d: Domain): HealthCheckRules {
  return {
    path: d.check_path || d.health_check_path || "/",
    expected: d.check_expected || d.health_check_expected || String(d.health_check_expected_status ?? 200),
    body_contains: d.check_body_contains ?? d.health_check_body_contains ?? "",
    timeout_seconds: d.check_timeout_seconds || d.health_check_timeout_seconds || DEFAULT_CHECK_TIMEOUT,
  };
}

/** The domain's own (custom) rules, ignoring any preset. */
export function domainCustomRules(d: Domain): HealthCheckRules {
  return {
    path: d.health_check_path || "/",
    expected: d.health_check_expected || String(d.health_check_expected_status ?? 200),
    body_contains: d.health_check_body_contains ?? "",
    timeout_seconds: d.health_check_timeout_seconds || DEFAULT_CHECK_TIMEOUT,
  };
}

export function presetRules(p: HealthCheckPreset): HealthCheckRules {
  return { path: p.path, expected: p.expected_status, body_contains: p.body_contains ?? "", timeout_seconds: p.timeout_seconds };
}

/** "/health → 2xx · body "ok" · 10s" (timeout only when not the default). */
export function describeRules(r: HealthCheckRules): string {
  const parts = [`${r.path || "/"} → ${r.expected.split(",").join(", ")}`];
  if (r.body_contains) parts.push(`body “${r.body_contains.length > 24 ? `${r.body_contains.slice(0, 24)}…` : r.body_contains}”`);
  if (r.timeout_seconds && r.timeout_seconds !== DEFAULT_CHECK_TIMEOUT) parts.push(`${r.timeout_seconds}s`);
  return parts.join(" · ");
}

/** Mirrors the backend's status spec parser: "200", "200,301-302", "2xx". Returns an error or null. */
export function statusSpecError(spec: string): string | null {
  const tokens = spec.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return "Enter at least one status.";
  for (const t of tokens) {
    let lo: number, hi: number;
    if (/^[1-5]xx$/.test(t)) continue;
    const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(t);
    if (range) {
      lo = Number(range[1]);
      hi = Number(range[2]);
      if (lo > hi) return `“${t}” is not a valid range.`;
    } else if (/^\d{3}$/.test(t)) {
      lo = hi = Number(t);
    } else {
      return `“${t}” isn't a status. Use 200, 200-299 or 2xx.`;
    }
    if (lo < 100 || hi > 599) return `“${t}” must be between 100 and 599.`;
  }
  return null;
}

export function pathError(path: string): string | null {
  if (!path.startsWith("/") || /\s/.test(path) || path.length > 512) return "Must start with / and contain no spaces.";
  return null;
}

export function rulesError(r: HealthCheckRules): string | null {
  return (
    pathError(r.path) ??
    statusSpecError(r.expected) ??
    (r.timeout_seconds < 1 || r.timeout_seconds > 60 ? "Timeout must be 1–60 seconds." : null) ??
    (r.body_contains.length > 512 ? "Body match is limited to 512 characters." : null)
  );
}

export function sameRules(a: HealthCheckRules, b: HealthCheckRules): boolean {
  return (
    a.path === b.path &&
    a.expected.replace(/\s/g, "") === b.expected.replace(/\s/g, "") &&
    a.body_contains.trim() === b.body_contains.trim() &&
    a.timeout_seconds === b.timeout_seconds
  );
}

/* -------------------------------------------------------------------------- */
/* Apex groups                                                                */
/* -------------------------------------------------------------------------- */

const APEX_GROUP_PREFIX = "apex-group:";

/** Synthetic row grouping subdomains whose apex isn't a domain in the list. */
export function apexGroupRow(apex: string, children: Domain[]): Domain {
  const newest = children.reduce((a, b) => (a.created_at > b.created_at ? a : b));
  return {
    id: APEX_GROUP_PREFIX + apex,
    fqdn: apex,
    assigned_machine_id: null,
    status: "",
    notes_md: null,
    last_check_at: null,
    created_at: newest.created_at,
    updated_at: newest.updated_at,
    machine_name: null,
    machine_ip: null,
    config_id: null,
    config_name: null,
  };
}

export function isApexGroup(d: Pick<Domain, "id">): boolean {
  return d.id.startsWith(APEX_GROUP_PREFIX);
}
