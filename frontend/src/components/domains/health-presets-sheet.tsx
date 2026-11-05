"use client";

import * as React from "react";
import { HeartPulse, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, type HealthCheckPreset, type HealthCheckRules } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, Spinner, errorMessage, useConfirm } from "@/components/app";
import { cn } from "@/lib/utils";

import { DEFAULT_CHECK_RULES, describeRules, presetRules, rulesError } from "./domain-utils";
import { HealthCheckRulesFields } from "./health-check-rules-fields";

export interface HealthPresetsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: HealthCheckPreset[];
  /** Pre-open the editor for this preset (or "new"). */
  initialEdit?: string | "new" | null;
  /** Rules to start a new preset from (e.g. a domain's custom rules). */
  initialRules?: HealthCheckRules | null;
  onChanged: (saved?: HealthCheckPreset) => void;
}

type Draft = { id: string | null; name: string; description: string; rules: HealthCheckRules };

export function HealthPresetsSheet({ open, onOpenChange, presets, initialEdit, initialRules, onChanged }: HealthPresetsSheetProps) {
  const confirm = useConfirm();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);

  const startEdit = React.useCallback(
    (p: HealthCheckPreset | null) =>
      setDraft(
        p
          ? { id: p.id, name: p.name, description: p.description ?? "", rules: presetRules(p) }
          : { id: null, name: "", description: "", rules: initialRules ?? DEFAULT_CHECK_RULES }
      ),
    [initialRules]
  );

  React.useEffect(() => {
    if (!open) {
      setDraft(null);
      return;
    }
    if (initialEdit === "new") startEdit(null);
    else if (initialEdit) {
      const p = presets.find((x) => x.id === initialEdit);
      if (p) startEdit(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialEdit]);

  const err = draft ? (draft.name.trim() ? rulesError(draft.rules) : "Name is required.") : null;

  const save = async () => {
    if (!draft || err) return;
    setSaving(true);
    try {
      const input = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        path: draft.rules.path,
        expected_status: draft.rules.expected,
        body_contains: draft.rules.body_contains.trim(),
        timeout_seconds: draft.rules.timeout_seconds,
      };
      const saved = draft.id
        ? await api.updateHealthCheckPreset(draft.id, input)
        : await api.createHealthCheckPreset(input);
      toast.success(draft.id ? "Preset saved" : "Preset created", {
        description: draft.id && saved.domain_count ? `${saved.domain_count} domain${saved.domain_count === 1 ? "" : "s"} use it` : saved.name,
      });
      setDraft(null);
      onChanged(saved);
    } catch (e) {
      toast.error("Couldn't save preset", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: HealthCheckPreset) => {
    const ok = await confirm({
      title: `Delete preset “${p.name}”?`,
      description: p.domain_count
        ? `${p.domain_count} domain${p.domain_count === 1 ? "" : "s"} use it. They fall back to their own custom rules.`
        : "No domains use it.",
      destructive: true,
      confirmText: "Delete preset",
      onConfirm: () => api.deleteHealthCheckPreset(p.id),
    });
    if (ok) {
      toast.success("Preset deleted");
      if (draft?.id === p.id) setDraft(null);
      onChanged();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Health check presets</SheetTitle>
          <SheetDescription>
            Shared rule sets for domains that front the same service. Editing a preset changes the check for every domain
            using it.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {draft ? (
            <div className="animate-fade-in-up space-y-4 rounded-lg border border-border bg-surface-2/40 p-4">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium">{draft.id ? "Edit preset" : "New preset"}</div>
                <Button variant="ghost" size="xs" onClick={() => setDraft(null)} disabled={saving}>
                  Cancel
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="preset-name">Name</Label>
                  <Input
                    id="preset-name"
                    autoFocus
                    value={draft.name}
                    placeholder="Storefront API, Landing…"
                    maxLength={100}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="preset-description">
                    Description <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="preset-description"
                    value={draft.description}
                    placeholder="What the service is"
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
              </div>
              <HealthCheckRulesFields
                idPrefix="preset"
                value={draft.rules}
                onChange={(rules) => setDraft({ ...draft, rules })}
                disabled={saving}
              />
              <div className="flex items-center justify-end gap-3">
                {draft.name.trim() && err && <span className="text-xs text-destructive">{err}</span>}
                <Button onClick={save} disabled={saving || !!err}>
                  {saving && <Spinner />}
                  {draft.id ? "Save preset" : "Create preset"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full border-dashed" onClick={() => startEdit(null)}>
              <Plus />
              New preset
            </Button>
          )}

          {presets.length === 0 ? (
            !draft && (
              <EmptyState
                icon={HeartPulse}
                size="compact"
                title="No presets yet"
                description="Create one per backend service, then assign it to every domain that proxies to it."
              />
            )
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {presets.map((p) => (
                <li key={p.id} className={cn("group/row flex items-center gap-3 px-3 py-2.5", draft?.id === p.id && "bg-accent/50")}>
                  <HeartPulse className="size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{p.name}</div>
                    <div className="font-data truncate text-[11.5px] text-muted-foreground">{describeRules(presetRules(p))}</div>
                    {p.description && <div className="truncate text-xs text-subtle-foreground">{p.description}</div>}
                  </div>
                  <span
                    className="font-data shrink-0 text-xs text-muted-foreground"
                    title={`${p.domain_count} domain${p.domain_count === 1 ? "" : "s"}`}
                  >
                    {p.domain_count} {p.domain_count === 1 ? "domain" : "domains"}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover/row:opacity-100">
                    <Button variant="ghost" size="icon-xs" aria-label={`Edit ${p.name}`} onClick={() => startEdit(p)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <SheetFooter className="border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
