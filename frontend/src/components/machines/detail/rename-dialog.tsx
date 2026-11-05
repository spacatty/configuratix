"use client";

import * as React from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner, errorMessage, invalidatePickerCache } from "@/components/app";
import type { FleetMachine } from "../utils";

export function RenameDialog({
  open,
  onOpenChange,
  machine,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  machine: FleetMachine;
  onRenamed: (title: string | null) => void;
}) {
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (open) setValue(machine.title || "");
  }, [open, machine.title]);

  const save = async () => {
    setSaving(true);
    try {
      const title = value.trim();
      await api.updateMachine(machine.id, { title });
      onRenamed(title || null);
      invalidatePickerCache("machines");
      toast.success("Machine renamed");
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't rename machine", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename machine</DialogTitle>
          <DialogDescription>A friendly name for lists and pickers. Leave empty to use the hostname.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="machine-title">Name</Label>
          <Input id="machine-title" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={machine.hostname ?? "Machine name"} onKeyDown={(e) => e.key === "Enter" && save()} />
          <p className="text-xs text-muted-foreground">
            Hostname <span className="font-data">{machine.hostname ?? "—"}</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Spinner />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
