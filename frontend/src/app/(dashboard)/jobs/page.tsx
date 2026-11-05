"use client";

import * as React from "react";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { ListChecks, RefreshCw, Search } from "lucide-react";

import { api, type JobCounts, type JobListItem, type JobListParams, type Machine } from "@/lib/api";
import { cn } from "@/lib/utils";
import { JOB_ACTION_OPTIONS, JOB_ENTITY_OPTIONS, JOBS_CHANGED_EVENT, isJobActive } from "@/lib/jobs";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableFacet } from "@/components/ui/data-table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EmptyState,
  ErrorState,
  FillPage,
  Metric,
  MetricBar,
  MetricSegments,
  PageHeader,
  Spinner,
  StatusDot,
  openJobLogs,
  trackJob,
  usePolling,
} from "@/components/app";
import { JOB_HIDDEN_COLUMNS, buildJobColumns } from "@/components/jobs/job-columns";
import { useJobActions } from "@/components/jobs/use-job-actions";
import { useNow } from "@/components/jobs/job-detail";

const PAGE_SIZE = 50;
const STATUSES: { value: keyof JobCounts; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
const RANGES = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "168h", label: "Last 7 days" },
];
/** URL param ↔ facet column. */
const FILTER_PARAMS: Record<string, string> = { status: "status", machine: "machine", action: "action", target: "entity", created_at: "range" };

function sinceMidnight(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function JobsPage() {
  return (
    <Suspense>
      <JobsPageInner />
    </Suspense>
  );
}

function JobsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const statusParam = sp.get("status") ?? "";
  const statuses = React.useMemo(() => statusParam.split(",").filter(Boolean), [statusParam]);
  const machineId = sp.get("machine") ?? null;
  const action = sp.get("action") ?? null;
  const entity = sp.get("entity") ?? null;
  const range = sp.get("range") ?? null;
  const urlQ = sp.get("q") ?? "";

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
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

  const baseParams = React.useMemo<JobListParams>(
    () => ({
      q: urlQ || undefined,
      machine_id: machineId ?? undefined,
      type: action ?? undefined,
      entity_type: entity ?? undefined,
      since: range ?? undefined,
      status: statuses.length ? statuses : undefined,
    }),
    [urlQ, machineId, action, entity, range, statuses]
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

  // Today's numbers come from their own query so they don't depend on how many rows are loaded.
  const today = usePolling(() => api.listJobsPage({ since: sinceMidnight(), limit: 1 }), anyActive ? 4000 : 15_000);
  const todayCounts = today.data?.counts;
  const sum = (c?: JobCounts | null) => (c ? Object.values(c).reduce((a, b) => a + (b ?? 0), 0) : null);
  const totalAll = sum(counts);
  const todayTotal = sum(todayCounts);
  const todayActive = (todayCounts?.running ?? 0) + (todayCounts?.pending ?? 0);
  const filtersActive = !!(urlQ || machineId || action || entity || range || statuses.length);
  const loading = first.loading && rows.size === 0;
  const clearFilters = () => {
    setQ("");
    setParams({ q: null, status: null, machine: null, action: null, entity: null, range: null });
  };

  const columns = React.useMemo(
    () =>
      buildJobColumns({
        machines: machineMap,
        now,
        onOpen: (j) => openJobLogs(j),
        onRetry: (j) => void retry(j),
        onCancel: (j) => void cancel(j),
        onFilterMachine: (id) => setParams({ machine: id }),
        retrying,
      }),
    [machineMap, now, retry, cancel, setParams, retrying]
  );

  const facets = React.useMemo<DataTableFacet[]>(
    () => [
      {
        columnId: "status",
        title: "Status",
        manual: true,
        options: STATUSES.map((s) => ({ value: s.value, label: s.label, count: counts?.[s.value] ?? undefined })),
      },
      {
        columnId: "machine",
        title: "Machine",
        manual: true,
        single: true,
        options: (machines ?? [])
          .map((m) => ({ value: m.id, label: m.title || m.hostname || m.id.slice(0, 8) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
      { columnId: "action", title: "Action", manual: true, single: true, options: JOB_ACTION_OPTIONS },
      { columnId: "target", title: "Target", manual: true, single: true, options: JOB_ENTITY_OPTIONS },
      { columnId: "created_at", title: "Created", manual: true, single: true, options: RANGES },
    ],
    [counts, machines]
  );

  const columnFilters = React.useMemo<ColumnFiltersState>(() => {
    const out: ColumnFiltersState = [];
    if (statuses.length) out.push({ id: "status", value: statuses });
    if (machineId) out.push({ id: "machine", value: [machineId] });
    if (action) out.push({ id: "action", value: [action] });
    if (entity) out.push({ id: "target", value: [entity] });
    if (range) out.push({ id: "created_at", value: [range] });
    return out;
  }, [statuses, machineId, action, entity, range]);

  const onColumnFiltersChange = (next: ColumnFiltersState) => {
    const patch: Record<string, string | null> = {};
    for (const [col, param] of Object.entries(FILTER_PARAMS)) {
      const v = next.find((f) => f.id === col)?.value as string[] | undefined;
      patch[param] = v?.length ? v.join(",") : null;
    }
    setParams(patch);
  };

  return (
    <FillPage>
      <PageHeader
        title="Jobs"
        stats={
          <MetricBar>
            <Metric label="Jobs" value={totalAll ?? 0} loading={totalAll === null} href={pathname}>
              <MetricSegments
                segments={[
                  { value: (counts?.running ?? 0) + (counts?.pending ?? 0), tone: "info", label: "active" },
                  { value: counts?.completed ?? 0, tone: "success", label: "completed" },
                  { value: counts?.failed ?? 0, tone: "destructive", label: "failed" },
                ]}
              />
            </Metric>
            <Metric
              label="Today"
              value={todayTotal ?? 0}
              hint={todayTotal ? `${todayActive} active · ${todayCounts?.failed ?? 0} failed` : undefined}
              loading={todayTotal === null}
              href={`${pathname}?range=24h`}
            />
            <Metric
              label="Running"
              value={counts?.running ?? 0}
              hint={counts?.pending ? `${counts.pending} queued` : undefined}
              loading={totalAll === null}
              tone={(counts?.running ?? 0) > 0 ? "info" : "default"}
              href={`${pathname}?status=running,pending`}
            />
            <Metric
              label="Failed"
              value={counts?.failed ?? 0}
              loading={totalAll === null}
              tone={(counts?.failed ?? 0) > 0 ? "destructive" : "default"}
              href={`${pathname}?status=failed`}
            />
          </MetricBar>
        }
        meta={
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status={anyActive ? "running" : "completed"} pulse={anyActive} />
            {anyActive ? "Live · 4s" : "Refreshing every 15s"}
          </span>
        }
      />

      {first.error && rows.size === 0 ? (
        <ErrorState error={first.error} onRetry={refresh} title="Couldn't load jobs" />
      ) : (
        // DataTable inside our own card so the cursor footer ("Load more") shares the surface.
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[inset_0_1px_0_0_oklch(1_0_0/3%)] md:min-h-0 md:flex-1">
          <DataTable
            fill
            variant="card"
            bordered={false}
            persistKey="jobs"
            columns={columns}
            data={list}
            loading={loading}
            getRowId={(j) => j.id}
            searchKeys={["title", "action", "type", "entity_id", "machine_title", "machine_hostname", "created_by_email"]}
            searchPlaceholder="Search titles… (e.g. shop.example.com)"
            search={q}
            onSearchChange={setQ}
            facets={facets}
            columnFilters={columnFilters}
            onColumnFiltersChange={onColumnFiltersChange}
            initialState={{ columnVisibility: JOB_HIDDEN_COLUMNS }}
            showPagination={false}
            getRowClassName={(j) => cn(j.status === "failed" && "bg-destructive/[0.025]", fresh.has(j.id) && "animate-fade-in-up")}
            onRowClick={(j, e) => {
              if (e.metaKey || e.ctrlKey) window.open(`/jobs/${j.id}`, "_blank");
              else openJobLogs(j);
            }}
            toolbarActions={
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      void refresh();
                      void today.refresh();
                    }}
                    disabled={first.refreshing}
                    aria-label="Refresh"
                  >
                    {first.refreshing ? <Spinner /> : <RefreshCw />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{anyActive ? "Live, refreshing every 4s" : "Refreshing every 15s"}</TooltipContent>
              </Tooltip>
            }
            emptyState={
              filtersActive ? (
                <EmptyState
                  size="compact"
                  bordered={false}
                  icon={Search}
                  title="No jobs match these filters"
                  description="Try a wider time range or clear the filters."
                  action={
                    <Button variant="outline" size="sm" onClick={clearFilters}>
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
            <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span className="font-data tabular-nums">
                {list.length} <span className="text-subtle-foreground">of</span> {totalAll ?? list.length}
              </span>
              {cursor ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
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
    </FillPage>
  );
}
