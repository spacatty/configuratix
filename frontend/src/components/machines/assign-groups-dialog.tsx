"use client";

import * as React from "react";
import { toast } from "sonner";
import { Tags } from "lucide-react";
import { api, type MachineGroupWithCount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MultiCombobox } from "@/components/ui/combobox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner, errorMessage, machineDisplayName } from "@/components/app";
import { groupRefs, type FleetMachine } from "./utils";
import { GroupChip } from "./group-chips";

type Mode = "set" | "add" | "remove";

export function AssignGroupsDialog({
  open,
  onOpenChange,
  machines,
  groups,
  onDone,
  onManageGroups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machines: FleetMachine[];
  groups: MachineGroupWithCount[];
  onDone?: () => void;
  onManageGroups?: () => void;
}) {
  const single = machines.length === 1 ? machines[0] : null;
  const [mode, setMode] = React.useState<Mode>("set");
  const [value, setValue] = React.useState<string[]>([]);
  const [loadingCurrent, setLoadingCurrent] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setMode(single ? "set" : "add");
    setValue([]);
    if (!single) return;
    const refs = groupRefs(single);
    if (Array.isArray(single.group_names)) {
      setValue(refs.map((g) => g.id));
      return;
    }
    let alive = true;
    setLoadingCurrent(true);
    api
      .getMachineGroups(single.id)
      .then((gs) => alive && setValue((gs ?? []).map((g) => g.id)))
      .catch(() => {})
      .finally(() => alive && setLoadingCurrent(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, single?.id]);

  const save = async () => {
    setSaving(true);
    try {
      if (single && mode === "set") {
        await api.setMachineGroups(single.id, value);
        toast.success("Groups updated", { description: machineDisplayName(single) });
      } else {
        const ids = machines.map((m) => m.id);
        if (mode === "remove") {
          await Promise.all(value.flatMap((gid) => ids.map((mid) => api.removeGroupMember(gid, mid).catch(() => undefined))));
          toast.success(`Removed ${ids.length} machine${ids.length === 1 ? "" : "s"} from ${value.length} group${value.length === 1 ? "" : "s"}`);
        } else {
          await Promise.all(value.map((gid) => api.addGroupMembers(gid, ids)));
          toast.success(`Added ${ids.length} machine${ids.length === 1 ? "" : "s"} to ${value.length} group${value.length === 1 ? "" : "s"}`);
        }
      }
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error("Couldn't update groups", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && (mode === "set" || value.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{single ? `Groups for ${machineDisplayName(single)}` : `Groups for ${machines.length} machines`}</DialogTitle>
          <DialogDescription>
            Groups drive passthrough pools and bulk targeting. Changes regenerate affected nginx configs.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!single && (
            <div className="space-y-2">
              <Label>Action</Label>
              <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as Mode)} className="w-full">
                <ToggleGroupItem value="add" className="flex-1">
                  Add to groups
                </ToggleGroupItem>
                <ToggleGroupItem value="remove" className="flex-1">
                  Remove from groups
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          <div className="space-y-2">
            <Label>Groups</Label>
            <MultiCombobox
              items={groups}
              value={value}
              onValueChange={(ids) => setValue(ids)}
              getValue={(g) => g.id}
              getLabel={(g) => g.name}
              getKeywords={(g) => [g.emoji]}
              renderItem={(g) => (
                <div className="flex w-full items-center gap-2">
                  <GroupChip group={g} />
                  <span className="font-data ml-auto text-[11px] text-subtle-foreground">{g.machine_count ?? 0}</span>
                </div>
              )}
              renderChip={(g) => g.name}
              placeholder={loadingCurrent ? "Loading…" : "Select groups…"}
              searchPlaceholder="Search groups…"
              emptyText="No groups yet."
              loading={loadingCurrent}
              maxChips={4}
            />
            {onManageGroups && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onManageGroups();
                }}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Create or edit groups…
              </button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? <Spinner /> : <Tags />}
            {mode === "remove" ? "Remove" : "Save groups"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
