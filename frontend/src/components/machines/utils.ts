import type { Machine } from "@/lib/api";
import { machineLiveness, type MachineLiveness } from "@/lib/jobs";

/** Group reference embedded in machine list/detail responses (`group_names`). */
export interface MachineGroupRef {
  id: string;
  name: string;
  color?: string | null;
  emoji?: string | null;
}

/**
 * Machine with the fields the backend added for the fleet view. All optional so the UI keeps
 * working against an older backend.
 */
export type FleetMachine = Machine & {
  is_online?: boolean;
  agent_outdated?: boolean;
  agent_update_state?: string | null;
  agent_update_target_version?: string | null;
  agent_last_update_error?: string | null;
  agent_arch?: string | null;
  agent_capabilities?: string[] | null;
  agent_running_job_id?: string | null;
  group_names?: MachineGroupRef[] | null;
  php_installed?: boolean;
  php_version?: string | null;
};

export const UPDATE_IN_PROGRESS = new Set(["pending", "downloading", "verifying", "installing", "restarting"]);

export function isAgentUpdating(m: FleetMachine): boolean {
  return !!m.agent_update_state && UPDATE_IN_PROGRESS.has(m.agent_update_state);
}

export function liveness(m: FleetMachine, now?: number): MachineLiveness {
  return machineLiveness(m as Machine & { is_online?: boolean }, now);
}

export function pct(used: number | null | undefined, total: number | null | undefined): number | null {
  if (!total || total <= 0 || used == null) return null;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

export function memPct(m: Machine): number | null {
  return pct(m.memory_used, m.memory_total);
}
export function diskPct(m: Machine): number | null {
  return pct(m.disk_used, m.disk_total);
}
export function cpuPct(m: Machine): number | null {
  if (!m.last_seen || typeof m.cpu_percent !== "number") return null;
  return Math.max(0, Math.min(100, m.cpu_percent));
}

export type UsageTone = "success" | "warning" | "destructive" | "muted";

export function usageTone(v: number | null | undefined, warn = 75, crit = 90): UsageTone {
  if (v == null) return "muted";
  if (v >= crit) return "destructive";
  if (v >= warn) return "warning";
  return "success";
}

export const toneBg: Record<UsageTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/40",
};
export const toneText: Record<UsageTone, string> = {
  success: "text-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

export function groupRefs(m: FleetMachine): MachineGroupRef[] {
  const g = m.group_names;
  return Array.isArray(g) ? g.filter((x) => x && x.id && x.name) : [];
}

/** Semver-ish compare: returns <0 if a<b. Non-numeric parts compared as strings. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.+-]/);
  const pb = b.replace(/^v/, "").split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Outdated = backend flag, or (fallback) version lower than the latest published agent. */
export function isAgentOutdated(m: FleetMachine, latest?: string | null): boolean {
  if (typeof m.agent_outdated === "boolean") return m.agent_outdated;
  if (!latest || !m.agent_version) return false;
  return compareVersions(m.agent_version, latest) < 0;
}

export const LIVENESS_LABEL: Record<MachineLiveness, string> = { online: "Online", stale: "Stale", offline: "Offline" };

/** Safe unique id for a client-side list key. */
export function hashKey(...parts: Array<string | number | null | undefined>): string {
  return parts.map((p) => String(p ?? "")).join("|");
}
