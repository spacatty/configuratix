"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpCircle,
  FileCode,
  Globe,
  RefreshCw,
  Server,
  ShieldBan,
  ShieldAlert,
  Timer,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { api, type JobCounts } from "@/lib/api";
import { formatDuration, formatNumber } from "@/lib/format";
import { humanizeJobType } from "@/lib/jobs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ErrorState,
  RelativeTime,
  SectionCard,
  Spinner,
  StatusDot,
  usePolling,
} from "@/components/app";
import { ChartLegend, JobsActivityChart } from "@/components/dashboard/jobs-activity-chart";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { FleetPanel } from "@/components/dashboard/fleet-panel";
import { RecentActivity } from "@/components/dashboard/recent-activity";

const REFRESH_MS = 20_000;

function pct(a: number, b: number) {
  return b > 0 ? (a / b) * 100 : 0;
}

export default function DashboardPage() {
  const dash = usePolling(() => api.getDashboard(), REFRESH_MS);
  const stats = usePolling(() => api.getJobStats(24), 30_000);
  const recent = usePolling(() => api.listJobsPage({ limit: 10 }), 10_000);
  const machines = usePolling(() => api.listMachines(), 30_000);
  const domains = usePolling(() => api.listDomains(), 30_000);
  const configs = usePolling(() => api.listNginxConfigs(), 30_000);

  const d = dash.data;
  const s = stats.data;
  const refreshing = dash.refreshing || stats.refreshing || recent.refreshing;
  const refreshAll = React.useCallback(() => {
    void dash.refresh();
    void stats.refresh();
    void recent.refresh();
    void machines.refresh();
    void domains.refresh();
    void configs.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash.refresh, stats.refresh, recent.refresh, machines.refresh, domains.refresh, configs.refresh]);

  const counts: Partial<JobCounts> | undefined = s?.counts ?? d?.jobs.last24h;
  const buckets = s?.buckets ?? d?.jobs.buckets;
  const total24 = s?.total ?? d?.jobs.total_24h ?? 0;
  const finished = (counts?.completed ?? 0) + (counts?.failed ?? 0);
  const successRate = finished > 0 ? ((counts?.completed ?? 0) / finished) * 100 : null;
  const topFailing = (s?.top_failing ?? d?.jobs.top_failing ?? []).filter((t) => t.failed > 0).slice(0, 5);

  const loadingDash = dash.loading && !d;

  if (dash.error && !d && !dash.loading) {
    return <ErrorState error={dash.error} onRetry={dash.refresh} title="Couldn't load the dashboard" />;
  }

  return (
    // lg+: exactly one viewport tall (minus top bar + page padding); panels scroll inside themselves.
    <div className="flex flex-col gap-3 lg:h-[calc(100svh-6rem)]">
      <div className="flex shrink-0 items-stretch gap-2">
        <div className="grid flex-1 grid-cols-2 overflow-hidden rounded-lg border border-border bg-border gap-px sm:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label="Machines online"
            icon={Server}
            href="/machines"
            loading={loadingDash}
            value={d ? d.machines.online : null}
            total={d?.machines.total}
            tone={d && d.machines.offline > 0 ? "warning" : undefined}
            sub={d ? `${d.machines.offline} offline${d.machines.updating > 0 ? ` · ${d.machines.updating} updating` : ""}` : undefined}
          />
          <Kpi
            label="Domains healthy"
            icon={Globe}
            href="/domains"
            loading={loadingDash}
            value={d ? d.domains.healthy : null}
            total={d?.domains.total}
            tone={d && d.domains.unhealthy > 0 ? "destructive" : undefined}
            sub={d ? `${d.domains.unhealthy} unhealthy · ${d.domains.unknown} unknown` : undefined}
          />
          <Kpi
            label="Apply failures"
            icon={ShieldAlert}
            href="/domains"
            loading={loadingDash}
            value={d ? d.domains.apply_failed : null}
            tone={d && d.domains.apply_failed > 0 ? "destructive" : undefined}
            sub={d ? (d.domains.applying > 0 ? `${d.domains.applying} applying` : "none in progress") : undefined}
          />
          <Kpi
            label="Configs out of sync"
            icon={FileCode}
            href="/configs/nginx"
            loading={loadingDash}
            value={d ? d.nginx_configs.out_of_sync : null}
            total={d?.nginx_configs.total}
            tone={d && d.nginx_configs.out_of_sync > 0 ? "warning" : undefined}
            sub={d ? `${d.nginx_configs.out_of_sync_domains} domains pending` : undefined}
          />
          <Kpi
            label="Active bans"
            icon={ShieldBan}
            href="/security/bans"
            loading={loadingDash}
            value={d?.security ? d.security.active_bans : null}
            sub={d ? (d.security ? `+${d.security.bans_24h} in 24h` : "n/a") : undefined}
          />
          <Kpi
            label="Outdated agents"
            icon={ArrowUpCircle}
            href="/machines"
            loading={loadingDash}
            value={d && d.machines.outdated_agents !== null ? d.machines.outdated_agents : null}
            tone={d && (d.machines.outdated_agents ?? 0) > 0 ? "warning" : undefined}
            sub={d?.machines.latest_agent_version ? `latest ${d.machines.latest_agent_version}` : undefined}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              aria-label="Refresh dashboard"
              className="flex w-9 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              <StatusDot status={dash.error ? "error" : "online"} pulse={!dash.error} size="xs" />
              {refreshing ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {dash.error ? "Refresh failed, showing last data" : "Live"}
            {dash.updatedAt && (
              <span className="text-muted-foreground">
                {" "}· updated <RelativeTime date={new Date(dash.updatedAt).toISOString()} noTooltip />
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      </div>


      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-3 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <FleetPanel className="lg:col-span-2" top={d?.top_machines_by_cpu} machines={machines.data} loading={loadingDash} />

        <AttentionPanel
          domains={domains.data}
          machines={machines.data}
          configs={configs.data}
          latestAgent={d?.machines.latest_agent_version}
          loading={domains.loading || machines.loading}
          onChanged={refreshAll}
        />

        <SectionCard
          fill
          className="lg:col-span-2"
          title="Job activity"
          icon={Activity}
          description="Jobs per hour over the last 24 hours, by outcome"
          actions={
            <Button asChild variant="ghost" size="xs">
              <Link href="/jobs?range=24h">Open jobs</Link>
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
              <MiniStat label="Jobs (24h)" value={stats.loading && !s && !d ? null : formatNumber(total24)} />
              <MiniStat
                label="Success rate"
                value={stats.loading && !s && !d ? null : successRate === null ? "—" : `${successRate.toFixed(successRate >= 99.5 || successRate === 0 ? 0 : 1)}%`}
                tone={successRate !== null && successRate < 90 ? "text-warning" : undefined}
              />
              <MiniStat
                label="Failed"
                value={stats.loading && !s && !d ? null : formatNumber(counts?.failed ?? 0)}
                tone={(counts?.failed ?? 0) > 0 ? "text-destructive" : undefined}
                href={(counts?.failed ?? 0) > 0 ? "/jobs?status=failed&range=24h" : undefined}
              />
              <MiniStat label="Avg duration" icon={Timer} value={stats.loading && !s ? null : formatDuration(s?.avg_duration_ms ?? null)} />
            </div>
            <JobsActivityChart buckets={buckets} loading={stats.loading && dash.loading} />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <ChartLegend counts={counts} />
            </div>
            {topFailing.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TriangleAlert className="size-3.5 text-warning" />
                  Most failing job types
                </div>
                <ul className="space-y-1.5">
                  {topFailing.map((t) => {
                    const rate = pct(t.failed, t.total);
                    return (
                      <li key={t.type} className="grid grid-cols-[minmax(0,1fr)_120px_70px] items-center gap-3 text-[13px]">
                        <Link href={`/jobs?action=${encodeURIComponent(t.type)}&status=failed&range=24h`} className="truncate hover:underline underline-offset-2">
                          {humanizeJobType(t.type)} <span className="font-data text-[11px] text-subtle-foreground">{t.type}</span>
                        </Link>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full bg-destructive/80" style={{ width: `${Math.max(3, rate)}%` }} />
                        </div>
                        <span className="font-data text-right text-xs text-muted-foreground">
                          <span className="text-destructive">{t.failed}</span>/{t.total}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </SectionCard>
        <RecentActivity jobs={recent.data?.jobs} loading={recent.loading} />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
  icon: Icon,
  href,
}: {
  label: string;
  value: string | null;
  tone?: string;
  icon?: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      {value === null ? <Skeleton className="mt-1 h-5 w-14" /> : <div className={cn("font-data mt-0.5 text-lg leading-6 font-medium tracking-tight", tone)}>{value}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block bg-card px-3 py-2 transition-colors hover:bg-surface-2/60">
      {body}
    </Link>
  ) : (
    <div className="bg-card px-3 py-2">{body}</div>
  );
}

function Kpi({
  label,
  icon: Icon,
  href,
  value,
  total,
  sub,
  tone,
  loading,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  value: number | null;
  total?: number;
  sub?: string;
  tone?: "warning" | "destructive";
  loading?: boolean;
}) {
  return (
    <Link href={href} className="group flex min-w-0 flex-col gap-1 bg-card px-3 py-2 transition-colors hover:bg-surface-2/60">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-5 w-16" />
      ) : (
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "font-data text-lg leading-none font-semibold tabular-nums",
              value && tone === "warning" && "text-warning",
              value && tone === "destructive" && "text-destructive"
            )}
          >
            {value === null ? "—" : formatNumber(value)}
            {total !== undefined && <span className="text-xs font-normal text-subtle-foreground">/{formatNumber(total)}</span>}
          </span>
          {sub && <span className="truncate text-[11px] text-subtle-foreground">{sub}</span>}
        </div>
      )}
    </Link>
  );
}
