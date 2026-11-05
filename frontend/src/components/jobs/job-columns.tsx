"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
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
import { humanizeJobType, isJobActive, isJobCancellable, isJobRetryable, jobTitle, jobTitleSubject, machineIp } from "@/lib/jobs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot, getStatusMeta } from "@/components/app/status";
import { RelativeTime } from "@/components/app/data-display";
import { jobEntityHref } from "@/components/jobs/job-detail";

export interface JobColumnHandlers {
  machines?: Map<string, Machine>;
  now: number;
  onOpen: (job: JobListItem) => void;
  onRetry: (job: JobListItem) => void;
  onCancel: (job: JobListItem) => void;
  onFilterMachine?: (machineId: string) => void;
  retrying?: string | null;
}

/** Facet-only columns; never shown. */
export const JOB_HIDDEN_COLUMNS = { status: false, action: false };

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

function jobMachineName(j: JobListItem, machine?: Machine): string | null {
  return j.machine_title || j.machine_hostname || (machine ? machine.title || machine.hostname : null);
}

/** Columns for the jobs `DataTable`. Rows arrive filtered and ordered by the server. */
export function buildJobColumns(h: JobColumnHandlers): ColumnDef<JobListItem>[] {
  const machineOf = (j: JobListItem) => (j.machine_id ? h.machines?.get(j.machine_id) : undefined);
  return [
    {
      id: "job",
      accessorFn: (j) => jobTitle(j),
      header: "Job",
      meta: { label: "Job", width: "fill", share: 38, minWidth: 260 },
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => <JobCell job={row.original} />,
    },
    // Hidden facet columns
    { id: "status", accessorFn: (j) => j.status, header: "Status", enableHiding: false, enableSorting: false },
    { id: "action", accessorFn: (j) => j.action || j.type, header: "Action", enableHiding: false, enableSorting: false },
    {
      id: "target",
      accessorFn: (j) => j.entity_type ?? "",
      header: "Target",
      meta: { label: "Target", width: "fill", minWidth: 140 },
      enableSorting: false,
      cell: ({ row }) => <TargetCell job={row.original} machine={machineOf(row.original)} />,
    },
    {
      id: "machine",
      accessorFn: (j) => j.machine_id ?? "",
      header: "Machine",
      meta: { label: "Machine", width: "fill", minWidth: 140 },
      enableSorting: false,
      cell: ({ row }) => {
        const j = row.original;
        if (!j.machine_id) return <span className="text-subtle-foreground">—</span>;
        const machine = machineOf(j);
        const ip = machine ? machineIp(machine) : null;
        return (
          <div className="min-w-0">
            <Link href={`/machines/${j.machine_id}`} className="block truncate hover:underline underline-offset-4">
              {jobMachineName(j, machine) ?? j.machine_id.slice(0, 8)}
            </Link>
            {ip && <div className="font-data truncate text-[11.5px] text-subtle-foreground">{ip}</div>}
          </div>
        );
      },
    },
    {
      id: "by",
      accessorFn: (j) => j.created_by_email ?? "system",
      header: "By",
      meta: { label: "By", width: "fill", minWidth: 110 },
      enableSorting: false,
      cell: ({ row }) => <span className="block truncate text-muted-foreground">{row.original.created_by_email ?? "system"}</span>,
    },
    {
      id: "created_at",
      accessorFn: (j) => new Date(j.created_at).getTime(),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Created" align="right" />,
      meta: { label: "Created", align: "right", width: "fit" },
      sortDescFirst: true,
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <RelativeTime date={row.original.created_at} noTooltip className="text-xs text-muted-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <span className="font-data">{formatDateTime(row.original.created_at)}</span>
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: "duration",
      accessorFn: (j) => liveDuration(j, h.now) ?? -1,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Duration" align="right" />,
      meta: { label: "Duration", align: "right", width: "fit" },
      sortDescFirst: true,
      cell: ({ row }) => {
        const j = row.original;
        if (j.status === "pending") return <span className="text-xs text-subtle-foreground">queued</span>;
        return (
          <span className={cn("font-data text-xs", j.status === "running" ? "text-info" : "text-muted-foreground")}>
            {formatDuration(liveDuration(j, h.now))}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", width: "fit" },
      cell: ({ row }) => (
        <RowMenu
          job={row.original}
          onOpen={h.onOpen}
          onRetry={h.onRetry}
          onCancel={h.onCancel}
          onFilterMachine={h.onFilterMachine}
          retrying={h.retrying === row.original.id}
        />
      ),
    },
  ];
}

function JobCell({ job: j }: { job: JobListItem }) {
  const meta = getStatusMeta(j.status);
  return (
    <div className="flex items-center gap-2.5 pr-6">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex size-4 shrink-0 items-center justify-center">
            <StatusDot status={j.status} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {meta.label}
          {j.cancel_requested && isJobActive(j) ? " · cancel requested" : ""}
        </TooltipContent>
      </Tooltip>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-[13px] font-semibold", j.status === "cancelled" && "font-medium text-muted-foreground")}>
            {jobTitle(j)}
          </span>
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
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-subtle-foreground">
          <span className={cn("shrink-0", j.status === "failed" ? "text-destructive" : j.status === "running" ? "text-info" : "text-muted-foreground")}>
            {meta.label}
          </span>
          <span aria-hidden>·</span>
          <span className="font-data shrink-0">{j.action || humanizeJobType(j.type)}</span>
          {j.status === "failed" && j.error_message && (
            <>
              <span aria-hidden>·</span>
              <span className="font-data truncate text-destructive/80" title={j.error_message}>
                {j.error_message}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TargetCell({ job: j, machine }: { job: JobListItem; machine?: Machine }) {
  const href = jobEntityHref(j);
  const subject = jobTitleSubject(j.title);
  const EntityIcon = (j.entity_type && ENTITY_ICON[j.entity_type]) || null;
  const label =
    j.entity_type === "file" || j.entity_type === "command"
      ? j.entity_id
      : subject || (j.entity_type === "machine" ? jobMachineName(j, machine) : null) || (j.entity_id ? j.entity_id.slice(0, 8) : null);
  if (!label) return <span className="text-subtle-foreground">—</span>;
  const body = (
    <>
      {EntityIcon && <EntityIcon className="size-3.5 shrink-0" />}
      <span className="font-data truncate">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="inline-flex max-w-full items-center gap-1.5 text-muted-foreground hover:text-foreground">
      {body}
    </Link>
  ) : (
    <span className="inline-flex max-w-full items-center gap-1.5 text-muted-foreground">{body}</span>
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
        <Button variant="ghost" size="icon-sm" aria-label="Job actions" className="text-muted-foreground hover:text-foreground">
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
