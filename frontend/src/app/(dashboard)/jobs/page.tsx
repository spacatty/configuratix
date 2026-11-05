"use client";

import * as React from "react";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ListChecks, RefreshCw, Search, X } from "lucide-react";

import { api, type JobCounts, type JobListItem, type JobListParams, type Machine } from "@/lib/api";
import { JOB_ACTION_OPTIONS, JOB_ENTITY_OPTIONS, JOBS_CHANGED_EVENT, isJobActive } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EmptyState,
  ErrorState,
  MachinePicker,
  PageHeader,
  Spinner,
  StatusDot,
  openJobLogs,
  trackJob,
  usePolling,
} from "@/components/app";
import { JobsTable } from "@/components/jobs/jobs-table";
import { useJobActions } from "@/components/jobs/use-job-actions";
import { useNow } from "@/components/jobs/job-detail";

const PAGE_SIZE = 50;
const STATUS_TABS: { value: string; label: string; key?: keyof JobCounts }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running", key: "running" },
  { value: "pending", label: "Pending", key: "pending" },
  { value: "failed", label: "Failed", key: "failed" },
  { value: "completed", label: "Completed", key: "completed" },
  { value: "cancelled", label: "Cancelled", key: "cancelled" },
];
const RANGES = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "168h", label: "7d" },
  { value: "all", label: "All" },
];

export default function JobsPage() {
  return (
    <Suspense>
      <JobsPageInner />
    </Suspense>
  );
}

function readGroupPref(): boolean {
  try {
    return localStorage.getItem("jobs:groupByDay") !== "0";
  } catch {
    return true;
  }
}

function JobsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const status = sp.get("status") ?? "all";
  const machineId = sp.get("machine") ?? null;
  const action = sp.get("action") ?? null;
  const entity = sp.get("entity") ?? null;
  const range = sp.get("range") ?? "all";
  const urlQ = sp.get("q") ?? "";

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || (k === "status" && v === "all") || (k === "range" && v === "all")) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname]
  );

  // Debounced search → URL
  const [q, setQ] = React.useState(urlQ);
  React.useEffect(() => setQ(urlQ), [urlQ]);
  React.useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => setParams({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [q, urlQ, setParams]);

  // Deep link ?job=<id> opens the sheet once
  const jobParam = sp.get("job");
  const openedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!jobParam || openedRef.current === jobParam) return;
    openedRef.current = jobParam;
    // Defer so the provider is mounted
    const t = setTimeout(() => openJobLogs(jobParam), 0);
    return () => clearTimeout(t);
  }, [jobParam]);

  const [groupByDay, setGroupByDay] = React.useState(true);
  React.useEffect(() => setGroupByDay(readGroupPref()), []);
  const toggleGroup = (v: boolean) => {
    setGroupByDay(v);
    try {
      localStorage.setItem("jobs:groupByDay", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const baseParams = React.useMemo<JobListParams>(
    () => ({
      q: urlQ || undefined,
      machine_id: machineId ?? undefined,
      type: action ?? undefined,
      entity_type: entity ?? undefined,
      since: range !== "all" ? range : undefined,
      status: status !== "all" ? status : undefined,
    }),
    [urlQ, machineId, action, entity, range, status]
  );
  const paramsKey = JSON.stringify(baseParams);

  /* ---------------------------------------------------------------- data */
  // Accumulated rows (first page refreshed by polling + older pages via cursor).
  const [rows, setRows] = React.useState<Map<string, JobListItem>>(new Map());
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [counts, setCounts] = React.useState<JobCounts | null>(null);
  const seen = React.useRef<Set<string>>(new Set());
  const [fresh, setFresh] = React.useState<Set<string>>(new Set());
  const hasMoreLoaded = React.useRef(false);

  const anyActive = React.useMemo(() => {
    for (const j of rows.values()) if (isJobActive(j)) return true;
    return (counts?.running ?? 0) + (counts?.pending ?? 0) > 0;
  }, [rows, counts]);

  const first = usePolling(() => api.listJobsPage({ ...baseParams, limit: PAGE_SIZE }), anyActive ? 4000 : 15_000, {
    deps: [paramsKey],
  });
  const { refresh } = first;

  // reset on filter change
  React.useEffect(() => {
    setRows(new Map());
    setCursor(null);
    setCounts(null);
    seen.current = new Set();
    hasMoreLoaded.current = false;
    setFresh(new Set());
  }, [paramsKey]);

  // merge first page
  React.useEffect(() => {
    const page = first.data;
    if (!page) return;
    setCounts(page.counts);
    setRows((prev) => {
      const next = new Map(prev);
      const ids = new Set(page.jobs.map((j) => j.id));
      // Remove rows inside the first page's window that no longer match.
      const oldest = page.jobs.length ? new Date(page.jobs[page.jobs.length - 1].created_at).getTime() : Infinity;
      for (const [id, j] of next) {
        if (ids.has(id)) continue;
        if (!page.next_cursor || new Date(j.created_at).getTime() >= oldest) next.delete(id);
      }
      for (const j of page.jobs) next.set(j.id, j);
      return next;
    });
    if (!hasMoreLoaded.current) setCursor(page.next_cursor);
    // new arrivals animate in (not on the first load)
    const arrived = new Set<string>();
    const initial = seen.current.size === 0;
    for (const j of page.jobs) {
      if (!seen.current.has(j.id)) {
        if (!initial) arrived.add(j.id);
        seen.current.add(j.id);
      }
    }
    if (arrived.size) setFresh(arrived);
  }, [first.data]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api.listJobsPage({ ...baseParams, limit: PAGE_SIZE, cursor });
      hasMoreLoaded.current = true;
      setRows((prev) => {
        const next = new Map(prev);
        for (const j of page.jobs) {
          next.set(j.id, j);
          seen.current.add(j.id);
        }
        return next;
      });
      setCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  };

  React.useEffect(() => {
    const h = () => void refresh();
    window.addEventListener(JOBS_CHANGED_EVENT, h);
    return () => window.removeEventListener(JOBS_CHANGED_EVENT, h);
  }, [refresh]);

  const list = React.useMemo(
    () => [...rows.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [rows]
  );

  const { data: machines } = usePolling(() => api.listMachines(), 60_000);
  const machineMap = React.useMemo(() => new Map((machines ?? []).map((m: Machine) => [m.id, m])), [machines]);

  const now = useNow(list.some((j) => j.status === "running"));

  const { cancel, retry, retrying } = useJobActions({
    onRetried: (created) => {
      void trackJob(created, { title: created.title ?? undefined });
    },
  });

  const totalAll = counts ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : null;
  const filtersActive = !!(urlQ || machineId || action || entity || range !== "all");
  const loading = first.loading && rows.size === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ListChecks}
        title="Jobs"
        description="Everything agents ran for you: config applies, commands, updates. Click a row for logs, step results and the rollback outcome."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={anyActive ? "running" : "completed"} pulse={anyActive} />
              {anyActive ? "Live · refreshing every 4s" : "Refreshing every 15s"}
            </span>
            {totalAll !== null && (
              <span>
                <span className="font-data text-foreground">{totalAll}</span> jobs match
              </span>
            )}
          </>
        }
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={first.refreshing}>
            {first.refreshing ? <Spinner /> : <RefreshCw />}
            Refresh
          </Button>
        }
      />

      <div className="space-y-3">
        {/* Status tabs */}
        <div role="tablist" aria-label="Status" className="flex flex-wrap items-center gap-1 border-b border-border">
          {STATUS_TABS.map((t) => {
            const n = t.key ? counts?.[t.key] : totalAll;
            const activeTab = status === t.value;
            return (
              <button
                key={t.value}
                role="tab"
                aria-selected={activeTab}
                onClick={() => setParams({ status: t.value })}
                className={cn(
                  "relative -mb-px inline-flex h-9 items-center gap-2 border-b-2 px-3 text-[13px] transition-colors outline-none focus-visible:text-foreground",
                  activeTab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.value === "running" && (counts?.running ?? 0) > 0 && <StatusDot status="running" size="xs" />}
                {t.label}
                <span
                  className={cn(
                    "font-data rounded px-1.5 py-px text-[11px]",
                    t.value === "failed" && (n ?? 0) > 0 ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground",
                    t.value === "running" && (n ?? 0) > 0 && "bg-info/12 text-info"
                  )}
                >
                  {n ?? "–"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles… (e.g. shop.example.com)"
              className="h-8 pl-8"
              aria-label="Search jobs"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <MachinePicker
            value={machineId}
            onValueChange={(id) => setParams({ machine: id })}
            clearable
            placeholder="All machines"
            size="sm"
            className="w-52"
            modal={false}
            groupBy="status"
          />
          <Combobox
            items={JOB_ACTION_OPTIONS}
            getValue={(o) => o.value}
            getLabel={(o) => o.label}
            getKeywords={(o) => [o.value]}
            getGroup={(o) => o.group}
            renderItem={(o) => (
              <div className="flex w-full items-center justify-between gap-2">
                <span>{o.label}</span>
                <span className="font-data text-[11px] text-subtle-foreground">{o.value}</span>
              </div>
            )}
            value={action}
            onValueChange={(v) => setParams({ action: v })}
            clearable
            placeholder="All actions"
            searchPlaceholder="Search actions…"
            size="sm"
            className="w-44"
            contentClassName="w-72"
            modal={false}
          />
          <Combobox
            items={JOB_ENTITY_OPTIONS}
            getValue={(o) => o.value}
            getLabel={(o) => o.label}
            value={entity}
            onValueChange={(v) => setParams({ entity: v })}
            clearable
            placeholder="Any target"
            size="sm"
            className="w-36"
            modal={false}
          />
          <ToggleGroup type="single" size="sm" value={range} onValueChange={(v) => v && setParams({ range: v })} aria-label="Time range">
            {RANGES.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value} className="font-data px-2.5 text-xs">
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setParams({ q: null, machine: null, action: null, entity: null, range: null });
              }}
            >
              <X />
              Reset
            </Button>
          )}
          <div className="ml-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle size="sm" pressed={groupByDay} onPressedChange={toggleGroup} aria-label="Group by day" variant="outline">
                  <CalendarDays />
                  <span className="hidden text-xs md:inline">Group by day</span>
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>Group rows by day with sticky headers</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {first.error && rows.size === 0 ? (
        <ErrorState error={first.error} onRetry={refresh} title="Couldn't load jobs" />
      ) : (
        <div className="space-y-3">
          <JobsTable
            jobs={list}
            loading={loading}
            machines={machineMap}
            groupByDay={groupByDay}
            freshIds={fresh}
            now={now}
            onOpen={(j) => openJobLogs(j)}
            onRetry={(j) => void retry(j)}
            onCancel={(j) => void cancel(j)}
            onFilterMachine={(id) => setParams({ machine: id })}
            retrying={retrying}
            emptyState={
              filtersActive || status !== "all" ? (
                <EmptyState
                  size="compact"
                  bordered={false}
                  icon={Search}
                  title="No jobs match these filters"
                  description="Try a wider time range or clear the filters."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQ("");
                        setParams({ q: null, machine: null, action: null, entity: null, range: null, status: null });
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  bordered={false}
                  icon={ListChecks}
                  title="No jobs yet"
                  description="Applying a domain, changing a firewall rule or running a command creates a job here."
                />
              )
            }
          />
          {list.length > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing <span className="font-data text-foreground">{list.length}</span>
                {status === "all" && totalAll !== null ? (
                  <>
                    {" "}
                    of <span className="font-data text-foreground">{totalAll}</span>
                  </>
                ) : null}
              </span>
              {cursor ? (
                <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore && <Spinner />}
                  Load {PAGE_SIZE} more
                </Button>
              ) : (
                <span className="text-subtle-foreground">End of history</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
