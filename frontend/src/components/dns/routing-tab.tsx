"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  History,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Shuffle,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import {
  api,
  type DNSManagedDomain,
  type DNSRecord,
  type Machine,
  type MachineGroupWithCount,
  type PassthroughPoolResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EmptyState,
  KeyValueList,
  RelativeTime,
  SectionCard,
  Spinner,
  StatusBadge,
  StatusDot,
  errorMessage,
  useConfirm,
  usePolling,
} from "@/components/app";

import { recordHost, trackJobsFrom } from "./dns-utils";
import { L7CertificatesCard } from "./l7-certificates-card";
import { PoolEditorSheet } from "./pool-editor-sheet";
import { EMPTY_POOL, PoolFields, draftFromPool, validatePool, type PoolDraft } from "./pool-fields";
import { RotationHistorySheet } from "./rotation-history-sheet";

type HistoryTarget = { poolId: string; wildcard: boolean; label: string } | null;

/** Regenerate nginx for a pool; tracks jobs when the backend returns them. */
async function regenerate(poolId: string, wildcard: boolean, label: string) {
  try {
    const res = await api.regeneratePoolConfigs(poolId, wildcard);
    trackJobsFrom(res, `Push nginx configs · ${label}`);
  } catch (e) {
    toast.error("Couldn't regenerate configs", { description: errorMessage(e) });
  }
}

function PoolState({ paused }: { paused: boolean }) {
  return paused ? <StatusBadge status="paused" /> : <StatusBadge status="active" label="Rotating" />;
}

/* -------------------------------------------------------------------------- */
/* Per-record pools (layer 4 "separate" and layer 7)                          */
/* -------------------------------------------------------------------------- */

function RecordPools({
  zone,
  records,
  machines,
  groups,
  groupsByMachine,
  onRecordsChanged,
}: {
  zone: DNSManagedDomain;
  records: DNSRecord[];
  machines?: Machine[];
  groups: MachineGroupWithCount[];
  groupsByMachine?: Record<string, string[]>;
  onRecordsChanged: () => void;
}) {
  const confirm = useConfirm();
  const layer7 = zone.proxy_mode === "layer7";
  const dynamic = React.useMemo(() => records.filter((r) => r.mode === "dynamic" && r.record_type === "A"), [records]);
  const key = dynamic.map((r) => r.id).join(",");

  const poolsQ = usePolling(
    async () => {
      const entries = await Promise.all(
        dynamic.map(async (r) => [r.id, await api.getRecordPool(r.id).catch(() => null)] as const)
      );
      return Object.fromEntries(entries) as Record<string, PassthroughPoolResponse | null>;
    },
    30000,
    { deps: [key] }
  );
  const pools = React.useMemo(() => poolsQ.data ?? {}, [poolsQ.data]);

  const [editor, setEditor] = React.useState<{ open: boolean; record: DNSRecord | null }>({ open: false, record: null });
  const [history, setHistory] = React.useState<HistoryTarget>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const host = React.useCallback((r: DNSRecord) => recordHost(r.name, zone.fqdn), [zone.fqdn]);

  const act = React.useCallback(
    async (id: string, fn: () => Promise<unknown>, ok: string) => {
      setBusy(id);
      try {
        await fn();
        toast.success(ok);
        void poolsQ.refresh();
      } catch (e) {
        toast.error("Action failed", { description: errorMessage(e) });
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poolsQ.refresh]
  );

  const remove = React.useCallback(
    async (r: DNSRecord) => {
      const ok = await confirm({
        title: `Delete ${host(r)}?`,
        description: "The pool, its rotation and the DNS record are removed. Proxy machines stop routing this host.",
        destructive: true,
        confirmText: "Delete record",
        onConfirm: async () => {
          await api.deleteRecordPool(r.id).catch(() => undefined);
          await api.deleteDNSRecord(zone.id, r.id);
        },
      });
      if (ok) {
        toast.success(`${host(r)} deleted`);
        onRecordsChanged();
      }
    },
    [confirm, host, zone.id, onRecordsChanged]
  );

  const columns = React.useMemo<ColumnDef<DNSRecord>[]>(
    () => [
      {
        id: "host",
        accessorFn: (r) => host(r),
        header: "Host",
        cell: ({ row }) => <span className="font-data text-[12.5px] font-medium">{host(row.original)}</span>,
      },
      {
        id: "target",
        header: "Upstream",
        enableSorting: false,
        cell: ({ row }) => {
          const p = pools[row.original.id]?.pool;
          if (!p) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="font-data text-[12px]">
              <span className="text-muted-foreground">{p.target_scheme ?? "http"}://</span>
              {p.target_ip}
              <span className="text-muted-foreground">
                :{p.target_port}/{p.target_port_http || 80}
              </span>
            </span>
          );
        },
      },
      {
        id: "pool",
        header: "Pool",
        enableSorting: false,
        cell: ({ row }) => {
          const data = pools[row.original.id];
          if (!data) return <span className="text-muted-foreground">—</span>;
          const groupIds = data.pool.group_ids ?? [];
          const gs = data.groups ?? groups.filter((g) => groupIds.includes(g.id));
          const online = data.members.filter((m) => m.is_online).length;
          return (
            <HoverCard openDelay={150}>
              <HoverCardTrigger asChild>
                <button type="button" className="font-data inline-flex items-center gap-1.5 text-[12px] hover:underline">
                  <StatusDot tone={online ? "success" : "muted"} size="xs" />
                  {online}/{data.members.length} up
                  {gs.length > 0 && <span className="text-muted-foreground">+ {gs.length} grp</span>}
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-72 space-y-2 text-xs" align="start">
                {gs.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium">Groups</div>
                    {gs.map((g) => (
                      <div key={g.id} className="flex items-center gap-1.5">
                        <span>{g.emoji}</span>
                        <span className="flex-1 truncate">{g.name}</span>
                        <span className="font-data text-muted-foreground">{g.machine_count}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <div className="mb-1 font-medium">Machines</div>
                  {data.members.length === 0 && <div className="text-muted-foreground">None directly</div>}
                  {data.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-1.5">
                      <StatusDot status={m.is_online ? "online" : "offline"} pulse={false} size="xs" />
                      <span className="flex-1 truncate">{m.machine_name}</span>
                      <span className="font-data text-muted-foreground">{m.machine_ip}</span>
                    </div>
                  ))}
                </div>
              </HoverCardContent>
            </HoverCard>
          );
        },
      },
      {
        id: "current",
        header: "Serving now",
        enableSorting: false,
        cell: ({ row }) => {
          const data = pools[row.original.id];
          const cur = data?.members.find((m) => m.machine_id === data.pool.current_machine_id);
          if (!cur) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="inline-flex min-w-0 items-center gap-2">
              <StatusDot status={cur.is_online ? "online" : "offline"} />
              <span className="truncate text-[13px]">{cur.machine_name}</span>
              <span className="font-data text-[11px] text-muted-foreground">{cur.machine_ip}</span>
            </span>
          );
        },
      },
      {
        id: "rotated",
        header: "Last rotation",
        enableSorting: false,
        cell: ({ row }) => {
          const p = pools[row.original.id]?.pool;
          return <RelativeTime date={p?.last_rotated_at ?? null} className="text-xs text-muted-foreground" />;
        },
      },
      {
        id: "state",
        header: "State",
        enableSorting: false,
        cell: ({ row }) => {
          const p = pools[row.original.id]?.pool;
          return p ? <PoolState paused={p.is_paused} /> : <StatusBadge status="pending" label="No pool" />;
        },
      },
      {
        id: "actions",
        enableHiding: false,
        meta: { align: "right", className: "w-10" },
        cell: ({ row }) => {
          const r = row.original;
          const p = pools[r.id]?.pool;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${host(r)}`}>
                  {busy === r.id ? <Spinner /> : <MoreHorizontal />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setEditor({ open: true, record: r })}>
                  <Settings2 />
                  Edit pool…
                </DropdownMenuItem>
                {p && (
                  <>
                    <DropdownMenuItem onClick={() => act(r.id, () => api.rotateRecordPool(p.id), `Rotated ${host(r)}`)}>
                      <Shuffle />
                      Rotate now
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        act(
                          r.id,
                          () => (p.is_paused ? api.resumeRecordPool(p.id) : api.pauseRecordPool(p.id)),
                          p.is_paused ? "Rotation resumed" : "Rotation paused"
                        )
                      }
                    >
                      {p.is_paused ? <Play /> : <Pause />}
                      {p.is_paused ? "Resume rotation" : "Pause rotation"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setHistory({ poolId: p.id, wildcard: false, label: host(r) })}>
                      <History />
                      Rotation history
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => regenerate(p.id, false, host(r))}>
                      <RefreshCw />
                      Push nginx configs
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => remove(r)}>
                  <Trash2 />
                  Delete record…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [pools, groups, busy, host, act, remove]
  );

  const regenerateAll = async () => {
    const poolIds = Object.values(pools)
      .filter(Boolean)
      .map((p) => p!.pool.id);
    if (!poolIds.length) return;
    const ok = await confirm({
      title: `Push nginx configs for ${poolIds.length} pool${poolIds.length === 1 ? "" : "s"}?`,
      description: "Every pool machine rewrites its routing config, tests it and reloads nginx. Failed tests keep the previous config.",
      confirmText: "Push configs",
    });
    if (!ok) return;
    for (const id of poolIds) await regenerate(id, false, zone.fqdn);
  };

  return (
    <div className="space-y-4">
      {layer7 && <L7CertificatesCard domainId={zone.id} />}
      <SectionCard
        title={layer7 ? "Layer 7 records" : "Passthrough records"}
        description={
          layer7
            ? "Each host has a pool of proxy machines that terminate TLS and forward to its upstream."
            : "Each host has a pool of proxy machines routing raw TLS by SNI; the A record rotates between them."
        }
        icon={Zap}
        actions={
          <>
            {dynamic.length > 0 && (
              <Button size="sm" variant="outline" onClick={regenerateAll}>
                <RefreshCw />
                Push all configs
              </Button>
            )}
            <Button size="sm" onClick={() => setEditor({ open: true, record: null })}>
              <Plus />
              Add record
            </Button>
          </>
        }
        flush
      >
        <DataTable
          columns={columns}
          data={dynamic}
          loading={poolsQ.loading && dynamic.length > 0 && !poolsQ.data}
          getRowId={(r) => r.id}
          hideSearch={dynamic.length < 8}
          searchKeys={[(r) => host(r)]}
          showColumnToggle={false}
          showPagination={dynamic.length > 20}
          bordered={false}
          maxHeight="none"
          onRowClick={(r) => setEditor({ open: true, record: r })}
          emptyState={
            <EmptyState
              size="compact"
              bordered={false}
              icon={Zap}
              title={layer7 ? "No Layer 7 records yet" : "No passthrough records yet"}
              description="Add a host and pick the proxy machines that should serve it."
              action={
                <Button size="sm" onClick={() => setEditor({ open: true, record: null })}>
                  <Plus />
                  Add record
                </Button>
              }
            />
          }
        />
      </SectionCard>

      <PoolEditorSheet
        open={editor.open}
        onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))}
        zone={zone}
        record={editor.record}
        records={records}
        machines={machines}
        groups={groups}
        groupsByMachine={groupsByMachine}
        onSaved={() => {
          onRecordsChanged();
          void poolsQ.refresh();
        }}
      />
      <RotationHistorySheet target={history} onOpenChange={(o) => !o && setHistory(null)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Wildcard pool                                                              */
/* -------------------------------------------------------------------------- */

function WildcardPoolPanel({
  zone,
  machines,
  groups,
  groupsByMachine,
}: {
  zone: DNSManagedDomain;
  machines?: Machine[];
  groups: MachineGroupWithCount[];
  groupsByMachine?: Record<string, string[]>;
}) {
  const confirm = useConfirm();
  const q = usePolling(() => api.getWildcardPool(zone.id).catch(() => null), 30000, { deps: [zone.id] });
  const data = q.data ?? null;
  const [draft, setDraft] = React.useState<PoolDraft>({ ...EMPTY_POOL });
  const [dirty, setDirty] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryTarget>(null);

  // Load server state into the form unless the user is editing
  React.useEffect(() => {
    if (dirty) return;
    if (data) setDraft(draftFromPool(data.pool, data.members.map((m) => m.machine_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const errors = touched ? validatePool(draft, {}) : {};
  const current = data?.members.find((m) => m.machine_id === data.pool.current_machine_id);

  const save = async () => {
    setTouched(true);
    if (Object.keys(validatePool(draft, {})).length) return;
    setSaving(true);
    try {
      await api.createOrUpdateWildcardPool(zone.id, {
        include_root: draft.include_root,
        target_ip: draft.target_ip,
        target_scheme: draft.target_scheme,
        target_port: draft.target_port,
        target_port_http: draft.target_port_http,
        preserve_host: draft.preserve_host,
        tls_verify_upstream: draft.tls_verify_upstream,
        ssl_email: draft.ssl_email || undefined,
        rotation_strategy: draft.rotation_strategy,
        rotation_mode: draft.rotation_mode,
        interval_minutes: draft.interval_minutes,
        scheduled_times: draft.scheduled_times,
        health_check_enabled: draft.health_check_enabled,
        proxy_protocol: draft.proxy_protocol,
        machine_ids: draft.machine_ids,
        group_ids: draft.group_ids,
      });
      toast.success("Wildcard pool saved", { description: "Pool machines are being reconfigured." });
      setDirty(false);
      setTouched(false);
      void q.refresh();
    } catch (e) {
      toast.error("Couldn't save pool", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      void q.refresh();
    } catch (e) {
      toast.error("Action failed", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const removePool = async () => {
    if (!data) return;
    const ok = await confirm({
      title: "Delete the wildcard pool?",
      description: `*.${zone.fqdn} stops rotating and proxy machines stop routing it.`,
      destructive: true,
      confirmText: "Delete pool",
      onConfirm: () => api.deleteWildcardPool(zone.id),
    });
    if (ok) {
      toast.success("Wildcard pool deleted");
      setDirty(false);
      setDraft({ ...EMPTY_POOL });
      void q.refresh();
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <SectionCard
        className="lg:col-span-2"
        title={`*.${zone.fqdn}`}
        description="One pool of proxy machines serves every subdomain."
        icon={Zap}
        footer={
          <div className="flex items-center justify-end gap-2">
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDirty(false);
                  setTouched(false);
                  if (data) setDraft(draftFromPool(data.pool, data.members.map((m) => m.machine_id)));
                }}
                disabled={saving}
              >
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={saving || (!dirty && !!data)}>
              {saving && <Spinner />}
              {data ? "Save pool" : "Create pool"}
            </Button>
          </div>
        }
      >
        {q.loading ? (
          <Spinner />
        ) : (
          <PoolFields
            draft={draft}
            onChange={(d) => {
              setDraft(d);
              setDirty(true);
            }}
            machines={machines}
            groups={groups}
            groupsByMachine={groupsByMachine}
            variant="wildcard"
            zone={zone.fqdn}
            errors={errors}
          />
        )}
      </SectionCard>

      <SectionCard title="Rotation" icon={RotateCcw} className="h-fit">
        {data ? (
          <div className="space-y-4">
            <KeyValueList
              labelWidth={100}
              items={[
                { label: "State", value: <PoolState paused={data.pool.is_paused} /> },
                {
                  label: "Serving now",
                  value: current ? (
                    <span className="inline-flex items-center gap-2">
                      <StatusDot status={current.is_online ? "online" : "offline"} />
                      {current.machine_name}
                    </span>
                  ) : (
                    "—"
                  ),
                },
                { label: "IP", value: current?.machine_ip, mono: true, copy: current?.machine_ip, hidden: !current?.machine_ip },
                { label: "Last rotation", value: <RelativeTime date={data.pool.last_rotated_at} /> },
                {
                  label: "Members",
                  value: (
                    <span className="font-data">
                      {data.members.filter((m) => m.is_online).length}/{data.members.length} online
                    </span>
                  ),
                },
                {
                  label: "Strategy",
                  value: (
                    <Badge variant="secondary">
                      {data.pool.rotation_strategy === "random" ? "Random" : "Round robin"} · {data.pool.interval_minutes}m
                    </Badge>
                  ),
                },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => api.rotateWildcardPool(data.pool.id), "Rotated")}>
                <Shuffle />
                Rotate now
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () => (data.pool.is_paused ? api.resumeWildcardPool(data.pool.id) : api.pauseWildcardPool(data.pool.id)),
                    data.pool.is_paused ? "Rotation resumed" : "Rotation paused"
                  )
                }
              >
                {data.pool.is_paused ? <Play /> : <Pause />}
                {data.pool.is_paused ? "Resume" : "Pause"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHistory({ poolId: data.pool.id, wildcard: true, label: `*.${zone.fqdn}` })}
              >
                <History />
                History
              </Button>
              <Button size="sm" variant="outline" onClick={() => regenerate(data.pool.id, true, `*.${zone.fqdn}`)}>
                <RefreshCw />
                Push configs
              </Button>
            </div>
            <Button size="sm" variant="destructive" className="w-full" onClick={removePool}>
              <Trash2 />
              Delete pool
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No pool yet. Fill in the form and create it to start rotating.</p>
        )}
      </SectionCard>
      <RotationHistorySheet target={history} onOpenChange={(o) => !o && setHistory(null)} />
    </div>
  );
}

export function RoutingTab(props: {
  zone: DNSManagedDomain;
  records: DNSRecord[];
  machines?: Machine[];
  groups: MachineGroupWithCount[];
  groupsByMachine?: Record<string, string[]>;
  onRecordsChanged: () => void;
}) {
  if (props.zone.proxy_mode === "wildcard") return <WildcardPoolPanel {...props} />;
  return <RecordPools {...props} />;
}
