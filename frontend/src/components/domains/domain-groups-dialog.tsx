"use client";

import * as React from "react";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";

import { api, type Domain, type DomainGroupWithCount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MultiCombobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Spinner, errorMessage } from "@/components/app";

import { GroupChip } from "./group-chip";

export interface DomainGroupsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * One domain → "set" its memberships (add + remove).
   * Many → "add" to the chosen groups (existing memberships kept).
   */
  domains: Domain[];
  groups: DomainGroupWithCount[];
  /** Current memberships (domainId → groupIds). */
  membership: Record<string, string[]>;
  onChanged: () => void;
  onManageGroups: () => void;
}

export function GroupMultiPicker({
  groups,
  value,
  onValueChange,
  id,
  placeholder = "Select groups…",
}: {
  groups: DomainGroupWithCount[];
  value: string[];
  onValueChange: (ids: string[]) => void;
  id?: string;
  placeholder?: string;
}) {
  return (
    <MultiCombobox<DomainGroupWithCount>
      id={id}
      items={groups}
      value={value}
      onValueChange={(ids) => onValueChange(ids)}
      getValue={(g) => g.id}
      getLabel={(g) => g.name}
      renderItem={(g) => (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
          <span>{g.emoji}</span>
          <span className="min-w-0 flex-1 truncate">{g.name}</span>
          <span className="font-data text-[11px] text-muted-foreground">{g.domain_count ?? 0}</span>
        </span>
      )}
      renderChip={(g) => <GroupChip group={g} className="h-auto border-0 bg-transparent px-0" />}
      placeholder={placeholder}
      searchPlaceholder="Search groups…"
      emptyText="No groups match."
      className="w-full"
    />
  );
}

export function DomainGroupsDialog({
  open,
  onOpenChange,
  domains,
  groups,
  membership,
  onChanged,
  onManageGroups,
}: DomainGroupsDialogProps) {
  const single = domains.length === 1 ? domains[0] : null;
  const [value, setValue] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setValue(single ? (membership[single.id] ?? []) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      if (single) {
        await api.setDomainGroups(single.id, value);
        toast.success("Groups updated", { description: single.fqdn });
      } else {
        const ids = domains.map((d) => d.id);
        for (const gid of value) await api.addDomainGroupMembers(gid, ids);
        toast.success(`Added ${domains.length} domains to ${value.length} group${value.length === 1 ? "" : "s"}`);
      }
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't update groups", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{single ? "Groups" : `Add ${domains.length} domains to groups`}</DialogTitle>
          <DialogDescription>
            {single ? (
              <span className="font-data text-foreground">{single.fqdn}</span>
            ) : (
              "Existing memberships are kept; only new ones are added."
            )}
          </DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <EmptyState
            size="compact"
            icon={FolderPlus}
            title="No groups yet"
            description="Groups help you filter and bulk-manage domains."
            action={
              <Button
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onManageGroups();
                }}
              >
                Create a group
              </Button>
            }
          />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="group-picker">Groups</Label>
            <GroupMultiPicker id="group-picker" groups={groups} value={value} onValueChange={setValue} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || groups.length === 0 || (!single && value.length === 0)}>
            {saving && <Spinner />}
            {single ? "Save" : "Add to groups"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
