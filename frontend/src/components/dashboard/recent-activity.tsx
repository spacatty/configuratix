"use client";

import * as React from "react";
import Link from "next/link";
import { History, ListChecks } from "lucide-react";

import { cn } from "@/lib/utils";
import type { JobListItem } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { isJobActive, jobTitle } from "@/lib/jobs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/components/app/layout-primitives";
import { StatusDot } from "@/components/app/status";
import { RelativeTime } from "@/components/app/data-display";
import { EmptyState } from "@/components/app/states";
import { openJobLogs } from "@/components/app/jobs";
import { useNow } from "@/components/jobs/job-detail";

export function RecentActivity({ jobs, loading, className }: { jobs: JobListItem[] | undefined; loading?: boolean; className?: string }) {
  const now = useNow(!!jobs?.some((j) => j.status === "running"));
  return (
    <SectionCard
      fill
      className={className}
      title="Recent activity"
      icon={History}
      actions={
        <Button asChild variant="ghost" size="xs">
          <Link href="/jobs">All jobs</Link>
        </Button>
      }
      flush
    >
      {loading && !jobs ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <EmptyState size="compact" bordered={false} icon={ListChecks} title="No jobs yet" />
      ) : (
        <ul className="divide-y divide-border/60">
          {jobs.map((j) => {
            const d =
              j.status === "running" && j.started_at
                ? now - new Date(j.started_at).getTime()
                : j.duration_ms ?? null;
            return (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => openJobLogs(j)}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
                >
                  <StatusDot status={j.status} />
                  <div className="min-w-0 flex-1">
                    <div className={cn("truncate text-[13px]", j.status === "cancelled" && "text-muted-foreground")}>{jobTitle(j)}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {j.machine_title || j.machine_hostname || "—"}
                      {j.status === "failed" && j.error_message ? <span className="text-destructive/90"> · {j.error_message}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <RelativeTime date={j.created_at} noTooltip className="text-[11px] text-muted-foreground" />
                    <span className={cn("font-data text-[11px]", isJobActive(j) ? "text-info" : "text-subtle-foreground")}>
                      {j.status === "pending" ? "queued" : formatDuration(d)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
