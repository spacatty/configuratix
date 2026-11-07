"use client";

import * as React from "react";
import { ChevronRight, HeartPulse } from "lucide-react";
import { toast } from "sonner";

import { api, type BulkHealthCheckResult, type Domain, type HealthCheckPreset, type HealthCheckRules } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner, StatusDot, errorMessage } from "@/components/app";
import { cn } from "@/lib/utils";

import { DEFAULT_CHECK_RULES, describeRules, domainCheckRules } from "./domain-utils";
import { CheckResponseDetails } from "./check-response";
import { RulesSourcePicker, settingsFor, type RulesSource } from "./health-check-dialog";

export interface BulkHealthCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domains: Domain[];
  presets: HealthCheckPreset[];
  /** Preset just created from the presets sheet; selected when it arrives. */
  newPresetId?: string | null;
  onChanged: () => void;
  onManagePresets: (fromRules?: HealthCheckRules) => void;
}

/** How the selection is checked today: "Storefront · 3", "Custom · 2". */
function currentMix(domains: Domain[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of domains) {
    const label = d.health_check_preset_id ? (d.health_check_preset_name ?? "Preset") : `Custom ${describeRules(domainCheckRules(d))}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function BulkHealthCheckDialog({
  open,
  onOpenChange,
  domains,
  presets,
  newPresetId,
  onChanged,
  onManagePresets,
}: BulkHealthCheckDialogProps) {
  const [source, setSource] = React.useState<RulesSource>("keep");
  const [presetId, setPresetId] = React.useState<string | null>(null);
  const [rules, setRules] = React.useState<HealthCheckRules>(DEFAULT_CHECK_RULES);
  const [run, setRun] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<BulkHealthCheckResult | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSource(presets.length ? "preset" : "keep");
    setPresetId(null);
    setRules(DEFAULT_CHECK_RULES);
    setRun(true);
    setResult(null);
    setExpanded(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (open && newPresetId) {
      setSource("preset");
      setPresetId(newPresetId);
    }
  }, [open, newPresetId]);

  const assigned = domains.filter((d) => d.assigned_machine_id).length;
  const settings = settingsFor(source, presetId, rules);
  const changes = source !== "keep";
  const canSubmit = !busy && domains.length > 0 && (changes ? !!settings : run && assigned > 0);
  const mix = React.useMemo(() => currentMix(domains), [domains]);
  const byId = React.useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);
  const n = domains.length;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.bulkHealthCheck(
        domains.map((d) => d.id),
        changes ? settings : null,
        run
      );
      onChanged();
      if (!run) {
        toast.success(`Health check updated on ${res.updated} domain${res.updated === 1 ? "" : "s"}`);
        onOpenChange(false);
        return;
      }
      setResult(res);
    } catch (e) {
      toast.error("Bulk health check failed", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const healthy = result?.results.filter((r) => r.status === "healthy") ?? [];
  const failing = result?.results.filter((r) => r.status !== "healthy") ?? [];

  const submitLabel = changes ? (run ? "Apply & check" : "Apply") : "Run check";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Health check · {n} domain{n === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Check finished. Statuses in the table are updated."
              : "Assign a preset or custom rules to the selection, run a check, or both."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-[13px]">
              <span className="inline-flex items-center gap-1.5">
                <StatusDot status="healthy" pulse={false} />
                <span className="font-data">{healthy.length}</span> healthy
              </span>
              <span className="inline-flex items-center gap-1.5">
                <StatusDot status="unhealthy" pulse={false} />
                <span className="font-data">{failing.length}</span> not healthy
              </span>
              {result.updated > 0 && (
                <span className="text-muted-foreground">
                  · rules updated on <span className="font-data">{result.updated}</span>
                </span>
              )}
            </div>
            {failing.length > 0 && (
              <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {failing.map((r) => {
                  const d = byId.get(r.id);
                  const hasResponse = !r.error && typeof d?.last_check_status_code === "number";
                  const isOpen = expanded === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        disabled={!hasResponse}
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left enabled:hover:bg-accent/50"
                        aria-expanded={hasResponse ? isOpen : undefined}
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-muted-foreground transition-transform",
                            isOpen && "rotate-90",
                            !hasResponse && "invisible"
                          )}
                        />
                        <StatusDot status="unhealthy" pulse={false} />
                        <span className="font-data min-w-0 flex-1 truncate text-[12.5px]">{d?.fqdn ?? r.id}</span>
                        <span className="font-data max-w-[55%] shrink-0 truncate text-[12px] text-muted-foreground" title={r.error ?? d?.last_check_error ?? undefined}>
                          {r.error ??
                            d?.last_check_error ??
                            (typeof d?.last_check_status_code === "number" ? `HTTP ${d.last_check_status_code}` : r.status)}
                        </span>
                      </button>
                      {isOpen && d && (
                        <div className="px-3 pb-3">
                          <CheckResponseDetails domainId={d.id} checkedAt={d.last_check_at} defaultOpen />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {n - assigned > 0 && (
              <p className="text-xs text-muted-foreground">
                {n - assigned} unassigned domain{n - assigned === 1 ? " wasn't" : "s weren't"} checked.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Checked with today</div>
              <div className="flex flex-wrap gap-1.5">
                {mix.slice(0, 6).map((m) => (
                  <span
                    key={m.label}
                    className="font-data inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-border bg-surface-2/40 px-2 py-0.5 text-[11.5px]"
                  >
                    <span className="truncate">{m.label}</span>
                    <span className="text-muted-foreground">×{m.count}</span>
                  </span>
                ))}
                {mix.length > 6 && <span className="text-xs text-muted-foreground">+{mix.length - 6} more</span>}
              </div>
            </div>

            <RulesSourcePicker
              source={source}
              onSourceChange={setSource}
              presetId={presetId}
              onPresetChange={setPresetId}
              rules={rules}
              onRulesChange={setRules}
              presets={presets}
              allowKeep
              onManagePresets={() => onManagePresets()}
              onSaveAsPreset={() => onManagePresets(rules)}
              disabled={busy}
            />

            <div className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2.5">
              <div>
                <Label htmlFor="bulk-hc-run" className="text-[13px]">
                  Run check now
                </Label>
                <p className="text-xs text-muted-foreground">
                  {assigned === n
                    ? `Probes all ${n} domains, 8 at a time.`
                    : `Probes the ${assigned} assigned domain${assigned === 1 ? "" : "s"}; ${n - assigned} unassigned ${n - assigned === 1 ? "is" : "are"} skipped.`}
                </p>
              </div>
              <Switch id="bulk-hc-run" checked={run} onCheckedChange={setRun} disabled={busy} />
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!canSubmit}>
                {busy ? <Spinner /> : <HeartPulse />}
                {busy && run ? `Checking ${assigned}…` : submitLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
