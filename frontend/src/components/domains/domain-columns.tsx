"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ExternalLink,
  FileCog,
  FileText,
  FolderOpen,
  HeartPulse,
  Link2,
  MoreHorizontal,
  RotateCw,
  ScrollText,
  Server,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Unlink,
} from "lucide-react";

import type { Domain, DomainGroup } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTableColumnHeader } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyButton, RelativeTime, openJobLogs } from "@/components/app";

import { DomainApplyCell, DomainHealthCell } from "./domain-status";
import { GroupChips } from "./group-chip";
import { APPLY_META, HEALTH_LABEL, domainApplyState, domainHealth, getApexDomain, isApplyActive } from "./domain-utils";

export interface DomainRowActions {
  open: (d: Domain) => void;
  assign: (d: Domain) => void;
  reapply: (d: Domain) => void;
  unassign: (d: Domain) => void;
  checkHealth: (d: Domain) => void;
  healthSettings: (d: Domain) => void;
  groups: (d: Domain) => void;
  notes: (d: Domain) => void;
  remove: (d: Domain) => void;
}

/** FQDN with the apex muted; subdomains indented under an apex present in the list. */
export function FqdnCell({ domain, nested }: { domain: Domain; nested: boolean }) {
  const apex = getApexDomain(domain.fqdn);
  const isApex = domain.fqdn.toLowerCase() === apex;
  const sub = isApex ? "" : domain.fqdn.slice(0, domain.fqdn.length - apex.length);
  return (
    <div className="group/fqdn flex min-w-0 items-center gap-1.5">
      {nested && !isApex && (
        <span aria-hidden className="ml-1 h-3 w-3 shrink-0 rounded-bl-[3px] border-b border-l border-border-strong" />
      )}
      <span className="font-data min-w-0 truncate text-[12.5px]">
        {isApex ? (
          <span className="font-medium text-foreground">{domain.fqdn}</span>
        ) : (
          <>
            <span className="text-foreground">{sub}</span>
            <span className="text-subtle-foreground">{apex}</span>
          </>
        )}
      </span>
      {domain.notes_md?.trim() && (
        <Tooltip>
          <TooltipTrigger asChild>
            <StickyNote className="size-3 shrink-0 text-muted-foreground" aria-label="Has notes" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-wrap text-xs">
            {domain.notes_md.slice(0, 280)}
            {domain.notes_md.length > 280 && "…"}
          </TooltipContent>
        </Tooltip>
      )}
      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/fqdn:opacity-100 focus-within:opacity-100">
        <CopyButton value={domain.fqdn} size="xs" label="Copy domain" />
        <a
          href={`https://${domain.fqdn}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={`Open ${domain.fqdn}`}
        >
          <ExternalLink className="size-3" />
        </a>
      </span>
    </div>
  );
}

export function buildDomainColumns({
  actions,
  groupsByDomain,
  apexSet,
  retryingIds,
}: {
  actions: DomainRowActions;
  groupsByDomain: Record<string, DomainGroup[]>;
  /** Apex names that are themselves rows (to draw nesting). */
  apexSet: Set<string>;
  retryingIds: Set<string>;
}): ColumnDef<Domain>[] {
  return [
    {
      accessorKey: "fqdn",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Domain" />,
      meta: { label: "Domain", className: "max-w-[360px]" },
      sortingFn: (a, b) => a.original.fqdn.localeCompare(b.original.fqdn),
      cell: ({ row }) => (
        <FqdnCell domain={row.original} nested={apexSet.has(getApexDomain(row.original.fqdn))} />
      ),
    },
    {
      id: "machine",
      accessorFn: (d) => d.machine_name ?? (d.assigned_machine_id ? "Unknown machine" : "Unassigned"),
      header: "Machine",
      meta: { label: "Machine" },
      cell: ({ row }) => {
        const d = row.original;
        if (!d.assigned_machine_id) return <span className="text-muted-foreground">Unassigned</span>;
        return (
          <Link
            href={`/machines/${d.assigned_machine_id}`}
            className="group/m flex min-w-0 flex-col leading-tight"
          >
            <span className="truncate text-[13px] group-hover/m:underline">{d.machine_name ?? "Machine"}</span>
            {d.machine_ip && <span className="font-data truncate text-[11px] text-muted-foreground">{d.machine_ip}</span>}
          </Link>
        );
      },
    },
    {
      id: "config",
      accessorFn: (d) => d.config_name ?? "No config",
      header: "Config",
      meta: { label: "Nginx config" },
      cell: ({ row }) => {
        const d = row.original;
        if (!d.config_id) return <span className="text-muted-foreground">—</span>;
        return (
          <Link
            href={`/configs/nginx/${d.config_id}`}
            className="inline-flex max-w-[180px] items-center gap-1.5 truncate text-[13px] hover:underline"
          >
            <FileCog className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{d.config_name ?? "Config"}</span>
          </Link>
        );
      },
    },
    {
      id: "health",
      accessorFn: (d) => HEALTH_LABEL[domainHealth(d)],
      header: "Health",
      meta: { label: "Health" },
      sortingFn: (a, b) => {
        const rank = { unhealthy: 0, unknown: 1, healthy: 2, unassigned: 3 } as const;
        return rank[domainHealth(a.original)] - rank[domainHealth(b.original)];
      },
      cell: ({ row }) => <DomainHealthCell domain={row.original} />,
    },
    {
      id: "apply",
      accessorFn: (d) => APPLY_META[domainApplyState(d)].label,
      header: "Apply",
      meta: { label: "Apply status" },
      cell: ({ row }) => (
        <DomainApplyCell domain={row.original} onRetry={actions.reapply} retrying={retryingIds.has(row.original.id)} />
      ),
    },
    {
      id: "groups",
      accessorFn: (d) => (groupsByDomain[d.id] ?? []).map((g) => g.name),
      header: "Groups",
      enableSorting: false,
      meta: { label: "Groups" },
      cell: ({ row }) => <GroupChips groups={groupsByDomain[row.original.id] ?? []} />,
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Added" align="right" />,
      meta: { label: "Added", align: "right" },
      cell: ({ row }) => <RelativeTime date={row.original.created_at} className="text-xs text-muted-foreground" />,
    },
    {
      id: "actions",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", className: "w-10" },
      cell: ({ row }) => <DomainActionsMenu domain={row.original} actions={actions} />,
    },
  ];
}

export function DomainActionsMenu({ domain: d, actions }: { domain: Domain; actions: DomainRowActions }) {
  const assigned = !!d.assigned_machine_id;
  const busy = isApplyActive(d);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.fqdn}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => actions.assign(d)}>
          <Link2 />
          {assigned ? "Reassign…" : "Assign…"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!assigned || !d.config_id || busy} onClick={() => actions.reapply(d)}>
          <RotateCw />
          Re-apply config
        </DropdownMenuItem>
        {d.last_job_id && (
          <DropdownMenuItem onClick={() => openJobLogs(d.last_job_id!)}>
            <ScrollText />
            Last job logs
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!assigned} onClick={() => actions.checkHealth(d)}>
          <HeartPulse />
          Check health now
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.healthSettings(d)}>
          <SlidersHorizontal />
          Health check settings…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.groups(d)}>
          <FolderOpen />
          Groups…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.notes(d)}>
          <FileText />
          Notes…
        </DropdownMenuItem>
        {assigned && (
          <DropdownMenuItem asChild>
            <Link href={`/machines/${d.assigned_machine_id}`}>
              <Server />
              Go to machine
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {assigned && (
          <DropdownMenuItem disabled={busy} onClick={() => actions.unassign(d)}>
            <Unlink />
            Unassign…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={() => actions.remove(d)}>
          <Trash2 />
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
