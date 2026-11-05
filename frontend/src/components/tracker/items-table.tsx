"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, CircleDollarSign, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { TrackerCategoryWithCount, TrackerItemWithCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyableMono, EmptyState, StatusText } from "@/components/app";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CategoryGlyph, TagChip } from "./bits";
import { EXPIRY_LABEL, EXPIRY_STATUS, daysUntil, expiryState, formatCurrency, notifyDaysFor, recurringLabel } from "./utils";

function inDays(d: number): string {
  if (d === 0) return "today";
  if (d > 0) return d === 1 ? "tomorrow" : `in ${d}d`;
  return `${-d}d ago`;
}

export function ItemsTable({
  items,
  categories,
  loading,
  toolbar,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onPaid,
  onOpenResource,
  onCreate,
}: {
  items: TrackerItemWithCategory[];
  categories: TrackerCategoryWithCount[];
  loading?: boolean;
  toolbar?: React.ReactNode;
  onOpen: (i: TrackerItemWithCategory) => void;
  onEdit: (i: TrackerItemWithCategory) => void;
  onDuplicate: (i: TrackerItemWithCategory) => void;
  onDelete: (rows: TrackerItemWithCategory[], clear?: () => void) => void;
  onPaid: (i: TrackerItemWithCategory) => void;
  onOpenResource: (resourceId: string) => void;
  onCreate: () => void;
}) {
  const stateOf = React.useCallback(
    (i: TrackerItemWithCategory) => expiryState(i.expiry_at, notifyDaysFor(i.category_id, categories)),
    [categories]
  );

  const columns = React.useMemo<ColumnDef<TrackerItemWithCategory>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
          const i = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <CategoryGlyph icon={i.category_icon} color={i.category_color} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{i.name}</div>
                {i.tags && i.tags.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {i.tags.slice(0, 4).map((t) => (
                      <TagChip key={t.id} name={t.name} color={t.color} className="h-4 text-[10px]" />
                    ))}
                    {i.tags.length > 4 && <span className="text-[10px] text-subtle-foreground">+{i.tags.length - 4}</span>}
                  </div>
                )}
              </div>
            </div>
          );
        },
      },
      {
        id: "category",
        accessorFn: (i) => i.category_name ?? "Uncategorized",
        header: "Category",
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
        cell: ({ getValue }) => <span className="text-[13px] text-muted-foreground">{getValue() as string}</span>,
      },
      {
        accessorKey: "identifier_value",
        header: "Identifier",
        cell: ({ row }) => {
          const i = row.original;
          if (!i.identifier_value) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex min-w-0 items-center gap-1.5">
              {i.category_identifier_label && <span className="shrink-0 text-xs text-subtle-foreground">{i.category_identifier_label}</span>}
              <CopyableMono value={i.identifier_value} className="min-w-0" monoClassName="truncate" />
            </div>
          );
        },
      },
      {
        id: "resource",
        accessorFn: (i) => i.resource_name ?? "",
        header: "Resource",
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
        cell: ({ row }) => {
          const i = row.original;
          return i.resource_id ? (
            <button
              type="button"
              className="max-w-[200px] truncate text-left text-[13px] hover:text-primary hover:underline underline-offset-2"
              onClick={() => onOpenResource(i.resource_id!)}
            >
              {i.resource_name ?? "Resource"}
            </button>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "tags",
        accessorFn: (i) => (i.tags ?? []).map((t) => t.name),
        header: "Tags",
        enableSorting: false,
        filterFn: (row, id, value: string[]) => {
          if (!value?.length) return true;
          const v = row.getValue(id) as string[];
          return value.some((x) => v.includes(x));
        },
        cell: () => null,
      },
      {
        id: "status",
        accessorFn: (i) => EXPIRY_LABEL[stateOf(i)],
        header: "Status",
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
        cell: ({ row }) => {
          const s = stateOf(row.original);
          return <StatusText status={EXPIRY_STATUS[s]} label={EXPIRY_LABEL[s]} />;
        },
      },
      {
        id: "expiry",
        accessorFn: (i) => (i.expiry_at ? new Date(i.expiry_at).getTime() : Number.POSITIVE_INFINITY),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expires" />,
        cell: ({ row }) => {
          const i = row.original;
          if (!i.expiry_at) return <span className="text-muted-foreground">—</span>;
          const s = stateOf(i);
          const d = daysUntil(i.expiry_at)!;
          return (
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="font-data text-[12.5px]">{formatDate(i.expiry_at)}</span>
              <span
                className={cn(
                  "font-data text-[11px]",
                  s === "overdue" ? "text-destructive" : s === "due_soon" ? "text-warning" : "text-subtle-foreground"
                )}
              >
                {inDays(d)}
              </span>
            </div>
          );
        },
      },
      {
        id: "recurring",
        accessorFn: (i) => recurringLabel(i.recurring_period_type, i.recurring_period_days) ?? "One-off",
        header: "Renews",
        cell: ({ getValue }) => <span className="text-[13px] text-muted-foreground">{getValue() as string}</span>,
      },
      {
        id: "price",
        accessorFn: (i) => i.price_usd ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Price" align="right" />,
        meta: { align: "right" },
        cell: ({ row }) => <span className="font-data text-[13px]">{formatCurrency(row.original.price_usd)}</span>,
      },
      {
        id: "actions",
        enableHiding: false,
        meta: { align: "right" },
        cell: ({ row }) => {
          const i = row.original;
          return (
            <div className="flex items-center justify-end gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Record payment" onClick={() => onPaid(i)}>
                    <CircleDollarSign />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Record payment</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(i)}>
                    <Pencil />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDuplicate(i)}>
                    <Copy />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete([i])}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [stateOf, onEdit, onDuplicate, onDelete, onPaid, onOpenResource]
  );

  const tagOptions = React.useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.tags?.forEach((t) => set.add(t.name)));
    return [...set].sort().map((t) => ({ label: t, value: t }));
  }, [items]);

  return (
    <DataTable
      columns={columns}
      data={items}
      loading={loading}
      getRowId={(i) => i.id}
      searchKeys={[
        "name",
        "identifier_value",
        (i) => i.resource_name,
        (i) => i.category_name,
        (i) => (i.tags ?? []).map((t) => t.name),
      ]}
      searchPlaceholder="Search name, identifier, resource, tag…"
      facets={[
        { columnId: "status", title: "Status", options: Object.values(EXPIRY_LABEL).map((l) => ({ label: l, value: l })) },
        ...(tagOptions.length ? [{ columnId: "tags", title: "Tags", options: tagOptions }] : []),
        { columnId: "resource", title: "Resource" },
      ]}
      toolbar={toolbar}
      initialState={{ sorting: [{ id: "expiry", desc: false }], columnVisibility: { tags: false, category: false } }}
      onRowClick={onOpen}
      getRowClassName={(i) => (stateOf(i) === "overdue" ? "bg-destructive/[0.035]" : undefined)}
      enableRowSelection
      bulkActions={(rows, clear) => (
        <Button size="sm" variant="destructive" onClick={() => onDelete(rows, clear)}>
          <Trash2 />
          Delete {rows.length}
        </Button>
      )}
      emptyState={
        <EmptyState
          icon={CalendarClock}
          title="Nothing tracked yet"
          description="Add a subscription, server or domain to get renewal reminders and spend totals."
          action={
            <Button onClick={onCreate}>
              <Plus />
              New item
            </Button>
          }
        />
      }
    />
  );
}
