"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpCircle, CheckCircle2, FileCode, Globe, HeartPulse, RefreshCw, RotateCcw, Server, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { api, type Domain, type Machine, type NginxConfig } from "@/lib/api";
import { machineDisplayName, machineLiveness } from "@/lib/jobs";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RelativeTime } from "@/components/app/data-display";
import { EmptyState, Spinner, errorMessage } from "@/components/app/states";
import { SectionCard } from "@/components/app/layout-primitives";
import { trackJob } from "@/components/app/jobs";

/** "0.6.0" < "0.10.1" aware comparison. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function isAgentOutdated(m: Machine, latest: string | null | undefined): boolean {
  return !!latest && !!m.agent_version && compareVersions(m.agent_version, latest) < 0;
}

type Severity = "critical" | "warning";
interface Item {
  key: string;
  group: string;
  /** Short tab label for the group. */
  tab: string;
  severity: Severity;
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  detail?: React.ReactNode;
  href?: string;
  action?: { label: string; icon: React.ComponentType<{ className?: string }>; run: () => Promise<unknown> };
}

export interface AttentionPanelProps {
  domains?: Domain[];
  machines?: Machine[];
  configs?: NginxConfig[];
  latestAgent?: string | null;
  loading?: boolean;
  onChanged?: () => void;
  className?: string;
}

function firstJobRef(res: { job?: { id: string } | null; job_id?: string | null; jobs?: Array<{ id: string }> | null }) {
  return res.jobs?.[0] ?? res.job ?? res.job_id ?? null;
}

export function AttentionPanel({ domains, machines, configs, latestAgent, loading, onChanged, className }: AttentionPanelProps) {
  const items = React.useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const d of domains ?? []) {
      if (d.apply_status === "failed") {
        out.push({
          key: `apply:${d.id}`,
          group: "Failed applies",
          tab: "Applies",
          severity: "critical",
          icon: Globe,
          title: <span className="font-data">{d.fqdn}</span>,
          detail: d.last_apply_error || "Last apply failed",
          href: `/domains?q=${encodeURIComponent(d.fqdn)}`,
          action: {
            label: "Retry",
            icon: RotateCcw,
            run: async () => {
              const res = await api.applyDomain(d.id);
              const ref = firstJobRef(res);
              if (ref) void trackJob(ref, { title: `Apply nginx config · ${d.fqdn}`, onDone: () => onChanged?.() });
            },
          },
        });
      }
    }
    for (const d of domains ?? []) {
      if (d.status === "unhealthy") {
        out.push({
          key: `health:${d.id}`,
          group: "Unhealthy domains",
          tab: "Health",
          severity: "critical",
          icon: HeartPulse,
          title: <span className="font-data">{d.fqdn}</span>,
          detail: (
            <>
              {d.last_check_status_code ? <span className="font-data">HTTP {d.last_check_status_code}</span> : "Health check failing"}
              {d.machine_name ? ` · ${d.machine_name}` : ""}
              {d.last_check_at ? (
                <>
                  {" · checked "}
                  <RelativeTime date={d.last_check_at} />
                </>
              ) : null}
            </>
          ),
          href: `/domains?q=${encodeURIComponent(d.fqdn)}`,
          action: {
            label: "Re-check",
            icon: RefreshCw,
            run: async () => {
              const r = await api.triggerDomainHealthCheck(d.id);
              toast.info(`${d.fqdn}: ${r.status}`);
              onChanged?.();
            },
          },
        });
      }
    }
    for (const m of machines ?? []) {
      if (machineLiveness(m) === "offline") {
        out.push({
          key: `offline:${m.id}`,
          group: "Offline machines",
          tab: "Offline",
          severity: "critical",
          icon: Server,
          title: machineDisplayName(m),
          detail: m.last_seen ? (
            <>
              Last seen <RelativeTime date={m.last_seen} />
            </>
          ) : (
            "Never connected"
          ),
          href: `/machines/${m.id}`,
        });
      }
    }
    for (const c of configs ?? []) {
      if ((c.out_of_sync_count ?? 0) > 0) {
        out.push({
          key: `sync:${c.id}`,
          group: "Configs out of sync",
          tab: "Sync",
          severity: "warning",
          icon: FileCode,
          title: c.name,
          detail: `${c.out_of_sync_count} of ${c.domains_count ?? 0} domains run an older version`,
          href: `/configs/nginx/${c.id}`,
          action: {
            label: "Apply",
            icon: Upload,
            run: async () => {
              const res = await api.applyNginxConfig(c.id, { only_out_of_sync: true });
              const errs = res.results.filter((r) => r.error);
              for (const r of res.results) {
                const ref = r.jobs?.[0] ?? r.job_id;
                if (ref) void trackJob(ref, { title: `Apply nginx config · ${r.fqdn}`, quietSuccess: res.results.length > 3 });
              }
              if (errs.length) toast.warning(`${errs.length} domain(s) skipped`, { description: errs.map((e) => `${e.fqdn}: ${e.error}`).join("\n") });
              onChanged?.();
            },
          },
        });
      }
    }
    for (const m of machines ?? []) {
      if (machineLiveness(m) !== "offline" && isAgentOutdated(m, latestAgent)) {
        out.push({
          key: `agent:${m.id}`,
          group: "Outdated agents",
          tab: "Agents",
          severity: "warning",
          icon: ArrowUpCircle,
          title: machineDisplayName(m),
          detail: (
            <span className="font-data">
              {m.agent_version} → {latestAgent}
            </span>
          ),
          href: `/machines/${m.id}`,
          action: {
            label: "Update",
            icon: ArrowUpCircle,
            run: async () => {
              const r = await api.triggerMachineUpdate(m.id);
              void trackJob(r.job_id, { title: `Update agent → ${latestAgent}`, description: machineDisplayName(m), onDone: () => onChanged?.() });
            },
          },
        });
      }
    }
    return out;
  }, [domains, machines, configs, latestAgent, onChanged]);

  const groups = React.useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) m.set(it.group, [...(m.get(it.group) ?? []), it]);
    return [...m.entries()];
  }, [items]);

  const [tab, setTab] = React.useState<string>();
  const activeTab = groups.some(([g]) => g === tab) ? tab : groups[0]?.[0];

  const critical = items.filter((i) => i.severity === "critical").length;

  return (
    <SectionCard
      fill
      className={className}
      title="Needs attention"
      icon={TriangleAlert}
      description={items.length ? `${critical} critical · ${items.length - critical} warnings` : "Problems with a one-click fix where possible"}
      flush
      bodyClassName="flex max-h-[460px] flex-col overflow-hidden lg:max-h-none"
    >
      {loading && !domains && !machines ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-4 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          size="compact"
          bordered={false}
          icon={CheckCircle2}
          title="All clear"
          description="No failed applies, unhealthy domains, offline machines or pending config changes."
          className="py-10"
        />
      ) : (
        <Tabs value={activeTab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
          <TabsList className="h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-0 border-b border-border bg-transparent px-2 py-0 [scrollbar-width:none]">
            {groups.map(([group, list]) => (
              <TabsTrigger
                key={group}
                value={group}
                title={group}
                className="h-9 flex-none rounded-none border-0 border-b-2 border-transparent px-2 text-xs data-[state=active]:border-b-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <span className={cn("size-1.5 rounded-full", list[0].severity === "critical" ? "bg-destructive" : "bg-warning")} />
                {list[0].tab}
                <span className="font-data text-subtle-foreground">{list.length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {groups.map(([group, list]) => (
            <TabsContent key={group} value={group} className="min-h-0 overflow-y-auto data-[state=active]:animate-none">
              <ul className="divide-y divide-border/60">
                {list.map((it) => (
                  <AttentionRow key={it.key} item={it} />
                ))}
              </ul>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </SectionCard>
  );
}

function AttentionRow({ item }: { item: Item }) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const Icon = item.icon;
  const run = async () => {
    if (!item.action) return;
    setBusy(true);
    try {
      await item.action.run();
      setDone(true);
    } catch (e) {
      toast.error(`${item.action.label} failed`, { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const ActionIcon = item.action?.icon;
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30">
      <Icon className={cn("size-4 shrink-0", item.severity === "critical" ? "text-destructive" : "text-warning")} />
      <div className="min-w-0 flex-1">
        {item.href ? (
          <Link href={item.href} className="block truncate text-[13px] hover:underline underline-offset-2">
            {item.title}
          </Link>
        ) : (
          <div className="truncate text-[13px]">{item.title}</div>
        )}
        {item.detail && <div className="truncate text-xs text-muted-foreground">{item.detail}</div>}
      </div>
      {item.action && ActionIcon && (
        <Button size="xs" variant="outline" onClick={() => void run()} disabled={busy || done} className="shrink-0">
          {busy ? <Spinner /> : done ? <CheckCircle2 className="text-success" /> : <ActionIcon />}
          {done ? "Queued" : item.action.label}
        </Button>
      )}
    </li>
  );
}
