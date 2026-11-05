"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpCircle,
  FileCode,
  Globe,
  LayoutDashboard,
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
import {
  ErrorState,
  PageHeader,
  RelativeTime,
  SectionCard,
  Spinner,
  StatCard,
  StatStrip,
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
    return (
      <div className="space-y-6">
        <PageHeader icon={LayoutDashboard} title="Overview" />
        <ErrorState error={dash.error} onRetry={dash.refresh} title="Couldn't load the dashboard" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title="Overview"
        description="Fleet, domains, config drift and agent activity at a glance."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={dash.error ? "error" : "online"} pulse={!dash.error} />
              {dash.error ? "Refresh failed — showing last data" : "Live"}
            </span>
            {dash.updatedAt && (
              <span>
                Updated <RelativeTime date={new Date(dash.updatedAt).toISOString()} />
              </span>
            )}
            {(d?.jobs.running ?? 0) > 0 && (
              <Link href="/jobs?status=running" className="inline-flex items-center gap-1.5 text-info hover:underline">
                <StatusDot status="running" size="xs" />
                <span className="font-data">{d?.jobs.running}</span> running
              </Link>
            )}
          </>
        }
        actions={
          <Button variant="outline" onClick={refreshAll} disabled={refreshing}>
            {refreshing ? <Spinner /> : <RefreshCw />}
            Refresh
          </Button>
        }
      />

      {/* KPI strip */}
      <StatStrip className="lg:grid-flow-col">
        <StatCard
          label="Machines online"
          icon={Server}
          loading={loadingDash}
          value={d ? formatNumber(d.machines.online) : "—"}
          suffix={d ? `/ ${d.machines.total}` : undefined}
          progress={d ? pct(d.machines.online, d.machines.total) : undefined}
          progressTone={d && d.machines.offline > 0 ? "warning" : "success"}
          tone={d && d.machines.offline > 0 ? "warning" : "default"}
          sub={
            d ? (
              <>
                <span className={cn(d.machines.offline > 0 && "text-destructive")}>{d.machines.offline} offline</span>
                {d.machines.updating > 0 ? ` · ${d.machines.updating} updating` : ""}
              </>
            ) : undefined
          }
          href="/machines"
        />
        <StatCard
          label="Domains healthy"
          icon={Globe}
          loading={loadingDash}
          value={d ? formatNumber(d.domains.healthy) : "—"}
          suffix={d ? `/ ${d.domains.total}` : undefined}
          progress={d ? pct(d.domains.healthy, d.domains.total) : undefined}
          progressTone={d && d.domains.unhealthy > 0 ? "destructive" : "success"}
          tone={d && d.domains.unhealthy > 0 ? "destructive" : "default"}
          sub={
            d ? (
              <>
                <span className={cn(d.domains.unhealthy > 0 && "text-destructive")}>{d.domains.unhealthy} unhealthy</span> · {d.domains.unknown} unknown
              </>
            ) : undefined
          }
          href="/domains"
        />
        <StatCard
          label="Apply failures"
          icon={ShieldAlert}
          loading={loadingDash}
          value={d ? formatNumber(d.domains.apply_failed) : "—"}
          tone={d && d.domains.apply_failed > 0 ? "destructive" : "default"}
          sub={d ? (d.domains.applying > 0 ? `${d.domains.applying} applying now` : "No apply in progress") : undefined}
          href="/domains"
        />
        <StatCard
          label="Configs out of sync"
          icon={FileCode}
          loading={loadingDash}
          value={d ? formatNumber(d.nginx_configs.out_of_sync) : "—"}
          suffix={d ? `/ ${d.nginx_configs.total}` : undefined}
          tone={d && d.nginx_configs.out_of_sync > 0 ? "warning" : "default"}
          sub={d ? `${d.nginx_configs.out_of_sync_domains} domains awaiting apply` : undefined}
          href="/configs/nginx"
        />
        <StatCard
          label="Active bans"
          icon={ShieldBan}
          loading={loadingDash}
          value={d?.security ? formatNumber(d.security.active_bans) : "—"}
          sub={d ? (d.security ? `+${d.security.bans_24h} in last 24h` : "Not available") : undefined}
          href="/security/bans"
        />
        <StatCard
          label="Outdated agents"
          icon={ArrowUpCircle}
          loading={loadingDash}
          value={d && d.machines.outdated_agents !== null ? formatNumber(d.machines.outdated_agents) : "—"}
          tone={d && (d.machines.outdated_agents ?? 0) > 0 ? "warning" : "default"}
          sub={
            d ? (
              d.machines.latest_agent_version ? (
                <>
                  Latest <span className="font-data">{d.machines.latest_agent_version}</span>
                  {d.domains.ssl_expiring_soon ? <span className="text-warning"> · {d.domains.ssl_expiring_soon} certs expiring</span> : null}
                </>
              ) : (
                "Latest version unknown"
              )
            ) : undefined
          }
        />
      </StatStrip>


      <div className="grid gap-4 lg:grid-cols-3">
        <FleetPanel className="lg:col-span-2" top={d?.top_machines_by_cpu} machines={machines.data} loading={loadingDash} />

        <AttentionPanel
          domains={domains.data}
          machines={machines.data}
          configs={configs.data}
          latestAgent={d?.machines.latest_agent_version}
          loading={domains.loading || machines.loading}
          onChanged={refreshAll}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
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
