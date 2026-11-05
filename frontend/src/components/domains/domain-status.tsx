"use client";

import { RotateCw, ScrollText } from "lucide-react";

import type { Domain } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RelativeTime, StatusDot, StatusBadge, openJobLogs } from "@/components/app";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { APPLY_META, HEALTH_LABEL, domainApplyState, domainHealth } from "./domain-utils";

/** Dot + label + last-check time; tooltip carries the detail. */
const HEALTH_EXPLAIN: Record<ReturnType<typeof domainHealth>, string> = {
  healthy: "Responding with the expected status.",
  unhealthy: "Last check failed: wrong status, timeout or connection error.",
  unknown: "Assigned, but not checked yet.",
  unassigned: "Not assigned to a machine, so it isn't checked.",
};

function DomainHealthTooltipBody({ domain }: { domain: Domain }) {
  const h = domainHealth(domain);
  const expected = domain.health_check_expected_status ?? 200;
  const code = domain.last_check_status_code;
  return (
    <div className="space-y-0.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        <StatusDot status={h === "unassigned" ? "unknown" : h} pulse={false} size="xs" />
        {HEALTH_LABEL[h]}
      </div>
      <div className="text-muted-foreground">{HEALTH_EXPLAIN[h]}</div>
      {h !== "unassigned" && (
        <>
          <div>
            {domain.last_check_at ? (
              <>
                Last check <span className="font-data">{formatDateTime(domain.last_check_at)}</span>
              </>
            ) : (
              "Not checked yet"
            )}
          </div>
          {typeof code === "number" && (
            <div>
              Response <span className="font-data">HTTP {code}</span>
              {typeof domain.last_check_response_ms === "number" && (
                <span className="font-data text-muted-foreground"> · {domain.last_check_response_ms} ms</span>
              )}
            </div>
          )}
          {domain.last_check_error && (
            <div className="font-data max-w-xs text-[11px] text-destructive">{domain.last_check_error.slice(0, 300)}</div>
          )}
          <div className="text-muted-foreground">
            Healthy when <span className="font-data">{domain.health_check_path || "/"}</span> returns{" "}
            <span className="font-data">{expected}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Health as a status light (used before the domain name). */
export function DomainHealthLight({ domain }: { domain: Domain }) {
  const h = domainHealth(domain);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex size-4 shrink-0 cursor-default items-center justify-center"
          aria-label={`Health: ${HEALTH_LABEL[h]}`}
          data-no-row-click
        >
          {h === "unassigned" ? (
            <span className="size-1.5 rounded-full border border-subtle-foreground/60" />
          ) : (
            <StatusDot status={h} pulse={h === "unhealthy"} />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <DomainHealthTooltipBody domain={domain} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Health label + last-check time (detail sheet). */
export function DomainHealthCell({ domain }: { domain: Domain }) {
  const h = domainHealth(domain);
  if (h === "unassigned") return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-2" data-no-row-click>
          <StatusDot status={h} />
          <span className={cn("text-[13px]", h === "unknown" && "text-muted-foreground")}>{HEALTH_LABEL[h]}</span>
          {domain.last_check_at && (
            <RelativeTime date={domain.last_check_at} noTooltip className="text-[11px] text-subtle-foreground" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <DomainHealthTooltipBody domain={domain} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Apply status with failure tooltip and inline "logs" / "retry". */
export function DomainApplyCell({
  domain,
  onRetry,
  retrying,
}: {
  domain: Domain;
  onRetry?: (d: Domain) => void;
  retrying?: boolean;
}) {
  const state = domainApplyState(domain);
  if (state === "none" && !domain.assigned_machine_id) return <span className="text-muted-foreground">—</span>;
  const meta = APPLY_META[state];
  const jobId = domain.last_job_id;

  const label = (
    <span className="inline-flex items-center gap-2">
      <StatusDot tone={meta.tone} pulse={meta.pulse} />
      <span className={cn("text-[13px]", meta.tone === "muted" && "text-muted-foreground")}>{meta.label}</span>
    </span>
  );

  const tooltipBody =
    state === "failed" ? (
      <div className="space-y-1 text-xs">
        <div className="font-medium">Last apply failed</div>
        {domain.last_apply_error ? (
          <div className="font-data max-h-40 overflow-hidden text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
            {domain.last_apply_error.slice(0, 600)}
          </div>
        ) : (
          <div className="text-muted-foreground">Open the job logs for details.</div>
        )}
        <div className="text-muted-foreground">Changes were rolled back on the machine.</div>
      </div>
    ) : state === "out_of_sync" ? (
      <div className="text-xs">The nginx config changed after the last apply. Re-apply to push it.</div>
    ) : domain.last_applied_at ? (
      <div className="text-xs">
        Applied <span className="font-data">{formatDateTime(domain.last_applied_at)}</span>
      </div>
    ) : null;

  return (
    <span className="inline-flex items-center gap-1" data-no-row-click>
      {tooltipBody ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{label}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm">
            {tooltipBody}
          </TooltipContent>
        </Tooltip>
      ) : (
        label
      )}
      {jobId && (state === "failed" || state === "applying" || state === "pending" || state === "removing") && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="View job logs" onClick={() => openJobLogs(jobId)}>
              <ScrollText />
            </Button>
          </TooltipTrigger>
          <TooltipContent>View job logs</TooltipContent>
        </Tooltip>
      )}
      {onRetry && (state === "failed" || state === "out_of_sync") && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Re-apply"
              disabled={retrying}
              onClick={() => onRetry(domain)}
            >
              <RotateCw className={cn(retrying && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Re-apply config</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

/** Badge form for dialogs / sheets. */
export function DomainApplyBadge({ domain }: { domain: Domain }) {
  const state = domainApplyState(domain);
  const meta = APPLY_META[state];
  return <StatusBadge status={state} tone={meta.tone} label={meta.label} />;
}
