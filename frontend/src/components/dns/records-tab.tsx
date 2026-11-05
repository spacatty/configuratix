"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ListPlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  api,
  type DNSAccount,
  type DNSManagedDomain,
  type DNSRecord,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DataTable } from "@/components/ui/data-table";
import {
  CopyButton,
  EmptyState,
  SectionCard,
  Spinner,
  StatusBadge,
  errorMessage,
  useConfirm,
} from "@/components/app";
import { cn } from "@/lib/utils";

import {
  RECORD_TYPES,
  TTL_PRESETS,
  formatTtl,
  providerMeta,
  recordTypeVariant,
  syncMeta,
  validateRecordValue,
} from "./dns-utils";

type Draft = {
  name: string;
  record_type: string;
  value: string;
  ttl: number;
  priority: number;
  proxied: boolean;
};

const EMPTY: Draft = {
  name: "",
  record_type: "A",
  value: "",
  ttl: 600,
  priority: 10,
  proxied: false,
};

function draftOf(r: DNSRecord): Draft {
  return {
    name: r.name,
    record_type: r.record_type,
    value: r.value,
    ttl: r.ttl,
    priority: r.priority ?? 10,
    proxied: r.proxied,
  };
}

function TtlSelect({
  value,
  onChange,
  min,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  className?: string;
}) {
  const presets = TTL_PRESETS.filter(
    (p) => !min || p.value === 1 || p.value >= min,
  );
  const options = presets.some((p) => p.value === value)
    ? presets
    : [...presets, { label: formatTtl(value), value }];
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger
        size="sm"
        className={cn("font-data w-full", className)}
        aria-label="TTL"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem
            key={p.value}
            value={String(p.value)}
            className="font-data"
          >
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="font-data w-full" aria-label="Type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RECORD_TYPES.map((t) => (
          <SelectItem key={t} value={t} className="font-data">
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function valuePlaceholder(type: string) {
  switch (type) {
    case "A":
      return "203.0.113.10";
    case "AAAA":
      return "2001:db8::1";
    case "CNAME":
      return "target.example.net";
    case "MX":
      return "mail.example.com";
    default:
      return '"v=spf1 include:… ~all"';
  }
}

/* -------------------------------------------------------------------------- */
/* Row cells (read inline-edit state from context)                            */
/* -------------------------------------------------------------------------- */

interface RowCtx {
  editingId: string | null;
  edit: Draft;
  setEdit: React.Dispatch<React.SetStateAction<Draft>>;
  setEditingId: (id: string | null) => void;
  save: (r: DNSRecord, patch?: Partial<Draft>) => Promise<void>;
  remove: (r: DNSRecord) => Promise<void>;
  startEdit: (r: DNSRecord) => void;
  savingId: string | null;
  fqdn: string;
  minTtl?: number;
}

const RowContext = React.createContext<RowCtx | null>(null);
function useRow() {
  return React.useContext(RowContext)!;
}

function NameCell({ r }: { r: DNSRecord }) {
  const c = useRow();
  if (c.editingId === r.id)
    return (
      <Input
        autoFocus
        className="font-data h-7 text-[12.5px]"
        value={c.edit.name}
        onChange={(e) => c.setEdit((d) => ({ ...d, name: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === "Enter") void c.save(r);
          if (e.key === "Escape") c.setEditingId(null);
        }}
      />
    );
  return (
    <span className="font-data text-[12.5px]">
      <span className="font-medium">{r.name || "@"}</span>
      {r.name !== "@" && (
        <span className="text-subtle-foreground">.{c.fqdn}</span>
      )}
    </span>
  );
}

function TypeCell({ r }: { r: DNSRecord }) {
  const c = useRow();
  if (c.editingId === r.id)
    return (
      <TypeSelect
        value={c.edit.record_type}
        onChange={(v) => c.setEdit((d) => ({ ...d, record_type: v }))}
      />
    );
  return (
    <Badge variant={recordTypeVariant(r.record_type)} className="font-data">
      {r.record_type}
    </Badge>
  );
}

function ValueCell({ r }: { r: DNSRecord }) {
  const c = useRow();
  if (c.editingId === r.id)
    return (
      <div className="flex gap-1.5">
        {c.edit.record_type === "MX" && (
          <Input
            className="font-data h-7 w-16 text-[12.5px]"
            inputMode="numeric"
            value={c.edit.priority}
            aria-label="Priority"
            onChange={(e) =>
              c.setEdit((d) => ({
                ...d,
                priority: Number(e.target.value) || 0,
              }))
            }
          />
        )}
        <Input
          className="font-data h-7 text-[12.5px]"
          value={c.edit.value}
          onChange={(e) => c.setEdit((d) => ({ ...d, value: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void c.save(r);
            if (e.key === "Escape") c.setEditingId(null);
          }}
        />
      </div>
    );
  return (
    <span className="group/v flex min-w-0 items-center gap-1">
      {r.record_type === "MX" && r.priority !== null && (
        <span className="font-data shrink-0 text-[11px] text-muted-foreground">
          {r.priority}
        </span>
      )}
      <span className="font-data min-w-0 truncate text-[12px]" title={r.value}>
        {r.value}
      </span>
      <span className="opacity-0 transition-opacity group-hover/v:opacity-100">
        <CopyButton value={r.value} label="Copy value" />
      </span>
    </span>
  );
}

function TtlCell({ r }: { r: DNSRecord }) {
  const c = useRow();
  if (c.editingId === r.id)
    return (
      <TtlSelect
        value={c.edit.ttl}
        min={c.minTtl}
        onChange={(v) => c.setEdit((d) => ({ ...d, ttl: v }))}
      />
    );
  return (
    <span className="font-data text-[12px] text-muted-foreground">
      {formatTtl(r.ttl)}
    </span>
  );
}

function ProxiedCell({ r }: { r: DNSRecord }) {
  const c = useRow();
  const editing = c.editingId === r.id;
  const canProxy = ["A", "AAAA", "CNAME"].includes(
    editing ? c.edit.record_type : r.record_type,
  );
  if (!canProxy) return <span className="text-muted-foreground">—</span>;
  if (editing)
    return (
      <Switch
        checked={c.edit.proxied}
        onCheckedChange={(v) => c.setEdit((d) => ({ ...d, proxied: v }))}
        aria-label="Proxied"
      />
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Switch
            checked={r.proxied}
            disabled={c.savingId === r.id}
            onCheckedChange={(v) => void c.save(r, { proxied: v })}
            aria-label="Proxied"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {r.proxied ? "Proxied through Cloudflare" : "DNS only"}
      </TooltipContent>
    </Tooltip>
  );
}

function SyncCell({ r }: { r: DNSRecord }) {
  const m = syncMeta(r.sync_status);
  const badge = (
    <StatusBadge status={r.sync_status} tone={m.tone} label={m.label} />
  );
  return r.sync_error ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="font-data max-w-sm text-[11px]">
        {r.sync_error}
      </TooltipContent>
    </Tooltip>
  ) : (
    badge
  );
}

function ActionsCell({ r }: { r: DNSRecord }) {
  const c = useRow();
  if (c.editingId === r.id)
    return (
      <span className="inline-flex gap-0.5">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Save"
          onClick={() => void c.save(r)}
          disabled={c.savingId === r.id}
        >
          {c.savingId === r.id ? <Spinner /> : <Check />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Cancel"
          onClick={() => c.setEditingId(null)}
        >
          <X />
        </Button>
      </span>
    );
  return (
    <span className="inline-flex gap-0.5">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Edit record"
        onClick={() => c.startEdit(r)}
      >
        <Pencil />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Delete record"
        onClick={() => void c.remove(r)}
      >
        <Trash2 />
      </Button>
    </span>
  );
}

function buildRecordColumns(proxiedSupported: boolean): ColumnDef<DNSRecord>[] {
  const cols: ColumnDef<DNSRecord>[] = [
    {
      accessorKey: "name",
      header: "Name",
      meta: { className: "w-[22%]" },
      cell: ({ row }) => <NameCell r={row.original} />,
    },
    {
      id: "type",
      accessorFn: (r) => r.record_type,
      header: "Type",
      meta: { className: "w-24" },
      cell: ({ row }) => <TypeCell r={row.original} />,
    },
    {
      accessorKey: "value",
      header: "Value",
      cell: ({ row }) => <ValueCell r={row.original} />,
    },
    {
      accessorKey: "ttl",
      header: "TTL",
      meta: { align: "right", className: "w-24" },
      cell: ({ row }) => <TtlCell r={row.original} />,
    },
  ];
  if (proxiedSupported)
    cols.push({
      id: "proxied",
      accessorFn: (r) => (r.proxied ? "Proxied" : "DNS only"),
      header: "Proxy",
      meta: { className: "w-20" },
      cell: ({ row }) => <ProxiedCell r={row.original} />,
    });
  cols.push(
    {
      id: "sync",
      accessorFn: (r) => syncMeta(r.sync_status).label,
      header: "Sync",
      meta: { className: "w-28" },
      cell: ({ row }) => <SyncCell r={row.original} />,
    },
    {
      id: "actions",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", className: "w-20" },
      cell: ({ row }) => <ActionsCell r={row.original} />,
    },
  );
  return cols;
}

export function RecordsTab({
  zone,
  account,
  records,
  loading,
  onChanged,
}: {
  zone: DNSManagedDomain;
  account: DNSAccount | null;
  records: DNSRecord[];
  loading: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const meta = providerMeta(account?.provider);
  const proxiedSupported = !!meta?.supportsProxied;
  const minTtl = meta?.minTtl;
  const staticRecords = React.useMemo(
    () => records.filter((r) => r.mode !== "dynamic"),
    [records],
  );

  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>({
    ...EMPTY,
    ttl: Math.max(600, minTtl ?? 0),
  });
  const [addTouched, setAddTouched] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<Draft>(EMPTY);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const editRef = React.useRef(edit);
  editRef.current = edit;

  const nameInputRef = React.useRef<HTMLInputElement>(null);

  const addError = addTouched
    ? validateRecordValue(draft.record_type, draft.value)
    : null;

  const create = async () => {
    setAddTouched(true);
    if (validateRecordValue(draft.record_type, draft.value)) return;
    setCreating(true);
    try {
      await api.createDNSRecord(zone.id, {
        name: draft.name.trim() || "@",
        record_type: draft.record_type,
        value: draft.value.trim(),
        ttl: draft.ttl,
        priority: draft.record_type === "MX" ? draft.priority : undefined,
        proxied: proxiedSupported ? draft.proxied : false,
      });
      toast.success("Record added", {
        description: `${draft.record_type} ${draft.name || "@"} → ${draft.value}`,
      });
      setDraft((d) => ({ ...d, name: "", value: "" }));
      setAddTouched(false);
      onChanged();
      nameInputRef.current?.focus();
    } catch (e) {
      toast.error("Couldn't add record", { description: errorMessage(e) });
    } finally {
      setCreating(false);
    }
  };

  const save = React.useCallback(
    async (r: DNSRecord, patch?: Partial<Draft>) => {
      const d = { ...(patch ? draftOf(r) : editRef.current), ...patch };
      const err = validateRecordValue(d.record_type, d.value);
      if (err) {
        toast.error(err);
        return;
      }
      setSavingId(r.id);
      try {
        await api.updateDNSRecord(zone.id, r.id, {
          name: d.name.trim() || "@",
          record_type: d.record_type,
          value: d.value.trim(),
          ttl: d.ttl,
          priority: d.record_type === "MX" ? d.priority : undefined,
          proxied: proxiedSupported ? d.proxied : false,
        });
        if (!patch) setEditingId(null);
        toast.success("Record saved");
        onChanged();
      } catch (e) {
        toast.error("Couldn't save record", { description: errorMessage(e) });
      } finally {
        setSavingId(null);
      }
    },
    [zone.id, proxiedSupported, onChanged],
  );

  const remove = React.useCallback(
    async (r: DNSRecord) => {
      const ok = await confirm({
        title: `Delete ${r.record_type} ${r.name}?`,
        description: r.remote_record_id
          ? "The record is removed locally and at the provider."
          : "The record is removed locally.",
        details: (
          <code className="font-data text-[12px] break-all text-muted-foreground">
            {r.value}
          </code>
        ),
        destructive: true,
        confirmText: "Delete record",
        onConfirm: () => api.deleteDNSRecord(zone.id, r.id),
      });
      if (ok) {
        toast.success("Record deleted");
        onChanged();
      }
    },
    [confirm, zone.id, onChanged],
  );

  const startEdit = React.useCallback((r: DNSRecord) => {
    setEditingId(r.id);
    setEdit(draftOf(r));
  }, []);

  const ctx: RowCtx = {
    editingId,
    edit,
    setEdit,
    setEditingId,
    save,
    remove,
    startEdit,
    savingId,
    fqdn: zone.fqdn,
    minTtl,
  };
  // Columns stay stable (cells read edit state from context) so inputs keep focus while typing.
  const columns = React.useMemo(
    () => buildRecordColumns(proxiedSupported),
    [proxiedSupported],
  );

  return (
    <div className="space-y-4">
      {adding ? (
        <SectionCard
          title="Add record"
          icon={ListPlus}
          className="animate-fade-in-up"
          actions={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close"
              onClick={() => setAdding(false)}
            >
              <X />
            </Button>
          }
        >
          <form
            className="grid items-start gap-2 md:grid-cols-[minmax(0,1.2fr)_96px_minmax(0,2fr)_110px_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring/40">
              <Input
                ref={nameInputRef}
                autoFocus
                className="font-data h-8 border-0 text-[12.5px] focus-visible:ring-0"
                placeholder="@"
                value={draft.name}
                onChange={(e) =>
                  setDraft({ ...draft, name: e.target.value.trim() })
                }
                aria-label="Name"
              />
              <span className="font-data max-w-[40%] shrink-0 truncate pr-2 text-[11.5px] text-subtle-foreground">
                .{zone.fqdn}
              </span>
            </div>
            <TypeSelect
              value={draft.record_type}
              onChange={(v) => setDraft({ ...draft, record_type: v })}
            />
            <div className="space-y-1">
              <div className="flex gap-1.5">
                {draft.record_type === "MX" && (
                  <Input
                    className="font-data h-8 w-16 text-[12.5px]"
                    inputMode="numeric"
                    value={draft.priority}
                    aria-label="Priority"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        priority: Number(e.target.value) || 0,
                      })
                    }
                  />
                )}
                <Input
                  className="font-data h-8 text-[12.5px]"
                  placeholder={valuePlaceholder(draft.record_type)}
                  value={draft.value}
                  aria-invalid={!!addError}
                  aria-label="Value"
                  onChange={(e) =>
                    setDraft({ ...draft, value: e.target.value })
                  }
                />
              </div>
              {addError && (
                <p className="text-xs text-destructive">{addError}</p>
              )}
            </div>
            <TtlSelect
              value={draft.ttl}
              min={minTtl}
              onChange={(v) => setDraft({ ...draft, ttl: v })}
              className="h-8"
            />
            {proxiedSupported &&
            ["A", "AAAA", "CNAME"].includes(draft.record_type) ? (
              <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={draft.proxied}
                  onCheckedChange={(v) => setDraft({ ...draft, proxied: v })}
                />
                Proxied
              </label>
            ) : (
              <span className="hidden md:block" />
            )}
            <Button type="submit" size="sm" className="h-8" disabled={creating}>
              {creating ? <Spinner /> : <Plus />}
              Add
            </Button>
          </form>
          {meta?.recordHint && (
            <p className="mt-2 text-xs text-muted-foreground">
              {meta.recordHint}
            </p>
          )}
        </SectionCard>
      ) : null}

      <RowContext.Provider value={ctx}>
        <DataTable
          columns={columns}
          data={staticRecords}
          loading={loading}
          getRowId={(r) => r.id}
          searchKeys={["name", "record_type", "value"]}
          searchPlaceholder="Search records…"
          facets={[
            { columnId: "type", title: "Type" },
            { columnId: "sync", title: "Sync" },
          ]}
          pageSize={50}
          getRowClassName={(r) =>
            r.id === editingId ? "bg-accent/40" : undefined
          }
          toolbarActions={
            !adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Add record
              </Button>
            )
          }
          emptyState={
            <EmptyState
              icon={ListPlus}
              title="No records"
              description="Add records here, or import the existing zone from the provider on the Sync tab."
              action={
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus />
                  Add record
                </Button>
              }
            />
          }
        />
      </RowContext.Provider>
    </div>
  );
}
