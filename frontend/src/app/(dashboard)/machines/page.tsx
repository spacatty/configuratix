"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { Activity, Cpu, FolderTree, KeyRound, Plus, RefreshCw, Server, Tags, Trash2, WifiOff } from "lucide-react";

import { api, type Machine, type MachineGroupMember, type MachineGroupWithCount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  StatCard,
  StatStrip,
  usePolling,
} from "@/components/app";
import { AddMachineDialog } from "@/components/machines/add-machine-dialog";
import { AssignGroupsDialog } from "@/components/machines/assign-groups-dialog";
import { GroupsSheet } from "@/components/machines/groups-sheet";
import { useMachineActions } from "@/components/machines/machine-actions";
import {
  HIDDEN_FACET_COLUMNS,
  STATUS_FACET_OPTIONS,
  buildMachineColumns,
  type MachineColumnHandlers,
} from "@/components/machines/machine-columns";
import { cpuPct, isAgentOutdated, isAgentUpdating, liveness, type FleetMachine } from "@/components/machines/utils";

/** Facet column ids ↔ URL query keys. */
const FACET_PARAMS = ["status", "project", "groups", "agent", "php"] as const;

export default function MachinesPage() {
  return (
    <React.Suspense fallback={null}>
      <MachinesView />
    </React.Suspense>
  );
}

function MachinesView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /* ---------------- data ---------------- */
  const machinesQ = usePolling(() => api.listMachines() as Promise<FleetMachine[]>, 10000);
  const groupsQ = usePolling(() => api.listMachineGroups(), 30000);
  const versionQ = usePolling(() => api.getAgentVersion().catch(() => null), 0);
  const machines = React.useMemo(() => machinesQ.data ?? [], [machinesQ.data]);
  const groups: MachineGroupWithCount[] = React.useMemo(() => groupsQ.data ?? [], [groupsQ.data]);
  const latestAgent = versionQ.data?.version ?? null;

  // Fallback for backends without `group_names`: one request per group (never per row).
  const needsMemberFallback = machines.length > 0 && machines.some((m) => !Array.isArray(m.group_names));
  const groupKey = groups.map((g) => `${g.id}:${g.machine_count}`).join(",");
  const [groupsByMachine, setGroupsByMachine] = React.useState<MachineColumnHandlers["groupsByMachine"]>({});
  React.useEffect(() => {
    if (!needsMemberFallback || groups.length === 0) return;
    let alive = true;
    Promise.all(groups.map((g) => api.getGroupMembers(g.id).then((ms) => [g, ms ?? []] as const).catch(() => [g, [] as MachineGroupMember[]] as const))).then(
      (pairs) => {
        if (!alive) return;
        const map: MachineColumnHandlers["groupsByMachine"] = {};
        for (const [g, ms] of pairs) for (const m of ms) (map[m.id] ??= []).push({ id: g.id, name: g.name, color: g.color, emoji: g.emoji });
        setGroupsByMachine(map);
      }
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsMemberFallback, groupKey]);

  const refreshMachines = machinesQ.refresh;
  const refreshGroups = groupsQ.refresh;
  const refreshAll = React.useCallback(() => {
    void refreshMachines();
    void refreshGroups();
  }, [refreshMachines, refreshGroups]);

  /* ---------------- URL-synced view ---------------- */
  const search = params.get("q") ?? "";
  const columnFilters: ColumnFiltersState = React.useMemo(
    () =>
      FACET_PARAMS.flatMap((k) => {
        const v = params.get(k);
        return v ? [{ id: k, value: v.split(",").filter(Boolean) }] : [];
      }),
    [params]
  );
  const writeParams = React.useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mut(next);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );
  const setSearch = (v: string) => writeParams((p) => (v ? p.set("q", v) : p.delete("q")));
  const setColumnFilters = (f: ColumnFiltersState) =>
    writeParams((p) => {
      for (const k of FACET_PARAMS) p.delete(k);
      for (const { id, value } of f) {
        const arr = Array.isArray(value) ? (value as string[]) : [];
        if (arr.length && (FACET_PARAMS as readonly string[]).includes(id)) p.set(id, arr.join(","));
      }
    });

  /* ---------------- actions ---------------- */
  const actions = useMachineActions(refreshAll);
  const [assignFor, setAssignFor] = React.useState<FleetMachine[] | null>(null);
  const [groupsOpen, setGroupsOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);

  const handlers: MachineColumnHandlers = React.useMemo(
    () => ({
      latestAgent,
      groupsByMachine,
      onUpdateAgent: (m) => actions.updateAgent(m),
      onAssignGroups: (m) => setAssignFor([m]),
      onDelete: (m) => void actions.deleteMachine(m),
    }),
    [latestAgent, groupsByMachine, actions]
  );
  const columns = React.useMemo(() => buildMachineColumns(handlers), [handlers]);

  /* ---------------- KPIs ---------------- */
  const kpi = React.useMemo(() => {
    let online = 0,
      offline = 0,
      stale = 0,
      outdated = 0,
      updating = 0,
      cpuSum = 0,
      cpuN = 0;
    for (const m of machines) {
      const l = liveness(m);
      if (l === "online") online++;
      else if (l === "stale") stale++;
      else offline++;
      if (isAgentUpdating(m)) updating++;
      else if (isAgentOutdated(m, latestAgent)) outdated++;
      const c = cpuPct(m);
      if (c != null && l !== "offline") {
        cpuSum += c;
        cpuN++;
      }
    }
    return { total: machines.length, online, offline, stale, outdated, updating, avgCpu: cpuN ? cpuSum / cpuN : null };
  }, [machines, latestAgent]);

  const outdatedMachines = React.useMemo(
    () => machines.filter((m) => !isAgentUpdating(m) && isAgentOutdated(m, latestAgent) && liveness(m) === "online"),
    [machines, latestAgent]
  );

  const facets = React.useMemo(() => {
    const groupNames = [...new Set(groups.map((g) => g.name))].sort();
    return [
      { columnId: "status", title: "Status", options: STATUS_FACET_OPTIONS },
      { columnId: "project", title: "Project" },
      { columnId: "groups", title: "Group", options: groupNames.map((n) => ({ value: n, label: n })) },
      { columnId: "agent", title: "Agent" },
      { columnId: "php", title: "PHP" },
    ];
  }, [groups]);

  const loading = machinesQ.loading && !machinesQ.data;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Server}
        title="Machines"
        description="Every server running the Configuratix agent — health, capacity and agent versions at a glance."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/machines/tokens">
                <KeyRound />
                Tokens
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setGroupsOpen(true)}>
              <FolderTree />
              Groups
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus />
              Add machine
            </Button>
          </>
        }
      />

      <StatStrip>
        <StatCard label="Machines" value={kpi.total} icon={Server} loading={loading} href={pathname} />
        <StatCard
          label="Online"
          value={kpi.online}
          suffix={kpi.total ? `/ ${kpi.total}` : undefined}
          icon={Activity}
          loading={loading}
          tone={kpi.total && kpi.online === kpi.total ? "success" : "default"}
          sub={kpi.stale ? `${kpi.stale} stale` : undefined}
          href={`${pathname}?status=online`}
        />
        <StatCard
          label="Offline"
          value={kpi.offline}
          icon={WifiOff}
          loading={loading}
          tone={kpi.offline > 0 ? "destructive" : "default"}
          href={`${pathname}?status=offline`}
        />
        <StatCard
          label="Outdated agents"
          value={kpi.outdated}
          icon={RefreshCw}
          loading={loading}
          tone={kpi.outdated > 0 ? "warning" : "default"}
          sub={kpi.updating ? `${kpi.updating} updating now` : latestAgent ? `latest ${latestAgent}` : undefined}
          href={`${pathname}?agent=Outdated`}
        />
        <StatCard
          label="Avg CPU"
          value={kpi.avgCpu == null ? "—" : Math.round(kpi.avgCpu)}
          suffix={kpi.avgCpu == null ? undefined : "%"}
          icon={Cpu}
          loading={loading}
          progress={kpi.avgCpu ?? undefined}
          progressTone="auto"
        />
      </StatStrip>

      {machinesQ.error && !machinesQ.data ? (
        <ErrorState error={machinesQ.error} onRetry={machinesQ.refresh} title="Couldn't load machines" />
      ) : (
        <DataTable
          columns={columns}
          data={machines}
          loading={loading}
          getRowId={(m) => m.id}
          searchKeys={[
            "title",
            "hostname",
            "ip_address",
            "primary_ip",
            "project_name",
            "agent_version",
            (m) => (m.detected_ips ?? []).map((d) => d.ip),
            (m) => (Array.isArray(m.group_names) ? m.group_names : (groupsByMachine[m.id] ?? [])).map((g) => g.name),
          ]}
          searchPlaceholder="Search name, host, IP, group…"
          search={search}
          onSearchChange={setSearch}
          facets={facets}
          columnFilters={columnFilters}
          onColumnFiltersChange={setColumnFilters}
          initialState={{ columnVisibility: HIDDEN_FACET_COLUMNS, sorting: [{ id: "name", desc: false }] }}
          onRowClick={(m, e) => {
            const href = `/machines/${m.id}`;
            if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
            else router.push(href);
          }}
          toolbarActions={
            <>
              {outdatedMachines.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={() => actions.updateAgents(outdatedMachines)}>
                      <RefreshCw />
                      Update {outdatedMachines.length} outdated
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Online machines running an older agent</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={refreshAll} aria-label="Refresh">
                    {machinesQ.refreshing ? <Spinner /> : <RefreshCw />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Auto-refreshes every 10s</TooltipContent>
              </Tooltip>
            </>
          }
          enableRowSelection
          bulkActions={(rows, clear) => (
            <>
              <Button size="sm" variant="outline" onClick={() => setAssignFor(rows)}>
                <Tags />
                Groups
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await actions.updateAgents(rows.filter((m) => !!m.agent_id));
                  clear();
                }}
              >
                <RefreshCw />
                Update agents
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  if (await actions.deleteMachines(rows)) clear();
                }}
              >
                <Trash2 />
                Delete
              </Button>
            </>
          )}
          emptyState={
            <EmptyState
              icon={Server}
              title="No machines yet"
              description="Install the agent on a server with a one-line command — it shows up here within seconds."
              action={
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus />
                  Add machine
                </Button>
              }
            />
          }
          emptyMessage="No machines match this view."
        />
      )}

      <AssignGroupsDialog
        open={!!assignFor}
        onOpenChange={(o) => !o && setAssignFor(null)}
        machines={assignFor ?? []}
        groups={groups}
        onDone={refreshAll}
        onManageGroups={() => setGroupsOpen(true)}
      />
      <GroupsSheet open={groupsOpen} onOpenChange={setGroupsOpen} groups={groups} machines={machines as Machine[]} onChanged={refreshAll} />
      <AddMachineDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        knownMachineIds={machines.map((m) => m.id)}
        onEnrolled={refreshAll}
      />
    </div>
  );
}
