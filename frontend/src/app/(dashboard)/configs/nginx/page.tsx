"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileCode, Plus, RefreshCw, Trash2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";

import { api, type NginxConfig } from "@/lib/api";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  EmptyState,
  ErrorState,
  FillPage,
  Metric,
  MetricBar,
  PageHeader,
  Spinner,
  errorMessage,
  invalidatePickerCache,
  useConfirm,
  usePolling,
} from "@/components/app";
import { buildConfigColumns } from "@/components/nginx/configs-table";
import { handleApplyResult } from "@/components/nginx/config-domains";

export default function NginxConfigsPage() {
  return (
    <Suspense>
      <NginxConfigsInner />
    </Suspense>
  );
}

function NginxConfigsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const confirm = useConfirm();

  // Legacy deep link: /configs/nginx?edit=<id> → /configs/nginx/<id>
  const editId = sp.get("edit");
  React.useEffect(() => {
    if (editId) router.replace(`/configs/nginx/${encodeURIComponent(editId)}`);
  }, [editId, router]);

  const { data, loading, error, refresh, refreshing } = usePolling(() => api.listNginxConfigs(), 30_000);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [applyingAll, setApplyingAll] = React.useState(false);

  const configs = React.useMemo(() => data ?? [], [data]);
  const outOfSync = configs.filter((c) => (c.out_of_sync_count ?? 0) > 0);
  const oosDomains = outOfSync.reduce((a, c) => a + (c.out_of_sync_count ?? 0), 0);

  const apply = React.useCallback(
    async (c: NginxConfig, onlyOutOfSync: boolean) => {
      const n = onlyOutOfSync ? (c.out_of_sync_count ?? 0) : (c.domains_count ?? 0);
      if (!onlyOutOfSync) {
        const ok = await confirm({
          title: `Re-apply “${c.name}” to ${n} domain${n === 1 ? "" : "s"}?`,
          description: "Each domain gets an apply job. Failed applies roll back automatically and nginx keeps running.",
          confirmText: `Apply to ${n}`,
          icon: Upload,
        });
        if (!ok) return;
      }
      setBusyId(c.id);
      try {
        const res = await api.applyNginxConfig(c.id, onlyOutOfSync ? { only_out_of_sync: true } : {});
        handleApplyResult(res, () => void refresh());
        void refresh();
      } catch (e) {
        toast.error("Couldn't apply config", { description: errorMessage(e) });
      } finally {
        setBusyId(null);
      }
    },
    [confirm, refresh]
  );

  const applyAllOutOfSync = async () => {
    setApplyingAll(true);
    try {
      for (const c of outOfSync) {
        try {
          const res = await api.applyNginxConfig(c.id, { only_out_of_sync: true });
          handleApplyResult(res, () => void refresh());
        } catch (e) {
          toast.error(`Couldn't apply ${c.name}`, { description: errorMessage(e) });
        }
      }
      void refresh();
    } finally {
      setApplyingAll(false);
    }
  };

  const duplicate = React.useCallback(
    async (c: NginxConfig) => {
      setBusyId(c.id);
      try {
        const names = new Set(configs.map((x) => x.name));
        let name = `${c.name} (copy)`;
        for (let i = 2; names.has(name); i++) name = `${c.name} (copy ${i})`;
        const created = await api.createNginxConfig({
          name,
          mode: c.mode,
          structured_json: c.mode === "manual" ? undefined : (c.structured_json ?? undefined),
          raw_text: c.mode === "manual" ? (c.raw_text ?? "") : undefined,
        });
        try {
          const rules = await api.listSecurityEndpointRules(c.id);
          for (const r of rules) await api.createSecurityEndpointRule(created.id, { pattern: r.pattern, description: r.description });
          const st = c.structured_json;
          if (st?.ua_blocking_enabled || st?.endpoint_blocking_enabled)
            await api.updateSecuritySettings(created.id, {
              ua_blocking_enabled: !!st.ua_blocking_enabled,
              endpoint_blocking_enabled: !!st.endpoint_blocking_enabled,
            });
        } catch {
          toast.warning("Copied without endpoint rules");
        }
        invalidatePickerCache("nginx-configs");
        toast.success(`Created “${name}”`, { action: { label: "Edit", onClick: () => router.push(`/configs/nginx/${created.id}`) } });
        void refresh();
      } catch (e) {
        toast.error("Couldn't duplicate config", { description: errorMessage(e) });
      } finally {
        setBusyId(null);
      }
    },
    [configs, refresh, router]
  );

  const remove = React.useCallback(
    async (c: NginxConfig) => {
      const domains = c.domains ?? [];
      const ok = await confirm({
        title: `Delete “${c.name}”?`,
        description:
          domains.length > 0
            ? `${domains.length} domain${domains.length === 1 ? " uses" : "s use"} this config. They lose their config link; files already on machines stay until the domain is re-applied or removed.`
            : "No domains use this config. This can't be undone.",
        details:
          domains.length > 0 ? (
            <ul className="font-data max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs">
              {domains.map((d) => (
                <li key={d.id} className="flex justify-between gap-3">
                  <span className="truncate">{d.fqdn}</span>
                  <span className="shrink-0 text-muted-foreground">{d.machine_title ?? "unassigned"}</span>
                </li>
              ))}
            </ul>
          ) : undefined,
        destructive: true,
        icon: Trash2,
        confirmText: "Delete config",
        typeToConfirm: domains.length > 0 ? c.name : undefined,
        onConfirm: () => api.deleteNginxConfig(c.id),
      });
      if (ok) {
        toast.success("Configuration deleted");
        invalidatePickerCache("nginx-configs");
        void refresh();
      }
    },
    [confirm, refresh]
  );

  const columns = React.useMemo(
    () =>
      buildConfigColumns({
        onEdit: (c) => router.push(`/configs/nginx/${c.id}`),
        onDuplicate: (c) => void duplicate(c),
        onApply: (c, only) => void apply(c, only),
        onDelete: (c) => void remove(c),
        busyId,
      }),
    [router, duplicate, apply, remove, busyId]
  );

  return (
    <FillPage>
      <PageHeader
        title="Nginx configs"
        stats={
          data && (
            <MetricBar>
              <Metric label="Configs" value={configs.length} />
              <Metric label="Out of sync" value={outOfSync.length} tone={outOfSync.length ? "warning" : "default"} hint={oosDomains ? `${oosDomains} domains` : undefined} />
            </MetricBar>
          )
        }
        actions={
          <>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? <Spinner /> : <RefreshCw />}
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/configs/nginx/new")}>
              <Plus />
              New config
            </Button>
          </>
        }
      />

      {outOfSync.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>
            {oosDomains} domain{oosDomains === 1 ? "" : "s"} across {outOfSync.length} config{outOfSync.length === 1 ? "" : "s"} run an older version
          </AlertTitle>
          <AlertDescription>
            <p>Saving a config doesn&apos;t push it. Apply to roll the changes out; failed applies roll back automatically.</p>
          </AlertDescription>
          <AlertAction>
            <Button size="sm" onClick={() => void applyAllOutOfSync()} disabled={applyingAll}>
              {applyingAll ? <Spinner /> : <Upload />}
              Apply all out-of-sync
            </Button>
          </AlertAction>
        </Alert>
      )}

      {error && !data ? (
        <ErrorState error={error} onRetry={refresh} title="Couldn't load nginx configs" />
      ) : (
        <DataTable
          fill
          columns={columns}
          data={configs}
          loading={loading}
          getRowId={(c) => c.id}
          searchKeys={["name", (c) => (c.domains ?? []).map((d) => d.fqdn).join(" ")]}
          searchPlaceholder="Search configs or domains…"
          facets={[
            {
              columnId: "kind",
              title: "Type",
              options: [
                { label: "L7 structured", value: "l7" },
                { label: "L4 passthrough", value: "l4" },
                { label: "Raw", value: "raw" },
              ],
            },
            {
              columnId: "ssl",
              title: "SSL",
              options: [
                { label: "Disabled", value: "disabled" },
                { label: "Allow HTTP", value: "allow_http" },
                { label: "Force HTTPS", value: "redirect_https" },
                { label: "HTTPS only", value: "https_only" },
                { label: "Backend (L4)", value: "backend" },
              ],
            },
          ]}
          initialState={{ sorting: [{ id: "updated", desc: true }] }}
          onRowClick={(c) => router.push(`/configs/nginx/${c.id}`)}
          emptyState={
            <EmptyState
              icon={FileCode}
              title="No nginx configs yet"
              description="Create a reverse proxy, static site or L4 passthrough template to assign to domains."
              action={
                <Button onClick={() => router.push("/configs/nginx/new")}>
                  <Plus />
                  New config
                </Button>
              }
            />
          }
        />
      )}
    </FillPage>
  );
}
