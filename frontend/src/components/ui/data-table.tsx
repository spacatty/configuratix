"use client";

import * as React from "react";
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
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
  CirclePlus,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  }
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface DataTableFacetOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface DataTableFacet {
  /** Column id (accessorKey or id) to filter. */
  columnId: string;
  title: string;
  /** Options; when omitted they're derived from the column's unique values. */
  options?: DataTableFacetOption[];
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
  /** Sticky header; container scrolls vertically within maxHeight. Default true. */
  stickyHeader?: boolean;
  /** Max height of the scroll area (CSS). Default "max(320px, calc(100svh - 15rem))". "none" to disable. */
  maxHeight?: string;
  className?: string;
  /** Wrap in bordered card surface (default true). */
  bordered?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const INTERACTIVE = "a,button,input,select,textarea,label,[role=checkbox],[role=menuitem],[role=switch],[data-no-row-click]";

function columnKey<TData, TValue>(c: ColumnDef<TData, TValue>): string | undefined {
  const anyC = c as { id?: string; accessorKey?: string };
  return anyC.id ?? anyC.accessorKey;
}

const facetFilter: FilterFn<unknown> = (row, columnId, value: string[]) => {
  if (!value || value.length === 0) return true;
  const v = row.getValue(columnId);
  if (Array.isArray(v)) return v.some((x) => value.includes(String(x)));
  return value.includes(String(v ?? ""));
};

/** Checkbox column for row selection. Pages may add it themselves; DataTable adds it if missing. */
export function selectionColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label="Select all on page"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        aria-label="Select row"
      />
    ),
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
  loading,
  skeletonRows = 6,
  emptyState,
  emptyMessage = "No results.",
  getRowClassName,
  getRowId,
  onRowClick,
  density = "default",
  enableRowSelection = false,
  rowSelection: rowSelectionControlled,
  onRowSelectionChange: onRowSelectionChangeControlled,
  bulkActions,
  stickyHeader = true,
  maxHeight = "max(320px, calc(100svh - 15rem))",
  className,
  bordered = true,
}: DataTableProps<TData, TValue>) {
  const defaultPageSize = pageSizeProp ?? 20;
  const [sorting, setSorting] = React.useState<SortingState>(initialStateProp?.sorting ?? []);
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
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialStateProp?.columnVisibility ?? {});
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
    const next = pageSizeProp ?? 20;
    setPagination((p) => (p.pageSize === next ? p : { ...p, pageSize: next, pageIndex: 0 }));
  }, [pageSizeProp]);

  // Columns: attach facet filterFn + optional auto selection column
  const finalColumns = React.useMemo(() => {
    const facetIds = new Set((facets ?? []).map((f) => f.columnId));
    let cols = columns.map((c) => {
      const key = columnKey(c);
      if (key && facetIds.has(key) && !(c as { filterFn?: unknown }).filterFn) {
        return { ...c, filterFn: facetFilter as FilterFn<TData> };
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
    enableRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: showPagination ? getPaginationRowModel() : undefined,
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onColumnVisibilityChange: setColumnVisibility,
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
      rowSelection,
      globalFilter,
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

  return (
    <div className={cn("w-full space-y-3", className)} data-slot="data-table">
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {!hideSearch &&
            (searchKey ? (
              <SearchInput
                placeholder={searchPlaceholder}
                value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
                onChange={(v) => table.getColumn(searchKey)?.setFilterValue(v)}
              />
            ) : (
              <SearchInput placeholder={searchPlaceholder} value={globalFilter ?? ""} onChange={setGlobalFilter} />
            ))}
          {facets?.map((f) => {
            const col = table.getColumn(f.columnId);
            if (!col) return null;
            return <DataTableFacetedFilter key={f.columnId} column={col} title={f.title} options={f.options} />;
          })}
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
              Reset
              <X />
            </Button>
          )}
          {toolbar}
          <div className="ml-auto flex items-center gap-2">
            {toolbarActions}
            {showColumnToggle && <DataTableViewOptions table={table} />}
          </div>
        </div>
      )}

      <div
        className={cn(
          "relative overflow-hidden",
          bordered && "rounded-lg border border-border bg-card shadow-[inset_0_1px_0_0_oklch(1_0_0/3%)]"
        )}
      >
        <Table containerStyle={stickyHeader && maxHeight !== "none" ? { maxHeight } : undefined}>
          <TableHeader sticky={stickyHeader}>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const def = header.column.columnDef.header;
                  const plainSortable = header.column.getCanSort() && typeof def === "string";
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      style={header.column.id === "select" ? { width: 36 } : undefined}
                      className={cn(
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
                    onRowClick
                      ? (e) => {
                          const t = e.target as HTMLElement;
                          if (t.closest(INTERACTIVE)) return;
                          if (window.getSelection()?.toString()) return;
                          onRowClick(row.original, e);
                        }
                      : undefined
                  }
                  className={cn(onRowClick && "cursor-pointer", getRowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          rowPad,
                          meta?.align === "right" && "text-right",
                          meta?.align === "center" && "text-center",
                          meta?.className
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
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

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 pr-7 pl-8"
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
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
}: {
  column: Column<TData, TValue>;
  title: string;
  options?: DataTableFacetOption[];
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

  return (
    <Popover>
      <PopoverTrigger asChild>
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
                      const next = new Set(selected);
                      if (isSel) next.delete(o.value);
                      else next.add(o.value);
                      set(next);
                    }}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border border-border-strong",
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
                    <span className="font-data ml-auto text-[11px] text-muted-foreground">{countFor(o.value)}</span>
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

export function DataTableViewOptions<TData>({ table }: { table: TanstackTable<TData> }) {
  const hideable = table.getAllColumns().filter((c) => typeof c.accessorFn !== "undefined" || c.getCanHide()).filter((c) => c.getCanHide() && c.id !== "select");
  if (hideable.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Settings2 />
          <span className="hidden sm:inline">View</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map((column) => {
          const def = column.columnDef;
          const label = def.meta?.label ?? (typeof def.header === "string" ? def.header : column.id.replace(/_/g, " "));
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              className="capitalize"
              checked={column.getIsVisible()}
              onCheckedChange={(v) => column.toggleVisibility(!!v)}
              onSelect={(e) => e.preventDefault()}
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
}: {
  table: TanstackTable<TData>;
  pageSizeOptions?: number[];
  selectedCount?: number;
  filteredTotal: number;
  total: number;
}) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const from = filteredTotal === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(filteredTotal, (pageIndex + 1) * pageSize);
  const pages = Math.max(1, table.getPageCount());
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
        if (sorted === false) column.toggleSorting(false);
        else if (sorted === "asc") column.toggleSorting(true);
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
