"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowUpRight, Ban, ListChecks, MoreHorizontal, RefreshCw, RotateCcw, ScrollText } from "lucide-react";
import { api, type JobCounts, type JobListItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, RelativeTime, Spinner, StatusBadge, errorMessage, isJobActive, jobTitle, openJobLogs, trackJob, useConfirm, usePolling } from "@/components/app";

const STATUS_FILTERS: { value: string; label: string; key?: keyof JobCounts }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "failed", label: "Failed", key: "failed" },
  { value: "completed", label: "Completed", key: "completed" },
  { value: "cancelled", label: "Cancelled", key: "cancelled" },
];

function statusParam(v: string): string[] | undefined {
  if (v === "all") return undefined;
  if (v === "active") return ["pending", "running"];
  return [v];
}

export function JobsTab({ machineId, machineName, active }: { machineId: string; machineName: string; active: boolean }) {
  const confirm = useConfirm();
  const [status, setStatus] = React.useState("all");
  const [limit, setLimit] = React.useState(50);
  const [hasActive, setHasActive] = React.useState(false);

  const q = usePolling(() => api.listJobsPage({ machine_id: machineId, status: statusParam(status), limit }), hasActive ? 3000 : 15000, {
    enabled: active,
    deps: [machineId, status, limit],
  });
  const jobs = React.useMemo(() => q.data?.jobs ?? [], [q.data]);
  const counts = q.data?.counts;
  React.useEffect(() => setHasActive(jobs.some((j) => isJobActive(j))), [jobs]);

  const cancel = React.useCallback(
    async (j: JobListItem) => {
      const ok = await confirm({
        title: `Cancel “${jobTitle(j)}”?`,
        description: j.status === "running" ? "The agent is asked to stop; steps already applied are not undone." : "The job is removed from the queue.",
        destructive: true,
        confirmText: "Cancel job",
        cancelText: "Keep running",
        icon: Ban,
        onConfirm: () => api.cancelJob(j.id),
      });
      if (ok) {
        toast.success(j.status === "running" ? "Cancellation requested" : "Job cancelled");
        void q.refresh();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm]
  );

  const retry = React.useCallback(
    async (j: JobListItem) => {
      try {
        const created = await api.retryJob(j.id);
        void q.refresh();
        trackJob(created.job_id ?? created.id, { title: `Retry: ${jobTitle(j)}`, description: machineName, onDone: () => q.refresh() });
      } catch (e) {
        toast.error("Couldn't retry job", { description: errorMessage(e) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [machineName]
  );

  const columns: ColumnDef<JobListItem>[] = React.useMemo(
    () => [
      {
        id: "title",
        accessorFn: (j) => jobTitle(j),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Job" />,
        meta: { label: "Job" },
        cell: ({ row }) => {
          const j = row.original;
          return (
            <div className="min-w-[220px] max-w-[460px]">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium">{jobTitle(j)}</span>
                {j.parent_job_id && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <RotateCcw className="size-3 shrink-0 text-subtle-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>Retry of an earlier job</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {j.status === "failed" && j.error_message ? (
                <div className="font-data truncate text-[11px] text-destructive">{j.error_message}</div>
              ) : j.created_by_email ? (
                <div className="truncate text-[11px] text-subtle-foreground">by {j.created_by_email}</div>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "type",
        accessorFn: (j) => j.action || j.type,
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline" className="font-data max-w-[180px] truncate font-normal text-muted-foreground">
            {row.original.action || row.original.type}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={row.original.status} />
            {row.original.cancel_requested && isJobActive(row.original) && <span className="text-[11px] text-warning">cancelling</span>}
          </div>
        ),
      },
      {
        id: "started",
        accessorFn: (j) => new Date(j.started_at ?? j.created_at).getTime(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Started" align="right" />,
        meta: { label: "Started", align: "right" },
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            <RelativeTime date={row.original.started_at ?? row.original.created_at} />
          </span>
        ),
      },
      {
        id: "duration",
        accessorFn: (j) => j.duration_ms ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Duration" align="right" />,
        meta: { label: "Duration", align: "right" },
        cell: ({ row }) => (
          <span className={cn("font-data text-xs", row.original.status === "running" ? "text-info" : "text-muted-foreground")}>
            {row.original.duration_ms != null ? formatDuration(row.original.duration_ms) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "attempts",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Attempts" align="right" />,
        meta: { label: "Attempts", align: "right" },
        cell: ({ row }) => (
          <span className={cn("font-data text-xs", (row.original.attempts ?? 0) > 1 ? "text-warning" : "text-muted-foreground")}>{row.original.attempts ?? 0}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { align: "right", className: "w-10" },
        cell: ({ row }) => {
          const j = row.original;
          const activeJob = isJobActive(j);
          const retryable = j.status === "failed" || j.status === "cancelled";
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Job actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openJobLogs(j.id)}>
                  <ScrollText />
                  Logs & details
                </DropdownMenuItem>
                {retryable && (
                  <DropdownMenuItem onSelect={() => retry(j)}>
                    <RotateCcw />
                    Retry
                  </DropdownMenuItem>
                )}
                {activeJob && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => cancel(j)} disabled={j.cancel_requested}>
                      <Ban />
                      Cancel
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [cancel, retry]
  );

  const countFor = (f: (typeof STATUS_FILTERS)[number]) => {
    if (!counts) return null;
    if (f.value === "all") return counts.pending + counts.running + counts.completed + counts.failed + counts.cancelled;
    if (f.value === "active") return counts.pending + counts.running;
    return f.key ? counts[f.key] : null;
  };

  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.refresh} title="Couldn't load jobs" />;

  return (
    <div className="space-y-3">
    <DataTable
      columns={columns}
      data={jobs}
      loading={q.loading}
      getRowId={(j) => j.id}
      searchKeys={["title", "type", "action", "error_message", "entity_id"]}
      searchPlaceholder="Search jobs…"
      onRowClick={(j) => openJobLogs(j.id)}
      showPagination={false}
      maxHeight="max(420px, calc(100svh - 320px))"
      getRowClassName={(j) => (j.status === "failed" ? "bg-destructive/[0.025]" : undefined)}
      toolbar={
        <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v)}>
          {STATUS_FILTERS.map((f) => {
            const n = countFor(f);
            return (
              <ToggleGroupItem key={f.value} value={f.value} className="gap-1.5">
                {f.label}
                {n != null && (
                  <span className={cn("font-data text-[11px]", f.value === "failed" && n > 0 ? "text-destructive" : f.value === "active" && n > 0 ? "text-info" : "text-subtle-foreground")}>{n}</span>
                )}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      }
      toolbarActions={
        <>
          {hasActive && (
            <span className="flex items-center gap-1.5 text-xs text-info">
              <Spinner className="size-3" />
              live
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => q.refresh()} aria-label="Refresh">
                {q.refreshing ? <Spinner /> : <RefreshCw />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/jobs?machine_id=${machineId}`}>
              Open in Jobs
              <ArrowUpRight />
            </Link>
          </Button>
        </>
      }
      emptyState={
        <EmptyState
          icon={ListChecks}
          title={status === "all" ? "No jobs for this machine yet" : "No jobs with this status"}
          description={status === "all" ? "Config changes, updates and commands run as jobs and show up here." : undefined}
          size="compact"
          bordered={false}
          action={
            status !== "all" ? (
              <Button size="sm" variant="outline" onClick={() => setStatus("all")}>
                Show all jobs
              </Button>
            ) : undefined
          }
        />
      }
    />
      {q.data?.next_cursor && limit < 200 && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => Math.min(200, l + 50))} disabled={q.refreshing}>
            {q.refreshing && <Spinner />}
            Load older jobs
          </Button>
        </div>
      )}
    </div>
  );
}
