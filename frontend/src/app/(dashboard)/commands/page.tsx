"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ListChecks, Play, Search, Terminal, Variable, X } from "lucide-react";
import { api, type CommandTemplate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CardSkeleton, EmptyState, ErrorState, PageHeader, usePolling } from "@/components/app";
import { fuzzyFilter } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";
import { OnErrorBadge, categoryMeta } from "@/components/commands/command-meta";
import { ExecuteCommandSheet } from "@/components/commands/execute-command-sheet";
import { RecentCommandRuns } from "@/components/commands/recent-runs";

export default function CommandsPage() {
  return (
    <Suspense>
      <CommandsPageInner />
    </Suspense>
  );
}

function CommandsPageInner() {
  const params = useSearchParams();
  const initialMachine = params.get("machine");
  const { data, loading, error, refresh } = usePolling(() => api.listCommands(), 0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<CommandTemplate | null>(null);
  const [open, setOpen] = useState(false);
  const [runsKey, setRunsKey] = useState(0);

  const commands = useMemo(() => data ?? [], [data]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of commands) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => categoryMeta(a[0]).order - categoryMeta(b[0]).order || a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, count, ...categoryMeta(key) }));
  }, [commands]);

  const filtered = useMemo(() => {
    const q = query.trim();
    let list = category === "all" ? commands : commands.filter((c) => c.category === category);
    if (q) {
      list = list
        .map((c) => ({
          c,
          score: fuzzyFilter(c.name, q, [c.description, c.category, c.id, ...c.variables.map((v) => v.name)]),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.c);
    }
    return list;
  }, [commands, category, query]);

  const groups = useMemo(() => {
    if (query.trim()) return [{ key: "results", label: `${filtered.length} results`, items: filtered, icon: Search }];
    return categories
      .map((cat) => ({ key: cat.key, label: cat.label, icon: cat.icon, items: filtered.filter((c) => c.category === cat.key) }))
      .filter((g) => g.items.length > 0);
  }, [categories, filtered, query]);

  const openCommand = (c: CommandTemplate) => {
    setSelected(c);
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Terminal}
        title="Commands"
        description="Run vetted command templates on a machine. Variables are validated server-side before reaching the agent."
        badge={data ? <Badge variant="muted" className="font-data">{commands.length}</Badge> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands, variables…"
                className="pl-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filtered[0]) openCommand(filtered[0]);
                  if (e.key === "Escape") setQuery("");
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              value={category}
              onValueChange={(v) => v && setCategory(v)}
              className="flex-wrap"
            >
              <ToggleGroupItem value="all">
                All <span className="font-data text-[11px] text-subtle-foreground">{commands.length}</span>
              </ToggleGroupItem>
              {categories.map((c) => (
                <ToggleGroupItem key={c.key} value={c.key}>
                  <c.icon className="size-3.5" />
                  {c.label}
                  <span className="font-data text-[11px] text-subtle-foreground">{c.count}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} lines={2} />
              ))}
            </div>
          ) : error && !data ? (
            <ErrorState error={error} onRetry={refresh} />
          ) : groups.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No commands match"
              description="Try a different search or category."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <section key={g.key} className="space-y-2">
                  <h2 className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                    <g.icon className="size-3.5" />
                    {g.label}
                    <span className="font-data text-[11px] text-subtle-foreground">{g.items.length}</span>
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {g.items.map((c) => (
                      <CommandCard key={c.id} command={c} onRun={() => openCommand(c)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <RecentCommandRuns refreshKey={runsKey} />
        </div>
      </div>

      <ExecuteCommandSheet
        command={selected}
        open={open}
        onOpenChange={setOpen}
        initialMachineId={initialMachine}
        onStarted={() => setRunsKey((k) => k + 1)}
      />
    </div>
  );
}

function CommandCard({ command, onRun }: { command: CommandTemplate; onRun: () => void }) {
  const meta = categoryMeta(command.category);
  const required = command.variables.filter((v) => v.required).length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onRun}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRun();
        }
      }}
      className={cn(
        "group flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 outline-none transition-colors",
        "hover:border-border-strong hover:bg-surface-2/40 focus-visible:ring-[3px] focus-visible:ring-ring/30"
      )}
    >
      <div className="flex items-start gap-2.5">
        <meta.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{command.name}</div>
          <p className="line-clamp-2 text-xs text-muted-foreground">{command.description}</p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0 opacity-60 group-hover:opacity-100"
          aria-label={`Run ${command.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
        >
          <Play />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6.5 text-[11px] text-subtle-foreground">
        <span className="flex items-center gap-1" title="Variables">
          <Variable className="size-3" />
          {command.variables.length === 0 ? (
            "no variables"
          ) : (
            <span className="font-data">
              {command.variables.map((v) => v.name).join(", ")}
              {required > 0 && <span className="text-muted-foreground"> · {required} req</span>}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1" title="Steps">
          <ListChecks className="size-3" />
          <span className="font-data">{command.steps.length}</span> steps
        </span>
        {command.on_error === "rollback" && <OnErrorBadge value={command.on_error} />}
      </div>
    </div>
  );
}
