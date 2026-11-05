"use client";

import * as React from "react";

import { api, type Domain, type Machine, type NginxConfig } from "@/lib/api";
import { machineDisplayName, machineIp, machineLiveness } from "@/lib/jobs";
import { Combobox, MultiCombobox, type ComboboxBaseProps } from "@/components/ui/combobox";
import { StatusDot } from "@/components/app/status";

/* -------------------------------------------------------------------------- */
/* Tiny shared loader cache (dedupes concurrent picker loads, 30s TTL)        */
/* -------------------------------------------------------------------------- */

type CacheEntry<T> = { at: number; promise: Promise<T> };
const cache = new Map<string, CacheEntry<unknown>>();
const TTL = 30_000;

function cachedLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = loader().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/** Drop cached picker data (call after creating/deleting machines, domains, configs). */
export function invalidatePickerCache(kind?: "machines" | "domains" | "nginx-configs") {
  if (!kind) cache.clear();
  else for (const k of [...cache.keys()]) if (k.startsWith(kind)) cache.delete(k);
}

function useLoaded<T>(provided: T[] | undefined, key: string, loader: () => Promise<T[]>) {
  const [items, setItems] = React.useState<T[]>(provided ?? []);
  const [loading, setLoading] = React.useState(!provided);
  const loaderRef = React.useRef(loader);
  React.useEffect(() => {
    loaderRef.current = loader;
  });

  React.useEffect(() => {
    if (provided) {
      setItems(provided);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    cachedLoad(key, () => loaderRef.current())
      .then((r) => alive && setItems(r ?? []))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [provided, key]);

  return { items, loading };
}

type PassThrough = Pick<
  ComboboxBaseProps<unknown>,
  "placeholder" | "searchPlaceholder" | "emptyText" | "disabled" | "className" | "contentClassName" | "align" | "modal" | "id" | "aria-invalid" | "footer" | "size" | "open" | "onOpenChange"
>;

type SingleProps<T> = {
  multiple?: false;
  value: string | null | undefined;
  onValueChange: (id: string | null, item: T | null) => void;
  clearable?: boolean;
};
type MultiProps<T> = {
  multiple: true;
  value: string[];
  onValueChange: (ids: string[], items: T[]) => void;
  maxChips?: number;
};

/* -------------------------------------------------------------------------- */
/* MachinePicker                                                              */
/* -------------------------------------------------------------------------- */

export type MachinePickerProps = PassThrough & {
  /** Machines to choose from. When omitted, loads api.listMachines() itself. */
  machines?: Machine[];
  /** Only used when self-loading. */
  projectId?: string;
  /** Optional machineId → group names (shown as hints + searchable). */
  groupsByMachine?: Record<string, string[]>;
  /** Hide some machines. */
  filter?: (m: Machine) => boolean;
  /** Make offline machines unselectable. */
  disableOffline?: boolean;
  /** Group the list by project (default) / liveness / none. */
  groupBy?: "project" | "status" | "none";
} & (SingleProps<Machine> | MultiProps<Machine>);

function MachineRow({ m, groups }: { m: Machine; groups?: string[] }) {
  const live = machineLiveness(m);
  const ip = machineIp(m);
  const name = machineDisplayName(m);
  const showHost = m.hostname && m.hostname !== name;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <StatusDot status={live} pulse={false} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">{name}</span>
          {showHost && <span className="font-data truncate text-[11px] text-muted-foreground">{m.hostname}</span>}
        </div>
        {(m.project_name || (groups && groups.length > 0)) && (
          <div className="truncate text-[11px] text-subtle-foreground">
            {[m.project_name, ...(groups ?? [])].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      {ip && <span className="font-data shrink-0 text-[11.5px] text-muted-foreground">{ip}</span>}
    </div>
  );
}

const LIVE_ORDER = ["Online", "Stale", "Offline"];

export function MachinePicker(props: MachinePickerProps) {
  const { machines, projectId, groupsByMachine, filter, disableOffline, groupBy = "project" } = props;
  const { items: loaded, loading } = useLoaded<Machine>(
    machines,
    `machines:${projectId ?? ""}`,
    () => api.listMachines(undefined, projectId)
  );
  const items = React.useMemo(() => (filter ? loaded.filter(filter) : loaded), [loaded, filter]);

  const common = {
    items,
    loading,
    getValue: (m: Machine) => m.id,
    getLabel: (m: Machine) => machineDisplayName(m),
    getKeywords: (m: Machine) => [
      m.hostname,
      m.title,
      m.agent_name,
      m.ip_address,
      m.primary_ip,
      ...(m.detected_ips ?? []).map((d) => d.ip),
      m.project_name,
      ...(groupsByMachine?.[m.id] ?? []),
    ],
    renderItem: (m: Machine) => <MachineRow m={m} groups={groupsByMachine?.[m.id]} />,
    getGroup:
      groupBy === "none"
        ? undefined
        : groupBy === "status"
          ? (m: Machine) => {
              const l = machineLiveness(m);
              return l === "online" ? "Online" : l === "stale" ? "Stale" : "Offline";
            }
          : (m: Machine) => m.project_name || "No project",
    groupOrder: groupBy === "status" ? LIVE_ORDER : undefined,
    isItemDisabled: disableOffline ? (m: Machine) => machineLiveness(m) === "offline" : undefined,
    searchPlaceholder: props.searchPlaceholder ?? "Search name, hostname, IP, group…",
    emptyText: props.emptyText ?? "No machines match.",
    placeholder: props.placeholder ?? (props.multiple ? "Select machines…" : "Select machine…"),
    disabled: props.disabled,
    className: props.className,
    contentClassName: props.contentClassName ?? "min-w-[360px]",
    align: props.align,
    modal: props.modal,
    id: props.id,
    "aria-invalid": props["aria-invalid"],
    footer: props.footer,
    size: props.size,
    open: props.open,
    onOpenChange: props.onOpenChange,
  };

  if (props.multiple) {
    return (
      <MultiCombobox<Machine>
        {...common}
        value={props.value}
        onValueChange={props.onValueChange}
        maxChips={props.maxChips}
        renderChip={(m) => (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status={machineLiveness(m)} pulse={false} size="xs" />
            {machineDisplayName(m)}
          </span>
        )}
      />
    );
  }
  return (
    <Combobox<Machine>
      {...common}
      value={props.value}
      onValueChange={props.onValueChange}
      clearable={props.clearable}
      renderValue={(m) => (
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot status={machineLiveness(m)} pulse={false} />
          <span className="truncate">{machineDisplayName(m)}</span>
          {machineIp(m) && <span className="font-data truncate text-[11.5px] text-muted-foreground">{machineIp(m)}</span>}
        </span>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* DomainPicker                                                               */
/* -------------------------------------------------------------------------- */

export type DomainPickerProps = PassThrough & {
  domains?: Domain[];
  filter?: (d: Domain) => boolean;
  /** Group by assigned machine (default) or none. */
  groupBy?: "machine" | "none";
} & (SingleProps<Domain> | MultiProps<Domain>);

function domainHealth(d: Domain): string {
  return d.status || "unknown";
}

function DomainRow({ d }: { d: Domain }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <StatusDot status={domainHealth(d)} pulse={false} />
      <span className="font-data min-w-0 flex-1 truncate text-[12.5px]">{d.fqdn}</span>
      {d.config_name && <span className="max-w-[120px] shrink-0 truncate text-[11px] text-subtle-foreground">{d.config_name}</span>}
    </div>
  );
}

export function DomainPicker(props: DomainPickerProps) {
  const { domains, filter, groupBy = "machine" } = props;
  const { items: loaded, loading } = useLoaded<Domain>(domains, "domains", () => api.listDomains());
  const items = React.useMemo(() => (filter ? loaded.filter(filter) : loaded), [loaded, filter]);

  const common = {
    items,
    loading,
    getValue: (d: Domain) => d.id,
    getLabel: (d: Domain) => d.fqdn,
    getKeywords: (d: Domain) => [d.machine_name, d.machine_ip, d.config_name, d.status],
    renderItem: (d: Domain) => <DomainRow d={d} />,
    getGroup: groupBy === "none" ? undefined : (d: Domain) => d.machine_name || "Unassigned",
    searchPlaceholder: props.searchPlaceholder ?? "Search domain, machine, config…",
    emptyText: props.emptyText ?? "No domains match.",
    placeholder: props.placeholder ?? (props.multiple ? "Select domains…" : "Select domain…"),
    disabled: props.disabled,
    className: props.className,
    contentClassName: props.contentClassName ?? "min-w-[340px]",
    align: props.align,
    modal: props.modal,
    id: props.id,
    "aria-invalid": props["aria-invalid"],
    footer: props.footer,
    size: props.size,
    open: props.open,
    onOpenChange: props.onOpenChange,
  };

  if (props.multiple) {
    return (
      <MultiCombobox<Domain>
        {...common}
        value={props.value}
        onValueChange={props.onValueChange}
        maxChips={props.maxChips}
        renderChip={(d) => <span className="font-data">{d.fqdn}</span>}
      />
    );
  }
  return (
    <Combobox<Domain>
      {...common}
      value={props.value}
      onValueChange={props.onValueChange}
      clearable={props.clearable}
      renderValue={(d) => (
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot status={domainHealth(d)} pulse={false} />
          <span className="font-data truncate text-[12.5px]">{d.fqdn}</span>
        </span>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* NginxConfigPicker                                                          */
/* -------------------------------------------------------------------------- */

export type NginxConfigPickerProps = PassThrough & {
  configs?: NginxConfig[];
  filter?: (c: NginxConfig) => boolean;
} & (SingleProps<NginxConfig> | MultiProps<NginxConfig>);

function ModeTag({ mode }: { mode: string }) {
  return (
    <span className="font-data inline-flex h-4 items-center rounded-[3px] border border-border px-1 text-[10px] text-muted-foreground uppercase">
      {mode}
    </span>
  );
}

export function NginxConfigPicker(props: NginxConfigPickerProps) {
  const { configs, filter } = props;
  const { items: loaded, loading } = useLoaded<NginxConfig>(configs, "nginx-configs", () => api.listNginxConfigs());
  const items = React.useMemo(() => (filter ? loaded.filter(filter) : loaded), [loaded, filter]);

  const common = {
    items,
    loading,
    getValue: (c: NginxConfig) => c.id,
    getLabel: (c: NginxConfig) => c.name,
    getKeywords: (c: NginxConfig) => [c.mode],
    renderItem: (c: NginxConfig) => (
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{c.name}</span>
        <ModeTag mode={c.mode} />
      </div>
    ),
    searchPlaceholder: props.searchPlaceholder ?? "Search configs…",
    emptyText: props.emptyText ?? "No configs match.",
    placeholder: props.placeholder ?? (props.multiple ? "Select configs…" : "Select config…"),
    disabled: props.disabled,
    className: props.className,
    contentClassName: props.contentClassName,
    align: props.align,
    modal: props.modal,
    id: props.id,
    "aria-invalid": props["aria-invalid"],
    footer: props.footer,
    size: props.size,
    open: props.open,
    onOpenChange: props.onOpenChange,
  };

  if (props.multiple) {
    return <MultiCombobox<NginxConfig> {...common} value={props.value} onValueChange={props.onValueChange} maxChips={props.maxChips} />;
  }
  return (
    <Combobox<NginxConfig>
      {...common}
      value={props.value}
      onValueChange={props.onValueChange}
      clearable={props.clearable}
      renderValue={(c) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{c.name}</span>
          <ModeTag mode={c.mode} />
        </span>
      )}
    />
  );
}
