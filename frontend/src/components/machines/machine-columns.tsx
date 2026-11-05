"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Copy, ExternalLink, MoreHorizontal, RefreshCw, Tags, TerminalSquare, Trash2 } from "lucide-react";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getApexDomain } from "@/components/domains/domain-utils";
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

const DOMAIN_STATUS_RANK: Record<string, number> = { unhealthy: 0, idle: 1, linked: 1, healthy: 2 };

/** "shop." bright, "aurora-goods.test" muted. */
function FqdnParts({ fqdn }: { fqdn: string }) {
  const apex = getApexDomain(fqdn);
  const sub = fqdn.toLowerCase() === apex ? "" : fqdn.slice(0, fqdn.length - apex.length);
  return (
    <span className="font-data min-w-0 truncate text-[12px]">
      {sub ? (
        <>
          <span className="text-foreground">{sub}</span>
          <span className="text-muted-foreground">{apex}</span>
        </>
      ) : (
        <span className="text-foreground">{fqdn}</span>
      )}
    </span>
  );
}

function HealthBar({ healthy, unhealthy, unknown, className }: { healthy: number; unhealthy: number; unknown: number; className?: string }) {
  const total = healthy + unhealthy + unknown;
  return (
    <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-white/[0.07]", className)} aria-hidden>
      {healthy > 0 && <div className="h-full bg-success" style={{ width: `${(healthy / total) * 100}%` }} />}
      {unhealthy > 0 && <div className="h-full bg-destructive" style={{ width: `${(unhealthy / total) * 100}%` }} />}
      {unknown > 0 && <div className="h-full bg-muted-foreground/40" style={{ width: `${(unknown / total) * 100}%` }} />}
    </div>
  );
}

const DOMAINS_PREVIEW = 8;

function DomainsCell({ m }: { m: FleetMachine }) {
  const total = m.assigned_domains_count ?? 0;
  const healthy = m.healthy_domains_count ?? 0;
  const unhealthy = m.unhealthy_domains_count ?? 0;
  const unknown = Math.max(0, total - healthy - unhealthy);
  const summary = React.useMemo(
    () =>
      [...(m.assigned_domains_summary ?? [])].sort(
        (a, b) => (DOMAIN_STATUS_RANK[a.status] ?? 1) - (DOMAIN_STATUS_RANK[b.status] ?? 1) || a.fqdn.localeCompare(b.fqdn)
      ),
    [m.assigned_domains_summary]
  );
  if (!total) return <span className="text-xs text-subtle-foreground">—</span>;
  const name = machineDisplayName(m);

  return (
    <HoverCard openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>
        <div className="flex w-full cursor-default items-center gap-2 pr-8">
          <HealthBar healthy={healthy} unhealthy={unhealthy} unknown={unknown} className="min-w-8 flex-1" />
          <span className="font-data shrink-0 text-[12.5px] tabular-nums">{total}</span>
          {unhealthy > 0 && <span className="font-data shrink-0 text-[11px] text-destructive">{unhealthy} down</span>}
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="start"
        className="w-80 p-0"
        // Portaled, but React still bubbles clicks to the row; keep them here.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2.5 px-3.5 pt-3 pb-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium">Domains</span>
            <span className="font-data text-[12px] text-muted-foreground tabular-nums">{total} assigned</span>
          </div>
          <HealthBar healthy={healthy} unhealthy={unhealthy} unknown={unknown} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status="healthy" pulse={false} size="xs" />
              <span className="font-data text-foreground tabular-nums">{healthy}</span> healthy
            </span>
            {unhealthy > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <StatusDot status="unhealthy" pulse={false} size="xs" />
                <span className="font-data text-foreground tabular-nums">{unhealthy}</span> down
              </span>
            )}
            {unknown > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <StatusDot status="unknown" pulse={false} size="xs" />
                <span className="font-data text-foreground tabular-nums">{unknown}</span> not checked
              </span>
            )}
          </div>
        </div>
        {summary.length > 0 && (
          <ul className="max-h-64 overflow-y-auto border-t border-border py-1">
            {summary.slice(0, DOMAINS_PREVIEW).map((d) => (
              <li key={d.fqdn}>
                <Link
                  href={`/domains?q=${encodeURIComponent(d.fqdn)}`}
                  className="flex items-center gap-2 px-3.5 py-1.5 transition-colors hover:bg-accent"
                >
                  <StatusDot status={d.status} pulse={false} size="xs" />
                  <FqdnParts fqdn={d.fqdn} />
                  {d.status === "unhealthy" && <span className="ml-auto shrink-0 text-[11px] text-destructive">down</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/domains?q=${encodeURIComponent(name)}`}
          className="flex items-center justify-between border-t border-border px-3.5 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {summary.length > DOMAINS_PREVIEW ? `+${summary.length - DOMAINS_PREVIEW} more · view all` : "Open in Domains"}
          <ArrowRight className="size-3.5" />
        </Link>
      </HoverCardContent>
    </HoverCard>
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
      header: ({ column }) => <DataTableColumnHeader column={column} title="System" align="center" />,
      meta: { label: "System (load + agent)", width: "fill", minWidth: 250, align: "center" },
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
      meta: { label: "Machine", width: "fill", share: 35, minWidth: 200 },
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
      meta: { label: "Domains", width: "fill", share: 24, minWidth: 140 },
      sortDescFirst: true,
      cell: ({ row }) => <DomainsCell m={row.original} />,
    },
    ...resourceColumns(h.latestAgent),
    {
      id: "groups",
      accessorFn: (m) => machineGroups(m, h.groupsByMachine).map((g) => g.name),
      header: "Groups",
      meta: { label: "Groups", width: "fill", share: 16, minWidth: 110 },
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
