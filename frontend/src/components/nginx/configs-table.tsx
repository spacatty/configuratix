"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, CopyPlus, Lock, LockOpen, MoreHorizontal, Pencil, Trash2, TriangleAlert, Upload } from "lucide-react";

import type { NginxConfig, NginxConfigStructured } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTableColumnHeader } from "@/components/ui/data-table";
import { RelativeTime } from "@/components/app/data-display";
import { SSL_MODE_LABELS } from "@/components/nginx/form-state";

export function configStructured(c: NginxConfig): NginxConfigStructured | null {
  return (c.structured_json as NginxConfigStructured | null) ?? null;
}
export function configKind(c: NginxConfig): "raw" | "l4" | "l7" {
  if (c.mode === "manual") return "raw";
  return configStructured(c)?.is_passthrough ? "l4" : "l7";
}

export function ConfigKindBadges({ config }: { config: NginxConfig }) {
  const k = configKind(config);
  return (
    <span className="inline-flex items-center gap-1">
      {k === "raw" ? <Badge variant="secondary">Raw</Badge> : <Badge variant="muted">Structured</Badge>}
      {k === "l4" && <Badge variant="warning">L4 passthrough</Badge>}
      {k === "l7" && <Badge variant="info">L7</Badge>}
    </span>
  );
}

export interface ConfigActions {
  onEdit: (c: NginxConfig) => void;
  onDuplicate: (c: NginxConfig) => void;
  onApply: (c: NginxConfig, onlyOutOfSync: boolean) => void;
  onDelete: (c: NginxConfig) => void;
  busyId?: string | null;
}

export function buildConfigColumns(a: ConfigActions): ColumnDef<NginxConfig>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const c = row.original;
        const st = configStructured(c);
        const k = configKind(c);
        const sub =
          k === "raw"
            ? `${(c.raw_text ?? "").split("\n").length} lines`
            : k === "l4"
              ? st?.passthrough_target || "no target"
              : `${st?.locations?.length ?? 0} location${(st?.locations?.length ?? 0) === 1 ? "" : "s"}${st?.locations?.some((l) => l.use_php) ? " · PHP" : ""}${st?.proxy_settings?.enabled ? ` · ${st.proxy_settings.proxy_type === "cloudflare" ? "Cloudflare" : "real IP"}` : ""}`;
        return (
          <div className="min-w-0">
            <Link href={`/configs/nginx/${c.id}`} className="block truncate font-medium hover:underline underline-offset-2">
              {c.name}
            </Link>
            <div className="font-data truncate text-[11.5px] text-muted-foreground">{sub}</div>
          </div>
        );
      },
    },
    {
      id: "kind",
      accessorFn: (c) => configKind(c),
      header: "Type",
      cell: ({ row }) => <ConfigKindBadges config={row.original} />,
      filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
    },
    {
      id: "ssl",
      accessorFn: (c) => {
        const k = configKind(c);
        if (k === "raw") return "raw";
        if (k === "l4") return "backend";
        return configStructured(c)?.ssl_mode || "allow_http";
      },
      header: "SSL",
      cell: ({ row }) => {
        const v = row.getValue<string>("ssl");
        if (v === "raw") return <span className="text-subtle-foreground">—</span>;
        if (v === "backend")
          return (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Lock className="size-3.5" />
              Backend
            </span>
          );
        return (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            {v === "disabled" ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5 text-success" />}
            {SSL_MODE_LABELS[v] ?? v}
          </span>
        );
      },
      filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
    },
    {
      id: "domains",
      accessorFn: (c) => c.domains_count ?? 0,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Domains" align="right" />,
      meta: { align: "right" },
      cell: ({ row }) => {
        const c = row.original;
        const n = c.domains_count ?? 0;
        const oos = c.out_of_sync_count ?? 0;
        return (
          <div className="flex items-center justify-end gap-2">
            {oos > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="warning" className="font-data">
                    <TriangleAlert />
                    {oos}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {oos} of {n} domains run an older version
                </TooltipContent>
              </Tooltip>
            )}
            <span className={n ? "font-data" : "font-data text-subtle-foreground"}>{n}</span>
          </div>
        );
      },
    },
    {
      id: "updated",
      accessorFn: (c) => c.updated_at,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" align="right" />,
      meta: { align: "right" },
      cell: ({ row }) => <RelativeTime date={row.original.updated_at} className="text-muted-foreground" />,
    },
    {
      id: "actions",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => {
        const c = row.original;
        const oos = c.out_of_sync_count ?? 0;
        const n = c.domains_count ?? 0;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => a.onEdit(c)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => a.onDuplicate(c)} disabled={a.busyId === c.id}>
                <CopyPlus />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => a.onApply(c, true)} disabled={oos === 0}>
                <Upload />
                Apply to out-of-sync{oos ? ` (${oos})` : ""}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => a.onApply(c, false)} disabled={n === 0}>
                <Upload />
                Re-apply to all domains{n ? ` (${n})` : ""}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void copyToClipboard(c.id)}>
                <Copy />
                Copy ID
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => a.onDelete(c)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
