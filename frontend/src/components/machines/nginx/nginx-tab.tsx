"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, FlaskConical, RefreshCw, RotateCw, Search, Server, Trash2, X } from "lucide-react";
import { api, type ConfigCategory, type MachineNginxInventory } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorState, LogViewer, RelativeTime, Spinner, StatusBadge, StatusDot, errorMessage, trackJob, useConfirm, usePolling } from "@/components/app";
import { FileTree } from "./file-tree";
import { EditorPane } from "./editor-pane";
import { CategoryDialog, PathDialog, type CategoryForm, type PathForm } from "./config-dialogs";
import { allFiles, legacyGroups, nginxGroups, type ExplorerFile, type ExplorerGroup } from "./model";
import { EndpointMissingError, loadNginxInventory, originalPathOf, startNginxReload, startNginxTest, testResultFromLogs } from "./nginx-api";

type InvState =
  | { status: "loading"; pendingJobId?: string }
  | { status: "ready"; data: MachineNginxInventory }
  | { status: "unavailable" }
  | { status: "error"; error: unknown };

interface TestState {
  ok: boolean | null;
  output: string;
  at: string | null;
}

/** Legacy PHP discovery (pre-inventory backends list PHP versions client-side). */
async function withPhpVersions(machineId: string, cats: ConfigCategory[]): Promise<ConfigCategory[]> {
  const php = cats.find((c) => c.id === "php");
  if (!php || (php.subcategories?.length ?? 0) > 0) return cats;
  try {
    const r = await api.listDirectory(machineId, "/etc/php", false);
    if (!r.success || !Array.isArray(r.result)) return cats.filter((c) => c.id !== "php");
    const versions = (r.result as { name: string; is_dir: boolean }[])
      .filter((f) => f.is_dir && /^\d+\.\d+$/.test(f.name))
      .map((f) => f.name)
      .sort((a, b) => parseFloat(b) - parseFloat(a));
    if (!versions.length) return cats.filter((c) => c.id !== "php");
    return cats.map((c) =>
      c.id === "php"
        ? {
            ...c,
            subcategories: versions.map((v) => ({
              id: `php_${v}`,
              name: `PHP ${v}`,
              files: [
                { name: "php.ini", path: `/etc/php/${v}/fpm/php.ini`, type: "php", readonly: false },
                { name: "www.conf", path: `/etc/php/${v}/fpm/pool.d/www.conf`, type: "php", readonly: false },
              ],
            })),
          }
        : c
    );
  } catch {
    return cats.filter((c) => c.id !== "php" || (c.subcategories?.length ?? 0) > 0);
  }
}

export function NginxTab({ machineId, machineName, active }: { machineId: string; machineName: string; active: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const confirm = useConfirm();

  /* ---------- inventory ---------- */
  const [inv, setInv] = React.useState<InvState>({ status: "loading" });
  const [scanTick, setScanTick] = React.useState(0);
  const [rescanning, setRescanning] = React.useState(false);
  // Lazy: nothing is fetched until the tab is opened the first time.
  const [everActive, setEverActive] = React.useState(active);
  React.useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);

  React.useEffect(() => {
    if (!everActive) return;
    const signal = { cancelled: false };
    if (scanTick > 0) setRescanning(true);
    loadNginxInventory(machineId, { signal, onPending: (id) => setInv((s) => (s.status === "ready" ? s : { status: "loading", pendingJobId: id })) })
      .then((data) => !signal.cancelled && setInv({ status: "ready", data }))
      .catch((e) => {
        if (signal.cancelled) return;
        if (e instanceof EndpointMissingError) setInv({ status: "unavailable" });
        else setInv((s) => (s.status === "ready" ? s : { status: "error", error: e }));
        if (scanTick > 0 && !(e instanceof EndpointMissingError)) toast.error("Couldn't rescan nginx", { description: errorMessage(e) });
      })
      .finally(() => !signal.cancelled && setRescanning(false));
    return () => {
      signal.cancelled = true;
    };
  }, [machineId, scanTick, everActive]);

  const rescan = React.useCallback(() => setScanTick((t) => t + 1), []);
  const inventory = inv.status === "ready" ? inv.data : null;

  /* ---------- legacy categories (PHP, SSH, custom) ---------- */
  const legacyQ = usePolling(async () => withPhpVersions(machineId, (await api.listMachineConfigs(machineId)).categories ?? []), 0, {
    enabled: everActive,
    deps: [machineId],
  });

  const groups: ExplorerGroup[] = React.useMemo(() => {
    const g: ExplorerGroup[] = [];
    if (inventory) g.push(...nginxGroups(inventory));
    g.push(...legacyGroups(legacyQ.data ?? [], !!inventory));
    return g;
  }, [inventory, legacyQ.data]);
  const files = React.useMemo(() => allFiles(groups), [groups]);

  /* ---------- nginx -t ---------- */
  const [test, setTest] = React.useState<TestState | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [reloading, setReloading] = React.useState(false);
  React.useEffect(() => {
    if (inventory) setTest({ ok: inventory.nginx.test_ok, output: inventory.nginx.test_output, at: inventory.fetched_at });
  }, [inventory]);

  const runTest = async () => {
    setTesting(true);
    try {
      const id = await startNginxTest(machineId);
      const job = await trackJob(id, { title: "Test nginx configuration", description: machineName, quietSuccess: true });
      const detail = await api.getJobDetail(id).catch(() => null);
      const r = testResultFromLogs(detail?.logs ?? job?.logs);
      const ok = r.ok ?? job?.status === "completed";
      setTest({ ok, output: r.output, at: new Date().toISOString() });
      if (ok) toast.success("nginx -t passed", { description: "Syntax is ok, configuration test is successful." });
      else setOutputOpen(true); // trackJob already toasted the failure
    } catch (e) {
      toast.error("Couldn't run nginx -t", { description: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const runReload = async () => {
    setReloading(true);
    try {
      const id = await startNginxReload(machineId);
      const job = await trackJob(id, { title: "Reload nginx", description: machineName });
      if (job?.status === "failed") {
        const r = testResultFromLogs(job.logs);
        if (r.ok === false) {
          setTest({ ok: false, output: r.output, at: new Date().toISOString() });
          setOutputOpen(true);
        }
      }
      rescan();
    } catch (e) {
      toast.error("Couldn't reload nginx", { description: errorMessage(e) });
    } finally {
      setReloading(false);
    }
  };
  const [outputOpen, setOutputOpen] = React.useState(false);

  /* ---------- selection (synced to ?file=) ---------- */
  const selectedPath = params.get("file");
  const selected = React.useMemo(
    () => (selectedPath ? (files.find((f) => f.key === selectedPath) ?? files.find((f) => f.path === selectedPath) ?? null) : null),
    [files, selectedPath]
  );
  const [dirty, setDirty] = React.useState(false);
  const setSelectedPath = React.useCallback(
    (key: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (key) next.set("file", key);
      else next.delete("file");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );
  const select = async (f: ExplorerFile) => {
    if (f.key === selected?.key) return;
    if (dirty) {
      const ok = await confirm({ title: "Discard unsaved changes?", description: `Your edits to ${selected?.name} will be lost.`, confirmText: "Discard", destructive: true });
      if (!ok) return;
    }
    setSelectedPath(f.key);
  };
  const openPath = (path: string) => {
    const f = files.find((x) => x.path === path);
    if (f) void select(f);
  };
  const backups = React.useMemo(
    () => (selected && selected.state !== "backup" ? files.filter((f) => f.state === "backup" && f.path !== selected.path && originalPathOf(f.path) === selected.path) : []),
    [files, selected]
  );

  // Warn before leaving the page with unsaved edits.
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /* ---------- tree filters ---------- */
  const [filter, setFilter] = React.useState("");
  const [showBackups, setShowBackups] = React.useState(false);
  const backupCount = files.filter((f) => f.state === "backup").length;
  const driftCount = files.filter((f) => f.drift || f.state === "missing").length;
  const managedCount = files.filter((f) => f.managed && f.state !== "missing").length;

  /* ---------- custom categories ---------- */
  const [catDialog, setCatDialog] = React.useState<{ open: boolean; editing?: ExplorerGroup }>({ open: false });
  const [pathDialog, setPathDialog] = React.useState<{ open: boolean; group?: ExplorerGroup; file?: ExplorerFile }>({ open: false });
  const refreshLegacy = legacyQ.refresh;

  const submitCategory = async (f: CategoryForm) => {
    try {
      const cat = catDialog.editing?.custom?.category;
      if (cat) await api.updateConfigCategory(machineId, cat.id, f);
      else await api.createConfigCategory(machineId, f);
      toast.success(cat ? "Category updated" : "Category created");
      void refreshLegacy();
    } catch (e) {
      toast.error("Couldn't save category", { description: errorMessage(e) });
      throw e;
    }
  };
  const submitPath = async (f: PathForm) => {
    const cat = pathDialog.group?.custom?.category;
    if (!cat) return;
    try {
      const body = { name: f.name, path: f.path, file_type: f.file_type, reload_command: f.reload_command || undefined };
      if (pathDialog.file?.legacy?.pathId) await api.updateConfigPath(machineId, cat.id, pathDialog.file.legacy.pathId, body);
      else await api.addConfigPath(machineId, cat.id, body);
      toast.success(pathDialog.file ? "Path updated" : "Path added");
      void refreshLegacy();
    } catch (e) {
      toast.error("Couldn't save path", { description: errorMessage(e) });
      throw e;
    }
  };

  /* ---------- render ---------- */
  const nginx = inventory?.nginx;
  const loadingInv = inv.status === "loading";

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[13px]">
            <Server className="size-4 text-muted-foreground" />
            <span className="font-medium">nginx</span>
            {inventory ? (
              <StatusBadge status={nginx?.active ? "active" : nginx?.state || "inactive"} label={nginx?.state || (nginx?.active ? "active" : "inactive")} />
            ) : inv.status === "unavailable" ? (
              <span className="text-xs text-muted-foreground">status unavailable (legacy backend)</span>
            ) : loadingInv ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <StatusBadge status="unknown" />
            )}
            {nginx?.version && <span className="font-data text-xs text-muted-foreground">{nginx.version}</span>}
          </div>

          {(test || testing) && (
            <Collapsible open={outputOpen} onOpenChange={setOutputOpen} className="contents">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex items-center gap-2 rounded-md px-1.5 py-0.5 text-[13px] hover:bg-surface-2/60">
                  <span className="font-data text-xs text-muted-foreground">nginx -t</span>
                  {testing ? (
                    <StatusBadge status="running" label="testing" />
                  ) : test?.ok == null ? (
                    <StatusBadge status="unknown" />
                  ) : (
                    <StatusBadge status={test.ok ? "success" : "failed"} label={test.ok ? "passed" : "failed"} />
                  )}
                  {test?.at && !testing && (
                    <span className="text-xs text-subtle-foreground">
                      <RelativeTime date={test.at} />
                    </span>
                  )}
                  <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", outputOpen && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
            </Collapsible>
          )}

          {inventory && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                <span className="font-data text-foreground">{inventory.files.length}</span> files
              </span>
              <span className="inline-flex items-center gap-1">
                <StatusDot tone="info" pulse={false} size="xs" />
                <span className="font-data text-foreground">{managedCount}</span> managed
              </span>
              {driftCount > 0 && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <StatusDot tone="warning" pulse={false} size="xs" />
                  <span className="font-data">{driftCount}</span> drift / missing
                </span>
              )}
              <span className="hidden xl:inline">
                scanned <RelativeTime date={inventory.fetched_at} />
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={rescan} disabled={loadingInv || rescanning || inv.status === "unavailable"}>
                  {rescanning || loadingInv ? <Spinner /> : <RefreshCw />}
                  Rescan
                </Button>
              </TooltipTrigger>
              <TooltipContent>Re-read every file under /etc/nginx</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" onClick={runTest} disabled={testing || inv.status === "unavailable"}>
              {testing ? <Spinner /> : <FlaskConical />}
              Test
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={runReload} disabled={reloading || inv.status === "unavailable"}>
                  {reloading ? <Spinner /> : <RotateCw />}
                  Reload
                </Button>
              </TooltipTrigger>
              <TooltipContent>Runs nginx -t first; never reloads a broken config</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {outputOpen && test && (
          <div className="border-t border-border p-3 animate-fade-in-up">
            <LogViewer logs={test.output || "(no output)"} title="nginx -t" maxHeight="240px" />
          </div>
        )}
      </div>

      {/* Explorer + editor */}
      <div className="grid overflow-hidden rounded-lg border border-border bg-card lg:h-[max(560px,calc(100svh-330px))] lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          <div className="space-y-2 border-b border-border p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files or domains…" className="h-8 pr-7 pl-8 text-[12.5px]" />
              {filter && (
                <button type="button" onClick={() => setFilter("")} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear filter">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {backupCount > 0 && (
              <div className="flex items-center justify-between px-0.5">
                <Label htmlFor="show-backups" className="text-xs font-normal text-muted-foreground">
                  Show backups <span className="font-data">({backupCount})</span>
                </Label>
                <Switch id="show-backups" checked={showBackups} onCheckedChange={setShowBackups} />
              </div>
            )}
          </div>
          <div className="max-h-[420px] min-h-0 flex-1 overflow-y-auto p-1.5 lg:max-h-none">
            {loadingInv && (
              <div className="space-y-2 p-2">
                <div className="flex items-center gap-2 pb-1 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {inv.status === "loading" && inv.pendingJobId ? "Agent is reading /etc/nginx…" : "Scanning nginx configuration…"}
                </div>
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-4" style={{ width: `${85 - ((i * 13) % 40)}%`, opacity: 1 - i * 0.08 }} />
                ))}
              </div>
            )}
            {inv.status === "error" && (
              <div className="p-2">
                <ErrorState error={inv.error} onRetry={rescan} title="Couldn't read nginx files" size="compact" />
              </div>
            )}
            {inv.status === "unavailable" && (
              <p className="px-2.5 pt-1 pb-2 text-[11px] text-subtle-foreground">This backend has no full nginx inventory — showing known config paths.</p>
            )}
            {(!loadingInv || (legacyQ.data?.length ?? 0) > 0) && (
              <FileTree
                groups={groups}
                selectedKey={selected?.key ?? null}
                onSelect={(f) => void select(f)}
                filter={filter}
                showBackups={showBackups}
                handlers={{
                  onAddCategory: () => setCatDialog({ open: true }),
                  onEditCategory: (g) => setCatDialog({ open: true, editing: g }),
                  onDeleteCategory: async (g) => {
                    const cat = g.custom?.category;
                    if (!cat) return;
                    const ok = await confirm({
                      title: `Delete “${cat.name}”?`,
                      description: "The category and its file paths are removed from Configuratix. Files on the machine are not touched.",
                      destructive: true,
                      confirmText: "Delete category",
                      icon: Trash2,
                      onConfirm: () => api.deleteConfigCategory(machineId, cat.id),
                    });
                    if (ok) {
                      toast.success("Category deleted");
                      void refreshLegacy();
                    }
                  },
                  onAddPath: (g) => setPathDialog({ open: true, group: g }),
                  onEditPath: (g, f) => setPathDialog({ open: true, group: g, file: f }),
                  onRemovePath: async (g, f) => {
                    const cat = g.custom?.category;
                    if (!cat || !f.legacy?.pathId) return;
                    const ok = await confirm({
                      title: `Remove ${f.name} from “${cat.name}”?`,
                      description: "Only the shortcut is removed; the file stays on the machine.",
                      confirmText: "Remove path",
                      destructive: true,
                      onConfirm: () => api.removeConfigPath(machineId, cat.id, f.legacy!.pathId!),
                    });
                    if (ok) {
                      if (selected?.key === f.key) setSelectedPath(null);
                      void refreshLegacy();
                    }
                  },
                }}
              />
            )}
          </div>
        </aside>
        <section className="flex h-[640px] min-h-0 min-w-0 flex-col lg:h-auto">
          <EditorPane
            machineId={machineId}
            machineName={machineName}
            file={selected}
            backups={backups}
            onDirtyChange={setDirty}
            onSaved={rescan}
            onOpenPath={openPath}
          />
        </section>
      </div>

      <CategoryDialog
        open={catDialog.open}
        onOpenChange={(o) => setCatDialog((s) => ({ ...s, open: o }))}
        initial={catDialog.editing?.custom ? { name: catDialog.editing.label, emoji: catDialog.editing.custom.emoji || "📁", color: catDialog.editing.custom.color || "#6366f1" } : null}
        onSubmit={submitCategory}
      />
      <PathDialog
        open={pathDialog.open}
        onOpenChange={(o) => setPathDialog((s) => ({ ...s, open: o }))}
        categoryName={pathDialog.group?.label}
        initial={
          pathDialog.file
            ? { name: pathDialog.file.name, path: pathDialog.file.path, file_type: pathDialog.file.legacy?.type ?? "text", reload_command: pathDialog.file.legacy?.reloadCommand ?? "" }
            : null
        }
        onSubmit={submitPath}
      />
    </div>
  );
}
