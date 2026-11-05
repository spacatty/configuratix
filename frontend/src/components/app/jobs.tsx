"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, ListChecks, Server } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { api, type Job } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import { isJobActive, jobDurationMs, jobMachineLabel, jobTitle } from "@/lib/jobs";
import { usePolling } from "@/hooks/use-polling";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge, StatusDot } from "@/components/app/status";
import { CopyButton, KeyValueList, Mono, RelativeTime } from "@/components/app/data-display";
import { LogViewer } from "@/components/app/log-viewer";
import { EmptyState, ErrorState, Spinner } from "@/components/app/states";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** Anything an API might hand back for a created job. */
export type JobRef = Job | { id: string } | { job_id: string } | string;

export interface TrackJobOptions {
  /** Toast title. Defaults to job.title ?? humanizeJobType(job.type). */
  title?: string;
  /** Extra line under the status (e.g. machine name). */
  description?: string;
  /** Fired once when the job reaches a terminal state. */
  onDone?: (job: Job) => void;
  onSuccess?: (job: Job) => void;
  onFailure?: (job: Job) => void;
  /** Poll interval (ms). Default 1500. */
  intervalMs?: number;
  /** Stop polling after this long (ms). Default 15 min. */
  timeoutMs?: number;
  /** Don't show a toast on success (still shows on failure). */
  quietSuccess?: boolean;
}

export interface JobTrackerApi {
  /** Toast with live status; resolves with the final job (or last seen job on timeout). */
  trackJob: (job: JobRef, options?: TrackJobOptions) => Promise<Job | null>;
  /** Open the job logs sheet. */
  openJobLogs: (job: JobRef) => void;
  /** Ids currently being tracked. */
  trackedIds: string[];
}

function refId(ref: JobRef): string | null {
  if (!ref) return null;
  if (typeof ref === "string") return ref;
  if ("id" in ref && ref.id) return ref.id;
  if ("job_id" in ref && ref.job_id) return ref.job_id;
  return null;
}
function refJob(ref: JobRef): Job | null {
  return typeof ref === "object" && ref && "status" in ref && "type" in ref ? (ref as Job) : null;
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

const JobTrackerContext = React.createContext<JobTrackerApi | null>(null);
let globalApi: JobTrackerApi | null = null;

/**
 * Mount once in the dashboard layout (inside the Toaster's tree).
 * Provides `useJobTracker()` and powers the module-level `trackJob()`.
 */
export function JobTrackerProvider({ children }: { children: React.ReactNode }) {
  const [sheetJob, setSheetJob] = React.useState<{ id: string; initial: Job | null } | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [tracked, setTracked] = React.useState<string[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  React.useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach((x) => clearTimeout(x));
      t.clear();
    };
  }, []);

  const openJobLogs = React.useCallback((ref: JobRef) => {
    const id = refId(ref);
    if (!id) return;
    setSheetJob({ id, initial: refJob(ref) });
    setSheetOpen(true);
  }, []);

  const trackJob = React.useCallback(
    (ref: JobRef, options: TrackJobOptions = {}): Promise<Job | null> => {
      const id = refId(ref);
      if (!id) {
        toast.error(options.title ?? "Job could not be tracked", { description: "The server returned no job id." });
        return Promise.resolve(null);
      }
      const interval = options.intervalMs ?? 1500;
      const timeout = options.timeoutMs ?? 15 * 60 * 1000;
      const startedAt = Date.now();
      const toastId = `job:${id}`;
      let last: Job | null = refJob(ref);
      const title = () => options.title ?? (last ? jobTitle(last) : "Job");
      const action = { label: "View logs", onClick: () => openJobLogs(last ?? id) };

      setTracked((t) => (t.includes(id) ? t : [...t, id]));

      const describe = (j: Job | null) => {
        const parts: string[] = [];
        if (options.description) parts.push(options.description);
        else if (j && jobMachineLabel(j)) parts.push(jobMachineLabel(j)!);
        if (!j || j.status === "pending") parts.push("Queued — waiting for agent");
        else if (j.status === "running") {
          const d = jobDurationMs(j);
          parts.push(d !== null ? `Running · ${formatDuration(d)}` : "Running");
        }
        return parts.join(" · ");
      };

      const showActive = (j: Job | null) =>
        toast.loading(title(), { id: toastId, description: describe(j), action, duration: Infinity });

      showActive(last);

      return new Promise<Job | null>((resolve) => {
        const done = (j: Job | null) => {
          timers.current.delete(id);
          setTracked((t) => t.filter((x) => x !== id));
          resolve(j);
        };

        const tick = async () => {
          try {
            const j = await api.getJob(id);
            last = j;
            if (isJobActive(j)) {
              if (Date.now() - startedAt > timeout) {
                toast.warning(title(), {
                  id: toastId,
                  description: "Still running — stopped watching. Check the jobs page.",
                  action,
                  duration: 10_000,
                });
                return done(j);
              }
              showActive(j);
              timers.current.set(id, setTimeout(tick, interval));
              return;
            }
            const d = jobDurationMs(j);
            const machine = options.description ?? jobMachineLabel(j);
            if (j.status === "completed") {
              if (options.quietSuccess) toast.dismiss(toastId);
              else
                toast.success(title(), {
                  id: toastId,
                  description: [machine, d !== null ? `Completed in ${formatDuration(d)}` : "Completed"].filter(Boolean).join(" · "),
                  action,
                  duration: 6000,
                });
              options.onSuccess?.(j);
            } else if (j.status === "cancelled") {
              toast.info(title(), { id: toastId, description: "Cancelled", action, duration: 6000 });
              options.onFailure?.(j);
            } else {
              toast.error(title(), {
                id: toastId,
                description: j.error_message || [machine, "Failed — open logs for details"].filter(Boolean).join(" · "),
                action,
                duration: 15_000,
              });
              options.onFailure?.(j);
            }
            options.onDone?.(j);
            done(j);
          } catch (e) {
            // transient error: retry with backoff, give up at timeout
            if (Date.now() - startedAt > timeout) {
              toast.error(title(), {
                id: toastId,
                description: e instanceof Error ? e.message : "Lost track of job",
                action,
              });
              return done(last);
            }
            timers.current.set(id, setTimeout(tick, interval * 2));
          }
        };

        timers.current.set(id, setTimeout(tick, last && !isJobActive(last) ? 0 : 600));
      });
    },
    [openJobLogs]
  );

  const value = React.useMemo<JobTrackerApi>(() => ({ trackJob, openJobLogs, trackedIds: tracked }), [trackJob, openJobLogs, tracked]);

  React.useEffect(() => {
    globalApi = value;
    return () => {
      if (globalApi === value) globalApi = null;
    };
  }, [value]);

  return (
    <JobTrackerContext.Provider value={value}>
      {children}
      {sheetJob && (
        <JobLogsSheet
          jobId={sheetJob.id}
          initialJob={sheetJob.initial}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      )}
    </JobTrackerContext.Provider>
  );
}

export function useJobTracker(): JobTrackerApi {
  const ctx = React.useContext(JobTrackerContext);
  if (!ctx) throw new Error("useJobTracker must be used inside <JobTrackerProvider>");
  return ctx;
}

/**
 * Module-level helper for code that can't easily use the hook.
 *   const job = await api.changeSSHPort(id, 2222);
 *   trackJob(job, { title: "Change SSH port", onSuccess: reload });
 */
export function trackJob(job: JobRef, options?: TrackJobOptions): Promise<Job | null> {
  if (!globalApi) {
    toast.message(options?.title ?? "Job queued");
    return Promise.resolve(null);
  }
  return globalApi.trackJob(job, options);
}

export function openJobLogs(job: JobRef) {
  globalApi?.openJobLogs(job);
}

/* -------------------------------------------------------------------------- */
/* JobLogsSheet                                                               */
/* -------------------------------------------------------------------------- */

export interface JobLogsSheetProps {
  jobId: string;
  initialJob?: Job | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Right-side sheet: job title, status, timings, logs (live while running) and payload. */
export function JobLogsSheet({ jobId, initialJob, open, onOpenChange }: JobLogsSheetProps) {
  const [job, setJob] = React.useState<Job | null>(initialJob ?? null);
  const active = !job || isJobActive(job);
  const { data, error, loading, refresh } = usePolling(() => api.getJob(jobId), active ? 1500 : 0, {
    enabled: open,
    deps: [jobId],
  });

  React.useEffect(() => {
    setJob(initialJob ?? null);
  }, [jobId, initialJob]);
  React.useEffect(() => {
    if (data) setJob(data);
  }, [data]);

  const payload = React.useMemo(() => {
    if (!job?.payload_json) return "";
    try {
      const v = typeof job.payload_json === "string" ? JSON.parse(job.payload_json) : job.payload_json;
      return JSON.stringify(v, null, 2);
    } catch {
      return String(job.payload_json);
    }
  }, [job?.payload_json]);

  const duration = job ? jobDurationMs(job) : null;
  const machine = job ? jobMachineLabel(job) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            {job ? <StatusBadge status={job.status} /> : <Spinner className="size-3.5 text-muted-foreground" />}
            <span className="font-data text-[11px] text-subtle-foreground">{jobId.slice(0, 8)}</span>
            <CopyButton value={jobId} label="Copy job ID" />
          </div>
          <SheetTitle className="pt-1">{job ? jobTitle(job) : "Loading job…"}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {machine && (
              <span className="inline-flex items-center gap-1.5">
                <Server className="size-3" />
                {job?.machine_id ? (
                  <Link href={`/machines/${job.machine_id}`} className="hover:text-foreground">
                    {machine}
                  </Link>
                ) : (
                  machine
                )}
              </span>
            )}
            {job && (
              <span>
                <Mono muted>{job.type}</Mono>
              </span>
            )}
            {job?.triggered_by && <span>by {job.triggered_by}</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {error && !job ? (
            <ErrorState error={error} onRetry={refresh} title="Could not load job" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
                {[
                  ["Created", job?.created_at],
                  ["Started", job?.started_at],
                  ["Finished", job?.finished_at],
                ].map(([label, v]) => (
                  <div key={label as string} className="bg-card px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="mt-0.5 text-[12.5px]">
                      {v ? <RelativeTime date={v as string} /> : <span className="text-muted-foreground">—</span>}
                    </div>
                  </div>
                ))}
                <div className="bg-card px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Duration</div>
                  <div className={cn("font-data mt-0.5 text-[12.5px]", job?.status === "running" && "text-info")}>
                    {formatDuration(duration)}
                  </div>
                </div>
              </div>

              {job?.error_message && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/[0.07] px-3 py-2.5 text-[13px]">
                  <div className="text-xs font-medium text-destructive">Error</div>
                  <div className="font-data mt-1 text-xs break-words whitespace-pre-wrap">{job.error_message}</div>
                </div>
              )}

              <Tabs defaultValue="logs" className="min-h-0 flex-1 gap-3">
                <TabsList>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                  <TabsTrigger value="payload">Payload</TabsTrigger>
                  <TabsTrigger value="details">Details</TabsTrigger>
                </TabsList>
                <TabsContent value="logs" className="min-h-0">
                  <LogViewer
                    logs={job?.logs}
                    live={!!job && isJobActive(job)}
                    maxHeight="calc(100vh - 360px)"
                    emptyText={loading ? "Loading…" : job && isJobActive(job) ? "Waiting for output…" : "This job produced no output."}
                  />
                </TabsContent>
                <TabsContent value="payload">
                  <LogViewer logs={payload} title="payload.json" maxHeight="calc(100vh - 360px)" emptyText="No payload." />
                </TabsContent>
                <TabsContent value="details">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <KeyValueList
                      items={[
                        { label: "Job ID", value: job?.id, mono: true, copy: job?.id },
                        { label: "Type", value: job?.type, mono: true },
                        { label: "Agent ID", value: job?.agent_id, mono: true, copy: job?.agent_id },
                        { label: "Machine", value: machine, hidden: !machine },
                        { label: "Target", value: job?.target, mono: true, hidden: !job?.target },
                        { label: "Triggered by", value: job?.triggered_by, hidden: !job?.triggered_by },
                        { label: "Rollback", value: job?.rollback_status ? <StatusBadge status={job.rollback_status} /> : null, hidden: !job?.rollback_status },
                        { label: "Created", value: formatDateTime(job?.created_at), mono: true },
                        { label: "Started", value: formatDateTime(job?.started_at), mono: true },
                        { label: "Finished", value: formatDateTime(job?.finished_at), mono: true },
                      ]}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* JobsIndicator (top bar)                                                    */
/* -------------------------------------------------------------------------- */

/** Top-bar button: live count of pending/running jobs + popover of recent jobs. */
export function JobsIndicator({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const tracker = React.useContext(JobTrackerContext);
  const { data, loading, error, refresh } = usePolling(() => api.listJobs(), open ? 4000 : 10_000);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // refresh soon after something new is tracked
  const trackedKey = tracker?.trackedIds.join(",") ?? "";
  React.useEffect(() => {
    if (trackedKey) void refresh();
  }, [trackedKey, refresh]);

  const jobs = React.useMemo(
    () => [...(data ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [data]
  );
  const active = jobs.filter(isJobActive);
  const recent = jobs.slice(0, 8);
  const running = active.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${running} active jobs`}
              className={cn("gap-1.5 px-2", running > 0 && "text-foreground", className)}
            >
              {running > 0 ? <StatusDot status="running" /> : <Activity />}
              <span className="font-data text-xs">{running}</span>
              <span className="hidden text-xs sm:inline">{running === 1 ? "job" : "jobs"}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Agent jobs</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            Jobs
            {running > 0 && <span className="font-data text-xs text-info">{running} active</span>}
          </div>
          <Button asChild variant="ghost" size="xs">
            <Link href="/jobs" onClick={() => setOpen(false)}>
              View all <ArrowUpRight />
            </Link>
          </Button>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Spinner className="size-3.5" /> Loading jobs…
            </div>
          ) : error && !data ? (
            <ErrorState size="compact" bordered={false} error={error} onRetry={refresh} />
          ) : recent.length === 0 ? (
            <EmptyState size="compact" icon={ListChecks} title="No jobs yet" description="Actions on machines create jobs that appear here." />
          ) : (
            recent.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  tracker?.openJobLogs(j);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent outline-none"
              >
                <StatusDot status={j.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{jobTitle(j)}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {jobMachineLabel(j) ?? <span className="font-data">{j.agent_id?.slice(0, 8)}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <RelativeTime date={j.created_at} noTooltip className="text-[11px] text-muted-foreground" />
                  {isJobActive(j) ? (
                    <span className="font-data text-[11px] text-info">{formatDuration(jobDurationMs(j))}</span>
                  ) : (
                    <span className="font-data text-[11px] text-subtle-foreground">{formatDuration(jobDurationMs(j))}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
