"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, ListChecks } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { api, type Job, type JobCreated, type JobListItem } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { JOBS_CHANGED_EVENT, isJobActive, jobDurationMs, jobMachineLabel, jobTitle } from "@/lib/jobs";
import { usePolling } from "@/hooks/use-polling";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge, StatusDot } from "@/components/app/status";
import { CopyButton, RelativeTime } from "@/components/app/data-display";
import { EmptyState, ErrorState, Spinner } from "@/components/app/states";
import {
  JobActionButtons,
  JobDetailBody,
  JobHeaderMeta,
  JobPageLink,
  toJobView,
  useJobDetail,
  useNow,
} from "@/components/jobs/job-detail";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** Anything an API might hand back for a created job. */
export type JobRef = Job | JobListItem | JobCreated | { id: string } | { job_id: string } | string;

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
  initialJob?: Job | JobListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Right-side sheet: title, status, timings, apply outcome (applied / rolled back),
 * structured step results, live logs, redacted payload, cancel / retry.
 */
export function JobLogsSheet({ jobId, initialJob, open, onOpenChange }: JobLogsSheetProps) {
  const tracker = React.useContext(JobTrackerContext);
  const { job, error, loading, refresh } = useJobDetail(jobId, toJobView(initialJob), open);

  const onRetried = React.useCallback(
    (created: JobCreated) => {
      if (!tracker) return;
      void tracker.trackJob(created, { title: created.title ?? undefined });
      tracker.openJobLogs(created.id);
    },
    [tracker]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="pr-12">
          <div className="flex items-center gap-2">
            {job ? <StatusBadge status={job.status} /> : <Spinner className="size-3.5 text-muted-foreground" />}
            <span className="font-data text-[11px] text-subtle-foreground">{jobId.slice(0, 8)}</span>
            <CopyButton value={jobId} label="Copy job ID" />
            <div className="ml-auto flex items-center gap-1.5">
              <JobActionButtons job={job} onRetried={onRetried} onChanged={() => void refresh()} size="xs" />
              <JobPageLink id={jobId} onNavigate={() => onOpenChange(false)} />
            </div>
          </div>
          <SheetTitle className="pt-1 leading-snug">{job ? jobTitle(job) : "Loading job…"}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <JobHeaderMeta job={job} />
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          <JobDetailBody
            job={job}
            loading={loading}
            error={error}
            onRetry={refresh}
            paneHeight="calc(100vh - 400px)"
            onOpenJob={(id) => tracker?.openJobLogs(id)}
          />
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
  const { data, loading, error, refresh } = usePolling(() => api.listJobsPage({ limit: 8 }), open ? 4000 : 10_000);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // refresh soon after something new is tracked / cancelled / retried
  const trackedKey = tracker?.trackedIds.join(",") ?? "";
  React.useEffect(() => {
    if (trackedKey) void refresh();
  }, [trackedKey, refresh]);
  React.useEffect(() => {
    const h = () => void refresh();
    window.addEventListener(JOBS_CHANGED_EVENT, h);
    return () => window.removeEventListener(JOBS_CHANGED_EVENT, h);
  }, [refresh]);

  const recent = data?.jobs ?? [];
  const running = data?.counts ? (data.counts.running ?? 0) + (data.counts.pending ?? 0) : recent.filter(isJobActive).length;
  const now = useNow(open && recent.some((j) => j.status === "running"));

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
      <PopoverContent align="end" className="w-[400px] p-0">
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
        <div className="max-h-[380px] overflow-y-auto p-1">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Spinner className="size-3.5" /> Loading jobs…
            </div>
          ) : error && !data ? (
            <ErrorState size="compact" bordered={false} error={error} onRetry={refresh} />
          ) : recent.length === 0 ? (
            <EmptyState size="compact" icon={ListChecks} title="No jobs yet" description="Actions on machines create jobs that appear here." />
          ) : (
            recent.map((j) => {
              const machine = j.machine_title || j.machine_hostname;
              const d =
                j.status === "running" && j.started_at
                  ? Math.max(0, now - new Date(j.started_at).getTime())
                  : jobDurationMs(j as unknown as Job);
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    tracker?.openJobLogs(j);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <StatusDot status={j.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{jobTitle(j)}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {machine ?? <span className="font-data">{j.agent_id?.slice(0, 8) ?? "—"}</span>}
                      {j.status === "failed" && j.error_message && <span className="text-destructive/90"> · {j.error_message}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <RelativeTime date={j.created_at} noTooltip className="text-[11px] text-muted-foreground" />
                    <span className={cn("font-data text-[11px]", isJobActive(j) ? "text-info" : "text-subtle-foreground")}>
                      {j.status === "pending" ? "queued" : formatDuration(d)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
