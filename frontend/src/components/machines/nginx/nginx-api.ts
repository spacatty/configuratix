import { api, type Job, type MachineNginxInventory, type MachineNginxPending } from "@/lib/api";

/** Thin wrappers over the machine nginx / config endpoints (see backend/API_CHANGES.md). */

export class EndpointMissingError extends Error {}

function isRouteMissing(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /404 page not found/i.test(msg);
}

export function isPending(r: MachineNginxInventory | MachineNginxPending | null | undefined): r is MachineNginxPending {
  return !!r && (r as MachineNginxPending).pending === true;
}

export async function fetchNginxInventory(machineId: string, jobId?: string): Promise<MachineNginxInventory | MachineNginxPending> {
  try {
    return await api.getMachineNginx(machineId, jobId);
  } catch (e) {
    if (isRouteMissing(e)) throw new EndpointMissingError("Machine nginx inventory is not available on this backend");
    throw e;
  }
}

/** Polls a pending inventory job until it is parsed (or fails). */
export async function loadNginxInventory(
  machineId: string,
  opts: { signal?: { cancelled: boolean }; onPending?: (jobId: string) => void } = {}
): Promise<MachineNginxInventory> {
  let res = await fetchNginxInventory(machineId);
  let tries = 0;
  while (isPending(res)) {
    if (opts.signal?.cancelled) throw new Error("cancelled");
    opts.onPending?.(res.job_id);
    if (++tries > 30) throw new Error("The agent did not answer in time. Is it online?");
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetchNginxInventory(machineId, res.job_id);
  }
  return res;
}

type JobIdResponse = { job_id?: string; id?: string };

export async function startNginxTest(machineId: string): Promise<string> {
  const r = await api.request<JobIdResponse>(`/api/machines/${machineId}/nginx/test?wait=0`, { method: "POST" });
  return (r.job_id ?? r.id)!;
}

export async function startNginxReload(machineId: string): Promise<string> {
  const r = (await api.reloadMachineNginx(machineId, false)) as JobIdResponse;
  return (r.job_id ?? r.id)!;
}

export interface WriteResult {
  jobId: string | null;
  /** Legacy synchronous backend: result already known. */
  syncSuccess?: boolean;
  logs?: string;
}

/** Writes via the transactional config endpoint (async → job). */
export async function writeConfigFile(machineId: string, path: string, content: string): Promise<WriteResult> {
  const r = await api.request<{ success?: boolean; job_id?: string; logs?: string; error?: string }>(`/api/machines/${machineId}/configs/write`, {
    method: "POST",
    body: JSON.stringify({ path, content, async: true }),
  });
  if (r.job_id && r.logs === undefined) return { jobId: r.job_id };
  return { jobId: r.job_id ?? null, syncSuccess: !!r.success, logs: r.logs ?? r.error };
}

export async function readConfigFile(machineId: string, path: string): Promise<string> {
  const r = await api.readMachineConfig(machineId, path);
  return r.content ?? "";
}

export interface ApplyOutcome {
  status: "applied" | "rolled_back" | "failed" | "cancelled" | "unknown";
  reason?: string;
}

/** Reads CONFIGURATIX_RESULT markers / result_json.apply from a finished job. */
export function applyOutcome(job: Job & { result_json?: unknown }): ApplyOutcome {
  const rj = job.result_json as { apply?: { status?: string; reason?: string } } | null | undefined;
  let status = rj && !Array.isArray(rj) ? rj.apply?.status : undefined;
  let reason = rj && !Array.isArray(rj) ? rj.apply?.reason : undefined;
  if (!status && job.logs) {
    const lines = job.logs.split("\n").filter((l) => l.trim().startsWith("CONFIGURATIX_RESULT|"));
    const last = lines[lines.length - 1];
    if (last) {
      const parts = last.trim().split("|");
      status = parts[1];
      reason = parts.slice(2).join("|") || undefined;
    }
  }
  if (job.status === "cancelled") return { status: "cancelled" };
  if (status === "applied" || status === "removed") return { status: "applied", reason };
  if (status === "rolled_back") return { status: "rolled_back", reason: reason ?? job.error_message ?? undefined };
  if (job.status === "completed") return { status: "applied", reason };
  if (job.status === "failed") return { status: "failed", reason: reason ?? job.error_message ?? undefined };
  return { status: "unknown" };
}

/** nginx -t result from a test/reload job log. */
export function testResultFromLogs(logs: string | null | undefined): { ok: boolean | null; output: string } {
  const text = logs ?? "";
  const rc = text.match(/CFX_NGINX_TEST_RC\|(\d+)/);
  const output = text
    .split("\n")
    .filter((l) => !l.startsWith("CFX_") && !l.startsWith("CONFIGURATIX_RESULT"))
    .join("\n")
    .trim();
  return { ok: rc ? rc[1] === "0" : /test is successful/.test(text) ? true : /test failed|emerg/.test(text) ? false : null, output };
}

/** Strip backup/disabled suffixes: "/x/a.conf.bak" → "/x/a.conf". */
export function originalPathOf(path: string): string {
  for (const s of [".disabled-by-manual", ".disabled", ".configuratix-backup", ".bak", ".backup", ".orig", ".old", "~", ".dpkg-old", ".dpkg-dist", ".dpkg-new"]) {
    if (path.endsWith(s)) return path.slice(0, -s.length);
  }
  // timestamped backups: a.conf.bak.20240101 / a.conf.configuratix-backup.123
  const m = path.match(/^(.*?)\.(?:bak|backup|configuratix-backup)(?:[.-][\w-]+)?$/);
  return m ? m[1] : path;
}
