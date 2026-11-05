"use client";

import * as React from "react";
import { BookmarkPlus, HeartPulse, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { api, type Domain, type HealthCheckPreset, type HealthCheckRules, type HealthCheckSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyValueList, RelativeTime, Spinner, StatusBadge, errorMessage } from "@/components/app";

import {
  DEFAULT_CHECK_RULES,
  HEALTH_LABEL,
  describeRules,
  domainCustomRules,
  domainHealth,
  presetRules,
  rulesError,
  sameRules,
} from "./domain-utils";
import { HealthCheckRulesFields } from "./health-check-rules-fields";

export type RulesSource = "keep" | "preset" | "custom";

/** Preset vs custom rules (plus "keep current" for bulk edits), with the editor for the chosen one. */
export function RulesSourcePicker({
  source,
  onSourceChange,
  presetId,
  onPresetChange,
  rules,
  onRulesChange,
  presets,
  host,
  allowKeep,
  onManagePresets,
  onSaveAsPreset,
  disabled,
}: {
  source: RulesSource;
  onSourceChange: (s: RulesSource) => void;
  presetId: string | null;
  onPresetChange: (id: string) => void;
  rules: HealthCheckRules;
  onRulesChange: (r: HealthCheckRules) => void;
  presets: HealthCheckPreset[];
  host?: string;
  allowKeep?: boolean;
  onManagePresets: () => void;
  onSaveAsPreset?: () => void;
  disabled?: boolean;
}) {
  const preset = presets.find((p) => p.id === presetId) ?? null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={source}
          onValueChange={(v) => v && onSourceChange(v as RulesSource)}
          disabled={disabled}
        >
          {allowKeep && (
            <ToggleGroupItem value="keep" className="px-3 text-[12.5px]">
              Keep current
            </ToggleGroupItem>
          )}
          <ToggleGroupItem value="preset" className="px-3 text-[12.5px]">
            Preset
          </ToggleGroupItem>
          <ToggleGroupItem value="custom" className="px-3 text-[12.5px]">
            Custom
          </ToggleGroupItem>
        </ToggleGroup>
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onManagePresets}>
          <Settings2 />
          Manage presets
        </Button>
      </div>

      {source === "preset" &&
        (presets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-[13px] text-muted-foreground">
            No presets yet.{" "}
            <button type="button" className="text-foreground underline underline-offset-2" onClick={onManagePresets}>
              Create one
            </button>{" "}
            to share rules across domains that front the same service.
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="hc-preset">Preset</Label>
            <Select value={presetId ?? ""} onValueChange={onPresetChange} disabled={disabled}>
              <SelectTrigger id="hc-preset" className="w-full">
                <SelectValue placeholder="Choose a preset…" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="truncate">{p.name}</span>
                    <span className="font-data truncate text-[11.5px] text-muted-foreground">{describeRules(presetRules(p))}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset && (
              <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2.5">
                <KeyValueList
                  labelWidth={110}
                  items={[
                    { label: "Path", value: preset.path, mono: true },
                    { label: "Accepted", value: preset.expected_status.split(",").join(", "), mono: true },
                    { label: "Body contains", value: preset.body_contains, mono: true, hidden: !preset.body_contains },
                    { label: "Timeout", value: `${preset.timeout_seconds}s`, mono: true },
                    {
                      label: "Used by",
                      value: `${preset.domain_count} domain${preset.domain_count === 1 ? "" : "s"}`,
                    },
                  ]}
                />
              </div>
            )}
          </div>
        ))}

      {source === "custom" && (
        <>
          <HealthCheckRulesFields value={rules} onChange={onRulesChange} host={host} disabled={disabled} />
          {onSaveAsPreset && (
            <Button variant="outline" size="sm" onClick={onSaveAsPreset} disabled={disabled || !!rulesError(rules)}>
              <BookmarkPlus />
              Save as preset…
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** What to send for the chosen source, or null when nothing would change / the input is invalid. */
export function settingsFor(source: RulesSource, presetId: string | null, rules: HealthCheckRules): HealthCheckSettings | null {
  if (source === "preset") return presetId ? { preset_id: presetId } : null;
  if (source === "custom") return rulesError(rules) ? null : { rules: { ...rules, body_contains: rules.body_contains.trim() } };
  return null;
}

export interface HealthCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: Domain | null;
  presets: HealthCheckPreset[];
  /** Preset just created from the presets sheet; selected when it arrives. */
  newPresetId?: string | null;
  onChanged: () => void;
  /** Open the presets sheet; with rules, start a new preset from them. */
  onManagePresets: (fromRules?: HealthCheckRules) => void;
}

export function HealthCheckDialog({
  open,
  onOpenChange,
  domain,
  presets,
  newPresetId,
  onChanged,
  onManagePresets,
}: HealthCheckDialogProps) {
  const [source, setSource] = React.useState<RulesSource>("custom");
  const [presetId, setPresetId] = React.useState<string | null>(null);
  const [rules, setRules] = React.useState<HealthCheckRules>(DEFAULT_CHECK_RULES);
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [justChecked, setJustChecked] = React.useState(false);

  React.useEffect(() => {
    if (open && domain) {
      setSource(domain.health_check_preset_id ? "preset" : "custom");
      setPresetId(domain.health_check_preset_id ?? null);
      setRules(domainCustomRules(domain));
      setJustChecked(false);
    }
    // Re-sync only when the dialog opens for a domain, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, domain?.id]);

  React.useEffect(() => {
    if (open && newPresetId) {
      setSource("preset");
      setPresetId(newPresetId);
    }
  }, [open, newPresetId]);

  const settings = settingsFor(source, presetId, rules);
  const dirty =
    !!domain &&
    !!settings &&
    (source === "preset"
      ? presetId !== (domain.health_check_preset_id ?? null)
      : !!domain.health_check_preset_id || !sameRules(rules, domainCustomRules(domain)));
  const assigned = !!domain?.assigned_machine_id;

  const runCheck = async () => {
    if (!domain) return;
    setChecking(true);
    try {
      await api.triggerDomainHealthCheck(domain.id);
      setJustChecked(true);
      onChanged();
    } catch (e) {
      toast.error("Health check failed to run", { description: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  const save = async (andCheck: boolean) => {
    if (!domain || !settings) return;
    setSaving(true);
    try {
      await api.updateDomainHealthCheck(domain.id, settings);
      const preset = presets.find((p) => p.id === presetId);
      toast.success("Health check updated", {
        description: source === "preset" && preset ? `${domain.fqdn} uses “${preset.name}”` : `${domain.fqdn} · ${describeRules(rules)}`,
      });
      onChanged();
      if (andCheck) await runCheck();
      else onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't update health check", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const health = domain ? domainHealth(domain) : "unknown";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Health check</DialogTitle>
          <DialogDescription>
            An HTTPS request is sent to <span className="font-data text-foreground">{domain?.fqdn}</span>. It&apos;s healthy
            when the response matches the rules.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <KeyValueList
            labelWidth={110}
            items={[
              {
                label: "Current",
                value: (
                  <span className="inline-flex items-center gap-2">
                    <StatusBadge status={health === "unassigned" ? "unknown" : health} label={HEALTH_LABEL[health]} />
                    {justChecked && <span className="text-xs text-muted-foreground">just checked</span>}
                  </span>
                ),
              },
              { label: "Last check", value: <RelativeTime date={domain?.last_check_at} /> },
              {
                label: "Last response",
                value:
                  typeof domain?.last_check_status_code === "number" ? (
                    <span className="font-data">
                      HTTP {domain.last_check_status_code}
                      {typeof domain.last_check_response_ms === "number" && (
                        <span className="text-muted-foreground"> · {domain.last_check_response_ms} ms</span>
                      )}
                    </span>
                  ) : (
                    "—"
                  ),
                hidden: typeof domain?.last_check_status_code !== "number",
              },
              {
                label: "Last error",
                value: <span className="font-data text-[12px] text-destructive">{domain?.last_check_error}</span>,
                hidden: !domain?.last_check_error,
              },
            ]}
          />

          <div className="border-t border-border pt-4">
            <RulesSourcePicker
              source={source}
              onSourceChange={setSource}
              presetId={presetId}
              onPresetChange={setPresetId}
              rules={rules}
              onRulesChange={setRules}
              presets={presets}
              host={domain?.fqdn}
              onManagePresets={() => onManagePresets()}
              onSaveAsPreset={() => onManagePresets(rules)}
              disabled={saving}
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={runCheck}
            disabled={!assigned || checking || saving}
            title={!assigned ? "Assign the domain to a machine first" : undefined}
          >
            {checking ? <Spinner /> : <HeartPulse />}
            Check now
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Close
            </Button>
            <Button onClick={() => save(assigned)} disabled={!dirty || saving}>
              {saving && <Spinner />}
              Save{assigned ? " & check" : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
