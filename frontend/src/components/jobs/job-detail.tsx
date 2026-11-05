"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  CircleX,
  CornerDownRight,
  FileJson,
  Globe,
  RotateCcw,
  Server,
  ShieldAlert,
  Timer,
  TriangleAlert,
  User,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { api, type Job, type JobCreated, type JobDetail, type JobListItem } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import {
  isJobActive,
  isJobCancellable,
  isJobRetryable,
  jobDurationMs,
  jobTitle,
  jobTitleSubject,
  parseJobResult,
  type JobStepResult,
  type ParsedJobResult,
} from "@/lib/jobs";
import { usePolling } from "@/hooks/use-polling";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/app/status";
import { CopyButton, KeyValueList, Mono, RelativeTime } from "@/components/app/data-display";
import { LogViewer } from "@/components/app/log-viewer";
import { ErrorState, Spinner } from "@/components/app/states";
import { JsonTree } from "@/components/jobs/json-tree";
import { useJobActions } from "@/components/jobs/use-job-actions";

/** Union of every job shape the UI handles (legacy Job, list row, full detail). */
export type JobView = { id: string; status: string; type: string } & Partial<Omit<JobDetail, "id" | "status" | "type">> &
  Partial<Pick<Job, "payload_json" | "machine_name" | "triggered_by" | "rollback_status" | "target">>;

export function toJobView(j: Job | JobListItem | JobDetail | JobView | null | undefined): JobView | null {
  if (!j) return null;
  return j as unknown as JobView;
}

export function jobMachineName(j: JobView | null | undefined): string | null {
  if (!j) return null;
  return j.machine_title || j.machine_name || j.machine_hostname || null;
}

/** Live job detail: polls every 1.5s while the job is active, once otherwise. */
export function useJobDetail(jobId: string, initial?: JobView | null, enabled = true) {
  const [job, setJob] = React.useState<JobView | null>(initial ?? null);
  const active = !job || isJobActive(job);
  const { data, error, loading, refresh } = usePolling(() => api.getJobDetail(jobId), active ? 1500 : 0, {
    enabled,
    deps: [jobId],
  });
  React.useEffect(() => {
    setJob(initial ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  React.useEffect(() => {
    if (data && data.id === jobId) setJob(toJobView(data));
  }, [data, jobId]);
  return { job, error, loading: loading && !job, refresh };
}

/** Ticks every second while `active` (for live durations). */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

export function JobActionButtons({
  job,
  onRetried,
  onChanged,
  size = "sm",
}: {
  job: JobView | null;
  onRetried?: (created: JobCreated) => void;
  onChanged?: () => void;
  size?: "sm" | "xs";
}) {
  const { cancel, retry, retrying } = useJobActions({ onRetried: (c) => onRetried?.(c), onChanged });
  if (!job) return null;
  return (
    <>
      {job.cancel_requested && isJobActive(job) && (
        <Badge variant="warning">
          <Spinner className="size-3" />
          Cancel requested
        </Badge>
      )}
      {isJobCancellable(job) && (
        <Button size={size} variant="destructive" onClick={() => void cancel(job)}>
          <Ban />
          Cancel
        </Button>
      )}
      {isJobRetryable(job) && (
        <Button size={size} variant="outline" onClick={() => void retry(job)} disabled={retrying === job.id}>
          {retrying === job.id ? <Spinner /> : <RotateCcw />}
          Retry
        </Button>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Header meta                                                                */
/* -------------------------------------------------------------------------- */

export function jobEntityHref(j: Pick<JobView, "entity_type" | "entity_id" | "title" | "machine_id">, fqdn?: string | null): string | null {
  const id = j.entity_id;
  switch (j.entity_type) {
    case "domain": {
      const q = fqdn ?? jobTitleSubject(j.title);
      return q ? `/domains?q=${encodeURIComponent(q)}` : "/domains";
    }
    case "nginx_config":
      return id ? `/configs/nginx/${id}` : "/configs/nginx";
    case "machine":
    case "passthrough":
    case "php_runtime":
    case "agent":
      return id ? `/machines/${id}` : j.machine_id ? `/machines/${j.machine_id}` : null;
    default:
      return null;
  }
}

export function JobHeaderMeta({ job }: { job: JobView | null }) {
  if (!job) return null;
  const machine = jobMachineName(job);
  const by = job.created_by_email || job.triggered_by;
  const entityHref = jobEntityHref(job);
  const subject = jobTitleSubject(job.title);
  return (
    <>
      {machine && (
        <span className="inline-flex items-center gap-1.5">
          <Server className="size-3" />
          {job.machine_id ? (
            <Link href={`/machines/${job.machine_id}`} className="hover:text-foreground">
              {machine}
            </Link>
          ) : (
            machine
          )}
        </span>
      )}
      {entityHref && job.entity_type === "domain" && subject && (
        <span className="inline-flex items-center gap-1.5">
          <Globe className="size-3" />
          <Link href={entityHref} className="font-data hover:text-foreground">
            {subject}
          </Link>
        </span>
      )}
      <Mono muted>{job.action || job.type}</Mono>
      {by && (
        <span className="inline-flex items-center gap-1.5">
          <User className="size-3" />
          {by}
        </span>
      )}
      {(job.attempts ?? 0) > 0 && <span className="font-data">attempt {(job.attempts ?? 0) + 1}</span>}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Body                                                                       */
/* -------------------------------------------------------------------------- */

export interface JobDetailBodyProps {
  job: JobView | null;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Max height for log/step panes. */
  paneHeight?: string;
  /** Open another job (retry chain links). */
  onOpenJob?: (id: string) => void;
}

export function JobDetailBody({ job, loading, error, onRetry, paneHeight = "calc(100vh - 380px)", onOpenJob }: JobDetailBodyProps) {
  const active = !!job && isJobActive(job);
  const now = useNow(active && job?.status === "running");
  const result = React.useMemo(() => parseJobResult(job?.result_json), [job?.result_json]);
  const payload = job?.payload ?? job?.payload_json ?? null;
  const payloadValue = React.useMemo(() => {
    if (typeof payload !== "string") return payload;
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }, [payload]);
  const steps = result?.steps ?? [];
  const failedSteps = steps.filter((s) => s.status === "failed").length;

  const [tab, setTab] = React.useState<string>("logs");
  const chose = React.useRef(false);
  React.useEffect(() => {
    if (chose.current || !job || !job.updated_at) return;
    chose.current = true;
    if (!isJobActive(job) && steps.length > 0 && job.status !== "completed") setTab("steps");
  }, [job, steps.length]);

  if (error && !job) return <ErrorState error={error} onRetry={onRetry} title="Could not load job" />;

  const duration = job
    ? job.status === "running" && job.started_at
      ? Math.max(0, now - new Date(job.started_at).getTime())
      : jobDurationMs(job as Job)
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {(
          [
            ["Created", job?.created_at],
            ["Started", job?.started_at],
            ["Finished", job?.finished_at],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="bg-card px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-[12.5px]">{v ? <RelativeTime date={v} /> : <span className="text-muted-foreground">—</span>}</div>
          </div>
        ))}
        <div className="bg-card px-3 py-2">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Duration
            {job?.timeout_seconds ? <span className="text-subtle-foreground">/ {formatDuration(job.timeout_seconds * 1000)}</span> : null}
          </div>
          <div className={cn("font-data mt-0.5 text-[12.5px]", job?.status === "running" && "text-info")}>{formatDuration(duration)}</div>
        </div>
      </div>

      {job && <OutcomeCallout job={job} result={result} />}

      {job && (job.parent_job_id || (job.retries && job.retries.length > 0)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {job.parent_job_id && (
            <span className="inline-flex items-center gap-1.5">
              <CornerDownRight className="size-3" />
              Retry of
              <JobLink id={job.parent_job_id} onOpenJob={onOpenJob} />
            </span>
          )}
          {job.retries && job.retries.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <RotateCcw className="size-3" />
              Retried as
              {job.retries.map((r) => (
                <JobLink key={r} id={r} onOpenJob={onOpenJob} />
              ))}
            </span>
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-3">
        <TabsList>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="steps" disabled={steps.length === 0}>
            Steps
            {steps.length > 0 && (
              <span className={cn("font-data ml-1 text-[11px]", failedSteps ? "text-destructive" : "text-muted-foreground")}>
                {failedSteps ? `${failedSteps}/${steps.length}` : steps.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="payload">Payload</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="logs" className="min-h-0">
          <LogViewer
            logs={job?.logs}
            live={active}
            maxHeight={paneHeight}
            emptyText={loading ? "Loading…" : active ? "Waiting for output…" : "This job produced no output."}
          />
        </TabsContent>
        <TabsContent value="steps" className="min-h-0">
          <StepList steps={steps} result={result} maxHeight={paneHeight} />
        </TabsContent>
        <TabsContent value="payload">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileJson className="size-3.5" />
                payload.json
                <span className="text-subtle-foreground">· secrets masked</span>
              </span>
              {payloadValue != null && <CopyButton value={JSON.stringify(payloadValue, null, 2)} label="Copy payload" />}
            </div>
            <div className="overflow-auto p-3" style={{ maxHeight: paneHeight }}>
              {payloadValue == null ? (
                <div className="py-6 text-center text-xs text-muted-foreground">{loading ? "Loading…" : "No payload."}</div>
              ) : (
                <JsonTree value={payloadValue} defaultDepth={2} />
              )}
            </div>
          </div>
          {result && Object.keys(result.extra).length + (result.data ? 1 : 0) > 0 && (
            <Collapsible className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
              <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                Result data
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-border p-3">
                <JsonTree value={{ ...(result.data ? { data: result.data } : {}), ...result.extra }} defaultDepth={1} />
              </CollapsibleContent>
            </Collapsible>
          )}
        </TabsContent>
        <TabsContent value="details">
          <div className="rounded-lg border border-border bg-card p-4">
            <KeyValueList
              items={[
                { label: "Job ID", value: job?.id, mono: true, copy: job?.id },
                { label: "Title", value: job ? jobTitle(job) : null },
                { label: "Type", value: job?.type, mono: true },
                { label: "Action", value: job?.action, mono: true, hidden: !job?.action },
                {
                  label: "Entity",
                  value: job?.entity_type ? (
                    <span className="font-data">
                      {job.entity_type}
                      {job.entity_id ? <span className="text-muted-foreground"> · {job.entity_id}</span> : null}
                    </span>
                  ) : null,
                  hidden: !job?.entity_type,
                },
                { label: "Machine", value: jobMachineName(job), hidden: !jobMachineName(job) },
                { label: "Agent ID", value: job?.agent_id, mono: true, copy: job?.agent_id ?? null, hidden: !job?.agent_id },
                { label: "Created by", value: job?.created_by_email || job?.triggered_by, hidden: !(job?.created_by_email || job?.triggered_by) },
                { label: "Attempts", value: job ? String((job.attempts ?? 0) + 1) : null, mono: true },
                { label: "Timeout", value: job?.timeout_seconds ? formatDuration(job.timeout_seconds * 1000) : null, mono: true, hidden: !job?.timeout_seconds },
                { label: "Rollback", value: job?.rollback_status ? <StatusBadge status={job.rollback_status} /> : null, hidden: !job?.rollback_status },
                { label: "Created", value: formatDateTime(job?.created_at), mono: true },
                { label: "Started", value: formatDateTime(job?.started_at), mono: true },
                { label: "Finished", value: formatDateTime(job?.finished_at), mono: true },
              ]}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function JobLink({ id, onOpenJob }: { id: string; onOpenJob?: (id: string) => void }) {
  if (onOpenJob)
    return (
      <button type="button" onClick={() => onOpenJob(id)} className="font-data text-foreground/90 underline-offset-2 hover:underline">
        #{id.slice(0, 8)}
      </button>
    );
  return (
    <Link href={`/jobs/${id}`} className="font-data text-foreground/90 underline-offset-2 hover:underline">
      #{id.slice(0, 8)}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Outcome                                                                    */
/* -------------------------------------------------------------------------- */

function OutcomeCallout({ job, result }: { job: JobView; result: ParsedJobResult | null }) {
  const apply = result?.apply;
  const rolledBack = result?.rolledBack || apply?.status === "rolled_back";
  const lists = (
    <>
      {apply?.disabled && apply.disabled.length > 0 && (
        <div className="text-xs">
          <span className="text-warning">Disabled (missing certificate):</span>
          <ul className="font-data mt-0.5 space-y-0.5 text-[11.5px] text-muted-foreground">
            {apply.disabled.map((d) => (
              <li key={d} className="break-all">
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
      {apply?.reenabled && apply.reenabled.length > 0 && (
        <div className="text-xs">
          <span className="text-success">Re-enabled:</span>
          <ul className="font-data mt-0.5 space-y-0.5 text-[11.5px] text-muted-foreground">
            {apply.reenabled.map((d) => (
              <li key={d} className="break-all">
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result?.rollbackLog && (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
            Rollback log
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5">
            <LogViewer logs={result.rollbackLog} title="rollback" maxHeight={200} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );

  if (rolledBack) {
    return (
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>Rolled back — previous state restored</AlertTitle>
        <AlertDescription>
          <p className="font-data text-xs break-words whitespace-pre-wrap text-foreground/85">
            {apply?.reason || job.error_message || result?.error || "The change failed validation and was undone. nginx kept running."}
          </p>
          {lists}
        </AlertDescription>
      </Alert>
    );
  }
  if (apply?.status === "applied" || apply?.status === "removed") {
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertTitle>{apply.status === "applied" ? "Applied — config installed and nginx reloaded" : "Removed — config removed and nginx reloaded"}</AlertTitle>
        {(apply.disabled?.length || apply.reenabled?.length) ? <AlertDescription>{lists}</AlertDescription> : null}
      </Alert>
    );
  }
  if (job.status === "failed" || apply?.status === "failed") {
    return (
      <Alert variant="destructive">
        <CircleX />
        <AlertTitle>{apply?.status === "failed" ? "Apply failed" : "Failed"}</AlertTitle>
        <AlertDescription>
          <p className="font-data text-xs break-words whitespace-pre-wrap text-foreground/85">
            {apply?.reason || job.error_message || result?.error || "The job exited with an error — see logs."}
          </p>
          {lists}
        </AlertDescription>
      </Alert>
    );
  }
  if (job.status === "cancelled") {
    return (
      <Alert>
        <CircleSlash />
        <AlertTitle>Cancelled</AlertTitle>
        {job.error_message && (
          <AlertDescription>
            <p className="font-data text-xs">{job.error_message}</p>
          </AlertDescription>
        )}
      </Alert>
    );
  }
  if (job.error_message) {
    return (
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          <p className="font-data text-xs break-words whitespace-pre-wrap">{job.error_message}</p>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

function StepList({ steps, result, maxHeight }: { steps: JobStepResult[]; result: ParsedJobResult | null; maxHeight: string }) {
  const total = steps.reduce((a, s) => a + (s.duration_ms || 0), 0);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          <span className="font-data text-foreground">{steps.length}</span> steps
          {result?.rolledBack && <span className="ml-2 text-warning">· rolled back</span>}
        </span>
        <span className="inline-flex items-center gap-1">
          <Timer className="size-3" />
          <span className="font-data">{formatDuration(result?.durationMs ?? total)}</span>
        </span>
      </div>
      <ol className="divide-y divide-border overflow-y-auto" style={{ maxHeight }}>
        {steps.map((s, i) => (
          <StepRow key={`${s.index ?? i}-${s.id ?? s.name}`} step={s} total={total} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({ step, total }: { step: JobStepResult; total: number }) {
  const failed = step.status === "failed";
  const [open, setOpen] = React.useState(failed && !step.continued_on_error);
  const hasBody = !!(step.output_tail || step.error);
  const Icon = step.status === "ok" ? CheckCircle2 : failed ? CircleX : CircleDashed;
  const tone = step.status === "ok" ? "text-success" : failed ? (step.continued_on_error ? "text-warning" : "text-destructive") : "text-subtle-foreground";
  const share = total > 0 ? Math.max(2, Math.round(((step.duration_ms || 0) / total) * 100)) : 0;
  return (
    <li className={cn(failed && !step.continued_on_error && "bg-destructive/[0.04]")}>
      <button
        type="button"
        disabled={!hasBody}
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <Icon className={cn("size-4", tone)} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-data shrink-0 text-[11px] text-subtle-foreground">{String((step.index ?? 0) + 1).padStart(2, "0")}</span>
            <span className={cn("truncate text-[13px]", step.status === "skipped" && "text-muted-foreground")}>{step.name || step.id || step.action}</span>
            <span className="font-data shrink-0 text-[11px] text-muted-foreground">{step.action}</span>
            {step.continued_on_error && <Badge variant="warning">continued</Badge>}
            {(step.attempts ?? 0) > 1 && <Badge variant="muted">{step.attempts} attempts</Badge>}
          </div>
          {total > 0 && step.status !== "skipped" && (
            <div className="mt-1 h-[3px] w-full max-w-[220px] overflow-hidden rounded-full bg-white/[0.05]">
              <div className={cn("h-full rounded-full", failed ? "bg-destructive/70" : "bg-info/50")} style={{ width: `${share}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11.5px]">
          {step.status !== "skipped" && step.exit_code !== -1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("font-data", step.exit_code === 0 ? "text-muted-foreground" : "text-destructive")}>exit {step.exit_code}</span>
              </TooltipTrigger>
              <TooltipContent>Exit code</TooltipContent>
            </Tooltip>
          )}
          <span className="font-data w-14 text-right text-muted-foreground">{step.status === "skipped" ? "skipped" : formatDuration(step.duration_ms)}</span>
          <ChevronRight className={cn("size-3.5 text-subtle-foreground transition-transform", open && "rotate-90", !hasBody && "invisible")} />
        </div>
      </button>
      {open && hasBody && (
        <div className="space-y-2 px-3 pb-3 pl-10">
          {step.error && <div className="font-data rounded-md border border-destructive/25 bg-destructive/[0.06] px-2.5 py-1.5 text-xs break-words text-destructive">{step.error}</div>}
          {step.output_tail && <LogViewer logs={step.output_tail} title="output (tail)" maxHeight={240} />}
        </div>
      )}
    </li>
  );
}

/** "Open full page" link used by the sheet header. */
export function JobPageLink({ id, onNavigate }: { id: string; onNavigate?: () => void }) {
  return (
    <Button asChild variant="ghost" size="xs">
      <Link href={`/jobs/${id}`} onClick={onNavigate}>
        Open page
        <ArrowUpRight />
      </Link>
    </Button>
  );
}
