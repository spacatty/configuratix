"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { api, type Domain } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner, errorMessage } from "@/components/app";

export interface DomainNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: Domain | null;
  onSaved: () => void;
}

export function DomainNotesDialog({ open, onOpenChange, domain, onSaved }: DomainNotesDialogProps) {
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setNotes(domain?.notes_md ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, domain?.id]);

  const dirty = notes !== (domain?.notes_md ?? "");

  const save = async () => {
    if (!domain) return;
    setSaving(true);
    try {
      await api.updateDomainNotes(domain.id, notes);
      toast.success("Notes saved");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't save notes", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
          <DialogDescription>
            Registrar, expiry, owner — anything worth remembering about{" "}
            <span className="font-data text-foreground">{domain?.fqdn}</span>. Markdown supported.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-[300px] gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="domain-notes">Edit</Label>
            <Textarea
              id="domain-notes"
              autoFocus
              className="font-data min-h-[280px] flex-1 resize-none text-[12.5px]"
              placeholder={"**Registrar:** Namecheap\n**Expires:** 2026-12-31"}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Preview</Label>
            <div className="prose prose-invert prose-sm max-w-none min-h-[280px] flex-1 overflow-auto rounded-md border border-border bg-surface-2/40 p-4">
              {notes.trim() ? (
                <ReactMarkdown>{notes}</ReactMarkdown>
              ) : (
                <p className="text-muted-foreground">Nothing yet.</p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving && <Spinner />}
            Save notes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
