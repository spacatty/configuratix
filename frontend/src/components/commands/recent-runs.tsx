"use client";

import * as React from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { api, type JobListItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, RelativeTime, SectionCard, StatusDot, jobTitle, openJobLogs, usePolling } from "@/components/app";
import { durationBetween, formatDuration } from "@/lib/format";

/** Jobs created from command templates (entity_type=command), newest first. */
async function listCommandRuns(limit: number): Promise<JobListItem[]> {
  const page = await api.listJobsPage({ entity_type: "command", limit });
  return page.jobs ?? [];
}

export function RecentCommandRuns({ refreshKey, limit = 12 }: { refreshKey?: number; limit?: number }) {
  const { data, loading, error, refresh } = usePolling(() => listCommandRuns(limit), 10000);

  React.useEffect(() => {
    if (refreshKey) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <SectionCard
      title="Recent runs"
      icon={History}
      flush
      actions={
        <Button variant="ghost" size="xs" asChild>
          <Link href="/jobs">All jobs</Link>
        </Button>
      }
    >
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error && !data ? (
        <div className="p-4 text-xs text-muted-foreground">Run history isn&apos;t available.</div>
      ) : !data?.length ? (
        <EmptyState size="compact" bordered={false} icon={History} title="No runs yet" description="Commands you run show up here with live status." />
      ) : (
        <ul className="divide-y divide-border">
          {data.map((j) => {
            const machine = j.machine_title || j.machine_hostname;
            const dur = j.duration_ms ?? (j.started_at ? durationBetween(j.started_at, j.finished_at ?? undefined) : null);
            return (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => openJobLogs(j.id)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-2/60"
                >
                  <StatusDot status={j.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{jobTitle(j)}</div>
                    <div className="truncate text-xs text-muted-foreground">{machine ?? j.created_by_email ?? "—"}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <RelativeTime date={j.created_at} className="block text-xs text-muted-foreground" />
                    {dur != null && j.finished_at && (
                      <span className="font-data text-[11px] text-subtle-foreground">{formatDuration(dur)}</span>
                    )}
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
