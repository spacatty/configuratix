"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Bell, FolderPlus, Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { TrackerCategoryWithCount, TrackerItemWithCategory, TrackerResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CardSkeleton, EmptyState, Mono } from "@/components/app";
import { CategoryGlyph } from "./bits";
import { expiryState, formatCurrency } from "./utils";

/* -------------------------------------------------------------------------- */
/* Resources                                                                  */
/* -------------------------------------------------------------------------- */

type ResourceRow = TrackerResource & { item_count: number; spend: number };

export function ResourcesTable({
  resources,
  items,
  loading,
  onOpen,
  onEdit,
  onDelete,
  onCreate,
}: {
  resources: TrackerResource[];
  items: TrackerItemWithCategory[];
  loading?: boolean;
  onOpen: (r: TrackerResource) => void;
  onEdit: (r: TrackerResource) => void;
  onDelete: (r: TrackerResource) => void;
  onCreate: () => void;
}) {
  const rows = React.useMemo<ResourceRow[]>(() => {
    const counts = new Map<string, { n: number; spend: number }>();
    for (const i of items) {
      if (!i.resource_id) continue;
      const c = counts.get(i.resource_id) ?? { n: 0, spend: 0 };
      c.n++;
      c.spend += i.price_usd ?? 0;
      counts.set(i.resource_id, c);
    }
    return resources.map((r) => ({ ...r, item_count: counts.get(r.id)?.n ?? 0, spend: counts.get(r.id)?.spend ?? 0 }));
  }, [resources, items]);

  const columns = React.useMemo<ColumnDef<ResourceRow>[]>(
    () => [
      { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="text-[13px] font-medium">{row.original.name}</span> },
      {
        accessorKey: "url",
        header: "URL",
        cell: ({ row }) =>
          row.original.url ? (
            <a
              href={row.original.url}
              target="_blank"
              rel="noreferrer"
              className="font-data inline-flex max-w-[280px] items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary"
            >
              <Link2 className="size-3 shrink-0" />
              <span className="truncate">{row.original.url.replace(/^https?:\/\//, "")}</span>
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "notes_md",
        header: "Notes",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-[320px] truncate text-xs text-muted-foreground">{row.original.notes_md?.trim() || "—"}</span>
        ),
      },
      {
        accessorKey: "item_count",
        header: "Items",
        meta: { align: "right" },
        cell: ({ row }) => <Mono>{row.original.item_count}</Mono>,
      },
      {
        accessorKey: "spend",
        header: "Spend",
        meta: { align: "right" },
        cell: ({ row }) => <Mono>{row.original.item_count ? formatCurrency(row.original.spend) : "—"}</Mono>,
      },
      {
        id: "actions",
        enableHiding: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(row.original)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(row.original)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [onEdit, onDelete]
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      getRowId={(r) => r.id}
      searchKeys={["name", "url", "notes_md"]}
      searchPlaceholder="Search resources…"
      initialState={{ sorting: [{ id: "item_count", desc: true }] }}
      onRowClick={onOpen}
      toolbarActions={
        <Button size="sm" onClick={onCreate}>
          <Plus />
          New resource
        </Button>
      }
      emptyState={
        <EmptyState
          icon={Link2}
          title="No resources yet"
          description="Resources are the providers and accounts items are billed through. You can also create them while adding an item."
          action={
            <Button onClick={onCreate}>
              <Plus />
              New resource
            </Button>
          }
        />
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export function CategoriesGrid({
  categories,
  items,
  loading,
  onOpen,
  onEdit,
  onDelete,
  onCreate,
}: {
  categories: TrackerCategoryWithCount[];
  items: TrackerItemWithCategory[];
  loading?: boolean;
  onOpen: (c: TrackerCategoryWithCount) => void;
  onEdit: (c: TrackerCategoryWithCount) => void;
  onDelete: (c: TrackerCategoryWithCount) => void;
  onCreate: () => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} lines={2} />
        ))}
      </div>
    );
  }
  if (!categories.length) {
    return (
      <EmptyState
        icon={FolderPlus}
        title="No categories"
        description="Categories group items (Servers, Domains, SaaS…), set reminder timing and the identifier label."
        action={
          <Button onClick={onCreate}>
            <Plus />
            New category
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((c) => {
        const own = items.filter((i) => i.category_id === c.id);
        const spend = own.reduce((a, i) => a + (i.price_usd ?? 0), 0);
        const attention = own.filter((i) => {
          const s = expiryState(i.expiry_at, c.notify_days_before);
          return s === "overdue" || s === "due_soon";
        }).length;
        return (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(c)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onOpen(c);
            }}
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-card px-4 py-3 outline-none transition-colors hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <span aria-hidden className="absolute inset-y-3 left-0 w-[2px] rounded-r" style={{ backgroundColor: c.color }} />
            <div className="flex items-center gap-2.5">
              <CategoryGlyph icon={c.icon} color={c.color} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.identifier_label || "Identifier"}</div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Actions" onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => onEdit(c)}>
                    <Pencil />
                    Edit & tags
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(c)}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-subtle-foreground">Items</div>
                <div className="font-data text-[13px]">{c.item_count}</div>
              </div>
              <div>
                <div className="text-subtle-foreground">Spend</div>
                <div className="font-data text-[13px]">{formatCurrency(spend)}</div>
              </div>
              <div>
                <div className="text-subtle-foreground">Needs attention</div>
                <div className={attention ? "font-data text-[13px] text-warning" : "font-data text-[13px]"}>{attention}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-subtle-foreground">
              <Bell className="size-3" />
              Reminds <span className="font-data">{c.notify_days_before}</span>d before expiry
            </div>
          </div>
        );
      })}
    </div>
  );
}
