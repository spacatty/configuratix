"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Ban,
  Copy,
  FileCode,
  FileText,
  Globe,
  MoreHorizontal,
  RotateCcw,
  ScrollText,
  Server,
  SquareTerminal,
  Waypoints,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { JobListItem, Machine } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDateTime, formatDuration } from "@/lib/format";
import { dayLabel, humanizeJobType, isJobActive, isJobCancellable, isJobRetryable, jobTitle, jobTitleSubject, localDayKey, machineIp } from "@/lib/jobs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot, getStatusMeta } from "@/components/app/status";
import { RelativeTime } from "@/components/app/data-display";
import { jobEntityHref } from "@/components/jobs/job-detail";

export interface JobsTableProps {
  jobs: JobListItem[];
  loading?: boolean;
  machines?: Map<string, Machine>;
  groupByDay?: boolean;
  /** Ids that should animate in (newly arrived). */
  freshIds?: Set<string>;
  now: number;
  onOpen: (job: JobListItem) => void;
  onRetry: (job: JobListItem) => void;
  onCancel: (job: JobListItem) => void;
  onFilterMachine?: (machineId: string) => void;
  retrying?: string | null;
  emptyState?: React.ReactNode;
}

const ENTITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  domain: Globe,
  nginx_config: FileCode,
  machine: Server,
  passthrough: Waypoints,
  php_runtime: Server,
  agent: Server,
  file: FileText,
  command: SquareTerminal,
};

function liveDuration(j: JobListItem, now: number): number | null {
  if (j.status === "running" && j.started_at) return Math.max(0, now - new Date(j.started_at).getTime());
  if (typeof j.duration_ms === "number") return j.duration_ms;
  if (j.started_at && j.finished_at) return new Date(j.finished_at).getTime() - new Date(j.started_at).getTime();
  return null;
}

export function JobsTable({
  jobs,
  loading,
  machines,
  groupByDay,
  freshIds,
  now,
  onOpen,
  onRetry,
  onCancel,
  onFilterMachine,
  retrying,
  emptyState,
}: JobsTableProps) {
  const groups = React.useMemo(() => {
    if (!groupByDay) return [{ key: "all", label: null as string | null, rows: jobs }];
    const out: { key: string; label: string | null; rows: JobListItem[] }[] = [];
    for (const j of jobs) {
      const k = localDayKey(j.created_at);
      const last = out[out.length - 1];
      if (last && last.key === k) last.rows.push(j);
      else out.push({ key: k, label: dayLabel(k), rows: [j] });
    }
    return out;
  }, [jobs, groupByDay]);

  const cols = 8;
  return (
    <div className="overflow-clip rounded-lg border border-border bg-card">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-12 z-20">
          <tr className="bg-surface-2/95 backdrop-blur supports-[backdrop-filter]:bg-surface-2/80">
            <Th className="w-[34px] pr-0" />
            <Th>Job</Th>
            <Th className="hidden lg:table-cell">Target</Th>
            <Th>Machine</Th>
            <Th className="hidden xl:table-cell">By</Th>
            <Th className="text-right">Created</Th>
            <Th className="text-right">Duration</Th>
            <Th className="w-[44px]" />
          </tr>
        </thead>
        {loading ? (
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>
                <Td className="pr-0">
                  <Skeleton className="size-2 rounded-full" />
                </Td>
                <Td>
                  <Skeleton className="h-3.5 w-[60%]" />
                  <Skeleton className="mt-1.5 h-2.5 w-24" />
                </Td>
                <Td className="hidden lg:table-cell">
                  <Skeleton className="h-3 w-28" />
                </Td>
                <Td>
                  <Skeleton className="h-3 w-24" />
                </Td>
                <Td className="hidden xl:table-cell">
                  <Skeleton className="h-3 w-20" />
                </Td>
                <Td>
                  <Skeleton className="ml-auto h-3 w-12" />
                </Td>
                <Td>
                  <Skeleton className="ml-auto h-3 w-10" />
                </Td>
                <Td />
              </tr>
            ))}
          </tbody>
        ) : jobs.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={cols} className="p-0">
                {emptyState}
              </td>
            </tr>
          </tbody>
        ) : (
          groups.map((g) => (
            <tbody key={g.key}>
              {g.label && (
                <tr>
                  <th
                    colSpan={cols}
                    className="sticky top-[84px] z-10 border-b border-border bg-card/95 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-card/80"
                  >
                    <span className="text-foreground">{g.label}</span>
                    <span className="font-data ml-2 text-subtle-foreground">{g.rows.length}</span>
                    <DayStatusSummary rows={g.rows} />
                  </th>
                </tr>
              )}
              {g.rows.map((j) => (
                <JobRow
                  key={j.id}
                  job={j}
                  fresh={freshIds?.has(j.id)}
                  machine={j.machine_id ? machines?.get(j.machine_id) : undefined}
                  now={now}
                  onOpen={onOpen}
                  onRetry={onRetry}
                  onCancel={onCancel}
                  onFilterMachine={onFilterMachine}
                  retrying={retrying === j.id}
                />
              ))}
            </tbody>
          ))
        )}
      </table>
    </div>
  );
}

function DayStatusSummary({ rows }: { rows: JobListItem[] }) {
  const failed = rows.filter((r) => r.status === "failed").length;
  const active = rows.filter(isJobActive).length;
  return (
    <span className="ml-3 inline-flex gap-3 font-normal">
      {active > 0 && <span className="font-data text-info">{active} active</span>}
      {failed > 0 && <span className="font-data text-destructive">{failed} failed</span>}
    </span>
  );
}

function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th className={cn("h-9 border-b border-border px-3 text-left text-xs font-medium text-muted-foreground", className)}>{children}</th>;
}
function Td({ className, children, ...props }: React.ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-border/60 px-3 py-2 align-middle", className)} {...props}>
      {children}
    </td>
  );
}

function JobRow({
  job: j,
  fresh,
  machine,
  now,
  onOpen,
  onRetry,
  onCancel,
  onFilterMachine,
  retrying,
}: {
  job: JobListItem;
  fresh?: boolean;
  machine?: Machine;
  now: number;
  onOpen: (j: JobListItem) => void;
  onRetry: (j: JobListItem) => void;
  onCancel: (j: JobListItem) => void;
  onFilterMachine?: (id: string) => void;
  retrying?: boolean;
}) {
  const meta = getStatusMeta(j.status);
  const d = liveDuration(j, now);
  const ip = machine ? machineIp(machine) : null;
  const machineName = j.machine_title || j.machine_hostname || (machine ? machine.title || machine.hostname : null);
  const href = jobEntityHref(j);
  const subject = jobTitleSubject(j.title);
  const EntityIcon = (j.entity_type && ENTITY_ICON[j.entity_type]) || null;
  const entityLabel =
    j.entity_type === "file" || j.entity_type === "command"
      ? j.entity_id
      : subject || (j.entity_type === "machine" ? machineName : null) || (j.entity_id ? j.entity_id.slice(0, 8) : null);

  return (
    <tr
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("a,button,[role=menuitem],[data-no-row-click]")) return;
        onOpen(j);
      }}
      className={cn(
        "group cursor-pointer transition-colors hover:bg-accent/40",
        j.status === "failed" && "bg-destructive/[0.025]",
        fresh && "animate-fade-in-up"
      )}
    >
      <Td className="pr-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-4 items-center justify-center">
              <StatusDot status={j.status} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {meta.label}
            {j.cancel_requested && isJobActive(j) ? " · cancel requested" : ""}
          </TooltipContent>
        </Tooltip>
      </Td>
      <Td className="max-w-0 w-[42%]">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate font-medium", j.status === "cancelled" && "text-muted-foreground")}>{jobTitle(j)}</span>
          {j.attempts > 0 && (
            <Badge variant="muted" className="font-data shrink-0">
              <RotateCcw />
              {j.attempts + 1}
            </Badge>
          )}
          {j.cancel_requested && isJobActive(j) && (
            <Badge variant="warning" className="shrink-0">
              cancelling
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] text-muted-foreground">
          <span className={cn("shrink-0", j.status === "failed" ? "text-destructive" : j.status === "running" ? "text-info" : undefined)}>{meta.label}</span>
          <span className="font-data shrink-0 text-subtle-foreground">{j.action || humanizeJobType(j.type)}</span>
          {j.status === "failed" && j.error_message && (
            <span className="font-data truncate text-destructive/80" title={j.error_message}>
              {j.error_message}
            </span>
          )}
        </div>
      </Td>
      <Td className="hidden max-w-0 lg:table-cell">
        {entityLabel ? (
          href ? (
            <Link href={href} className="inline-flex max-w-full items-center gap-1.5 text-muted-foreground hover:text-foreground">
              {EntityIcon && <EntityIcon className="size-3.5 shrink-0" />}
              <span className="font-data truncate">{entityLabel}</span>
            </Link>
          ) : (
            <span className="inline-flex max-w-full items-center gap-1.5 text-muted-foreground">
              {EntityIcon && <EntityIcon className="size-3.5 shrink-0" />}
              <span className="font-data truncate">{entityLabel}</span>
            </span>
          )
        ) : (
          <span className="text-subtle-foreground">—</span>
        )}
      </Td>
      <Td className="max-w-0">
        {j.machine_id ? (
          <div className="min-w-0">
            <Link href={`/machines/${j.machine_id}`} className="block truncate hover:underline underline-offset-2">
              {machineName ?? j.machine_id.slice(0, 8)}
            </Link>
            {ip && <div className="font-data truncate text-[11.5px] text-muted-foreground">{ip}</div>}
          </div>
        ) : (
          <span className="text-subtle-foreground">—</span>
        )}
      </Td>
      <Td className="hidden max-w-0 xl:table-cell">
        <span className="block truncate text-muted-foreground">{j.created_by_email ?? "system"}</span>
      </Td>
      <Td className="text-right whitespace-nowrap">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <RelativeTime date={j.created_at} noTooltip className="text-muted-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <span className="font-data">{formatDateTime(j.created_at)}</span>
          </TooltipContent>
        </Tooltip>
      </Td>
      <Td className="text-right whitespace-nowrap">
        <span className={cn("font-data", j.status === "running" ? "text-info" : "text-muted-foreground")}>
          {j.status === "pending" ? <span className="text-subtle-foreground">queued</span> : formatDuration(d)}
        </span>
      </Td>
      <Td className="pr-2 text-right" data-no-row-click>
        <RowMenu job={j} onOpen={onOpen} onRetry={onRetry} onCancel={onCancel} onFilterMachine={onFilterMachine} retrying={retrying} />
      </Td>
    </tr>
  );
}

function RowMenu({
  job: j,
  onOpen,
  onRetry,
  onCancel,
  onFilterMachine,
  retrying,
}: {
  job: JobListItem;
  onOpen: (j: JobListItem) => void;
  onRetry: (j: JobListItem) => void;
  onCancel: (j: JobListItem) => void;
  onFilterMachine?: (id: string) => void;
  retrying?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Job actions" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => onOpen(j)}>
          <ScrollText />
          View logs
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/jobs/${j.id}`}>
            <ArrowUpRight />
            Open job page
          </Link>
        </DropdownMenuItem>
        {(isJobRetryable(j) || isJobCancellable(j)) && <DropdownMenuSeparator />}
        {isJobRetryable(j) && (
          <DropdownMenuItem disabled={retrying} onClick={() => onRetry(j)}>
            <RotateCcw />
            Retry
          </DropdownMenuItem>
        )}
        {isJobCancellable(j) && (
          <DropdownMenuItem variant="destructive" onClick={() => onCancel(j)}>
            <Ban />
            Cancel
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {j.machine_id && onFilterMachine && (
          <DropdownMenuItem onClick={() => onFilterMachine(j.machine_id!)}>
            <Server />
            Only this machine
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => void copyToClipboard(j.id)}>
          <Copy />
          Copy job ID
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
