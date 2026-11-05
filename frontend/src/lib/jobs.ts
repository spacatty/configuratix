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
