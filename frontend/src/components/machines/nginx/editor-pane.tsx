"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { OnMount } from "@monaco-editor/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Columns2,
  FileCode2,
  FileX2,
  Globe,
  History,
  Info,
  RotateCcw,
  Save,
  ScrollText,
  ShieldCheck,
  Undo2,
  WrapText,
} from "lucide-react";
import { api, type Job, type NginxExpectedFile } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { CopyableMono, EmptyState, ErrorState, RelativeTime, Spinner, errorMessage, openJobLogs, trackJob, useConfirm } from "@/components/app";
import { CFX_THEME, EDITOR_OPTIONS, languageForPath, setupMonaco } from "./monaco-setup";
import { applyOutcome, originalPathOf, readConfigFile, writeConfigFile, type ApplyOutcome } from "./nginx-api";
import { STATE_LABEL, type ExplorerFile } from "./model";

const EditorLoading = () => <div className="skeleton-shimmer h-full w-full bg-background" />;
const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), { ssr: false, loading: EditorLoading });
const MonacoDiff = dynamic(() => import("@monaco-editor/react").then((m) => m.DiffEditor), { ssr: false, loading: EditorLoading });

type Mode = "edit" | "diff";

interface Outcome extends ApplyOutcome {
  jobId: string;
  at: number;
}

export function EditorPane({
  machineId,
  machineName,
  file,
  backups,
  onDirtyChange,
  onSaved,
  onOpenPath,
}: {
  machineId: string;
  machineName: string;
  file: ExplorerFile | null;
  /** Backup files of the selected file (for diff / restore). */
  backups: ExplorerFile[];
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onOpenPath?: (path: string) => void;
}) {
  const confirm = useConfirm();
  const [content, setContent] = React.useState("");
  const [original, setOriginal] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<unknown>(null);
  const [reloadTick, setReloadTick] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>("edit");
  const [diffAgainst, setDiffAgainst] = React.useState<string>("disk");
  const [diffText, setDiffText] = React.useState<string | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [expected, setExpected] = React.useState<NginxExpectedFile | null>(null);
  const [wrap, setWrap] = React.useState(false);
  const [saving, setSaving] = React.useState<{ jobId: string | null } | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  const path = file?.path ?? null;
  const readOnly = !file || !!file.readonly || file.state === "missing";
  const dirty = !readOnly && content !== original;

  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Load file content
  React.useEffect(() => {
    setOutcome(null);
    setMode("edit");
    setDiffAgainst("disk");
    setDiffText(null);
    setExpected(null);
    if (!file || file.state === "missing") {
      setContent("");
      setOriginal("");
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    readConfigFile(machineId, file.path)
      .then((c) => {
        if (!alive) return;
        setContent(c);
        setOriginal(c);
      })
      .catch((e) => alive && setLoadError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId, file?.key, reloadTick]);

  // Load diff base
  React.useEffect(() => {
    if (mode !== "diff" || diffAgainst === "disk") {
      setDiffText(null);
      return;
    }
    let alive = true;
    setDiffLoading(true);
    if (diffAgainst === "expected") {
      api
        .getMachineNginxExpected(machineId, path ?? "")
        .then((e) => {
          if (!alive) return;
          setExpected(e);
          setDiffText(e.content);
        })
        .catch((e) => {
          if (!alive) return;
          toast.error("Couldn't render the expected config", { description: errorMessage(e) });
          setDiffAgainst("disk");
        })
        .finally(() => alive && setDiffLoading(false));
      return () => {
        alive = false;
      };
    }
    readConfigFile(machineId, diffAgainst)
      .then((c) => alive && setDiffText(c))
      .catch((e) => {
        if (!alive) return;
        toast.error("Couldn't read backup", { description: errorMessage(e) });
        setDiffAgainst("disk");
      })
      .finally(() => alive && setDiffLoading(false));
    return () => {
      alive = false;
    };
  }, [mode, diffAgainst, machineId, path]);

  const isNginx = !!path?.startsWith("/etc/nginx/");
  const isPhp = !!path?.startsWith("/etc/php/");
  const isSshd = path === "/etc/ssh/sshd_config";
  const transactional = isNginx || isPhp || isSshd;

  const apply = React.useCallback(
    async (targetPath: string, text: string, label: string) => {
      setSaving({ jobId: null });
      setOutcome(null);
      try {
        const res = await writeConfigFile(machineId, targetPath, text);
        if (!res.jobId) {
          // Legacy synchronous backend
          setSaving(null);
          if (res.syncSuccess) {
            toast.success(`${label} saved`);
            if (targetPath === path) setOriginal(text);
            onSaved?.();
          } else toast.error(`Couldn't save ${label}`, { description: res.logs });
          return;
        }
        const jobId = res.jobId;
        setSaving({ jobId });
        const finished = await trackJob(jobId, { title: `Save ${label}`, description: machineName, quietSuccess: true });
        let detail: (Job & { result_json?: unknown }) | null = finished;
        try {
          detail = await api.getJobDetail(jobId).then((d) => ({ ...d, agent_id: d.agent_id ?? "", payload_json: d.payload, logs: d.logs } as Job & { result_json?: unknown }));
        } catch {
          /* fall back to tracked job */
        }
        const o = detail ? applyOutcome(detail) : ({ status: "unknown" } as ApplyOutcome);
        setOutcome({ ...o, jobId, at: Date.now() });
        if (o.status === "applied") {
          if (targetPath === path) setOriginal(text);
          toast.success(`${label} applied`, { description: transactional ? "Tested and reloaded" : "Written" });
          onSaved?.();
        }
        // Failures are already toasted by trackJob; the outcome banner explains rollbacks.
      } catch (e) {
        toast.error(`Couldn't save ${label}`, { description: errorMessage(e) });
      } finally {
        setSaving(null);
      }
    },
    [machineId, machineName, onSaved, path, transactional]
  );

  const steps = (targetPath: string) => (
    <ol className="space-y-1.5 text-[12.5px]">
      {[
        ["Back up", <>current <span className="font-data">{targetPath.split("/").pop()}</span> on the machine</>],
        ["Write", "the new content"],
        isNginx ? ["Test", <span key="t" className="font-data">nginx -t</span>] : isPhp ? ["Test", <span key="t" className="font-data">php-fpm -t</span>] : isSshd ? ["Test", <span key="t" className="font-data">sshd -t</span>] : null,
        transactional ? ["Reload", isNginx ? "nginx" : isPhp ? "php-fpm" : "sshd"] : file?.legacy?.reloadCommand ? ["Run", <span key="r" className="font-data">{file.legacy.reloadCommand}</span>] : null,
        transactional ? ["Roll back", "automatically if the test or reload fails"] : null,
      ]
        .filter(Boolean)
        .map((s, i) => {
          const [k, v] = s as [string, React.ReactNode];
          return (
            <li key={k} className="flex items-baseline gap-2">
              <span className="font-data flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong text-[10px] text-muted-foreground">{i + 1}</span>
              <span>
                <span className="font-medium">{k}</span> <span className="text-muted-foreground">{v}</span>
              </span>
            </li>
          );
        })}
    </ol>
  );

  const save = React.useCallback(async () => {
    if (!file || readOnly || !dirty || saving) return;
    const ok = await confirm({
      title: `Apply changes to ${file.name}?`,
      description: transactional ? "The change is applied as a transaction on the machine:" : "The file is written on the machine:",
      details: (
        <div className="space-y-3">
          {steps(file.path)}
          {file.managed && (
            <p className="rounded-md border border-warning/30 bg-warning/[0.07] px-2.5 py-2 text-xs text-warning">
              This file is generated by Configuratix. Manual edits are overwritten the next time {file.domainFqdn ?? "it"} is applied.
            </p>
          )}
        </div>
      ),
      confirmText: transactional ? "Apply & reload" : "Write file",
      icon: ShieldCheck,
    });
    if (ok) void apply(file.path, content, file.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, readOnly, dirty, saving, confirm, transactional, apply, content]);

  const restoreBackup = async () => {
    if (!file || file.state !== "backup") return;
    const target = originalPathOf(file.path);
    const ok = await confirm({
      title: "Restore this backup?",
      description: (
        <>
          Overwrites <span className="font-data text-foreground">{target}</span> with this backup.
        </>
      ),
      details: steps(target),
      confirmText: "Restore backup",
      icon: History,
    });
    if (ok) void apply(target, content, target.split("/").pop() ?? target);
  };

  const canExpect = !!file && !!file.managed && file.state === "active" && isNginx;

  const showExpectedDiff = () => {
    setMode("diff");
    setDiffAgainst("expected");
  };

  const restoreExpected = async () => {
    if (!file || !canExpect) return;
    let exp = expected;
    try {
      if (!exp) {
        exp = await api.getMachineNginxExpected(machineId, file.path);
        setExpected(exp);
      }
    } catch (e) {
      toast.error("Couldn't render the expected config", { description: errorMessage(e) });
      return;
    }
    const ok = await confirm({
      title: `Restore ${file.name} to the expected config?`,
      description: (
        <>
          Replaces the file on the machine with what Configuratix generates{file.domainFqdn ? <> for <span className="font-data text-foreground">{file.domainFqdn}</span></> : null}. Manual changes on the machine{dirty ? " and your unsaved edits" : ""} are discarded.
        </>
      ),
      details: steps(file.path),
      confirmText: "Restore expected",
      icon: History,
    });
    if (!ok || !exp) return;
    setContent(exp.content);
    void apply(file.path, exp.content, file.name);
  };

  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current());
  };

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={FileCode2}
          title="Select a file"
          description="Pick a config from the explorer. Configuratix-managed files are marked with a blue dot; drift means the file no longer matches what Configuratix would generate."
          bordered={false}
        />
      </div>
    );
  }

  const backupOptions = [
    { id: "disk", label: dirty ? "Saved on machine (vs. your edits)" : "Saved on machine", path: "" },
    ...(canExpect ? [{ id: "expected", label: "Expected (Configuratix render)", path: "" }] : []),
    ...backups.map((b) => ({ id: b.path, label: b.name, path: b.path, mtime: b.mtime })),
  ];
  const vsExpected = mode === "diff" && diffAgainst === "expected";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-data truncate text-[14px] font-medium">{file.name}</span>
            {file.state !== "active" && <Badge variant={file.state === "missing" ? "warning" : "muted"}>{STATE_LABEL[file.state]}</Badge>}
            {file.managed && <Badge variant="info">managed</Badge>}
            {file.drift && <Badge variant="warning">drift</Badge>}
            {dirty && <Badge variant="outline">modified</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <CopyableMono value={file.path} monoClassName="text-[11.5px]" />
            {file.linkTarget && <span className="font-data text-[11px]">→ {file.linkTarget}</span>}
            {file.size != null && <span className="font-data">{formatBytes(file.size)}</span>}
            {file.mtime && (
              <span>
                modified <RelativeTime date={file.mtime} />
              </span>
            )}
            {file.domainFqdn && (
              <Link href={`/domains?q=${encodeURIComponent(file.domainFqdn)}`} className="inline-flex items-center gap-1 hover:text-foreground">
                <Globe className="size-3" />
                {file.domainFqdn}
              </Link>
            )}
          </div>
        </div>
        {file.state !== "missing" && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as Mode)}>
              <ToggleGroupItem value="edit" aria-label="Editor">
                <FileCode2 />
                {readOnly ? "View" : "Edit"}
              </ToggleGroupItem>
              <ToggleGroupItem value="diff" aria-label="Diff" disabled={!dirty && backups.length === 0 && !canExpect}>
                <Columns2 />
                Diff
              </ToggleGroupItem>
            </ToggleGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={wrap ? "secondary" : "ghost"} size="icon-sm" onClick={() => setWrap((w) => !w)} aria-label="Toggle word wrap">
                  <WrapText />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Word wrap</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => setReloadTick((t) => t + 1)} disabled={loading || dirty} aria-label="Reload from machine">
                  <RotateCcw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{dirty ? "Revert first to reload" : "Re-read from machine"}</TooltipContent>
            </Tooltip>
            {file.state === "backup" ? (
              <Button size="sm" variant="outline" onClick={restoreBackup} disabled={!!saving || loading}>
                {saving ? <Spinner /> : <History />}
                Restore backup
              </Button>
            ) : !readOnly ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setContent(original)} disabled={!dirty || !!saving}>
                  <Undo2 />
                  Revert
                </Button>
                <Button size="sm" onClick={save} disabled={!dirty || !!saving}>
                  {saving ? <Spinner /> : <Save />}
                  {saving ? "Applying…" : "Save"}
                  {!saving && <Kbd className="ml-1 hidden lg:inline-flex">⌘S</Kbd>}
                </Button>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Contextual notices */}
      <div className="space-y-2 empty:hidden [&>*]:mx-4 [&>*:first-child]:mt-3">
        {saving && (
          <div className="flex items-center gap-2 rounded-md border border-info/30 bg-info/[0.07] px-3 py-2 text-[12.5px]">
            <Spinner className="text-info" />
            <span className="flex-1">Applying on the machine — backup, {transactional ? "test, reload" : "write"}…</span>
            {saving.jobId && (
              <Button variant="ghost" size="xs" onClick={() => openJobLogs(saving.jobId!)}>
                <ScrollText />
                Live logs
              </Button>
            )}
          </div>
        )}
        {outcome && !saving && (
          <Alert variant={outcome.status === "applied" ? "success" : outcome.status === "unknown" ? "info" : "destructive"} className="animate-fade-in-up">
            {outcome.status === "applied" ? <CheckCircle2 /> : outcome.status === "unknown" ? <Info /> : <AlertTriangle />}
            <AlertTitle className="flex items-center justify-between gap-2">
              <span>
                {outcome.status === "applied"
                  ? transactional
                    ? "Applied — config test passed and service reloaded"
                    : "Written"
                  : outcome.status === "rolled_back"
                    ? "Rolled back — previous file restored"
                    : outcome.status === "cancelled"
                      ? "Cancelled"
                      : outcome.status === "unknown"
                        ? "Still running — check the job"
                        : "Failed"}
              </span>
              <Button variant="ghost" size="xs" onClick={() => openJobLogs(outcome.jobId)}>
                <ScrollText />
                Logs
              </Button>
            </AlertTitle>
            {outcome.reason && <AlertDescription className="font-data text-xs whitespace-pre-wrap">{outcome.reason}</AlertDescription>}
            {outcome.status === "rolled_back" && <AlertDescription className="text-xs">Your edits are still in the editor — fix and save again.</AlertDescription>}
          </Alert>
        )}
        {file.state === "missing" && (
          <Alert variant="warning">
            <FileX2 />
            <AlertTitle>Expected file is not on the machine</AlertTitle>
            <AlertDescription className="text-xs">
              {file.domainFqdn} is assigned here but <span className="font-data">{file.path}</span> does not exist. Re-apply the domain to regenerate it.
            </AlertDescription>
          </Alert>
        )}
        {file.drift && file.state !== "missing" && (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Drift detected</AlertTitle>
            <AlertDescription className="text-xs">
              This file differs from what Configuratix generates{file.domainFqdn ? ` for ${file.domainFqdn}` : ""}. Re-applying overwrites manual changes.
            </AlertDescription>
            {canExpect && (
              <div className="col-start-2 mt-1.5 flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" onClick={showExpectedDiff} disabled={vsExpected}>
                  <Columns2 />
                  Diff vs expected
                </Button>
                <Button size="xs" variant="outline" onClick={restoreExpected} disabled={!!saving || loading}>
                  <History />
                  Restore expected
                </Button>
              </div>
            )}
          </Alert>
        )}
        {file.managed && !file.drift && file.state === "active" && !outcome && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            <span>
              Generated by Configuratix
              {file.nginxConfigId && (
                <>
                  {" "}from{" "}
                  <Link href={`/configs/nginx/${encodeURIComponent(file.nginxConfigId)}`} className="underline-offset-4 hover:text-foreground hover:underline">
                    its nginx config
                  </Link>
                </>
              )}
              . Prefer editing the template — manual edits are replaced on the next apply.
            </span>
          </div>
        )}
        {file.state === "backup" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Archive className="size-3.5 shrink-0" />
            <span>
              Read-only backup of{" "}
              <button type="button" className="font-data underline-offset-4 hover:text-foreground hover:underline" onClick={() => onOpenPath?.(originalPathOf(file.path))}>
                {originalPathOf(file.path)}
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="relative mt-3 min-h-0 flex-1 border-t border-border">
        {file.state === "missing" ? null : loadError ? (
          <div className="p-6">
            <ErrorState error={loadError} onRetry={() => setReloadTick((t) => t + 1)} title="Couldn't read file" />
          </div>
        ) : loading ? (
          <EditorLoading />
        ) : mode === "diff" ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground">
              <span>Compare</span>
              <Combobox
                size="sm"
                className="w-72"
                items={backupOptions}
                value={diffAgainst}
                onValueChange={(v) => setDiffAgainst(v ?? "disk")}
                getValue={(o) => o.id}
                getLabel={(o) => o.label}
                renderItem={(o) => (
                  <div className="min-w-0">
                    <div className={cn("truncate", o.path && "font-data")}>{o.label}</div>
                    {"mtime" in o && o.mtime && <div className="text-[11px] text-muted-foreground"><RelativeTime date={o.mtime} /></div>}
                  </div>
                )}
                modal={false}
              />
              <span>{vsExpected ? "← on machine" : `→ ${dirty ? "your edits" : "current"}`}</span>
              {diffLoading && <Spinner className="ml-auto" />}
              {vsExpected && expected && (
                <Button size="xs" variant="outline" className={cn(!diffLoading && "ml-auto")} onClick={restoreExpected} disabled={!!saving}>
                  <History />
                  Restore expected
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <MonacoDiff
                height="100%"
                language={languageForPath(file.path)}
                theme={CFX_THEME}
                beforeMount={setupMonaco}
                original={vsExpected ? original : diffAgainst === "disk" ? original : (diffText ?? "")}
                modified={vsExpected ? (diffText ?? "") : content}
                options={{ ...EDITOR_OPTIONS, readOnly: true, renderSideBySide: true, wordWrap: wrap ? "on" : "off", originalEditable: false }}
              />
            </div>
          </div>
        ) : (
          <MonacoEditor
            height="100%"
            path={`cfx://${machineId}${file.path}`}
            language={languageForPath(file.path)}
            theme={CFX_THEME}
            beforeMount={setupMonaco}
            onMount={onMount}
            value={content}
            onChange={(v) => setContent(v ?? "")}
            options={{ ...EDITOR_OPTIONS, readOnly, wordWrap: wrap ? "on" : "off", domReadOnly: readOnly }}
          />
        )}
      </div>
    </div>
  );
}
