"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { api, type TrackerCategoryWithCount, type TrackerResource, type TrackerTag } from "@/lib/api";
import { Combobox, MultiCombobox } from "@/components/ui/combobox";
import { CommandItem } from "@/components/ui/command";
import { Spinner, errorMessage } from "@/components/app";
import { CategoryGlyph, TagChip } from "./bits";
import { PALETTE } from "./utils";

function CreateItem({ label, onCreate, busy }: { label: React.ReactNode; onCreate: () => void; busy?: boolean }) {
  return (
    <CommandItem value="__create__" forceMount onSelect={onCreate} disabled={busy} className="gap-2 text-primary">
      {busy ? <Spinner className="size-3.5" /> : <Plus className="size-3.5 text-primary!" />}
      <span className="truncate">{label}</span>
    </CommandItem>
  );
}

/* -------------------------------------------------------------------------- */
/* Resource                                                                   */
/* -------------------------------------------------------------------------- */

export function ResourcePicker({
  resources,
  value,
  onValueChange,
  onCreated,
  invalid,
}: {
  resources: TrackerResource[];
  value: string | null;
  onValueChange: (id: string | null) => void;
  onCreated: (r: TrackerResource) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const trimmed = q.trim();
  const exists = resources.some((r) => r.name.toLowerCase() === trimmed.toLowerCase());

  const create = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const r = await api.createTrackerResource({ name: trimmed });
      onCreated(r);
      onValueChange(r.id);
      toast.success(`Resource “${r.name}” created`);
      setOpen(false);
    } catch (e) {
      toast.error("Couldn't create resource", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Combobox
      items={resources}
      getValue={(r) => r.id}
      getLabel={(r) => r.name}
      getKeywords={(r) => [r.url, r.notes_md?.slice(0, 120)]}
      renderItem={(r) => (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">{r.name}</span>
          {r.url && <span className="font-data truncate text-[11px] text-muted-foreground">{r.url.replace(/^https?:\/\//, "")}</span>}
        </div>
      )}
      value={value}
      onValueChange={(id) => onValueChange(id)}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
      onSearchChange={setQ}
      placeholder="Choose or create a provider…"
      searchPlaceholder="Search resources or type a new name…"
      emptyText={trimmed ? "No match — create it below." : "No resources yet. Type a name to create one."}
      aria-invalid={invalid}
      footer={trimmed && !exists ? <CreateItem label={<>Create “{trimmed}”</>} onCreate={create} busy={busy} /> : null}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Category                                                                   */
/* -------------------------------------------------------------------------- */

export function CategoryPicker({
  categories,
  value,
  onValueChange,
}: {
  categories: TrackerCategoryWithCount[];
  value: string | null;
  onValueChange: (id: string | null) => void;
}) {
  return (
    <Combobox
      items={categories}
      getValue={(c) => c.id}
      getLabel={(c) => c.name}
      getKeywords={(c) => [c.identifier_label]}
      renderItem={(c) => (
        <span className="flex items-center gap-2">
          <CategoryGlyph icon={c.icon} color={c.color} className="size-5 text-[11px]" />
          <span className="truncate">{c.name}</span>
          <span className="font-data ml-auto text-[11px] text-subtle-foreground">{c.item_count}</span>
        </span>
      )}
      renderValue={(c) => (
        <span className="flex items-center gap-2">
          <span>{c.icon}</span>
          {c.name}
        </span>
      )}
      value={value}
      onValueChange={(id) => onValueChange(id)}
      clearable
      placeholder="Uncategorized"
      searchPlaceholder="Search categories…"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Tags (multi, with inline create)                                           */
/* -------------------------------------------------------------------------- */

export function TagPicker({
  categoryId,
  tags,
  value,
  onValueChange,
  onCreated,
}: {
  categoryId: string;
  tags: TrackerTag[];
  value: string[];
  onValueChange: (ids: string[]) => void;
  onCreated: (t: TrackerTag) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const trimmed = q.trim();
  const exists = tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const create = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const color = PALETTE[tags.length % PALETTE.length];
      const t = await api.createTrackerCategoryTag(categoryId, { name: trimmed, color });
      onCreated(t);
      onValueChange([...value, t.id]);
      setQ("");
    } catch (e) {
      toast.error("Couldn't create tag", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <MultiCombobox
      items={tags}
      getValue={(t) => t.id}
      getLabel={(t) => t.name}
      renderItem={(t) => <TagChip name={t.name} color={t.color} />}
      renderChip={(t) => (
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
          {t.name}
        </span>
      )}
      value={value}
      onValueChange={(ids) => onValueChange(ids)}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
      onSearchChange={setQ}
      maxChips={4}
      showBulkActions={false}
      placeholder="Add tags…"
      searchPlaceholder="Search or create a tag…"
      emptyText={trimmed ? "No match — create it below." : "No tags in this category yet."}
      footer={trimmed && !exists ? <CreateItem label={<>Create tag “{trimmed}”</>} onCreate={create} busy={busy} /> : null}
    />
  );
}
