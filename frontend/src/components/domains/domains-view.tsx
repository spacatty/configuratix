"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { FolderOpen, Globe, HeartPulse, Link2, Network, Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, type Domain, type DomainGroup, type DomainGroupWithCount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  StatCard,
  StatStrip,
  errorMessage,
  invalidatePickerCache,
  trackJob,
  useConfirm,
  usePolling,
} from "@/components/app";

import { AssignDomainDialog } from "./assign-domain-dialog";
import { CreateDomainsDialog } from "./create-domains-dialog";
import { buildDomainColumns, type DomainRowActions } from "./domain-columns";
import { DomainGroupsDialog } from "./domain-groups-dialog";
import { DomainSheet } from "./domain-sheet";
import { GroupsSheet } from "./groups-sheet";
import { HealthCheckDialog } from "./health-check-dialog";
import { DomainNotesDialog } from "./notes-dialog";
import { domainApplyState, domainHealth, extractJobIds, getApexDomain, isApplyActive, sortDomainsByApex } from "./domain-utils";


type DialogState =
  | { kind: "assign"; ids: string[] }
  | { kind: "groups"; ids: string[] }
  | { kind: "health"; id: string }
  | { kind: "notes"; id: string }
  | null;

export function DomainsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirm = useConfirm();

  /* ------------------------------ data ------------------------------ */

  const [fast, setFast] = React.useState(false);
  const domainsQ = usePolling(() => api.listDomains(), fast ? 3000 : 20000);
  const machinesQ = usePolling(() => api.listMachines(), 60000);
  const configsQ = usePolling(() => api.listNginxConfigs(), 0);
  const groupsQ = usePolling(async () => {
    const groups = await api.listDomainGroups();
    const members = await Promise.all(
      groups.map((g) => api.getDomainGroupMembers(g.id).catch(() => [] as { id: string }[]))
    );
    const byDomain: Record<string, string[]> = {};
    groups.forEach((g, i) => {
      for (const m of members[i]) (byDomain[m.id] ??= []).push(g.id);
    });
    return { groups, byDomain };
  }, 0);

  const domains = React.useMemo(() => domainsQ.data ?? [], [domainsQ.data]);
  const groups: DomainGroupWithCount[] = React.useMemo(
    () => [...(groupsQ.data?.groups ?? [])].sort((a, b) => a.position - b.position),
    [groupsQ.data]
  );
  const membership = React.useMemo(() => groupsQ.data?.byDomain ?? {}, [groupsQ.data]);

  // Poll fast while anything is applying
  React.useEffect(() => {
    setFast(domains.some(isApplyActive));
  }, [domains]);

  const refreshDomains = domainsQ.refresh;
  const refreshAll = React.useCallback(() => {
    void domainsQ.refresh();
    void groupsQ.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainsQ.refresh, groupsQ.refresh]);

  const groupById = React.useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const groupsByDomain = React.useMemo(() => {
    const out: Record<string, DomainGroup[]> = {};
    for (const [did, gids] of Object.entries(membership)) {
      out[did] = gids.map((id) => groupById.get(id)).filter(Boolean) as DomainGroup[];
    }
    return out;
  }, [membership, groupById]);

  const groupsByMachine = React.useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const m of machinesQ.data ?? []) {
      const names = (m.group_names ?? []).map((g) => g?.name).filter(Boolean) as string[];
      if (names.length) out[m.id] = names;
    }
    return out;
  }, [machinesQ.data]);

  const sorted = React.useMemo(() => sortDomainsByApex(domains), [domains]);
  const apexSet = React.useMemo(() => new Set(domains.map((d) => d.fqdn.toLowerCase())), [domains]);
  const byId = React.useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);

  /* ------------------------------ search (?q=) ------------------------------ */

  const urlQ = searchParams.get("q") ?? "";
  const [search, setSearch] = React.useState(urlQ);
  React.useEffect(() => setSearch(urlQ), [urlQ]);
  const onSearchChange = React.useCallback(
    (v: string) => {
      setSearch(v);
      const sp = new URLSearchParams(searchParams.toString());
      if (v) sp.set("q", v);
      else sp.delete("q");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  /* ------------------------------ ui state ------------------------------ */

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  // ?new=1 (the "/domain" palette action) opens the create dialog once, then drops the param.
  const wantsNew = searchParams.get("new") === "1";
  React.useEffect(() => {
    if (!wantsNew) return;
    setCreateOpen(true);
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("new");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [wantsNew, searchParams, router, pathname]);
  const [groupsSheet, setGroupsSheet] = React.useState<{ open: boolean; edit: string | "new" | null }>({ open: false, edit: null });
  const [sheetId, setSheetId] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState<string | null>(null);

  const dialogDomains = React.useMemo(
    () => (dialog && "ids" in dialog ? (dialog.ids.map((id) => byId.get(id)).filter(Boolean) as Domain[]) : []),
    [dialog, byId]
  );
  const dialogDomain = dialog && "id" in dialog ? (byId.get(dialog.id) ?? null) : null;
  const sheetDomain = sheetId ? (byId.get(sheetId) ?? null) : null;

  /* ------------------------------ actions ------------------------------ */

  const markApplying = React.useCallback(
    (ids: string[]) =>
      domainsQ.setData((prev) =>
        prev?.map((d) => (ids.includes(d.id) ? { ...d, apply_status: "pending", last_apply_error: null } : d))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domainsQ.setData]
  );

  const trackDomainJobs = React.useCallback(
    (ids: string[], title: string, description?: string) => {
      if (!ids.length) return false;
      setFast(true);
      ids.forEach((id) =>
        trackJob(id, { title, description, onDone: () => void refreshDomains() })
      );
      return true;
    },
    [refreshDomains]
  );

  const reapply = React.useCallback(
    async (d: Domain) => {
      setRetrying((s) => new Set(s).add(d.id));
      try {
        const res = await api.applyDomain(d.id);
        markApplying([d.id]);
        const ids = extractJobIds(res);
        if (!trackDomainJobs(ids, `Re-apply ${d.fqdn}`, d.machine_name ?? undefined)) {
          toast.success(`Re-apply queued for ${d.fqdn}`);
        }
        void refreshDomains();
      } catch (e) {
        toast.error(`Couldn't re-apply ${d.fqdn}`, { description: errorMessage(e) });
      } finally {
        setRetrying((s) => {
          const n = new Set(s);
          n.delete(d.id);
          return n;
        });
      }
    },
    [markApplying, trackDomainJobs, refreshDomains]
  );

  const unassign = React.useCallback(
    async (d: Domain) => {
      let jobIds: string[] = [];
      const ok = await confirm({
        title: `Unassign ${d.fqdn}?`,
        description: `The nginx config is removed from ${d.machine_name ?? "the machine"} and nginx is reloaded. The domain stays in the list.`,
        confirmText: "Unassign",
        destructive: true,
        onConfirm: async () => {
          jobIds = extractJobIds(await api.assignDomain(d.id, null, null));
        },
      });
      if (!ok) return;
      if (!trackDomainJobs(jobIds, `Remove ${d.fqdn} from ${d.machine_name ?? "machine"}`)) toast.success(`${d.fqdn} unassigned`);
      void refreshDomains();
    },
    [confirm, trackDomainJobs, refreshDomains]
  );

  const remove = React.useCallback(
    async (d: Domain) => {
      let res: Awaited<ReturnType<typeof api.deleteDomain>> | null = null;
      const ok = await confirm({
        title: `Delete ${d.fqdn}?`,
        description: d.assigned_machine_id
          ? `Its nginx config is removed from ${d.machine_name ?? "the machine"}. This can't be undone.`
          : "This can't be undone.",
        destructive: true,
        confirmText: "Delete domain",
        onConfirm: async () => {
          res = await api.deleteDomain(d.id);
        },
      });
      if (!ok) return;
      const r = res as Awaited<ReturnType<typeof api.deleteDomain>> | null;
      const ids = extractJobIds(r);
      ids.forEach((id) => trackJob(id, { title: `Remove domain · ${d.fqdn}`, description: d.machine_name ?? undefined }));
      if (r?.warnings?.length) toast.warning(`${d.fqdn} deleted with warnings`, { description: r.warnings.join("\n") });
      else if (!ids.length) toast.success(`${d.fqdn} deleted`);
      invalidatePickerCache("domains");
      if (sheetId === d.id) setSheetId(null);
      domainsQ.setData((prev) => prev?.filter((x) => x.id !== d.id));
      void refreshDomains();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, refreshDomains, sheetId, domainsQ.setData]
  );

  const checkHealth = React.useCallback(
    async (d: Domain) => {
      const t = toast.loading(`Checking ${d.fqdn}…`);
      try {
        const res = await api.triggerDomainHealthCheck(d.id);
        const st = res.status;
        if (st === "healthy") toast.success(`${d.fqdn} is healthy`, { id: t });
        else toast.error(`${d.fqdn} is ${st || "unhealthy"}`, { id: t });
        void refreshDomains();
      } catch (e) {
        toast.error(`Health check failed for ${d.fqdn}`, { id: t, description: errorMessage(e) });
      }
    },
    [refreshDomains]
  );

  const actions: DomainRowActions = React.useMemo(
    () => ({
      open: (d) => setSheetId(d.id),
      assign: (d) => setDialog({ kind: "assign", ids: [d.id] }),
      reapply: (d) => void reapply(d),
      unassign: (d) => void unassign(d),
      checkHealth: (d) => void checkHealth(d),
      healthSettings: (d) => setDialog({ kind: "health", id: d.id }),
      groups: (d) => setDialog({ kind: "groups", ids: [d.id] }),
      notes: (d) => setDialog({ kind: "notes", id: d.id }),
      remove: (d) => void remove(d),
    }),
    [reapply, unassign, checkHealth, remove]
  );

  /* ------------------------------ bulk ------------------------------ */

  const bulkCheck = async (rows: Domain[]) => {
    const targets = rows.filter((d) => d.assigned_machine_id);
    if (!targets.length) {
      toast.info("None of the selected domains are assigned to a machine");
      return;
    }
    setBulkBusy("check");
    try {
      const res = await api.bulkCheckDomains(targets.map((d) => d.id));
      const healthy = res.results.filter((r) => r.status === "healthy").length;
      const errored = res.results.filter((r) => r.error).length;
      const unhealthy = res.results.length - healthy - errored;
      const msg = `${healthy} healthy · ${unhealthy} unhealthy${errored ? ` · ${errored} errors` : ""}`;
      if (unhealthy || errored) toast.warning(`Checked ${res.results.length} domains`, { description: msg });
      else toast.success(`Checked ${res.results.length} domains`, { description: msg });
      void refreshDomains();
    } catch (e) {
      toast.error("Bulk health check failed", { description: errorMessage(e) });
    } finally {
      setBulkBusy(null);
    }
  };

  const bulkReapply = async (rows: Domain[], clear: () => void) => {
    const targets = rows.filter((d) => d.assigned_machine_id && d.config_id && !isApplyActive(d));
    if (!targets.length) {
      toast.info("Nothing to re-apply", { description: "Select assigned domains with a config." });
      return;
    }
    setBulkBusy("apply");
    let failed = 0;
    for (const d of targets) {
      try {
        const ids = extractJobIds(await api.applyDomain(d.id));
        trackDomainJobs(ids, `Re-apply ${d.fqdn}`, d.machine_name ?? undefined);
      } catch {
        failed++;
      }
    }
    markApplying(targets.map((d) => d.id));
    setBulkBusy(null);
    if (failed) toast.error(`${failed} of ${targets.length} couldn't be queued`);
    clear();
    void refreshDomains();
  };

  const bulkDelete = async (rows: Domain[], clear: () => void) => {
    const assigned = rows.filter((d) => d.assigned_machine_id).length;
    let res: Awaited<ReturnType<typeof api.bulkDeleteDomains>> | null = null;
    const ok = await confirm({
      title: `Delete ${rows.length} domain${rows.length === 1 ? "" : "s"}?`,
      description:
        assigned > 0
          ? `${assigned} of them are assigned — their nginx configs are removed from the machines. This can't be undone.`
          : "This can't be undone.",
      details: (
        <div className="font-data max-h-32 overflow-y-auto text-[12px] text-muted-foreground">
          {rows.slice(0, 30).map((d) => (
            <div key={d.id}>{d.fqdn}</div>
          ))}
          {rows.length > 30 && <div>+{rows.length - 30} more</div>}
        </div>
      ),
      destructive: true,
      confirmText: `Delete ${rows.length}`,
      typeToConfirm: rows.length >= 10 ? String(rows.length) : undefined,
      onConfirm: async () => {
        res = await api.bulkDeleteDomains(rows.map((d) => d.id));
      },
    });
    if (!ok) return;
    const r = res as Awaited<ReturnType<typeof api.bulkDeleteDomains>> | null;
    const ids = extractJobIds(r);
    ids.forEach((id) => trackJob(id, { title: "Remove domain from machine" }));
    const n = r?.deleted ?? rows.length;
    if (r?.warnings?.length) toast.warning(`Deleted ${n} domain${n === 1 ? "" : "s"} with warnings`, { description: r.warnings.join("\n") });
    else toast.success(`Deleted ${n} domain${n === 1 ? "" : "s"}`, { description: ids.length ? `${ids.length} removal job${ids.length === 1 ? "" : "s"} running` : undefined });
    invalidatePickerCache("domains");
    clear();
    void refreshDomains();
  };

  /* ------------------------------ stats ------------------------------ */

  const stats = React.useMemo(() => {
    let healthy = 0,
      unhealthy = 0,
      failed = 0,
      unassigned = 0,
      applying = 0;
    for (const d of domains) {
      const h = domainHealth(d);
      if (h === "healthy") healthy++;
      else if (h === "unhealthy") unhealthy++;
      else if (h === "unassigned") unassigned++;
      const a = domainApplyState(d);
      if (a === "failed") failed++;
      if (isApplyActive(d)) applying++;
    }
    return { total: domains.length, healthy, unhealthy, failed, unassigned, applying };
  }, [domains]);

  const columns = React.useMemo(
    () => buildDomainColumns({ actions, groupsByDomain, apexSet, retryingIds: retrying }),
    [actions, groupsByDomain, apexSet, retrying]
  );

  const facets = React.useMemo(
    () => [
      { columnId: "health", title: "Health" },
      { columnId: "apply", title: "Apply" },
      { columnId: "machine", title: "Machine" },
      { columnId: "config", title: "Config" },
      ...(groups.length ? [{ columnId: "groups", title: "Group" }] : []),
    ],
    [groups.length]
  );

  /* ------------------------------ render ------------------------------ */

  if (domainsQ.error && !domainsQ.data) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Globe} title="Domains" />
        <ErrorState error={domainsQ.error} onRetry={domainsQ.refresh} />
      </div>
    );
  }

  const loading = domainsQ.loading;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Globe}
        title="Domains"
        description="Hostnames, where they're served from, and whether they're healthy."
        actions={
          <>
            <Button variant="ghost" size="icon" aria-label="Refresh" onClick={refreshAll} disabled={domainsQ.refreshing}>
              {domainsQ.refreshing ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/domains/dns">
                <Network />
                DNS
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setGroupsSheet({ open: true, edit: null })}>
              <FolderOpen />
              Groups
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Add domains
            </Button>
          </>
        }
      />

      <StatStrip>
        <StatCard label="Total" value={stats.total} loading={loading} sub={stats.applying ? `${stats.applying} applying` : undefined} />
        <StatCard label="Healthy" value={stats.healthy} loading={loading} sub={stats.total ? `${Math.round((stats.healthy / Math.max(1, stats.total - stats.unassigned)) * 100)}% of assigned` : undefined} />
        <StatCard label="Unhealthy" value={stats.unhealthy} loading={loading} tone={stats.unhealthy ? "destructive" : "default"} />
        <StatCard label="Apply failed" value={stats.failed} loading={loading} tone={stats.failed ? "destructive" : "default"} />
        <StatCard label="Unassigned" value={stats.unassigned} loading={loading} tone={stats.unassigned ? "warning" : "default"} />
      </StatStrip>

      <DataTable
        columns={columns}
        data={sorted}
        loading={loading}
        getRowId={(d) => d.id}
        search={search}
        onSearchChange={onSearchChange}
        searchKeys={[
          "fqdn",
          "machine_name",
          "machine_ip",
          "config_name",
          (d) => (groupsByDomain[d.id] ?? []).map((g) => g.name),
          (d) => getApexDomain(d.fqdn),
        ]}
        searchPlaceholder="Search domain, machine, IP, config…"
        facets={facets}
        onRowClick={(d) => setSheetId(d.id)}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        pageSize={50}
        pageSizeOptions={[25, 50, 100, 250]}
        initialState={{ columnVisibility: { created_at: false } }}
        getRowClassName={(d) => (isApplyActive(d) ? "bg-info/[0.04]" : undefined)}
        emptyState={
          <EmptyState
            icon={Globe}
            title="No domains yet"
            description="Add a domain, assign it to a machine with an nginx config, and Configuratix handles nginx, SSL and health checks."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                Add domains
              </Button>
            }
          />
        }
        bulkActions={(rows, clear) => (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "assign", ids: rows.map((r) => r.id) })}>
              <Link2 />
              Assign
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void bulkReapply(rows, clear)} disabled={!!bulkBusy}>
              {bulkBusy === "apply" ? <Spinner /> : <RotateCw />}
              Re-apply
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void bulkCheck(rows)} disabled={!!bulkBusy}>
              {bulkBusy === "check" ? <Spinner /> : <HeartPulse />}
              Check health
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "groups", ids: rows.map((r) => r.id) })}>
              <FolderOpen />
              Add to group
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void bulkDelete(rows, clear)}>
              <Trash2 />
              Delete
            </Button>
          </>
        )}
      />

      <CreateDomainsDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existing={domains}
        onCreated={(created) => {
          void refreshDomains();
          if (created.length === 1) {
            toast.info("Assign it to a machine?", {
              action: { label: "Assign", onClick: () => setDialog({ kind: "assign", ids: [created[0].id] }) },
            });
          } else if (created.length > 1) {
            setRowSelection(Object.fromEntries(created.map((d) => [d.id, true])));
          }
        }}
      />

      <AssignDomainDialog
        open={dialog?.kind === "assign"}
        onOpenChange={(o) => !o && setDialog(null)}
        domains={dialog?.kind === "assign" ? dialogDomains : []}
        machines={machinesQ.data}
        configs={configsQ.data}
        groupsByMachine={groupsByMachine}
        onChanged={() => {
          if (dialog?.kind === "assign") markApplying(dialog.ids);
          setFast(true);
          setRowSelection({});
          void refreshDomains();
        }}
      />

      <DomainGroupsDialog
        open={dialog?.kind === "groups"}
        onOpenChange={(o) => !o && setDialog(null)}
        domains={dialog?.kind === "groups" ? dialogDomains : []}
        groups={groups}
        membership={membership}
        onChanged={() => {
          void groupsQ.refresh();
          setRowSelection({});
        }}
        onManageGroups={() => setGroupsSheet({ open: true, edit: "new" })}
      />

      <HealthCheckDialog
        open={dialog?.kind === "health"}
        onOpenChange={(o) => !o && setDialog(null)}
        domain={dialog?.kind === "health" ? dialogDomain : null}
        onChanged={() => void refreshDomains()}
      />

      <DomainNotesDialog
        open={dialog?.kind === "notes"}
        onOpenChange={(o) => !o && setDialog(null)}
        domain={dialog?.kind === "notes" ? dialogDomain : null}
        onSaved={() => void refreshDomains()}
      />

      <GroupsSheet
        open={groupsSheet.open}
        initialEdit={groupsSheet.edit}
        onOpenChange={(o) => setGroupsSheet((s) => ({ ...s, open: o }))}
        groups={groups}
        domains={domains}
        onChanged={() => void groupsQ.refresh()}
      />

      <DomainSheet
        domain={sheetDomain}
        open={!!sheetDomain}
        onOpenChange={(o) => !o && setSheetId(null)}
        groups={sheetDomain ? (groupsByDomain[sheetDomain.id] ?? []) : []}
        actions={actions}
      />
    </div>
  );
}
