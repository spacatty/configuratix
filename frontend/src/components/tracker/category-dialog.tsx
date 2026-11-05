"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { api, type TrackerCategoryWithCount, type TrackerTag } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner, errorMessage, useConfirm } from "@/components/app";
import { FormField } from "@/components/security/form-field";
import { cn } from "@/lib/utils";
import { CategoryGlyph, ColorSwatches, TagChip } from "./bits";
import { CATEGORY_EMOJIS, DEFAULT_COLOR, PALETTE } from "./utils";

export interface CategoryPayload {
  name: string;
  icon: string;
  color: string;
  notify_days_before: number;
  identifier_label?: string;
}

type Staged = { name: string; color: string };

export function CategoryDialog({
  open,
  category,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  category: TrackerCategoryWithCount | null;
  onOpenChange: (o: boolean) => void;
  onSave: (category: TrackerCategoryWithCount | null, data: CategoryPayload, staged: Staged[]) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState("📁");
  const [color, setColor] = React.useState(DEFAULT_COLOR);
  const [notifyDays, setNotifyDays] = React.useState("3");
  const [idLabel, setIdLabel] = React.useState("");
  const [tags, setTags] = React.useState<TrackerTag[]>([]);
  const [staged, setStaged] = React.useState<Staged[]>([]);
  const [newTag, setNewTag] = React.useState("");
  const [tagBusy, setTagBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setIcon(category?.icon ?? "📁");
    setColor(category?.color ?? DEFAULT_COLOR);
    setNotifyDays(String(category?.notify_days_before ?? 3));
    setIdLabel(category?.identifier_label ?? "");
    setStaged([]);
    setNewTag("");
    setTags([]);
    if (category) api.listTrackerCategoryTags(category.id).then(setTags).catch(() => setTags([]));
  }, [open, category]);

  const nextColor = () => PALETTE[(tags.length + staged.length) % PALETTE.length];
  const days = Number(notifyDays);
  const daysInvalid = !Number.isInteger(days) || days < 0 || days > 365;

  const addTag = async () => {
    const n = newTag.trim();
    if (!n) return;
    if ([...tags, ...staged].some((t) => t.name.toLowerCase() === n.toLowerCase())) {
      toast.error(`Tag “${n}” already exists`);
      return;
    }
    if (!category) {
      setStaged((p) => [...p, { name: n, color: nextColor() }]);
      setNewTag("");
      return;
    }
    setTagBusy(true);
    try {
      const t = await api.createTrackerCategoryTag(category.id, { name: n, color: nextColor() });
      setTags((p) => [...p, t]);
      setNewTag("");
    } catch (e) {
      toast.error("Couldn't add tag", { description: errorMessage(e) });
    } finally {
      setTagBusy(false);
    }
  };

  const deleteTag = async (t: TrackerTag) => {
    const ok = await confirm({
      title: `Delete tag “${t.name}”?`,
      description: "It's removed from every item in this category.",
      destructive: true,
      confirmText: "Delete tag",
      onConfirm: () => api.deleteTrackerTag(t.id),
    });
    if (ok) setTags((p) => p.filter((x) => x.id !== t.id));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || daysInvalid) return;
    setSaving(true);
    try {
      await onSave(
        category,
        { name: name.trim(), icon, color, notify_days_before: days, identifier_label: idLabel.trim() || undefined },
        staged
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <CategoryGlyph icon={icon} color={color} />
            {category ? `Edit ${category.name}` : "New category"}
          </DialogTitle>
          <DialogDescription>Groups items, sets reminder timing and what the identifier field means.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <FormField label="Name" htmlFor="tc-name" required>
              <Input id="tc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Servers" />
            </FormField>
            <FormField label="Remind" htmlFor="tc-days" error={daysInvalid ? "0 – 365" : undefined}>
              <div className="flex items-center gap-1.5">
                <Input id="tc-days" type="number" min={0} max={365} className="font-data" value={notifyDays} onChange={(e) => setNotifyDays(e.target.value)} />
                <span className="shrink-0 text-xs text-muted-foreground">days before</span>
              </div>
            </FormField>
          </div>
          <FormField label="Identifier label" htmlFor="tc-ident" hint="What the identifier field holds for items here — e.g. IP, Domain, Account ID.">
            <Input id="tc-ident" value={idLabel} onChange={(e) => setIdLabel(e.target.value)} placeholder="Identifier" />
          </FormField>
          <FormField label="Icon">
            <div className="flex flex-wrap gap-1">
              {CATEGORY_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setIcon(em)}
                  aria-pressed={icon === em}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md border text-base transition-colors",
                    icon === em ? "border-primary/60 bg-primary/10" : "border-transparent hover:bg-accent"
                  )}
                >
                  {em}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Colour">
            <ColorSwatches value={color} onChange={setColor} />
          </FormField>

          <FormField label="Tags" hint={category ? "Click a tag to rename or recolour it. Changes save immediately." : "Created together with the category."}>
            <div className="space-y-2 rounded-md border border-border p-2">
              <div className="flex min-h-6 flex-wrap gap-1.5">
                {category
                  ? tags.map((t) => <EditableTag key={t.id} tag={t} onUpdated={(u) => setTags((p) => p.map((x) => (x.id === u.id ? u : x)))} onDelete={() => deleteTag(t)} />)
                  : staged.map((t, i) => (
                      <TagChip key={`${t.name}-${i}`} name={t.name} color={t.color} onRemove={() => setStaged((p) => p.filter((_, j) => j !== i))} />
                    ))}
                {(category ? tags.length : staged.length) === 0 && <span className="text-xs text-muted-foreground">No tags yet</span>}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="New tag name, press Enter"
                  className="h-7 text-xs"
                />
                <Button type="button" size="sm" variant="secondary" onClick={addTag} disabled={!newTag.trim() || tagBusy}>
                  {tagBusy ? <Spinner /> : <Plus />}
                  Add
                </Button>
              </div>
            </div>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || daysInvalid}>
              {saving ? <Spinner /> : <Save />}
              {category ? "Save changes" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditableTag({ tag, onUpdated, onDelete }: { tag: TrackerTag; onUpdated: (t: TrackerTag) => void; onDelete: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(tag.name);
  const [color, setColor] = React.useState(tag.color);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(tag.name);
      setColor(tag.color);
    }
  }, [open, tag]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const u = await api.updateTrackerTag(tag.id, { name: name.trim(), color });
      onUpdated(u);
      setOpen(false);
    } catch (e) {
      toast.error("Couldn't update tag", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          <TagChip name={tag.name} color={tag.color} className="cursor-pointer hover:brightness-125" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3 p-3" align="start">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className="h-7 text-xs"
          autoFocus
        />
        <ColorSwatches value={color} onChange={setColor} size="sm" />
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 />
            Delete
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : <Save />}
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type { Staged as StagedTag };
