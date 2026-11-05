import type { Job, Machine } from "@/lib/api";
import { durationBetween } from "@/lib/format";

/** Known job type → human label. Unknown types fall back to Title Case. */
const JOB_TYPE_LABELS: Record<string, string> = {
  nginx: "Apply nginx config",
  nginx_site: "Apply nginx site",
  nginx_test_reload: "Test & reload nginx",
  write_nginx_config: "Write nginx config",
  remove_nginx_config: "Remove nginx config",
  remove_domain: "Remove domain",
  apply_domain: "Apply domain",
  issue_certificate: "Issue certificate",
  change_ssh_port: "Change SSH port",
  change_root_password: "Change root password",
  write_sshd_config: "Write sshd config",
  toggle_ufw: "Toggle UFW",
  ufw_allow_port: "Allow port (UFW)",
  ufw_delete_port: "Remove port (UFW)",
  toggle_fail2ban: "Toggle fail2ban",
  restart_service: "Restart service",
  run_command: "Run command",
  exec_command: "Run command",
  write_file: "Write file",
  read_file: "Read file",
  update_agent: "Update agent",
  agent_update: "Update agent",
  install_php_runtime: "Install PHP runtime",
  remove_php_runtime: "Remove PHP runtime",
  switch_php_version: "Switch PHP version",
  sync_php_extensions: "Sync PHP extensions",
  remove_php_extension: "Remove PHP extension",
  restart_php: "Restart PHP-FPM",
  reload_php_version: "Reload PHP",
  network_info: "Network info",
  speedtest_public: "Speed test (public)",
  speedtest_download: "Speed test (download)",
  speedtest_upload: "Speed test (upload)",
  speedtest_latency: "Latency test",
  speedtest_serve: "Speed test server",
  speedtest_iperf_server: "iPerf3 server",
  speedtest_iperf_client: "iPerf3 client",
  speedtest_machine_download: "Machine-to-machine download",
  security_sync: "Sync security rules",
  sync_bans: "Sync IP bans",
};

const ACRONYMS: Record<string, string> = {
  ufw: "UFW",
  ssh: "SSH",
  sshd: "sshd",
  php: "PHP",
  fpm: "FPM",
  ssl: "SSL",
  tls: "TLS",
  dns: "DNS",
  ip: "IP",
  ips: "IPs",
  ua: "UA",
  l7: "L7",
  sni: "SNI",
  http: "HTTP",
  https: "HTTPS",
  api: "API",
  nginx: "nginx",
  iperf: "iPerf",
};

/** "change_ssh_port" → "Change SSH port" */
export function humanizeJobType(type: string | null | undefined): string {
  if (!type) return "Job";
  if (JOB_TYPE_LABELS[type]) return JOB_TYPE_LABELS[type];
  const words = type.split(/[_.\-\s]+/).filter(Boolean);
  return words
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (ACRONYMS[lw]) return ACRONYMS[lw];
      return i === 0 ? lw.charAt(0).toUpperCase() + lw.slice(1) : lw;
    })
    .join(" ");
}

/** Best display title for a job. */
export function jobTitle(job: Pick<Job, "type"> & Partial<Pick<Job, "title">>): string {
  return job.title?.trim() || humanizeJobType(job.type);
}

/** Machine label attached to a job, if the backend sent one. */
export function jobMachineLabel(job: Partial<Job>): string | null {
  return job.machine_title || job.machine_name || null;
}

export function isJobActive(job: Pick<Job, "status"> | null | undefined): boolean {
  return !!job && (job.status === "pending" || job.status === "running");
}

export function isJobFinished(job: Pick<Job, "status"> | null | undefined): boolean {
  return !!job && !isJobActive(job);
}

/** Duration in ms: duration_ms if present, else started→finished (or now while running). */
export function jobDurationMs(job: Job): number | null {
  if (typeof job.duration_ms === "number") return job.duration_ms;
  if (!job.started_at) return null;
  return durationBetween(job.started_at, job.finished_at ?? undefined);
}

/* ------------------------------------------------------------------------ */
/* Machine liveness                                                          */
/* ------------------------------------------------------------------------ */

/** Seen within this window → online. */
export const MACHINE_ONLINE_MS = 2 * 60 * 1000;
/** Seen within this window (but not online) → stale. Older/never → offline. */
export const MACHINE_STALE_MS = 60 * 60 * 1000;

export type MachineLiveness = "online" | "stale" | "offline";

export function machineLiveness(
  m: Pick<Machine, "last_seen"> | { last_seen: string | null | undefined; is_online?: boolean },
  now: number = Date.now()
): MachineLiveness {
  // Backend computes is_online with the authoritative heartbeat threshold.
  if ("is_online" in m && typeof m.is_online === "boolean" && m.is_online) return "online";
  if (!m.last_seen) return "offline";
  const t = new Date(m.last_seen).getTime();
  if (Number.isNaN(t)) return "offline";
  const age = now - t;
  if (age <= MACHINE_ONLINE_MS) return "online";
  if (age <= MACHINE_STALE_MS) return "stale";
  return "offline";
}

export function isMachineOnline(m: Pick<Machine, "last_seen">, now?: number): boolean {
  return machineLiveness(m, now) === "online";
}

/** Display name for a machine: title → hostname → agent_name → short id. */
export function machineDisplayName(
  m: Pick<Machine, "id" | "title" | "hostname"> & Partial<Pick<Machine, "agent_name">>
): string {
  return m.title || m.hostname || m.agent_name || m.id.slice(0, 8);
}

/** Preferred IP for display. */
export function machineIp(m: Pick<Machine, "primary_ip" | "ip_address">): string | null {
  return m.primary_ip || m.ip_address || null;
}

/* ------------------------------------------------------------------------ */
/* Jobs page / sheet helpers (additive)                                      */
/* ------------------------------------------------------------------------ */

export const JOB_STATUSES = ["running", "pending", "failed", "completed", "cancelled"] as const;

export function isJobRetryable(job: { status: string } | null | undefined): boolean {
  return !!job && (job.status === "failed" || job.status === "cancelled");
}

export function isJobCancellable(job: { status: string; cancel_requested?: boolean } | null | undefined): boolean {
  return !!job && (job.status === "pending" || (job.status === "running" && !job.cancel_requested));
}

/** Known logical actions for the jobs filter (value = action id). */
export const JOB_ACTION_OPTIONS: { value: string; label: string; group: string }[] = [
  { value: "apply_domain", label: "Apply domain", group: "Nginx & domains" },
  { value: "remove_domain", label: "Remove domain", group: "Nginx & domains" },
  { value: "apply_nginx_config", label: "Apply nginx config", group: "Nginx & domains" },
  { value: "remove_nginx_config", label: "Remove nginx config", group: "Nginx & domains" },
  { value: "write_nginx_config", label: "Write nginx config", group: "Nginx & domains" },
  { value: "apply_passthrough_domain", label: "Apply passthrough", group: "Nginx & domains" },
  { value: "passthrough_apply", label: "Apply DNS passthrough", group: "Nginx & domains" },
  { value: "passthrough_remove", label: "Remove DNS passthrough", group: "Nginx & domains" },
  { value: "nginx_inventory", label: "Read nginx configuration", group: "Nginx & domains" },
  { value: "nginx_test", label: "Test nginx", group: "Nginx & domains" },
  { value: "nginx_reload", label: "Reload nginx", group: "Nginx & domains" },
  { value: "deploy_landing", label: "Deploy landing", group: "Nginx & domains" },
  { value: "issue_ssl_cert", label: "Issue SSL certificate", group: "Nginx & domains" },
  { value: "install_php_runtime", label: "Install PHP", group: "PHP" },
  { value: "sync_php_extensions", label: "Update PHP extensions", group: "PHP" },
  { value: "remove_php_runtime", label: "Remove PHP", group: "PHP" },
  { value: "write_php_config", label: "Write PHP config", group: "PHP" },
  { value: "change_ssh_port", label: "Change SSH port", group: "Machine" },
  { value: "change_root_password", label: "Change root password", group: "Machine" },
  { value: "toggle_ufw", label: "Toggle UFW", group: "Machine" },
  { value: "ufw_allow_port", label: "UFW allow port", group: "Machine" },
  { value: "ufw_delete_port", label: "UFW delete port", group: "Machine" },
  { value: "toggle_fail2ban", label: "Toggle Fail2ban", group: "Machine" },
  { value: "restart_service", label: "Restart service", group: "Machine" },
  { value: "reload_service", label: "Reload service", group: "Machine" },
  { value: "read_logs", label: "Read logs", group: "Machine" },
  { value: "read_file", label: "Read file", group: "Machine" },
  { value: "exec_command", label: "Run command", group: "Machine" },
  { value: "update_agent", label: "Update agent", group: "Agent" },
];

export const JOB_ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: "domain", label: "Domain" },
  { value: "nginx_config", label: "Nginx config" },
  { value: "machine", label: "Machine" },
  { value: "passthrough", label: "Passthrough" },
  { value: "php_runtime", label: "PHP runtime" },
  { value: "landing", label: "Landing" },
  { value: "dns_domain", label: "DNS domain" },
  { value: "command", label: "Command" },
  { value: "file", label: "File" },
  { value: "agent", label: "Agent" },
];

/** Text after the last " · " in a title ("Apply nginx config · x.com" → "x.com"). */
export function jobTitleSubject(title: string | null | undefined): string | null {
  if (!title) return null;
  const i = title.lastIndexOf(" · ");
  if (i < 0) return null;
  const s = title.slice(i + 3).trim();
  return s ? s.split(" → ")[0].trim() : null;
}

/** One entry of result_json.steps (agent result.structured). */
export interface JobStepResult {
  index: number;
  id?: string;
  name: string;
  action: string;
  status: "ok" | "failed" | "skipped" | string;
  exit_code: number;
  duration_ms: number;
  attempts?: number;
  output_tail?: string;
  error?: string;
  continued_on_error?: boolean;
  data?: unknown;
}

export interface ParsedJobResult {
  status?: string;
  error?: string;
  durationMs?: number;
  steps: JobStepResult[];
  rolledBack: boolean;
  rollbackLog?: string;
  apply?: { status?: string; reason?: string; disabled?: string[]; reenabled?: string[] };
  data?: unknown;
  /** Keys not understood above (shown raw). */
  extra: Record<string, unknown>;
}

const KNOWN_RESULT_KEYS = new Set(["version", "job_type", "status", "error", "duration_ms", "steps", "rolled_back", "rollback_log", "apply", "data"]);

/** Normalise the free-form result_json of a job. Returns null when there is nothing to show. */
export function parseJobResult(raw: unknown): ParsedJobResult | null {
  if (raw === null || raw === undefined) return null;
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (Array.isArray(v)) {
    return { steps: v.filter((s): s is JobStepResult => !!s && typeof s === "object") as JobStepResult[], rolledBack: false, extra: {} };
  }
  if (typeof v !== "object" || !v) return null;
  const o = v as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(o)) if (!KNOWN_RESULT_KEYS.has(k)) extra[k] = val;
  const apply = o.apply && typeof o.apply === "object" ? (o.apply as ParsedJobResult["apply"]) : undefined;
  return {
    status: typeof o.status === "string" ? o.status : undefined,
    error: typeof o.error === "string" ? o.error : undefined,
    durationMs: typeof o.duration_ms === "number" ? o.duration_ms : undefined,
    steps: Array.isArray(o.steps) ? (o.steps as JobStepResult[]) : [],
    rolledBack: o.rolled_back === true || apply?.status === "rolled_back",
    rollbackLog: typeof o.rollback_log === "string" ? o.rollback_log : undefined,
    apply,
    data: o.data,
    extra,
  };
}

/** Window event fired after a job was cancelled/retried from the UI (pages refresh on it). */
export const JOBS_CHANGED_EVENT = "configuratix:jobs-changed";
export function emitJobsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
}
