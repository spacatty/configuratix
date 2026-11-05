"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type Machine, type MachineGroupWithCount } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, MachinePicker, Spinner, errorMessage, useConfirm } from "@/components/app";
import { GroupChip } from "./group-chips";

const GROUP_EMOJIS = ["📁", "🖥️", "🌐", "🔧", "🚀", "⭐", "🔒", "📦", "🏢", "💻", "🛠️", "📡", "🔥", "💎", "🎯"];
// User-chosen group label colours (data, not UI status colours).
const GROUP_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#64748b"];

interface Draft {
  id: string | null;
  name: string;
  emoji: string;
  color: string;
  members: string[];
}

export function GroupsSheet({
  open,
  onOpenChange,
  groups,
  machines,
  onChanged,
  initialGroupId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: MachineGroupWithCount[];
  /** Member candidates; when omitted the picker loads all machines itself. */
  machines?: Machine[];
  onChanged?: () => void;
  /** Open straight into editing this group ("new" for a blank form). */
  initialGroupId?: string | null;
}) {
  const confirm = useConfirm();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const startEdit = React.useCallback(async (g: MachineGroupWithCount | null) => {
    if (!g) {
      setDraft({ id: null, name: "", emoji: "📁", color: GROUP_COLORS[0], members: [] });
      return;
    }
    setDraft({ id: g.id, name: g.name, emoji: g.emoji || "📁", color: g.color || GROUP_COLORS[0], members: [] });
    setLoadingMembers(true);
    try {
      const members = await api.getGroupMembers(g.id);
      setDraft((d) => (d && d.id === g.id ? { ...d, members: (members ?? []).map((m) => m.id) } : d));
    } catch (e) {
      toast.error("Couldn't load group members", { description: errorMessage(e) });
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    if (initialGroupId === "new") void startEdit(null);
    else if (initialGroupId) {
      const g = groups.find((x) => x.id === initialGroupId);
      if (g) void startEdit(g);
    } else setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialGroupId]);

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Group name is required");
      return;
    }
    setSaving(true);
    try {
      let id = draft.id;
      const body = { name: draft.name.trim(), emoji: draft.emoji, color: draft.color };
      if (id) await api.updateMachineGroup(id, body);
      else id = (await api.createMachineGroup(body)).id;
      await api.setGroupMembers(id, draft.members);
      toast.success(draft.id ? "Group saved" : "Group created", { description: `${draft.members.length} machine${draft.members.length === 1 ? "" : "s"}` });
      setDraft(null);
      onChanged?.();
    } catch (e) {
      toast.error("Couldn't save group", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: MachineGroupWithCount) => {
    const ok = await confirm({
      title: `Delete group “${g.name}”?`,
      description: "Machines stay where they are; pools that target this group lose those members.",
      destructive: true,
      confirmText: "Delete group",
      icon: Trash2,
      onConfirm: () => api.deleteMachineGroup(g.id),
    });
    if (ok) {
      toast.success("Group deleted");
      if (draft?.id === g.id) setDraft(null);
      onChanged?.();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {draft && (
              <Button variant="ghost" size="icon-xs" onClick={() => setDraft(null)} aria-label="Back to groups">
                <ArrowLeft />
              </Button>
            )}
            {draft ? (draft.id ? "Edit group" : "New group") : "Machine groups"}
          </SheetTitle>
          <SheetDescription>
            {draft ? "Name it, pick a colour and choose its members." : "Organise machines for passthrough pools, filters and bulk actions."}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!draft ? (
            groups.length === 0 ? (
              <EmptyState
                icon={FolderTree}
                title="No groups yet"
                description="Groups let you target sets of machines at once."
                action={
                  <Button size="sm" onClick={() => startEdit(null)}>
                    <Plus />
                    New group
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {groups.map((g) => (
                  <div key={g.id} className="group flex items-center gap-3 bg-card px-3 py-2.5 transition-colors hover:bg-surface-2/50">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => startEdit(g)}>
                      <GroupChip group={g} className="max-w-[220px] text-[12px]" />
                      <span className="font-data ml-auto text-xs text-muted-foreground">
                        {g.machine_count ?? 0} machine{(g.machine_count ?? 0) === 1 ? "" : "s"}
                      </span>
                    </button>
                    <Button variant="ghost" size="icon-xs" onClick={() => startEdit(g)} aria-label={`Edit ${g.name}`}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => remove(g)} aria-label={`Delete ${g.name}`}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="group-name">Name</Label>
                <Input
                  id="group-name"
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Frankfurt edge"
                  onKeyDown={(e) => e.key === "Enter" && save()}
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Icon</Label>
                  <div className="flex flex-wrap gap-1">
                    {GROUP_EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setDraft({ ...draft, emoji: e })}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md border text-sm transition-colors",
                          draft.emoji === e ? "border-border-strong bg-surface-2" : "border-transparent hover:bg-surface-2/60"
                        )}
                        aria-label={`Icon ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Colour</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {GROUP_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraft({ ...draft, color: c })}
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow",
                          draft.color === c && "ring-2 ring-foreground/60"
                        )}
                        style={{ backgroundColor: c }}
                        aria-label={`Colour ${c}`}
                      >
                        {draft.color === c && <Check className="size-3 text-white" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Members</Label>
                  <span className="font-data text-xs text-muted-foreground">{draft.members.length} selected</span>
                </div>
                <MachinePicker
                  multiple
                  machines={machines}
                  value={draft.members}
                  onValueChange={(ids) => setDraft({ ...draft, members: ids })}
                  groupBy="status"
                  maxChips={6}
                  placeholder={loadingMembers ? "Loading members…" : "Add machines…"}
                  disabled={loadingMembers}
                />
              </div>
              <div className="rounded-lg border border-dashed border-border p-3">
                <div className="mb-1.5 text-[11px] text-subtle-foreground">Preview</div>
                <GroupChip group={{ id: "preview", name: draft.name || "Group name", emoji: draft.emoji, color: draft.color }} />
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          {draft ? (
            <>
              <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || loadingMembers || !draft.name.trim()}>
                {saving ? <Spinner /> : <Check />}
                {draft.id ? "Save group" : "Create group"}
              </Button>
            </>
          ) : (
            <Button onClick={() => startEdit(null)}>
              <Plus />
              New group
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
