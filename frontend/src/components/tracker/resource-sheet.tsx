"use client";

import * as React from "react";
import { ExternalLink, Pencil, Save, Trash2 } from "lucide-react";
import type { TrackerItemWithCategory, TrackerResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { KeyValueList, Spinner } from "@/components/app";
import { FormField } from "@/components/security/form-field";
import { CategoryGlyph, Markdown } from "./bits";
import { formatCurrency } from "./utils";

export interface ResourcePayload {
  name: string;
  url: string | null;
  notes_md: string | null;
}

/**
 * View / edit / create a resource. `resource === null && open` → create mode.
 */
export function ResourceSheet({
  open,
  resource,
  startEditing,
  items,
  onOpenChange,
  onSave,
  onDelete,
  onOpenItem,
}: {
  open: boolean;
  resource: TrackerResource | null;
  startEditing?: boolean;
  items: TrackerItemWithCategory[];
  onOpenChange: (o: boolean) => void;
  onSave: (resource: TrackerResource | null, data: ResourcePayload) => Promise<void>;
  onDelete: (r: TrackerResource) => void;
  onOpenItem: (i: TrackerItemWithCategory) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setEditing(!resource || !!startEditing);
    setName(resource?.name ?? "");
    setUrl(resource?.url ?? "");
    setNotes(resource?.notes_md ?? "");
    setSubmitted(false);
  }, [open, resource, startEditing]);

  const linked = resource ? items.filter((i) => i.resource_id === resource.id) : [];
  const spend = linked.reduce((a, i) => a + (i.price_usd ?? 0), 0);
  const urlInvalid = !!url.trim() && !/^https?:\/\/\S+$/i.test(url.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim() || urlInvalid) return;
    setSaving(true);
    try {
      await onSave(resource, { name: name.trim(), url: url.trim() || null, notes_md: notes.trim() || null });
      if (resource) setEditing(false);
    } catch {
      // parent already toasted; stay in edit mode
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{resource ? (editing ? `Edit ${resource.name}` : resource.name) : "New resource"}</SheetTitle>
          <SheetDescription>
            {resource
              ? `${linked.length} linked ${linked.length === 1 ? "item" : "items"}`
              : "A provider, registrar or account that items are billed through."}
          </SheetDescription>
        </SheetHeader>

        {editing ? (
          <form id="tracker-resource-form" onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            <FormField label="Name" htmlFor="tr-name" required error={submitted && !name.trim() ? "Name is required" : undefined}>
              <Input id="tr-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Hetzner" />
            </FormField>
            <FormField label="URL" htmlFor="tr-url" error={urlInvalid ? "Must start with http:// or https://" : undefined} hint="Dashboard or billing page">
              <Input id="tr-url" className="font-data" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://accounts.hetzner.com" />
            </FormField>
            <FormField label="Notes" htmlFor="tr-notes" hint="Markdown supported">
              <Textarea id="tr-notes" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} className="resize-y text-[13px]" placeholder="Account email, support contacts, billing quirks…" />
            </FormField>
          </form>
        ) : resource ? (
          <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
            <KeyValueList
              items={[
                {
                  label: "URL",
                  value: resource.url ? (
                    <a href={resource.url} target="_blank" rel="noreferrer" className="font-data inline-flex items-center gap-1 hover:text-primary">
                      <span className="truncate">{resource.url}</span>
                      <ExternalLink className="size-3.5 shrink-0" />
                    </a>
                  ) : null,
                  copy: resource.url,
                },
                { label: "Linked spend", value: linked.length ? formatCurrency(spend) : null, mono: true },
              ]}
            />
            {resource.notes_md?.trim() && (
              <section className="space-y-2">
                <h3 className="text-[13px] font-medium">Notes</h3>
                <div className="rounded-md border border-border bg-surface-2/30 p-3">
                  <Markdown>{resource.notes_md}</Markdown>
                </div>
              </section>
            )}
            <section className="space-y-2">
              <h3 className="text-[13px] font-medium">Linked items</h3>
              {linked.length === 0 ? (
                <p className="text-xs text-muted-foreground">No items use this resource.</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                  {linked.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => onOpenItem(i)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2/60"
                      >
                        <CategoryGlyph icon={i.category_icon} color={i.category_color} className="size-5 text-[11px]" />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{i.name}</span>
                        <span className="font-data text-xs text-muted-foreground">{formatCurrency(i.price_usd)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        <SheetFooter className={resource && !editing ? "sm:justify-between" : undefined}>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => (resource ? setEditing(false) : onOpenChange(false))}>
                Cancel
              </Button>
              <Button type="submit" form="tracker-resource-form" disabled={saving}>
                {saving ? <Spinner /> : <Save />}
                {resource ? "Save changes" : "Create resource"}
              </Button>
            </>
          ) : resource ? (
            <>
              <Button variant="destructive" onClick={() => onDelete(resource)}>
                <Trash2 />
                Delete
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            </>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
