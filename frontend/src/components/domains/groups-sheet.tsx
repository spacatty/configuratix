"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, type Domain, type DomainGroupWithCount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DomainPicker, EmptyState, Spinner, errorMessage, useConfirm } from "@/components/app";
import { cn } from "@/lib/utils";

const EMOJIS = ["📁", "🌐", "🚀", "⭐", "🔒", "📦", "🏢", "💻", "🛠️", "📡", "🔥", "💎", "🎯", "🧪"];
const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#64748b"];

export interface GroupsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DomainGroupWithCount[];
  domains: Domain[];
  /** Pre-open the editor for this group (or "new"). */
  initialEdit?: string | "new" | null;
  onChanged: () => void;
}

type Draft = { id: string | null; name: string; emoji: string; color: string; members: string[] };

export function GroupsSheet({ open, onOpenChange, groups, domains, initialEdit, onChanged }: GroupsSheetProps) {
  const confirm = useConfirm();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [order, setOrder] = React.useState<DomainGroupWithCount[]>(groups);

  React.useEffect(() => setOrder([...groups].sort((a, b) => a.position - b.position)), [groups]);

  const startEdit = React.useCallback(async (g: DomainGroupWithCount | null) => {
    if (!g) {
      setDraft({ id: null, name: "", emoji: "📁", color: COLORS[0], members: [] });
      return;
    }
    setDraft({ id: g.id, name: g.name, emoji: g.emoji, color: g.color, members: [] });
    setLoadingMembers(true);
    try {
      const members = await api.getDomainGroupMembers(g.id);
      setDraft((d) => (d && d.id === g.id ? { ...d, members: members.map((m) => m.id) } : d));
    } catch (e) {
      toast.error("Couldn't load group members", { description: errorMessage(e) });
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) {
      setDraft(null);
      return;
    }
    if (initialEdit === "new") void startEdit(null);
    else if (initialEdit) {
      const g = groups.find((x) => x.id === initialEdit);
      if (g) void startEdit(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialEdit]);

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: draft.name.trim(), emoji: draft.emoji, color: draft.color };
      let id = draft.id;
      if (id) await api.updateDomainGroup(id, payload);
      else id = (await api.createDomainGroup(payload)).id;
      if (id) await api.setDomainGroupMembers(id, draft.members);
      toast.success(draft.id ? "Group saved" : "Group created", { description: payload.name });
      setDraft(null);
      onChanged();
    } catch (e) {
      toast.error("Couldn't save group", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: DomainGroupWithCount) => {
    const ok = await confirm({
      title: `Delete group “${g.name}”?`,
      description: "Domains in the group are not affected.",
      destructive: true,
      confirmText: "Delete group",
      onConfirm: () => api.deleteDomainGroup(g.id),
    });
    if (ok) {
      toast.success("Group deleted");
      if (draft?.id === g.id) setDraft(null);
      onChanged();
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...order];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setOrder(next);
    try {
      await api.reorderDomainGroups(next.map((g) => g.id));
      onChanged();
    } catch (e) {
      toast.error("Couldn't reorder groups", { description: errorMessage(e) });
      setOrder(order);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Domain groups</SheetTitle>
          <SheetDescription>Organise domains for filtering and bulk actions. Order sets the filter order.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {draft ? (
            <div className="animate-fade-in-up space-y-4 rounded-lg border border-border bg-surface-2/40 p-4">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium">{draft.id ? "Edit group" : "New group"}</div>
                <Button variant="ghost" size="xs" onClick={() => setDraft(null)} disabled={saving}>
                  Cancel
                </Button>
              </div>
              <div className="flex items-end gap-3">
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-lg"
                  style={{ backgroundColor: `${draft.color}22` }}
                >
                  {draft.emoji}
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="group-name">Name</Label>
                  <Input
                    id="group-name"
                    autoFocus
                    value={draft.name}
                    placeholder="Production, Landing pages…"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && void save()}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Icon</Label>
                  <div className="flex flex-wrap gap-1">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setDraft({ ...draft, emoji: e })}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md border text-sm transition-colors",
                          draft.emoji === e ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent"
                        )}
                        aria-label={`Icon ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Colour</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraft({ ...draft, color: c })}
                        className={cn(
                          "size-6 rounded-md ring-offset-2 ring-offset-background transition-transform",
                          draft.color === c ? "ring-2 ring-foreground" : "hover:scale-110"
                        )}
                        style={{ backgroundColor: c }}
                        aria-label={`Colour ${c}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="group-members">
                  Domains <span className="font-data text-muted-foreground">({draft.members.length})</span>
                </Label>
                <DomainPicker
                  id="group-members"
                  multiple
                  domains={domains}
                  value={draft.members}
                  onValueChange={(ids) => setDraft({ ...draft, members: ids })}
                  disabled={loadingMembers}
                  placeholder={loadingMembers ? "Loading members…" : "Select domains…"}
                  maxChips={4}
                  className="w-full"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving || !draft.name.trim()}>
                  {saving && <Spinner />}
                  {draft.id ? "Save group" : "Create group"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full border-dashed" onClick={() => void startEdit(null)}>
              <Plus />
              New group
            </Button>
          )}

          {order.length === 0 ? (
            !draft && (
              <EmptyState
                icon={FolderOpen}
                size="compact"
                title="No groups yet"
                description="Create one to filter domains by project, customer or environment."
              />
            )
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {order.map((g, i) => (
                <li
                  key={g.id}
                  className={cn("group/row flex items-center gap-3 px-3 py-2", draft?.id === g.id && "bg-accent/50")}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                  <span className="text-base leading-none">{g.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{g.name}</span>
                  <span className="font-data text-xs text-muted-foreground">{g.domain_count ?? 0}</span>
                  <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover/row:opacity-100">
                    <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Move down"
                      disabled={i === order.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Edit" onClick={() => void startEdit(g)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Delete" onClick={() => remove(g)}>
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
