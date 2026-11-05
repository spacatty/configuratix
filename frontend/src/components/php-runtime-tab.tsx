"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download, Package, RefreshCw, Trash2, X } from "lucide-react";
import { api, type PHPExtensionTemplate, type PHPRuntimeResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Combobox, MultiCombobox } from "@/components/ui/combobox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CardSkeleton,
  CopyableMono,
  ErrorState,
  KeyValueList,
  RelativeTime,
  SectionCard,
  Spinner,
  StatusBadge,
  errorMessage,
  trackJob,
  useConfirm,
  usePolling,
} from "@/components/app";

interface PHPRuntimeTabProps {
  machineId: string;
  machineName?: string;
}

const PHP_VERSIONS = ["8.4", "8.3", "8.2", "8.1", "8.0"];

const AVAILABLE_EXTENSIONS = [
  "apcu", "bcmath", "bz2", "curl", "dba", "enchant", "exif", "ffi", "gd", "gmp", "igbinary", "imagick", "imap", "intl",
  "ldap", "mbstring", "memcached", "mongodb", "msgpack", "mysqli", "odbc", "opcache", "pdo_mysql", "pdo_odbc", "pdo_pgsql",
  "pgsql", "pspell", "readline", "redis", "soap", "sockets", "sqlite3", "ssh2", "tidy", "uuid", "xdebug", "xml", "xmlrpc",
  "xsl", "yaml", "zip",
];

const BUSY = new Set(["installing", "removing", "pending"]);

export function PHPRuntimeTab({ machineId, machineName }: PHPRuntimeTabProps) {
  const confirm = useConfirm();
  const [busyHint, setBusyHint] = React.useState(false);
  const runtimeQ = usePolling<PHPRuntimeResponse>(() => api.getPHPRuntime(machineId), busyHint ? 3000 : 15000, { deps: [machineId] });
  const templatesQ = usePolling<PHPExtensionTemplate[]>(() => api.listPHPExtensionTemplates(), 0);
  const templates = React.useMemo(() => templatesQ.data ?? [], [templatesQ.data]);

  const runtime = runtimeQ.data?.runtime ?? null;
  const installed = !!runtimeQ.data?.installed;
  const busy = !!runtime && BUSY.has(runtime.status);

  React.useEffect(() => setBusyHint(busy), [busy]);

  const [version, setVersion] = React.useState("8.3");
  const [extensions, setExtensions] = React.useState<string[]>(["mysqli", "curl", "mbstring", "xml", "zip"]);
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  // Sync form from the server unless the user is editing.
  React.useEffect(() => {
    if (!runtime || dirty) return;
    setVersion(runtime.version);
    setExtensions(runtime.extensions ?? []);
  }, [runtime, dirty]);

  const run = async (kind: "install" | "update") => {
    setSubmitting(true);
    try {
      const res =
        kind === "install"
          ? await api.installPHPRuntime(machineId, version, extensions)
          : await api.updatePHPRuntime(machineId, version, extensions);
      setDirty(false);
      setBusyHint(true);
      void runtimeQ.refresh();
      if (res?.job_id)
        trackJob(res.job_id, {
          title: kind === "install" ? `Install PHP ${version}` : `Update PHP ${version}`,
          description: machineName,
          onDone: () => runtimeQ.refresh(),
        });
    } catch (e) {
      toast.error(kind === "install" ? "Couldn't start PHP install" : "Couldn't start PHP update", { description: errorMessage(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!runtime) return;
    const ok = await confirm({
      title: `Remove PHP ${runtime.version}?`,
      description: "PHP-FPM and its extensions are uninstalled. Sites routing .php to FPM will return 502 until PHP is reinstalled.",
      destructive: true,
      confirmText: "Remove PHP",
      icon: Trash2,
      onConfirm: async () => {
        const res = await api.removePHPRuntime(machineId);
        setBusyHint(true);
        if (res?.job_id) trackJob(res.job_id, { title: `Remove PHP ${runtime.version}`, description: machineName, onDone: () => runtimeQ.refresh() });
      },
    });
    if (ok) void runtimeQ.refresh();
  };

  if (runtimeQ.loading && !runtimeQ.data) return <CardSkeleton lines={6} />;
  if (runtimeQ.error && !runtimeQ.data) return <ErrorState error={runtimeQ.error} onRetry={runtimeQ.refresh} title="Couldn't load PHP runtime" />;

  const versionChanged = installed && runtime && runtime.version !== version;
  const template = templates.find((t) => t.id === templateId);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <SectionCard
          icon={Package}
          title={installed ? "Configure PHP-FPM" : "Install PHP-FPM"}
          description={installed ? "Change the version or the extension set. Applied as a job on the machine." : "Pick a version and extensions. Uses the ondrej/php PPA."}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {versionChanged ? `Switching ${runtime?.version} → ${version} removes the old version.` : installed ? "Only the differences are applied." : "Adds the PPA and installs php-fpm with the selected extensions."}
              </p>
              <div className="flex items-center gap-2">
                {dirty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDirty(false);
                      setTemplateId(null);
                    }}
                  >
                    <X />
                    Discard
                  </Button>
                )}
                <Button onClick={() => run(installed ? "update" : "install")} disabled={submitting || busy || (installed && !dirty)}>
                  {submitting ? <Spinner /> : installed ? <RefreshCw /> : <Download />}
                  {installed ? "Apply changes" : `Install PHP ${version}`}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Version</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={version}
                onValueChange={(v) => {
                  if (!v) return;
                  setVersion(v);
                  setDirty(true);
                }}
              >
                {PHP_VERSIONS.map((v) => (
                  <ToggleGroupItem key={v} value={v} className="font-data px-3">
                    {v}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Preset</Label>
                <Combobox
                  items={templates}
                  value={templateId}
                  onValueChange={(id, t) => {
                    setTemplateId(id);
                    if (t) {
                      setExtensions(t.extensions);
                      setDirty(true);
                    }
                  }}
                  getValue={(t) => t.id}
                  getLabel={(t) => t.name}
                  getKeywords={(t) => [t.description, ...t.extensions]}
                  renderItem={(t) => (
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{t.name}</span>
                        {t.is_default && <Badge variant="muted">default</Badge>}
                      </div>
                      <div className="font-data truncate text-[11px] text-muted-foreground">{t.extensions.join(", ")}</div>
                    </div>
                  )}
                  placeholder="Choose a preset…"
                  searchPlaceholder="Search presets or extensions…"
                  loading={templatesQ.loading}
                  clearable
                />
                {template?.description && <p className="text-xs text-muted-foreground">{template.description}</p>}
              </div>
              <div className="space-y-2">
                <Label>Extensions</Label>
                <MultiCombobox
                  items={AVAILABLE_EXTENSIONS}
                  value={extensions}
                  onValueChange={(ids) => {
                    setExtensions(ids);
                    setTemplateId(null);
                    setDirty(true);
                  }}
                  getValue={(e) => e}
                  getLabel={(e) => e}
                  renderItem={(e) => <span className="font-data">{e}</span>}
                  placeholder="Add extensions…"
                  searchPlaceholder="Search extensions…"
                  maxChips={0}
                />
              </div>
            </div>

            <div className="flex min-h-8 flex-wrap gap-1.5 rounded-lg border border-border bg-background/40 p-2">
              {extensions.length === 0 ? (
                <span className="px-1 text-xs text-muted-foreground">No extensions selected — only the PHP core is installed.</span>
              ) : (
                [...extensions].sort().map((e) => (
                  <span key={e} className="font-data inline-flex h-6 items-center gap-1 rounded-[4px] border border-border bg-surface-2/70 pr-1 pl-2 text-[11.5px]">
                    {e}
                    <button
                      type="button"
                      className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => {
                        setExtensions((xs) => xs.filter((x) => x !== e));
                        setTemplateId(null);
                        setDirty(true);
                      }}
                      aria-label={`Remove ${e}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="space-y-4">
        <SectionCard
          title="Runtime"
          actions={
            installed && runtime ? (
              <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
                <Trash2 />
                Remove
              </Button>
            ) : undefined
          }
        >
          {runtime ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="font-data text-2xl font-medium tracking-tight">PHP {runtime.version}</span>
                <StatusBadge status={runtime.status === "installing" || runtime.status === "removing" ? "running" : runtime.status} label={runtime.status} />
              </div>
              {runtime.status === "failed" && runtime.error_message && (
                <Alert variant="destructive">
                  <AlertTitle>Last operation failed</AlertTitle>
                  <AlertDescription className="font-data text-xs break-words">{runtime.error_message}</AlertDescription>
                </Alert>
              )}
              <KeyValueList
                labelWidth={96}
                items={[
                  { label: "FPM socket", value: runtime.socket_path ? <CopyableMono value={runtime.socket_path} /> : null },
                  { label: "Extensions", value: <span className="font-data">{runtime.extensions?.length ?? 0}</span> },
                  { label: "Installed", value: runtime.installed_at ? <RelativeTime date={runtime.installed_at} /> : null },
                  { label: "Updated", value: <RelativeTime date={runtime.updated_at} /> },
                ]}
              />
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">PHP is not installed on this machine.</p>
          )}
        </SectionCard>
        <SectionCard title="Nginx integration">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Locations with “Use PHP” enabled route <span className="font-data">.php</span> requests to{" "}
            <span className="font-data text-foreground">/run/php/php{version}-fpm.sock</span>. The socket path updates automatically when the
            version changes.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
