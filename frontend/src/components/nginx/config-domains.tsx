"use client";

import * as React from "react";
import Link from "next/link";
import { Globe, RefreshCw, ScrollText, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";

import { api, type NginxConfig, type NginxConfigApplyResult, type NginxConfigDomainRef } from "@/lib/api";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RelativeTime } from "@/components/app/data-display";
import { StatusBadge, type StatusTone } from "@/components/app/status";
import { Spinner, errorMessage } from "@/components/app/states";
import { openJobLogs, trackJob } from "@/components/app/jobs";
import { EditorSection } from "@/components/nginx/fields";

const APPLY_TONE: Record<string, StatusTone> = {
  applied: "success",
  applying: "info",
  removing: "info",
  pending: "muted",
  failed: "destructive",
};

export function ApplyStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-subtle-foreground">—</span>;
  return <StatusBadge status={status} tone={APPLY_TONE[status] ?? "muted"} size="sm" />;
}

/** Track every job an apply call returned; warn about skipped domains. */
export function handleApplyResult(res: NginxConfigApplyResult, onDone?: () => void) {
  const ok = res.results.filter((r) => !r.error);
  const errs = res.results.filter((r) => r.error);
  const many = ok.length > 3;
  let remaining = ok.length;
  for (const r of ok) {
    const ref = r.jobs?.[0] ?? r.job_id;
    if (!ref) {
      remaining--;
      continue;
    }
    void trackJob(ref, {
      title: `Apply nginx config · ${r.fqdn}`,
      quietSuccess: many,
      onDone: () => {
        remaining--;
        if (remaining <= 0) onDone?.();
      },
    });
  }
  if (many) toast.info(`Applying to ${ok.length} domains`, { description: "Progress is in the jobs indicator; failures stay visible." });
  if (errs.length)
    toast.warning(`${errs.length} domain${errs.length === 1 ? "" : "s"} skipped`, {
      description: errs
        .slice(0, 6)
        .map((e) => `${e.fqdn}: ${e.error}`)
        .join("\n"),
    });
  if (res.results.length === 0) toast.info("Nothing to apply", { description: "No assigned domains use this config." });
}

export function useApplyConfig(config: Pick<NginxConfig, "id"> | null, onDone?: () => void) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const apply = React.useCallback(
    async (opts: { domain_ids?: string[]; only_out_of_sync?: boolean } = {}, key = "all") => {
      if (!config) return;
      setBusy(key);
      try {
        const res = await api.applyNginxConfig(config.id, opts);
        handleApplyResult(res, onDone);
        onDone?.();
      } catch (e) {
        toast.error("Couldn't apply config", { description: errorMessage(e) });
      } finally {
        setBusy(null);
      }
    },
    [config, onDone]
  );
  return { apply, busy };
}

export function OutOfSyncBanner({ config, onApplied }: { config: NginxConfig; onApplied?: () => void }) {
  const { apply, busy } = useApplyConfig(config, onApplied);
  const n = config.out_of_sync_count ?? 0;
  if (n === 0) return null;
  return (
    <Alert variant="warning">
      <TriangleAlert />
      <AlertTitle>
        {n} domain{n === 1 ? "" : "s"} use{n === 1 ? "s" : ""} an older version of this config
      </AlertTitle>
      <AlertDescription>
        <p>Saving doesn&apos;t touch machines. Apply to render the new config on each machine — every apply is tested with nginx -t and rolled back on failure.</p>
      </AlertDescription>
      <AlertAction>
        <Button size="sm" onClick={() => void apply({ only_out_of_sync: true }, "sync")} disabled={!!busy}>
          {busy === "sync" ? <Spinner /> : <Upload />}
          Apply to {n} out-of-sync
        </Button>
        {(config.domains_count ?? 0) > n && (
          <Button size="sm" variant="outline" onClick={() => void apply({}, "all")} disabled={!!busy}>
            {busy === "all" ? <Spinner /> : <RefreshCw />}
            Re-apply all {config.domains_count}
          </Button>
        )}
      </AlertAction>
    </Alert>
  );
}

export function ConfigDomainsSection({ config, onApplied }: { config: NginxConfig | null; onApplied?: () => void }) {
  const { apply, busy } = useApplyConfig(config, onApplied);
  const domains = config?.domains ?? [];
  return (
    <EditorSection
      id="domains"
      title="Domains using this config"
      icon={Globe}
      description={config ? `${domains.length} domain${domains.length === 1 ? "" : "s"} · ${config.out_of_sync_count ?? 0} out of sync` : "Save the config, then assign it to domains."}
      actions={
        domains.length > 0 ? (
          <Button type="button" size="xs" variant="outline" onClick={() => void apply({}, "all")} disabled={!!busy}>
            {busy === "all" ? <Spinner /> : <Upload />}
            Apply to all
          </Button>
        ) : null
      }
    >
      {domains.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No domains use this config yet. Assign it from the{" "}
          <Link href="/domains" className="text-foreground underline-offset-2 hover:underline">
            domains page
          </Link>
          .
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">Machine</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Last applied</th>
                <th className="w-[90px] px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <DomainRow key={d.id} d={d} busy={busy === d.id} onApply={() => void apply({ domain_ids: [d.id] }, d.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EditorSection>
  );
}

function DomainRow({ d, busy, onApply }: { d: NginxConfigDomainRef; busy: boolean; onApply: () => void }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="max-w-0 px-3 py-2">
        <Link href={`/domains?q=${encodeURIComponent(d.fqdn)}`} className="font-data block truncate hover:underline underline-offset-2">
          {d.fqdn}
        </Link>
        {d.apply_status === "failed" && d.last_apply_error && (
          <div className="font-data truncate text-[11px] text-destructive/90" title={d.last_apply_error}>
            {d.last_apply_error}
          </div>
        )}
      </td>
      <td className="max-w-0 px-3 py-2">
        {d.machine_id ? (
          <Link href={`/machines/${d.machine_id}`} className="block truncate text-muted-foreground hover:text-foreground">
            {d.machine_title ?? d.machine_id.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-xs text-subtle-foreground">not assigned</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <ApplyStatusBadge status={d.apply_status} />
          {d.out_of_sync && <Badge variant="warning">out of sync</Badge>}
        </div>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
        <RelativeTime date={d.last_applied_at} />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-end gap-0.5">
          {d.last_job_id && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Last apply logs" onClick={() => openJobLogs(d.last_job_id!)}>
                  <ScrollText />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Last apply job</TooltipContent>
            </Tooltip>
          )}
          {d.machine_id && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" aria-label={`Apply to ${d.fqdn}`} onClick={onApply} disabled={busy}>
                  {busy ? <Spinner /> : <Upload />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Apply to this domain</TooltipContent>
            </Tooltip>
          )}
        </div>
      </td>
    </tr>
  );
}
