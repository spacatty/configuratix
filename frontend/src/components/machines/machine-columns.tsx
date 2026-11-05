"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, ExternalLink, MoreHorizontal, RefreshCw, Tags, TerminalSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RelativeTime, StatusDot, getStatusMeta, machineDisplayName, machineIp } from "@/components/app";
import { GroupChips } from "./group-chips";
import { LoadCell, type AgentBadgeInfo } from "./resource-meter";
import { cpuPct, diskPct, groupRefs, isAgentOutdated, isAgentUpdating, liveness, memPct, LIVENESS_LABEL, type FleetMachine } from "./utils";

export interface MachineColumnHandlers {
  latestAgent?: string | null;
  groupsByMachine: Record<string, { id: string; name: string; color?: string | null; emoji?: string | null }[]>;
  onUpdateAgent: (m: FleetMachine) => void;
  onAssignGroups: (m: FleetMachine) => void;
  onDelete: (m: FleetMachine) => void;
}

export function agentFacet(m: FleetMachine, latest?: string | null): string {
  if (isAgentUpdating(m)) return "Updating";
  if (!m.agent_version) return "Not enrolled";
  if (isAgentOutdated(m, latest)) return "Outdated";
  return "Current";
}

export function machineGroups(m: FleetMachine, map: MachineColumnHandlers["groupsByMachine"]) {
  const refs = groupRefs(m);
  return refs.length || Array.isArray(m.group_names) ? refs : (map[m.id] ?? []);
}

function DomainsCell({ m }: { m: FleetMachine }) {
  const total = m.assigned_domains_count ?? 0;
  const healthy = m.healthy_domains_count ?? 0;
  const unhealthy = m.unhealthy_domains_count ?? 0;
  const unknown = Math.max(0, total - healthy - unhealthy);
  if (!total) return <span className="text-xs text-subtle-foreground">—</span>;
  const summary = m.assigned_domains_summary ?? [];
  const body = (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden>
        {healthy > 0 && <div className="h-full bg-success" style={{ width: `${(healthy / total) * 100}%` }} />}
        {unhealthy > 0 && <div className="h-full bg-destructive" style={{ width: `${(unhealthy / total) * 100}%` }} />}
        {unknown > 0 && <div className="h-full bg-muted-foreground/40" style={{ width: `${(unknown / total) * 100}%` }} />}
      </div>
      <span className="font-data min-w-6 text-right text-[12.5px]">{total}</span>
      {unhealthy > 0 && <span className="font-data text-[11px] text-destructive">{unhealthy}↓</span>}
    </div>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs">
        <div className="font-data mb-1 text-[11px]">
          {healthy} healthy · {unhealthy} unhealthy · {unknown} unknown
        </div>
        {summary.slice(0, 8).map((d) => (
          <div key={d.fqdn} className="flex items-center gap-1.5 text-[11px]">
            <StatusDot status={d.status} pulse={false} size="xs" />
            <span className="font-data truncate">{d.fqdn}</span>
          </div>
        ))}
        {summary.length > 8 && <div className="text-[11px] text-muted-foreground">+{summary.length - 8} more</div>}
      </TooltipContent>
    </Tooltip>
  );
}

function resourceProps(m: FleetMachine) {
  const stale = liveness(m) !== "online";
  return [
    { label: "CPU", value: cpuPct(m), stale, lastSeen: m.last_seen },
    { label: "Memory", value: memPct(m), used: m.memory_used, total: m.memory_total, stale, lastSeen: m.last_seen },
    { label: "Disk", value: diskPct(m), used: m.disk_used, total: m.disk_total, stale, lastSeen: m.last_seen },
  ] as const;
}

function agentBadge(m: FleetMachine, latest?: string | null): AgentBadgeInfo {
  if (!m.agent_version) return { version: null, state: "none", hint: "No agent has reported yet" };
  if (isAgentUpdating(m)) {
    return { version: m.agent_version, state: "updating", hint: `Updating to ${m.agent_update_target_version ?? latest ?? "latest"} (${m.agent_update_state})` };
  }
  if (m.agent_update_state === "failed") {
    return { version: m.agent_version, state: "failed", hint: m.agent_last_update_error ?? "Last update failed" };
  }
  if (isAgentOutdated(m, latest)) return { version: m.agent_version, state: "outdated", hint: latest ? `Latest is ${latest}` : "A newer agent is available" };
  return { version: m.agent_version, state: "current" };
}

/** "System": CPU / memory / disk gauges plus the agent version badge in one column. */
function resourceColumns(latest?: string | null): ColumnDef<FleetMachine>[] {
  return [
    {
      id: "system",
      accessorFn: (m) => Math.max(cpuPct(m) ?? -1, memPct(m) ?? -1, diskPct(m) ?? -1),
      header: ({ column }) => <DataTableColumnHeader column={column} title="System" />,
      meta: { label: "System (load + agent)", width: "fit" },
      sortDescFirst: true,
      cell: ({ row }) => {
        const items = [...resourceProps(row.original)];
        return (
          <LoadCell items={items} stale={items[0].stale} lastSeen={row.original.last_seen} agent={agentBadge(row.original, latest)} />
        );
      },
    },
  ];
}

export function buildMachineColumns(h: MachineColumnHandlers): ColumnDef<FleetMachine>[] {
  return [
    {
      id: "name",
      accessorFn: (m) => machineDisplayName(m),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Machine" />,
      meta: { label: "Machine", width: "fill" },
      enableHiding: false,
      cell: ({ row }) => {
        const m = row.original;
        const live = liveness(m);
        const name = machineDisplayName(m);
        const ip = machineIp(m);
        return (
          <div className="flex items-center gap-2.5 pr-6">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex size-4 items-center justify-center">
                  <StatusDot status={live} />
                </span>
              </TooltipTrigger>
              <TooltipContent>{LIVENESS_LABEL[live]}</TooltipContent>
            </Tooltip>
            <div className="min-w-0">
              <Link href={`/machines/${m.id}`} className="block truncate text-[13px] font-semibold hover:underline underline-offset-4">
                {name}
              </Link>
              <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-subtle-foreground">
                {ip && (
                  <button
                    type="button"
                    title="Copy IP"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await copyToClipboard(ip)) toast.success("IP copied", { description: ip });
                    }}
                    className="group/ip font-data inline-flex shrink-0 items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 outline-none"
                  >
                    {ip}
                    <Copy className="size-3 -translate-x-1 opacity-0 transition-all duration-150 group-hover/ip:translate-x-0 group-hover/ip:opacity-100" />
                  </button>
                )}
                {m.hostname && m.hostname !== name && (
                  <>
                    {ip && <span aria-hidden>·</span>}
                    <span className="font-data truncate">{m.hostname}</span>
                  </>
                )}
                {m.ubuntu_version && m.ubuntu_version !== "Unknown" && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{m.ubuntu_version.replace(/\s*LTS$/, "")}</span>
                  </>
                )}
                {!ip && !m.hostname && <span>awaiting first heartbeat</span>}
              </div>
            </div>
          </div>
        );
      },
    },
    // Hidden facet columns
    {
      id: "status",
      accessorFn: (m) => liveness(m),
      header: "Status",
      enableHiding: false,
      enableSorting: false,
    },
    {
      id: "project",
      accessorFn: (m) => m.project_name || "No project",
      header: "Project",
      enableHiding: false,
    },
    {
      id: "agent",
      accessorFn: (m) => agentFacet(m, h.latestAgent),
      header: "Agent",
      enableHiding: false,
    },
    {
      id: "php",
      accessorFn: (m) => (m.php_version ? `PHP ${m.php_version}` : m.php_installed ? "PHP" : "No PHP"),
      header: "PHP",
      enableHiding: false,
    },
    {
      id: "domains",
      accessorFn: (m) => m.assigned_domains_count ?? 0,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Domains" />,
      meta: { label: "Domains", width: "fill" },
      sortDescFirst: true,
      cell: ({ row }) => <DomainsCell m={row.original} />,
    },
    ...resourceColumns(h.latestAgent),
    {
      id: "groups",
      accessorFn: (m) => machineGroups(m, h.groupsByMachine).map((g) => g.name),
      header: "Groups",
      meta: { label: "Groups", width: "fit" },
      enableSorting: false,
      cell: ({ row }) => <GroupChips groups={machineGroups(row.original, h.groupsByMachine)} onEdit={() => h.onAssignGroups(row.original)} />,
    },
    {
      id: "created_at",
      accessorFn: (m) => (m.created_at ? new Date(m.created_at).getTime() : 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Added" align="right" />,
      meta: { label: "Added", align: "right", width: "fit" },
      sortDescFirst: true,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} className="text-xs text-muted-foreground" />,
    },
    {
      id: "last_seen",
      accessorFn: (m) => (m.last_seen ? new Date(m.last_seen).getTime() : 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Last seen" align="right" />,
      meta: { label: "Last seen", align: "right", width: "fit" },
      sortDescFirst: true,
      cell: ({ row }) =>
        liveness(row.original) === "online" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-success">
            <StatusDot status="online" size="xs" />
            live
          </span>
        ) : (
          <span className={cn("text-xs", liveness(row.original) === "offline" ? "text-warning" : "text-muted-foreground")}>
            <RelativeTime date={row.original.last_seen} fallback="never" />
          </span>
        ),
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", width: "fit" },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm" aria-label={`Terminal on ${machineDisplayName(row.original)}`}>
                <Link href={`/machines/${row.original.id}?tab=terminal`}>
                  <TerminalSquare />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open terminal</TooltipContent>
          </Tooltip>
          <RowActions m={row.original} h={h} />
        </div>
      ),
    },
  ];
}

function RowActions({ m, h }: { m: FleetMachine; h: MachineColumnHandlers }) {
  const ip = machineIp(m);
  const updating = isAgentUpdating(m);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Machine actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate">{machineDisplayName(m)}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/machines/${m.id}`}>
            <ExternalLink />
            Open
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/machines/${m.id}?tab=terminal`}>
            <TerminalSquare />
            Terminal
          </Link>
        </DropdownMenuItem>
        {ip && (
          <DropdownMenuItem
            onSelect={async () => {
              if (await copyToClipboard(ip)) toast.success("IP copied", { description: ip });
            }}
          >
            <Copy />
            Copy IP
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => h.onUpdateAgent(m)} disabled={updating || !m.agent_id}>
          <RefreshCw />
          {updating ? "Updating agent…" : "Update agent"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => h.onAssignGroups(m)}>
          <Tags />
          Assign groups
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => h.onDelete(m)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Facet-only columns, plus "Last seen" (hidden by default; the status dot already shows liveness).
export const HIDDEN_FACET_COLUMNS = { status: false, project: false, agent: false, php: false, last_seen: false };

/** Sort helper for unknown statuses in the facet list. */
export const STATUS_FACET_OPTIONS = (["online", "stale", "offline"] as const).map((s) => ({ value: s, label: getStatusMeta(s).label }));
