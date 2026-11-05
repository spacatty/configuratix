"use client";

import * as React from "react";

import type { Machine, MachineGroupWithCount, PassthroughPool, WildcardPool } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MultiCombobox } from "@/components/ui/combobox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MachinePicker } from "@/components/app";
import { cn } from "@/lib/utils";

export interface PoolDraft {
  name: string;
  target_ip: string;
  target_scheme: "http" | "https";
  target_port: number;
  target_port_http: number;
  preserve_host: boolean;
  tls_verify_upstream: boolean;
  ssl_email: string;
  rotation_strategy: string;
  rotation_mode: string;
  interval_minutes: number;
  scheduled_times: string[];
  health_check_enabled: boolean;
  proxy_protocol: boolean;
  include_root: boolean;
  machine_ids: string[];
  group_ids: string[];
}

export const EMPTY_POOL: PoolDraft = {
  name: "",
  target_ip: "",
  target_scheme: "http",
  target_port: 443,
  target_port_http: 80,
  preserve_host: true,
  tls_verify_upstream: false,
  ssl_email: "",
  rotation_strategy: "round_robin",
  rotation_mode: "interval",
  interval_minutes: 60,
  scheduled_times: [],
  health_check_enabled: true,
  proxy_protocol: true,
  include_root: true,
  machine_ids: [],
  group_ids: [],
};

export function draftFromPool(
  pool: PassthroughPool | WildcardPool,
  memberIds: string[],
  name = ""
): PoolDraft {
  return {
    name,
    target_ip: pool.target_ip,
    target_scheme: pool.target_scheme || "http",
    target_port: pool.target_port || 443,
    target_port_http: pool.target_port_http || 80,
    preserve_host: pool.preserve_host ?? true,
    tls_verify_upstream: pool.tls_verify_upstream ?? false,
    ssl_email: pool.ssl_email || "",
    rotation_strategy: pool.rotation_strategy || "round_robin",
    rotation_mode: pool.rotation_mode || "interval",
    interval_minutes: pool.interval_minutes || 60,
    scheduled_times: pool.scheduled_times ?? [],
    health_check_enabled: pool.health_check_enabled ?? true,
    proxy_protocol: pool.proxy_protocol ?? true,
    include_root: "include_root" in pool ? pool.include_root : true,
    machine_ids: memberIds,
    group_ids: pool.group_ids ?? [],
  };
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Returns a map of field → error. */
export function validatePool(d: PoolDraft, opts: { requireName?: boolean; layer7?: boolean }): Record<string, string> {
  const e: Record<string, string> = {};
  if (opts.requireName && !d.name.trim()) e.name = "Required";
  if (!d.target_ip.trim()) e.target_ip = "Required";
  else if (!IPV4.test(d.target_ip.trim()) && !/^[a-z0-9.-]+$/i.test(d.target_ip.trim())) e.target_ip = "IP or hostname";
  if (!(d.target_port > 0 && d.target_port < 65536)) e.target_port = "1–65535";
  if (!(d.target_port_http > 0 && d.target_port_http < 65536)) e.target_port_http = "1–65535";
  if (!(d.interval_minutes >= 1)) e.interval_minutes = "≥ 1";
  if (!d.machine_ids.length && !d.group_ids.length) e.machines = "Pick at least one machine or group";
  if (opts.layer7 && d.ssl_email && !/^\S+@\S+\.\S+$/.test(d.ssl_email)) e.ssl_email = "Invalid email";
  return e;
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-[13px]">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-[13px] font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

export function MachineGroupPicker({
  groups,
  value,
  onValueChange,
  id,
}: {
  groups: MachineGroupWithCount[];
  value: string[];
  onValueChange: (ids: string[]) => void;
  id?: string;
}) {
  return (
    <MultiCombobox<MachineGroupWithCount>
      id={id}
      items={groups}
      value={value}
      onValueChange={(ids) => onValueChange(ids)}
      getValue={(g) => g.id}
      getLabel={(g) => g.name}
      renderItem={(g) => (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
          <span>{g.emoji}</span>
          <span className="min-w-0 flex-1 truncate">{g.name}</span>
          <span className="font-data text-[11px] text-muted-foreground">{g.machine_count} machines</span>
        </span>
      )}
      renderChip={(g) => (
        <span className="inline-flex items-center gap-1">
          {g.emoji} {g.name}
        </span>
      )}
      placeholder={groups.length ? "Select machine groups…" : "No machine groups"}
      disabled={!groups.length}
      searchPlaceholder="Search groups…"
      emptyText="No groups match."
      className="w-full"
    />
  );
}

export function PoolFields({
  draft,
  onChange,
  machines,
  groups,
  groupsByMachine,
  variant,
  showName,
  nameLocked,
  zone,
  errors = {},
}: {
  draft: PoolDraft;
  onChange: (d: PoolDraft) => void;
  machines?: Machine[];
  groups: MachineGroupWithCount[];
  groupsByMachine?: Record<string, string[]>;
  variant: "layer7" | "passthrough" | "wildcard";
  showName?: boolean;
  nameLocked?: boolean;
  zone: string;
  errors?: Record<string, string>;
}) {
  const set = <K extends keyof PoolDraft>(k: K, v: PoolDraft[K]) => onChange({ ...draft, [k]: v });
  const num = (v: string, fallback: number) => {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  };
  const groupMachineCount = groups
    .filter((g) => draft.group_ids.includes(g.id))
    .reduce((n, g) => n + (g.machine_count ?? 0), 0);

  return (
    <div className="space-y-6">
      {showName && (
        <Field
          label="Record"
          htmlFor="pool-name"
          error={errors.name}
          hint={
            <>
              Serves <span className="font-data text-foreground">{draft.name && draft.name !== "@" ? `${draft.name}.${zone}` : zone}</span>
            </>
          }
        >
          <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring/40">
            <Input
              id="pool-name"
              className="font-data border-0 focus-visible:ring-0"
              placeholder="www, api, @"
              value={draft.name}
              disabled={nameLocked}
              onChange={(e) => set("name", e.target.value.trim())}
            />
            <span className="font-data shrink-0 pr-3 text-[12px] text-subtle-foreground">.{zone}</span>
          </div>
        </Field>
      )}

      <Group title="Upstream">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Target" htmlFor="pool-target" error={errors.target_ip} hint="Final destination the proxies forward to.">
            <Input
              id="pool-target"
              className="font-data"
              placeholder="203.0.113.10"
              value={draft.target_ip}
              aria-invalid={!!errors.target_ip}
              onChange={(e) => set("target_ip", e.target.value.trim())}
            />
          </Field>
          <Field label="Scheme">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.target_scheme}
              onValueChange={(v) => v && set("target_scheme", v as "http" | "https")}
            >
              <ToggleGroupItem value="http" className="px-3">HTTP</ToggleGroupItem>
              <ToggleGroupItem value="https" className="px-3">HTTPS</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HTTPS port" htmlFor="pool-https" error={errors.target_port}>
            <Input
              id="pool-https"
              inputMode="numeric"
              className="font-data"
              value={draft.target_port}
              onChange={(e) => set("target_port", num(e.target.value, 0))}
            />
          </Field>
          <Field label="HTTP port" htmlFor="pool-http" error={errors.target_port_http}>
            <Input
              id="pool-http"
              inputMode="numeric"
              className="font-data"
              value={draft.target_port_http}
              onChange={(e) => set("target_port_http", num(e.target.value, 0))}
            />
          </Field>
        </div>
        <div className="divide-y divide-border rounded-md border border-border px-3">
          <SwitchRow
            label="Preserve Host header"
            description="Send the original Host to the upstream."
            checked={draft.preserve_host}
            onCheckedChange={(v) => set("preserve_host", v)}
          />
          <SwitchRow
            label="Verify upstream TLS"
            description="Reject invalid certificates on HTTPS upstreams."
            checked={draft.tls_verify_upstream}
            onCheckedChange={(v) => set("tls_verify_upstream", v)}
          />
          {variant !== "layer7" && (
            <SwitchRow
              label="PROXY protocol"
              description="All HTTPS backends on one proxy share the :443 listener, so they must agree on this."
              checked={draft.proxy_protocol}
              onCheckedChange={(v) => set("proxy_protocol", v)}
            />
          )}
        </div>
        {variant === "layer7" && (
          <Field label="Certificate email" htmlFor="pool-email" error={errors.ssl_email} hint="Used for Let's Encrypt registration.">
            <Input
              id="pool-email"
              type="email"
              placeholder="ops@example.com"
              value={draft.ssl_email}
              onChange={(e) => set("ssl_email", e.target.value.trim())}
            />
          </Field>
        )}
      </Group>

      <Group title="Proxy machines">
        <Field label="Machines" htmlFor="pool-machines" error={errors.machines}>
          <MachinePicker
            id="pool-machines"
            multiple
            machines={machines}
            groupsByMachine={groupsByMachine}
            value={draft.machine_ids}
            onValueChange={(ids) => set("machine_ids", ids)}
            groupBy="status"
            maxChips={4}
            className="w-full"
          />
        </Field>
        <Field
          label="Machine groups"
          htmlFor="pool-groups"
          hint="Members of these groups join the pool automatically, now and later."
        >
          <MachineGroupPicker id="pool-groups" groups={groups} value={draft.group_ids} onValueChange={(ids) => set("group_ids", ids)} />
        </Field>
        <p className="font-data text-xs text-muted-foreground">
          {draft.machine_ids.length} direct + {draft.group_ids.length} group{draft.group_ids.length === 1 ? "" : "s"}
          {groupMachineCount ? ` (~${groupMachineCount} machines)` : ""}
        </p>
      </Group>

      <Group title="Rotation">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Strategy">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.rotation_strategy}
              onValueChange={(v) => v && set("rotation_strategy", v)}
            >
              <ToggleGroupItem value="round_robin" className="px-3">Round robin</ToggleGroupItem>
              <ToggleGroupItem value="random" className="px-3">Random</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field label="Every" htmlFor="pool-interval" error={errors.interval_minutes}>
            <div className="flex items-center gap-2">
              <Input
                id="pool-interval"
                inputMode="numeric"
                className="font-data w-24"
                value={draft.interval_minutes}
                onChange={(e) => set("interval_minutes", num(e.target.value, 0))}
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          </Field>
        </div>
        <div className="divide-y divide-border rounded-md border border-border px-3">
          <SwitchRow
            label="Skip offline machines"
            description="Rotation never lands on a machine whose agent is offline."
            checked={draft.health_check_enabled}
            onCheckedChange={(v) => set("health_check_enabled", v)}
          />
          {variant === "wildcard" && (
            <SwitchRow
              label="Include root domain"
              description={
                <>
                  Also route <span className="font-data">{zone}</span>, not only <span className="font-data">*.{zone}</span>.
                </>
              }
              checked={draft.include_root}
              onCheckedChange={(v) => set("include_root", v)}
            />
          )}
        </div>
      </Group>
    </div>
  );
}
