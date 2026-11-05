"use client";

import * as React from "react";
import Link from "next/link";
import { Cpu, PowerOff, Server } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DashboardSummary, Machine } from "@/lib/api";
import { machineDisplayName, machineIp, machineLiveness } from "@/lib/jobs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SectionCard } from "@/components/app/layout-primitives";
import { StatusDot } from "@/components/app/status";
import { RelativeTime } from "@/components/app/data-display";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";

type TopMachine = DashboardSummary["top_machines_by_cpu"][number];

function Meter({ label, value }: { label: string; value: number | null | undefined }) {
  const v = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const tone = v === null ? "text-subtle-foreground" : v >= 90 ? "text-destructive" : v >= 75 ? "text-warning" : "text-foreground/85";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-subtle-foreground">{label}</span>
            <span className={cn("font-data text-[12px]", tone)}>{v === null ? "—" : `${v.toFixed(0)}%`}</span>
          </div>
          <Progress value={v ?? 0} tone={v === null ? "muted" : "auto"} size="sm" className="mt-1" />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {label} {v === null ? "unknown" : `${v.toFixed(1)}%`}
      </TooltipContent>
    </Tooltip>
  );
}

export function FleetPanel({
  top,
  machines,
  loading,
  className,
}: {
  top: TopMachine[] | undefined;
  machines: Machine[] | undefined;
  loading?: boolean;
  className?: string;
}) {
  const byId = React.useMemo(() => new Map((machines ?? []).map((m) => [m.id, m])), [machines]);
  const offline = React.useMemo(
    () =>
      (machines ?? [])
        .filter((m) => machineLiveness(m) !== "online")
        .sort((a, b) => new Date(b.last_seen ?? 0).getTime() - new Date(a.last_seen ?? 0).getTime()),
    [machines]
  );
  const rows = (top ?? []).slice(0, 8);

  return (
    <SectionCard
      fill
      className={className}
      title="Fleet health"
      icon={Cpu}
      description="Busiest machines by CPU, with memory and disk"
      actions={
        <Button asChild variant="ghost" size="xs">
          <Link href="/machines">All machines</Link>
        </Button>
      }
      flush
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {loading && !top ? (
            <div className="space-y-4 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] gap-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4" />
                  <Skeleton className="h-4" />
                  <Skeleton className="h-4" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState size="compact" bordered={false} icon={Server} title="No machine metrics yet" description="Agents report CPU, memory and disk with every heartbeat." />
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((t) => {
                const m = byId.get(t.id);
                const ip = m ? machineIp(m) : null;
                return (
                  <li key={t.id} className="grid grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] items-center gap-4 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <StatusDot status={t.online ? "online" : "offline"} pulse={false} />
                      <div className="min-w-0">
                        <Link href={`/machines/${t.id}`} className="block truncate text-[13px] hover:underline underline-offset-2">
                          {t.title || (m ? machineDisplayName(m) : t.id.slice(0, 8))}
                        </Link>
                        {ip && <div className="font-data truncate text-[11px] text-muted-foreground">{ip}</div>}
                      </div>
                    </div>
                    <Meter label="CPU" value={t.cpu} />
                    <Meter label="Mem" value={t.mem_pct} />
                    <Meter label="Disk" value={t.disk_pct} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-border lg:border-t-0 lg:border-l">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <PowerOff className="size-3.5" />
              Not reporting
            </span>
            <span className={cn("font-data", offline.length ? "text-destructive" : "text-subtle-foreground")}>{machines ? offline.length : "—"}</span>
          </div>
          {loading && !machines ? (
            <div className="space-y-2 px-4 pb-4">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : offline.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">Every machine is sending heartbeats.</p>
          ) : (
            <ul className="max-h-[300px] overflow-y-auto pb-2">
              {offline.slice(0, 12).map((m) => (
                <li key={m.id}>
                  <Link href={`/machines/${m.id}`} className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-accent/40">
                    <StatusDot status={machineLiveness(m)} pulse={false} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{machineDisplayName(m)}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {m.last_seen ? <RelativeTime date={m.last_seen} noTooltip /> : "never"}
                    </span>
                  </Link>
                </li>
              ))}
              {offline.length > 12 && <li className="px-4 py-1.5 text-xs text-muted-foreground">+{offline.length - 12} more</li>}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
