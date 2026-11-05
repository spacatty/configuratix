"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Activity, ArrowRight, Ban, BarChart3, Bot, RefreshCw, Server, Shield, ShieldCheck, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSkeleton,
  SectionCard,
  Spinner,
  StatCard,
  usePolling,
} from "@/components/app";
import { formatNumber } from "@/lib/format";
import { BanReasonBadge, SecurityNav, fetchBans } from "@/components/security/shared";
import { BanTimeline, bucketByDay } from "@/components/security/ban-timeline";

const TIMELINE_DAYS = 14;

export default function SecurityOverviewPage() {
  const stats = usePolling(() => api.getSecurityStats(), 30000);
  // Recent bans (incl. expired) → bars-over-time. Slower cadence; it's a heavier call.
  const recent = usePolling(() => fetchBans({ active_only: false }, 1000), 60000);

  const buckets = useMemo(
    () => (recent.data ? bucketByDay(recent.data.bans.map((b) => b.banned_at), TIMELINE_DAYS) : null),
    [recent.data]
  );

  const s = stats.data;

  if (stats.loading) return <PageSkeleton />;
  if (stats.error && !s) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Shield} title="Security" />
        <ErrorState error={stats.error} onRetry={stats.refresh} />
      </div>
    );
  }

  const reasonMax = Math.max(1, ...(s?.top_reasons ?? []).map((r) => r.count));
  const machineMax = Math.max(1, ...(s?.top_machines ?? []).map((m) => m.count));
  const truncated = recent.data && recent.data.total > recent.data.bans.length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Shield}
        title="Security"
        description="IP banning, user-agent blocking and endpoint protection across all agents."
        actions={
          <>
            <Button variant="outline" onClick={() => { stats.refresh(); recent.refresh(); }} disabled={stats.refreshing}>
              {stats.refreshing ? <Spinner /> : <RefreshCw />}
              Refresh
            </Button>
            <Button asChild>
              <Link href="/security/bans?add=1">
                <Ban />
                Ban IP
              </Link>
            </Button>
          </>
        }
      />

      <SecurityNav />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active bans"
          icon={Ban}
          value={formatNumber(s?.active_bans ?? 0)}
          suffix={`/ ${formatNumber(s?.total_bans ?? 0)}`}
          sub="Active of all-time bans"
          href="/security/bans"
        />
        <StatCard
          label="Bans today"
          icon={TrendingUp}
          value={formatNumber(s?.bans_today ?? 0)}
          tone={(s?.bans_today ?? 0) > 0 ? "warning" : "default"}
          sub={<><span className="font-data">{formatNumber(s?.bans_this_week ?? 0)}</span> this week</>}
          href="/security/bans"
        />
        <StatCard
          label="Whitelisted"
          icon={ShieldCheck}
          value={formatNumber(s?.whitelist_count ?? 0)}
          sub="IPs and CIDR ranges never banned"
          href="/security/whitelist"
        />
        <StatCard
          label="UA patterns"
          icon={Bot}
          value={formatNumber(s?.ua_pattern_count ?? 0)}
          sub="Active blocking patterns"
          href="/security/ua-patterns"
        />
      </div>

      <SectionCard
        title="Bans over time"
        description={`New bans per day, last ${TIMELINE_DAYS} days`}
        icon={BarChart3}
        actions={
          truncated ? (
            <span className="text-xs text-muted-foreground">
              Based on latest <span className="font-data">{formatNumber(recent.data!.bans.length)}</span> bans
            </span>
          ) : null
        }
      >
        {recent.loading ? (
          <div className="flex h-[150px] items-end gap-1">
            {Array.from({ length: TIMELINE_DAYS }).map((_, i) => (
              <div key={i} className="skeleton-shimmer flex-1 rounded-t-[3px]" style={{ height: `${20 + ((i * 37) % 60)}%` }} />
            ))}
          </div>
        ) : buckets && buckets.some((b) => b.count > 0) ? (
          <BanTimeline buckets={buckets} />
        ) : (
          <EmptyState size="compact" bordered={false} icon={BarChart3} title="No bans in the last two weeks" />
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top ban reasons" icon={Activity} flush>
          {!s?.top_reasons?.length ? (
            <EmptyState size="compact" bordered={false} icon={Activity} title="No bans recorded yet" />
          ) : (
            <ul className="divide-y divide-border">
              {s.top_reasons.map((r) => (
                <li key={r.reason}>
                  <Link
                    href={`/security/bans?reason=${encodeURIComponent(r.reason)}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60"
                  >
                    <div className="w-28 shrink-0">
                      <BanReasonBadge reason={r.reason} />
                    </div>
                    <Progress value={(r.count / reasonMax) * 100} size="sm" className="flex-1" />
                    <span className="font-data w-14 shrink-0 text-right text-[13px]">{formatNumber(r.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Top source machines" icon={Server} flush>
          {!s?.top_machines?.length ? (
            <EmptyState size="compact" bordered={false} icon={Server} title="No machine has reported bans" />
          ) : (
            <ul className="divide-y divide-border">
              {s.top_machines.map((m, i) => (
                <li key={m.machine_id}>
                  <Link
                    href={`/machines/${m.machine_id}`}
                    className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60"
                  >
                    <span className="font-data w-4 shrink-0 text-xs text-subtle-foreground">{i + 1}</span>
                    <span className="w-40 shrink-0 truncate text-[13px] font-medium">{m.machine_name || m.machine_id}</span>
                    <Progress value={(m.count / machineMax) * 100} size="sm" className="flex-1" />
                    <span className="font-data w-14 shrink-0 text-right text-[13px]">{formatNumber(m.count)}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
