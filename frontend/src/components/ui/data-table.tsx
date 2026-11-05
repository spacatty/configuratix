"use client";
"use no memo";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type FilterFn,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ChevronDown,
  CirclePlus,
  GripVertical,
  RotateCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

/* -------------------------------------------------------------------------- */
/* Column meta                                                                */
/* -------------------------------------------------------------------------- */

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Human label for the column-visibility menu & facets. */
    label?: string;
    /** Cell + header alignment. Use "right" for numbers. */
    align?: "left" | "center" | "right";
    /** Extra classes on every <td> of this column. */
    className?: string;
    /** Extra classes on the <th>. */
    headerClassName?: string;
    /**
     * Column sizing: "fit" shrinks to the widest cell (no wrapping); "fill" columns share
     * the remaining width evenly. Columns without it size automatically.
     */
    width?: "fit" | "fill";
    /** Floor for a "fill" column's share (px), so its content never gets clipped. */
    minWidth?: number;
    /** Percent of the free width for this "fill" column; fill columns without it split the rest evenly. */
    share?: number;
  }

  interface TableMeta<TData extends RowData> {
    /** Synthetic parent rows that only group their children (see DataTableProps.isGroupRow). */
    isGroupRow?: (row: TData) => boolean;
  }
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface DataTableFacetOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Count shown next to the option; overrides the count derived from loaded rows. */
  count?: number;
}

export interface DataTableFacet {
  /** Column id (accessorKey or id) to filter. */
  columnId: string;
  title: string;
  /** Options; when omitted they're derived from the column's unique values. */
  options?: DataTableFacetOption[];
  /** Pick at most one option (choosing another replaces it). */
  single?: boolean;
  /** Filtered by the caller (e.g. server-side): no client filtering, counts only from `option.count`. */
  manual?: boolean;
}

export type SearchKey<TData> = keyof TData | ((row: TData) => string | number | null | undefined | Array<string | null | undefined>);

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];

  /* ---- search ---- */
  /** Legacy: filter one column by text. Prefer `searchKeys`. */
  searchKey?: string;
  /** Global search across these fields (keys or getters). Default: all primitive top-level fields. */
  searchKeys?: SearchKey<TData>[];
  searchPlaceholder?: string;
  /** Hide the search input. */
  hideSearch?: boolean;
  /** Controlled global search value (e.g. from ?q=). */
  search?: string;
  onSearchChange?: (value: string) => void;

  /* ---- toolbar ---- */
  /** Extra controls after search/facets (left side). */
  toolbar?: React.ReactNode;
  /** Right side of toolbar (primary actions, refresh). */
  toolbarActions?: React.ReactNode;
  /** Faceted filter chips. */
  facets?: DataTableFacet[];
  /** Controlled facet/column filters (e.g. synced to URL query params). */
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  showColumnToggle?: boolean;

  /* ---- pagination ---- */
  showPagination?: boolean;
  /** Default rows per page (default 20) */
  pageSize?: number;
  /** Page size dropdown options (default 10, 20, 50, 100) */
  pageSizeOptions?: number[];

  /* ---- state ---- */
  /**
   * localStorage key for the table layout (column order/visibility, sorting, page size).
   * Defaults to the route (ids normalized) + column set; pass false to disable.
   */
  persistKey?: string | false;
  initialState?: {
    sorting?: SortingState;
    columnVisibility?: VisibilityState;
  };
  loading?: boolean;
  /** Skeleton rows while loading (default 6). */
  skeletonRows?: number;
  /** Shown when there are no rows at all (data.length === 0). */
  emptyState?: React.ReactNode;
  /** Shown when filters/search hide all rows. Default: "No results." + clear filters. */
  emptyMessage?: string;

  /* ---- rows ---- */
  getRowClassName?: (row: TData) => string | undefined;
  /** Stable row id for selection / cross-page selection */
  getRowId?: (row: TData) => string;
  /**
   * Child rows (always expanded). Sorting orders groups and, separately, children within
   * each group; filters keep a parent when any child matches; pages never split a group.
   */
  getSubRows?: (row: TData) => TData[] | undefined;
  /**
   * Synthetic parent rows (e.g. a header for children with no real parent). They can't be
   * selected or clicked themselves; their checkbox selects all their children.
   */
  isGroupRow?: (row: TData) => boolean;
  onRowClick?: (row: TData, event: React.MouseEvent<HTMLTableRowElement>) => void;
  /** Row href for middle-click/cmd-click semantics is up to onRowClick; this just styles. */
  density?: "compact" | "default";

  /* ---- selection ---- */
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean);
  /** Controlled row selection (persists across pages when getRowId is set) */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /**
   * Floating bulk-action bar content, shown when ≥1 row is selected.
   * Receives the selected rows (across pages) and a clear() fn.
   */
  bulkActions?: (selected: TData[], clear: () => void) => React.ReactNode;

  /* ---- layout ---- */
  /**
   * "card": toolbar, table and pagination share one surface (borderless search, quiet
   * filter/view controls, slim footer). "default": separate toolbar, card and pager.
   */
  variant?: "default" | "card";
  /** Sticky header; container scrolls vertically within maxHeight. Default true. */
  stickyHeader?: boolean;
  /** Max height of the scroll area (CSS). Default "max(320px, calc(100svh - 15rem))". "none" to disable. */
  maxHeight?: string;
  /** md+: stretch to the parent's remaining height (flex column, e.g. `<FillPage>`) and scroll inside. */
  fill?: boolean;
  className?: string;
  /** Wrap in bordered card surface (default true). */
  bordered?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Bump when default column orders change, so saved layouts reset to the new defaults once. */
const LAYOUT_VERSION = "v3";

type SavedLayout = {
  sorting?: SortingState;
  columnVisibility?: VisibilityState;
  columnOrder?: ColumnOrderState;
  pageSize?: number;
};

let staleLayoutsPurged = false;
/** Drops table layouts saved under older LAYOUT_VERSIONs (they'd otherwise pile up forever). */
function purgeStaleLayouts() {
  if (staleLayoutsPurged) return;
  staleLayoutsPurged = true;
  try {
    const keep = `cfx.table:${LAYOUT_VERSION}:`;
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith("cfx.table:") && !k.startsWith(keep)) window.localStorage.removeItem(k);
    }
  } catch {
    // storage unavailable
  }
}

function loadLayout(key: string | null): SavedLayout | null {
  if (!key || typeof window === "undefined") return null;
  purgeStaleLayouts();
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return v && typeof v === "object" ? (v as SavedLayout) : null;
  } catch {
    return null;
  }
}

function saveLayout(key: string | null, layout: SavedLayout) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // storage unavailable: layout just isn't remembered
  }
}

const INTERACTIVE = "a,button,input,select,textarea,label,[role=checkbox],[role=menuitem],[role=switch],[data-no-row-click]";

function columnKey<TData, TValue>(c: ColumnDef<TData, TValue>): string | undefined {
  const anyC = c as { id?: string; accessorKey?: string };
  return anyC.id ?? anyC.accessorKey;
}

const passFilter: FilterFn<unknown> = () => true;

const facetFilter: FilterFn<unknown> = (row, columnId, value: string[]) => {
  if (!value || value.length === 0) return true;
  const v = row.getValue(columnId);
  if (Array.isArray(v)) return v.some((x) => value.includes(String(x)));
  return value.includes(String(v ?? ""));
};

function setRowsSelected<TData>(table: TanstackTable<TData>, rows: Row<TData>[], value: boolean) {
  table.setRowSelection((prev) => {
    const next = { ...prev };
    for (const r of rows) {
      if (value) next[r.id] = true;
      else delete next[r.id];
    }
    return next;
  });
}

/** Checkbox column for row selection. Pages may add it themselves; DataTable adds it if missing. */
export function selectionColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: "select",
    header: ({ table }) => {
      // Rendered rows of the page, children included (tanstack's page toggle skips sub-rows).
      const rows = table.getRowModel().rows.filter((r) => r.getCanSelect());
      const picked = rows.filter((r) => r.getIsSelected()).length;
      return (
        <Checkbox
          checked={rows.length > 0 && picked === rows.length ? true : picked > 0 ? "indeterminate" : false}
          onCheckedChange={(v) => setRowsSelected(table, rows, !!v)}
          aria-label="Select all on page"
        />
      );
    },
    cell: ({ row, table }) => {
      if (table.options.meta?.isGroupRow?.(row.original)) {
        const kids = row.subRows.filter((r) => r.getCanSelect());
        const picked = kids.filter((r) => r.getIsSelected()).length;
        return (
          <Checkbox
            checked={kids.length > 0 && picked === kids.length ? true : picked > 0 ? "indeterminate" : false}
            disabled={!kids.length}
            onCheckedChange={(v) => setRowsSelected(table, kids, !!v)}
            aria-label="Select group"
          />
        );
      }
      return (
        <Checkbox
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
        />
      );
    },
    enableSorting: false,
    enableHiding: false,
    size: 36,
  };
}

/* -------------------------------------------------------------------------- */
/* DataTable                                                                  */
/* -------------------------------------------------------------------------- */

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchKeys,
  searchPlaceholder = "Search…",
  hideSearch,
  search: searchControlled,
  onSearchChange,
  toolbar,
  toolbarActions,
  facets,
  columnFilters: columnFiltersControlled,
  onColumnFiltersChange: onColumnFiltersChangeControlled,
  showColumnToggle = true,
  showPagination = true,
  pageSize: pageSizeProp,
  pageSizeOptions = [10, 20, 50, 100],
  initialState: initialStateProp,
  persistKey,
  loading,
  skeletonRows = 6,
  emptyState,
  emptyMessage = "No results.",
  getRowClassName,
  getRowId,
  getSubRows,
  isGroupRow,
  onRowClick,
  density = "default",
  enableRowSelection = false,
  rowSelection: rowSelectionControlled,
  onRowSelectionChange: onRowSelectionChangeControlled,
  bulkActions,
  stickyHeader = true,
  maxHeight = "max(320px, calc(100svh - 15rem))",
  fill = false,
  className,
  bordered = true,
  variant = "card",
}: DataTableProps<TData, TValue>) {
  const pathname = usePathname() ?? "";
  const storageKey = React.useMemo(() => {
    if (persistKey === false) return null;
    if (persistKey) return `cfx.table:${LAYOUT_VERSION}:${persistKey}`;
    const route = pathname.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id").replace(/\/\d+(?=\/|$)/g, "/:n");
    const ids = columns.map((c) => columnKey(c) ?? "").filter(Boolean).sort().join(",");
    return `cfx.table:${LAYOUT_VERSION}:${route}:${ids}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey, pathname]);
  const saved = React.useMemo(() => loadLayout(storageKey), [storageKey]);

  const defaultPageSize = saved?.pageSize ?? pageSizeProp ?? 20;
  const [sorting, setSorting] = React.useState<SortingState>(saved?.sorting ?? initialStateProp?.sorting ?? []);
  const [columnFiltersInner, setColumnFiltersInner] = React.useState<ColumnFiltersState>([]);
  const columnFilters = columnFiltersControlled ?? columnFiltersInner;
  const setColumnFilters = React.useCallback<OnChangeFn<ColumnFiltersState>>(
    (u) => {
      const next = typeof u === "function" ? u(columnFilters) : u;
      if (columnFiltersControlled === undefined) setColumnFiltersInner(next);
      onColumnFiltersChangeControlled?.(next);
    },
    [columnFilters, columnFiltersControlled, onColumnFiltersChangeControlled]
  );
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => {
    const initial = initialStateProp?.columnVisibility ?? {};
    const merged = { ...initial, ...(saved?.columnVisibility ?? {}) };
    // Columns the user can't toggle keep the page's setting (e.g. sort/filter-only columns).
    for (const c of columns) {
      const key = columnKey(c);
      if (key && (c as { enableHiding?: boolean }).enableHiding === false && key in initial) merged[key] = initial[key];
    }
    return merged;
  });
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>(saved?.columnOrder ?? []);
  const [rowSelectionInternal, setRowSelectionInternal] = React.useState<RowSelectionState>({});
  const rowSelection = rowSelectionControlled ?? rowSelectionInternal;
  const setRowSelection = onRowSelectionChangeControlled ?? setRowSelectionInternal;
  const [globalFilterInner, setGlobalFilterInner] = React.useState("");
  const globalFilter = searchControlled ?? globalFilterInner;
  const setGlobalFilter = React.useCallback(
    (v: string) => {
      if (searchControlled === undefined) setGlobalFilterInner(v);
      onSearchChange?.(v);
    },
    [searchControlled, onSearchChange]
  );
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: defaultPageSize });

  React.useEffect(() => {
    if (saved?.pageSize) return; // the user's own choice wins over the page default
    const next = pageSizeProp ?? 20;
    setPagination((p) => (p.pageSize === next ? p : { ...p, pageSize: next, pageIndex: 0 }));
  }, [pageSizeProp, saved?.pageSize]);

  React.useEffect(() => {
    saveLayout(storageKey, { sorting, columnVisibility, columnOrder, pageSize: pagination.pageSize });
  }, [storageKey, sorting, columnVisibility, columnOrder, pagination.pageSize]);

  // Columns: attach facet filterFn + optional auto selection column
  const finalColumns = React.useMemo(() => {
    const facetById = new Map((facets ?? []).map((f) => [f.columnId, f]));
    let cols = columns.map((c) => {
      const key = columnKey(c);
      const facet = key ? facetById.get(key) : undefined;
      if (facet && !(c as { filterFn?: unknown }).filterFn) {
        return { ...c, filterFn: (facet.manual ? passFilter : facetFilter) as FilterFn<TData> };
      }
      return c;
    }) as ColumnDef<TData, TValue>[];
    if (enableRowSelection && !cols.some((c) => columnKey(c) === "select")) {
      cols = [selectionColumn<TData>() as ColumnDef<TData, TValue>, ...cols];
    }
    return cols;
  }, [columns, facets, enableRowSelection]);

  // Global search text per row (cached)
  const textCache = React.useMemo(() => new WeakMap<object, string>(), [data, searchKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowText = React.useCallback(
    (orig: TData): string => {
      if (orig && typeof orig === "object") {
        const hit = textCache.get(orig as object);
        if (hit !== undefined) return hit;
      }
      const parts: string[] = [];
      const push = (v: unknown) => {
        if (v === null || v === undefined) return;
        if (Array.isArray(v)) v.forEach(push);
        else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") parts.push(String(v));
      };
      if (searchKeys && searchKeys.length) {
        for (const k of searchKeys) push(typeof k === "function" ? k(orig) : (orig as Record<string, unknown>)[k as string]);
      } else if (orig && typeof orig === "object") {
        for (const v of Object.values(orig as Record<string, unknown>)) push(v);
      }
      const text = parts.join(" ").toLowerCase();
      if (orig && typeof orig === "object") textCache.set(orig as object, text);
      return text;
    },
    [searchKeys, textCache]
  );

  const globalFilterFn = React.useCallback<FilterFn<TData>>(
    (row, _columnId, value: string) => {
      const q = String(value ?? "").trim().toLowerCase();
      if (!q) return true;
      const text = rowText(row.original);
      return q.split(/\s+/).every((t) => text.includes(t));
    },
    [rowText]
  );

  const table = useReactTable({
    data,
    columns: finalColumns,
    getRowId,
    getSubRows,
    getExpandedRowModel: getSubRows ? getExpandedRowModel() : undefined,
    filterFromLeafRows: !!getSubRows,
    paginateExpandedRows: false,
    enableSubRowSelection: false,
    enableRowSelection:
      isGroupRow && enableRowSelection
        ? (row: Row<TData>) =>
            !isGroupRow(row.original) && (typeof enableRowSelection === "function" ? enableRowSelection(row) : true)
        : enableRowSelection,
    meta: { isGroupRow },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: showPagination ? getPaginationRowModel() : undefined,
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: setRowSelection as OnChangeFn<RowSelectionState>,
    onGlobalFilterChange: (u) => setGlobalFilter(typeof u === "function" ? u(globalFilter) : u),
    onPaginationChange: setPagination,
    globalFilterFn,
    getColumnCanGlobalFilter: () => true,
    autoResetPageIndex: false,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      rowSelection,
      globalFilter,
      ...(getSubRows ? { expanded: true as const } : {}),
      pagination,
    },
  });

  // Reset to first page when filters change
  React.useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [globalFilter, columnFilters]);
  // Clamp page index if data shrinks
  const pageCount = table.getPageCount();
  React.useEffect(() => {
    if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
      setPagination((p) => ({ ...p, pageIndex: Math.max(0, pageCount - 1) }));
    }
  }, [pageCount, pagination.pageIndex]);

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const selectedCount = enableRowSelection ? selectedIds.length : 0;
  const filteredTotal = table.getFilteredRowModel().rows.length;
  const isFiltered = !!globalFilter || columnFilters.length > 0;
  const visibleColCount = table.getVisibleLeafColumns().length;
  const fillCols = table.getVisibleLeafColumns().filter((c) => c.columnDef.meta?.width === "fill");
  const fixedShare = fillCols.reduce((sum, c) => sum + (c.columnDef.meta?.share ?? 0), 0);
  const evenCount = fillCols.filter((c) => !c.columnDef.meta?.share).length;
  const evenShare = evenCount ? `${(Math.max(0, 100 - fixedShare) / evenCount).toFixed(2)}%` : undefined;

  const selectedRows = React.useMemo(() => {
    if (!selectedCount) return [] as TData[];
    const all = table.getCoreRowModel().rowsById;
    return selectedIds.map((id) => all[id]?.original).filter(Boolean) as TData[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection, data, selectedCount]);

  const clearSelection = () => table.resetRowSelection();
  const resetFilters = () => {
    setGlobalFilter("");
    table.resetColumnFilters();
  };

  const rowPad = density === "compact" ? "h-8 py-1" : "h-10 py-2";
  const hasToolbar = !hideSearch || facets?.length || toolbar || toolbarActions || showColumnToggle;
  const card = variant === "card";

  return (
    <div
      className={cn(
        "w-full",
        card
          ? cn(
              "flex flex-col overflow-hidden",
              // Inside another card (bordered={false}) the table keeps its inner lines but no frame of its own.
              bordered && "rounded-lg border border-border bg-card shadow-[inset_0_1px_0_0_oklch(1_0_0/3%)]"
            )
          : fill
            ? "flex flex-col gap-3"
            : "space-y-3",
        fill && "md:min-h-0 md:flex-1",
        className
      )}
      data-slot="data-table"
      data-variant={variant}
    >
      {hasToolbar && (
        <div className={cn("flex flex-wrap items-center", card ? "gap-1 border-b border-border px-2 py-1.5" : "gap-2")}>
          {!hideSearch &&
            (searchKey ? (
              <SearchInput
                bare={card}
                placeholder={searchPlaceholder}
                value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
                onChange={(v) => table.getColumn(searchKey)?.setFilterValue(v)}
              />
            ) : (
              <SearchInput bare={card} placeholder={searchPlaceholder} value={globalFilter ?? ""} onChange={setGlobalFilter} />
            ))}
          {card && !!facets?.length && <span aria-hidden className="mx-1 h-4 w-px bg-border" />}
          {facets?.map((f) => {
            const col = table.getColumn(f.columnId);
            if (!col) return null;
            return (
              <DataTableFacetedFilter
                key={f.columnId}
                column={col}
                title={f.title}
                options={f.options}
                single={f.single}
                manual={f.manual}
                bare={card}
              />
            );
          })}
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className={cn("text-muted-foreground", card && "h-7 px-2 text-xs")}>
              Reset
              <X />
            </Button>
          )}
          {toolbar}
          <div className={cn("ml-auto flex items-center", card ? "gap-0.5" : "gap-2")}>
            {toolbarActions}
            {showColumnToggle && (
              <DataTableViewOptions table={table} defaultVisibility={initialStateProp?.columnVisibility} bare={card} />
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "relative overflow-hidden",
          fill && "md:flex md:min-h-0 md:flex-1 md:flex-col",
          !card && bordered && "rounded-lg border border-border bg-card shadow-[inset_0_1px_0_0_oklch(1_0_0/3%)]"
        )}
      >
        <Table
          containerClassName={fill ? "md:min-h-0 md:flex-1 md:max-h-none!" : undefined}
          containerStyle={stickyHeader && maxHeight !== "none" ? { maxHeight } : undefined}
        >
          <TableHeader sticky={stickyHeader}>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const fillShare = meta?.share ? `${meta.share}%` : evenShare;
                  const def = header.column.columnDef.header;
                  const plainSortable = header.column.getCanSort() && typeof def === "string";
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      style={
                        header.column.id === "select"
                          ? { width: 36 }
                          : meta?.width === "fill"
                            ? { width: fillShare, minWidth: meta.minWidth }
                            : undefined
                      }
                      className={cn(
                        meta?.width === "fit" && "w-px whitespace-nowrap",
                        meta?.align === "right" && "text-right",
                        meta?.align === "center" && "text-center",
                        meta?.headerClassName
                      )}
                      aria-sort={
                        header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : plainSortable ? (
                        <DataTableColumnHeader column={header.column} title={def as string} align={meta?.align} />
                      ) : (
                        flexRender(def, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && data.length === 0 ? (
              Array.from({ length: skeletonRows }).map((_, r) => (
                <TableRow key={`sk-${r}`} className="hover:bg-transparent">
                  {table.getVisibleLeafColumns().map((c, i) => (
                    <TableCell key={c.id} className={rowPad}>
                      {c.id === "select" ? (
                        <Skeleton className="size-4 rounded-[4px]" />
                      ) : (
                        <Skeleton
                          className={cn("h-3", i === (enableRowSelection ? 1 : 0) ? "w-40" : ["w-20", "w-28", "w-14", "w-24"][(i + r) % 4])}
                          style={{ opacity: 1 - r * 0.1 }}
                        />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={
                    onRowClick && !isGroupRow?.(row.original)
                      ? (e) => {
                          const t = e.target as HTMLElement;
                          if (t.closest(INTERACTIVE)) return;
                          if (window.getSelection()?.toString()) return;
                          onRowClick(row.original, e);
                        }
                      : undefined
                  }
                  className={cn(onRowClick && !isGroupRow?.(row.original) && "cursor-pointer", getRowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          rowPad,
                          meta?.width === "fit" && "w-px whitespace-nowrap",
                          meta?.align === "right" && "text-right",
                          meta?.align === "center" && "text-center",
                          meta?.className
                        )}
                      >
                        {meta?.width === "fill" ? (
                          // Keeps cell content from inflating the column's minimum width, so
                          // "fill" columns really split the free space evenly (content truncates).
                          <div className={cn("w-0 min-w-full overflow-hidden", meta?.align === "center" && "flex justify-center")}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColCount} className="h-auto p-0 whitespace-normal">
                  {data.length === 0 && emptyState ? (
                    emptyState
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-[13px] text-muted-foreground">
                      <Search className="size-4" />
                      <span>{emptyMessage}</span>
                      {isFiltered && (
                        <Button variant="ghost" size="sm" onClick={resetFilters}>
                          Clear filters
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {showPagination && (data.length > 0 || !loading) && (
        <DataTablePagination
          table={table}
          bare={card}
          pageSizeOptions={pageSizeOptions}
          selectedCount={enableRowSelection ? selectedCount : undefined}
          filteredTotal={filteredTotal}
          total={data.length}
        />
      )}

      {bulkActions && selectedCount > 0 && (
        <BulkActionBar count={selectedCount} onClear={clearSelection}>
          {bulkActions(selectedRows, clearSelection)}
        </BulkActionBar>
      )}

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar pieces                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Search box with its own draft state: keystrokes render instantly and are never lost,
 * while the (possibly expensive) consumer - table filtering, URL sync, server queries -
 * only sees the value after a short pause.
 */
function SearchInput({
  value,
  onChange,
  placeholder,
  delay = 200,
  bare,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  delay?: number;
  /** Borderless, for the "card" table toolbar. */
  bare?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const sent = React.useRef(value);
  const onChangeRef = React.useRef(onChange);
  React.useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  // External changes (URL navigation, "clear filters") replace the draft; our own echoes don't.
  React.useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setDraft(value);
    }
  }, [value]);

  React.useEffect(() => {
    if (draft === sent.current) return;
    const t = setTimeout(() => {
      sent.current = draft;
      onChangeRef.current(draft);
    }, delay);
    return () => clearTimeout(t);
  }, [draft, delay]);

  const clear = () => {
    setDraft("");
    sent.current = "";
    onChangeRef.current("");
  };

  return (
    <div className={cn("relative w-full", bare ? "sm:w-60" : "sm:w-64")}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className={cn(
          "h-8 pr-7 pl-8",
          bare && "h-7 border-transparent bg-transparent text-[13px] shadow-none hover:bg-white/[0.03] focus-visible:border-border focus-visible:bg-background/40"
        )}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.stopPropagation();
            clear();
          }
        }}
      />
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Faceted multi-select filter chip (shadcn "tasks" pattern) with counts. */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
  single,
  manual,
  bare,
}: {
  column: Column<TData, TValue>;
  title: string;
  options?: DataTableFacetOption[];
  single?: boolean;
  manual?: boolean;
  /** Quiet ghost trigger with a chevron (for the "card" table toolbar). */
  bare?: boolean;
}) {
  const facets = column.getFacetedUniqueValues();
  const selected = new Set((column.getFilterValue() as string[] | undefined) ?? []);
  const opts = React.useMemo<DataTableFacetOption[]>(() => {
    if (options) return options;
    return [...facets.keys()]
      .flatMap((k) => (Array.isArray(k) ? k : [k]))
      .filter((k) => k !== null && k !== undefined && k !== "")
      .map((k) => String(k))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [options, facets]);

  const countFor = (value: string) => {
    let n = 0;
    facets.forEach((count, key) => {
      if (Array.isArray(key) ? key.map(String).includes(value) : String(key) === value) n += count;
    });
    return n;
  };

  const set = (next: Set<string>) => column.setFilterValue(next.size ? [...next] : undefined);
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {bare ? (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
              selected.size > 0 && "bg-primary/10 text-foreground hover:bg-primary/15"
            )}
          >
            {title}
            {selected.size > 0 && (
              <span className="font-data rounded-[4px] bg-primary/20 px-1 text-[10.5px] leading-4 text-foreground">
                {selected.size === 1 ? opts.find((o) => selected.has(o.value))?.label ?? 1 : selected.size}
              </span>
            )}
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        ) : (
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 border-dashed", selected.size > 0 && "border-solid border-border-strong")}
        >
          <CirclePlus />
          {title}
          {selected.size > 0 && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border-strong" />
              {selected.size > 2 ? (
                <span className="rounded-[4px] bg-surface-2 px-1.5 py-px text-[11px] font-normal">{selected.size} selected</span>
              ) : (
                opts
                  .filter((o) => selected.has(o.value))
                  .map((o) => (
                    <span key={o.value} className="rounded-[4px] bg-surface-2 px-1.5 py-px text-[11px] font-normal">
                      {o.label}
                    </span>
                  ))
              )}
            </>
          )}
        </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No options.</CommandEmpty>
            <CommandGroup>
              {opts.map((o) => {
                const isSel = selected.has(o.value);
                const Icon = o.icon;
                return (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    keywords={[o.label]}
                    onSelect={() => {
                      if (single) {
                        set(new Set(isSel ? [] : [o.value]));
                        setOpen(false);
                        return;
                      }
                      const next = new Set(selected);
                      if (isSel) next.delete(o.value);
                      else next.add(o.value);
                      set(next);
                    }}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center border border-border-strong",
                        single ? "rounded-full" : "rounded-[4px]",
                        isSel && "border-primary bg-primary text-primary-foreground"
                      )}
                    >
                      {isSel && (
                        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
                          <path d="M2.5 6.5l2.2 2.2L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {Icon && <Icon className="size-3.5 text-muted-foreground" />}
                    <span className="flex-1 truncate">{o.label}</span>
                    {(o.count !== undefined || !manual) && (
                      <span className="font-data ml-auto text-[11px] text-muted-foreground">{o.count ?? countFor(o.value)}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => column.setFilterValue(undefined)} className="justify-center text-center text-muted-foreground">
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function DataTableViewOptions<TData>({
  table,
  defaultVisibility = {},
  bare,
}: {
  table: TanstackTable<TData>;
  /** Quiet icon trigger (for the "card" table toolbar). */
  bare?: boolean;
  /** The page's own default visibility (what "Reset" restores). */
  defaultVisibility?: VisibilityState;
}) {
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const leaf = table.getAllLeafColumns();
  const movable = leaf.filter((c) => c.getCanHide() && c.id !== "select");
  if (movable.length === 0) return null;

  const label = (column: (typeof leaf)[number]) => {
    const def = column.columnDef;
    return def.meta?.label ?? (typeof def.header === "string" ? def.header : column.id.replace(/_/g, " "));
  };

  // Movable columns are reordered among themselves; fixed ones (selection, actions) keep their slots.
  const move = (from: string, to: string) => {
    if (from === to) return;
    const ids = movable.map((c) => c.id);
    const next = ids.filter((id) => id !== from);
    next.splice(next.indexOf(to) + (ids.indexOf(from) < ids.indexOf(to) ? 1 : 0), 0, from);
    let i = 0;
    table.setColumnOrder(leaf.map((c) => (c.getCanHide() && c.id !== "select" ? next[i++] : c.id)));
  };
  const nudge = (id: string, dir: -1 | 1) => {
    const ids = movable.map((c) => c.id);
    const target = ids[ids.indexOf(id) + dir];
    if (target) move(id, target);
  };
  const customized =
    table.getState().columnOrder.length > 0 ||
    movable.some((c) => c.getIsVisible() !== (defaultVisibility[c.id] ?? true));

  return (
    <Popover>
      <PopoverTrigger asChild>
        {bare ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          >
            <Settings2 className="size-3.5" />
            <span className="hidden sm:inline">View</span>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-8">
            <Settings2 />
            <span className="hidden sm:inline">View</span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1">
        <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
          <span className="text-xs text-muted-foreground">Columns · drag to reorder</span>
          {customized && (
            <button
              type="button"
              onClick={() => {
                table.setColumnOrder([]);
                table.setColumnVisibility({ ...defaultVisibility });
              }}
              className="inline-flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" /> Reset
            </button>
          )}
        </div>
        <ul className="max-h-[min(360px,60vh)] overflow-y-auto">
          {movable.map((column) => (
            <li
              key={column.id}
              data-col-id={column.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] select-none hover:bg-accent",
                dragId === column.id && "opacity-40",
                overId === column.id && dragId !== column.id && "bg-accent ring-1 ring-primary/40"
              )}
            >
              {/* Pointer-based drag (mouse, touch, pen); HTML5 DnD is unreliable inside popovers. */}
              <span
                className="cursor-grab touch-none text-subtle-foreground active:cursor-grabbing"
                aria-hidden
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragId(column.id);
                  setOverId(column.id);
                }}
                onPointerMove={(e) => {
                  if (!dragId) return;
                  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-col-id]");
                  if (el?.dataset.colId) setOverId(el.dataset.colId);
                }}
                onPointerUp={() => {
                  if (dragId && overId) move(dragId, overId);
                  setDragId(null);
                  setOverId(null);
                }}
                onPointerCancel={() => {
                  setDragId(null);
                  setOverId(null);
                }}
              >
                <GripVertical className="size-3.5" />
              </span>
              <Checkbox
                id={`col-${column.id}`}
                checked={column.getIsVisible()}
                onCheckedChange={(v) => column.toggleVisibility(!!v)}
              />
              <label htmlFor={`col-${column.id}`} className="flex-1 cursor-pointer truncate capitalize">
                {label(column)}
              </label>
              {/* Keyboard / no-drag fallback */}
              <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" aria-label={`Move ${label(column)} up`} onClick={() => nudge(column.id, -1)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <ArrowUp className="size-3" />
                </button>
                <button type="button" aria-label={`Move ${label(column)} down`} onClick={() => nudge(column.id, 1)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <ArrowDown className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 20, 50, 100],
  selectedCount,
  filteredTotal,
  total,
  bare,
}: {
  table: TanstackTable<TData>;
  /** Slim footer bar inside the table card. */
  bare?: boolean;
  pageSizeOptions?: number[];
  selectedCount?: number;
  filteredTotal: number;
  total: number;
}) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const from = filteredTotal === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(filteredTotal, (pageIndex + 1) * pageSize);
  const pages = Math.max(1, table.getPageCount());
  if (bare) {
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <div className="font-data tabular-nums">
          {selectedCount !== undefined && selectedCount > 0 ? <span className="text-foreground">{selectedCount} selected · </span> : null}
          {filteredTotal === 0 ? "0" : `${from}–${to}`} <span className="text-subtle-foreground">of</span> {filteredTotal}
          {filteredTotal !== total && <span className="text-subtle-foreground"> · filtered from {total}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Select value={String(pageSize)} onValueChange={(v) => table.setPagination({ pageIndex: 0, pageSize: Number(v) })}>
            <SelectTrigger
              size="sm"
              aria-label="Rows per page"
              className="h-6 gap-1 border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            >
              <SelectValue />
              <span className="text-subtle-foreground">/ page</span>
            </SelectTrigger>
            <SelectContent side="top" align="end">
              {pageSizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span aria-hidden className="mx-1 h-3.5 w-px bg-border" />
          <Button variant="ghost" size="icon-xs" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="font-data min-w-10 text-center tabular-nums">
            {pageIndex + 1}
            <span className="text-subtle-foreground"> / {pages}</span>
          </span>
          <Button variant="ghost" size="icon-xs" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 text-xs text-muted-foreground">
      <div className="font-data tabular-nums">
        {selectedCount !== undefined && selectedCount > 0 ? (
          <span className="text-foreground">{selectedCount} selected · </span>
        ) : null}
        {from}–{to} of {filteredTotal}
        {filteredTotal !== total && <span className="text-subtle-foreground"> (filtered from {total})</span>}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => table.setPagination({ pageIndex: 0, pageSize: Number(v) })}
          >
            <SelectTrigger size="sm" className="h-7 w-[68px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="font-data tabular-nums">
          {pageIndex + 1} / {pages}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" className="hidden sm:inline-flex" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()} aria-label="First page">
            <ChevronsLeft />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
            <ChevronRight />
          </Button>
          <Button variant="outline" size="icon-sm" className="hidden sm:inline-flex" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()} aria-label="Last page">
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bulk action bar                                                            */
/* -------------------------------------------------------------------------- */

/** Floating bar pinned to the bottom of the viewport while rows are selected. */
export function BulkActionBar({ count, onClear, children }: { count: number; onClear: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]")) onClear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClear]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="pointer-events-auto flex animate-in items-center gap-1 rounded-xl border border-border-strong bg-popover p-1.5 pl-3 shadow-elevated fade-in-0 slide-in-from-bottom-4 duration-200"
      >
        <span className="flex items-center gap-2 pr-2 text-[13px]">
          <span className="font-data inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
            {count}
          </span>
          selected
        </span>
        <span className="mx-1 h-5 w-px bg-border-strong" />
        <div className="flex items-center gap-1">{children}</div>
        <span className="mx-1 h-5 w-px bg-border-strong" />
        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection">
          <X />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Column header                                                              */
/* -------------------------------------------------------------------------- */

/** Sortable column header. Click cycles asc → desc → off. */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  align,
  className,
}: {
  column: Column<TData, TValue>;
  title: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  if (!column.getCanSort()) {
    return <span className={className}>{title}</span>;
  }
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => {
        const now = column.getIsSorted();
        if (now === false) column.toggleSorting(false);
        else if (now === "asc") column.toggleSorting(true);
        else column.clearSorting();
      }}
      className={cn(
        "group/sort -mx-1 inline-flex h-6 items-center gap-1 rounded px-1 text-xs font-medium transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 outline-none",
        sorted && "text-foreground",
        align === "right" && "flex-row-reverse",
        className
      )}
    >
      {title}
      {sorted === "asc" ? (
        <ArrowUp className="size-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3" />
      ) : (
        <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover/sort:opacity-60" />
      )}
    </button>
  );
}

/** @deprecated use DataTableColumnHeader — kept for existing pages. */
export function SortableHeader<TData, TValue>({
  column,
  children,
}: {
  column: Column<TData, TValue>;
  children: React.ReactNode;
}) {
  return <DataTableColumnHeader column={column} title={children} />;
}
