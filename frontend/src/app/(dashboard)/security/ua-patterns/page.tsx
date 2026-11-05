"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Bot, CheckCircle2, Info, MoreHorizontal, Plus, Trash2, X, XCircle } from "lucide-react";
import { api, type SecurityUAPattern, type UAPatternsByCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Combobox } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  Mono,
  PageHeader,
  Spinner,
  errorMessage,
  useConfirm,
  usePolling,
} from "@/components/app";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { SecurityNav, UA_CATEGORIES, uaCategoryMeta } from "@/components/security/shared";
import { FormField } from "@/components/security/form-field";

type Row = SecurityUAPattern & { category_enabled: boolean };

function matches(pattern: string, type: string, ua: string): boolean | null {
  if (!pattern) return null;
  if (type === "exact") return ua === pattern;
  if (type === "regex") {
    try {
      return new RegExp(pattern, "i").test(ua);
    } catch {
      return null;
    }
  }
  return ua.toLowerCase().includes(pattern.toLowerCase());
}

export default function UAPatternsPage() {
  const confirm = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [addCategory, setAddCategory] = useState("custom");
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const { data, loading, error, refresh, setData } = usePolling(() => api.listSecurityUAPatterns(), 120000);
  const categories = useMemo(() => data ?? [], [data]);

  const rows = useMemo<Row[]>(
    () =>
      categories.flatMap((c) =>
        c.patterns.map((p) => ({ ...p, category_enabled: c.is_enabled }))
      ),
    [categories]
  );
  const visible = selected ? rows.filter((r) => r.category === selected) : rows;
  const customCount = rows.filter((r) => !r.is_system).length;
  const enabledCount = categories.filter((c) => c.is_enabled).length;

  const toggle = async (cat: UAPatternsByCategory, enabled: boolean) => {
    const label = uaCategoryMeta(cat.category).label;
    setPending((p) => ({ ...p, [cat.category]: true }));
    setData((prev) => prev?.map((c) => (c.category === cat.category ? { ...c, is_enabled: enabled } : c)));
    try {
      await api.toggleSecurityUACategory(cat.category, enabled);
      toast.success(`${label} ${enabled ? "enabled" : "disabled"}`, { description: "Agents pick this up on the next sync." });
    } catch (e) {
      setData((prev) => prev?.map((c) => (c.category === cat.category ? { ...c, is_enabled: !enabled } : c)));
      toast.error(`Couldn't update ${label}`, { description: errorMessage(e) });
    } finally {
      setPending((p) => ({ ...p, [cat.category]: false }));
    }
  };

  const remove = async (list: Row[], clear?: () => void) => {
    const deletable = list.filter((r) => !r.is_system);
    if (!deletable.length) return;
    const one = deletable.length === 1;
    const ok = await confirm({
      title: one ? "Delete pattern?" : `Delete ${deletable.length} patterns?`,
      description: one ? (
        <>
          <Mono>{deletable[0].pattern}</Mono> stops blocking new requests.
        </>
      ) : (
        "These custom patterns stop blocking new requests. System patterns in the selection are skipped."
      ),
      destructive: true,
      confirmText: "Delete",
      onConfirm: async () => {
        for (const r of deletable) await api.deleteSecurityUAPattern(r.id);
      },
    });
    if (ok) {
      toast.success(one ? "Pattern deleted" : `${deletable.length} patterns deleted`);
      clear?.();
      refresh();
    }
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "pattern",
        header: "Pattern",
        cell: ({ row }) => (
          <Mono className={cn("block max-w-[360px] truncate font-medium", !row.original.category_enabled && "text-muted-foreground")} title={row.original.pattern}>
            {row.original.pattern || <span className="italic text-muted-foreground">(empty)</span>}
          </Mono>
        ),
      },
      {
        id: "category",
        accessorFn: (r) => uaCategoryMeta(r.category).label,
        header: "Category",
        cell: ({ row }) => {
          const meta = uaCategoryMeta(row.original.category);
          return (
            <span className="flex items-center gap-1.5 text-[13px]">
              <meta.icon className="size-3.5 text-muted-foreground" />
              {meta.label}
              {!row.original.category_enabled && <Badge variant="muted">Off</Badge>}
            </span>
          );
        },
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
      },
      {
        accessorKey: "match_type",
        header: "Match",
        cell: ({ row }) => <Badge variant="outline" className="font-data">{row.original.match_type}</Badge>,
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
      },
      {
        id: "origin",
        accessorFn: (r) => (r.is_system ? "System" : "Custom"),
        header: "Origin",
        cell: ({ getValue }) => <Badge variant={getValue() === "System" ? "secondary" : "default"}>{getValue() as string}</Badge>,
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) =>
          row.original.description ? (
            <span className="block max-w-[320px] truncate text-[13px] text-muted-foreground" title={row.original.description}>
              {row.original.description}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        enableHiding: false,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.is_system ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={() => remove([row.original])}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bot}
        title="User-agent patterns"
        description="Requests matching an enabled pattern get their IP banned on the spot."
        meta={
          data ? (
            <>
              <span>
                <span className="font-data">{formatNumber(rows.length - customCount)}</span> system
              </span>
              <span>
                <span className="font-data">{formatNumber(customCount)}</span> custom
              </span>
              <span>
                <span className="font-data">{enabledCount}</span>/<span className="font-data">{categories.length}</span> categories on
              </span>
            </>
          ) : undefined
        }
        actions={
          <Button
            onClick={() => {
              setAddCategory(selected ?? "custom");
              setAddOpen(true);
            }}
          >
            <Plus />
            Add pattern
          </Button>
        }
      />

      <SecurityNav />

      {error && !data ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {loading
              ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} lines={1} />)
              : categories.map((c) => {
                  const meta = uaCategoryMeta(c.category);
                  const isSel = selected === c.category;
                  return (
                    <div
                      key={c.category}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSel}
                      onClick={() => setSelected(isSel ? null : c.category)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(isSel ? null : c.category);
                        }
                      }}
                      className={cn(
                        "group relative flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring/30",
                        isSel && "border-primary/60 bg-primary/[0.04]"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <meta.icon className={cn("size-4", c.is_enabled ? "text-foreground" : "text-subtle-foreground")} />
                        <span className={cn("flex-1 truncate text-[13px] font-medium", !c.is_enabled && "text-muted-foreground")}>
                          {meta.label}
                        </span>
                        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <Switch
                            checked={c.is_enabled}
                            disabled={pending[c.category]}
                            onCheckedChange={(v) => toggle(c, v)}
                            aria-label={`${c.is_enabled ? "Disable" : "Enable"} ${meta.label}`}
                          />
                        </div>
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{meta.description}</p>
                      <div className="flex items-center gap-2 text-xs text-subtle-foreground">
                        <span>
                          <span className="font-data text-foreground">{formatNumber(c.pattern_count)}</span> patterns
                        </span>
                        {!c.is_enabled && <Badge variant="muted">Disabled</Badge>}
                      </div>
                    </div>
                  );
                })}
          </div>

          <DataTable
            columns={columns}
            data={visible}
            loading={loading}
            getRowId={(r) => r.id}
            searchKeys={["pattern", "description", (r) => uaCategoryMeta(r.category).label]}
            searchPlaceholder="Search patterns…"
            facets={[
              ...(selected ? [] : [{ columnId: "category", title: "Category" }]),
              { columnId: "match_type", title: "Match" },
              { columnId: "origin", title: "Origin" },
            ]}
            toolbar={
              selected ? (
                <Badge variant="outline" className="h-7 gap-1.5 px-2 text-xs">
                  {uaCategoryMeta(selected).label}
                  <button
                    type="button"
                    aria-label="Show all categories"
                    onClick={() => setSelected(null)}
                    className="rounded-sm text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ) : null
            }
            getRowClassName={(r) => (!r.category_enabled ? "opacity-60" : undefined)}
            enableRowSelection={(r) => !r.original.is_system}
            bulkActions={(sel, clear) => (
              <Button size="sm" variant="destructive" onClick={() => remove(sel, clear)}>
                <Trash2 />
                Delete {sel.length}
              </Button>
            )}
            emptyMessage="No patterns match these filters."
            emptyState={
              <EmptyState
                icon={Bot}
                title={selected ? "No patterns in this category" : "No patterns yet"}
                secondaryAction={
                  selected ? (
                    <Button variant="outline" onClick={() => setSelected(null)}>
                      Show all categories
                    </Button>
                  ) : undefined
                }
                action={
                  <Button
                    onClick={() => {
                      setAddCategory(selected ?? "custom");
                      setAddOpen(true);
                    }}
                  >
                    <Plus />
                    Add pattern
                  </Button>
                }
              />
            }
          />

          <Alert>
            <Info />
            <AlertDescription>
              System patterns can't be deleted, but their category can be switched off. Patterns sync to all agents every
              2 minutes.
            </AlertDescription>
          </Alert>
        </>
      )}

      <AddPatternDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultCategory={addCategory}
        categories={categories.map((c) => c.category)}
        onAdded={refresh}
      />
    </div>
  );
}

function AddPatternDialog({
  open,
  onOpenChange,
  defaultCategory,
  categories,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultCategory: string;
  categories: string[];
  onAdded: () => void;
}) {
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [category, setCategory] = useState(defaultCategory);
  const [description, setDescription] = useState("");
  const [test, setTest] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPattern("");
      setMatchType("contains");
      setCategory(defaultCategory);
      setDescription("");
      setTest("");
    }
  }, [open, defaultCategory]);

  const catItems = useMemo(
    () => [...new Set([...Object.keys(UA_CATEGORIES), ...categories])].map((key) => ({ key, ...uaCategoryMeta(key) })),
    [categories]
  );

  let regexError: string | null = null;
  if (matchType === "regex" && pattern) {
    try {
      new RegExp(pattern);
    } catch (e) {
      regexError = e instanceof Error ? e.message : "Invalid regular expression";
    }
  }
  const result = test ? matches(pattern.trim(), matchType, test) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim() || regexError) return;
    setSubmitting(true);
    try {
      await api.createSecurityUAPattern({ pattern: pattern.trim(), category, match_type: matchType, description: description.trim() });
      toast.success("Pattern added");
      onOpenChange(false);
      onAdded();
    } catch (err) {
      toast.error("Couldn't add pattern", { description: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add pattern</DialogTitle>
          <DialogDescription>Matching requests are banned immediately while the category is enabled.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Pattern" htmlFor="ua-pattern" required error={regexError ?? undefined}>
            <Input
              id="ua-pattern"
              autoFocus
              className="font-data"
              placeholder="python-httpx"
              value={pattern}
              aria-invalid={!!regexError}
              onChange={(e) => setPattern(e.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Match type">
              <ToggleGroup type="single" variant="outline" value={matchType} onValueChange={(v) => v && setMatchType(v)}>
                <ToggleGroupItem value="contains">Contains</ToggleGroupItem>
                <ToggleGroupItem value="exact">Exact</ToggleGroupItem>
                <ToggleGroupItem value="regex">Regex</ToggleGroupItem>
              </ToggleGroup>
            </FormField>
            <FormField label="Category">
              <Combobox
                items={catItems}
                getValue={(c) => c.key}
                getLabel={(c) => c.label}
                getKeywords={(c) => [c.key, c.description]}
                renderItem={(c) => (
                  <span className="flex items-center gap-2">
                    <c.icon className="size-3.5 text-muted-foreground" />
                    {c.label}
                  </span>
                )}
                value={category}
                onValueChange={(v) => v && setCategory(v)}
                searchPlaceholder="Search categories…"
              />
            </FormField>
          </div>
          <FormField label="Description" htmlFor="ua-desc">
            <Input id="ua-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </FormField>
          <div className="space-y-1.5 rounded-lg border border-dashed border-border-strong p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Test against a user agent</span>
              {result !== null && (
                <span className={cn("flex items-center gap-1 font-medium", result ? "text-destructive" : "text-success")}>
                  {result ? <XCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                  {result ? "Would be banned" : "Allowed"}
                </span>
              )}
            </div>
            <Input
              className="font-data h-8 text-xs"
              placeholder="Mozilla/5.0 (compatible; python-httpx/0.27)"
              value={test}
              onChange={(e) => setTest(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !pattern.trim() || !!regexError}>
              {submitting ? <Spinner /> : <Plus />}
              Add pattern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
