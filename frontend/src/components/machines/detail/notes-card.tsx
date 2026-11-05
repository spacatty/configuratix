"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Check, NotebookPen, Pencil, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Kbd } from "@/components/ui/kbd";
import { SectionCard, Spinner, errorMessage } from "@/components/app";

export function NotesCard({ machineId, notes, onSaved }: { machineId: string; notes: string | null; onSaved: (notes: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(notes ?? "");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!editing) setDraft(notes ?? "");
  }, [notes, editing]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateMachineNotes(machineId, draft);
      onSaved(draft);
      setEditing(false);
      toast.success("Notes saved");
    } catch (e) {
      toast.error("Couldn't save notes", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      icon={NotebookPen}
      title="Notes"
      description={editing ? "Markdown supported" : undefined}
      actions={
        editing ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              <X />
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving || draft === (notes ?? "")}>
              {saving ? <Spinner /> : <Check />}
              Save
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
        )
      }
    >
      {editing ? (
        <Tabs defaultValue="write" className="gap-2">
          <TabsList>
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
                if (e.key === "Escape") setEditing(false);
              }}
              className="font-data min-h-48 text-[12.5px]"
              placeholder={"**Provider:** Hetzner\n**Renewal:** 2026-12-31\n\n- runs cron for backups"}
            />
            <div className="mt-1.5 text-[11px] text-subtle-foreground">
              <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to save · <Kbd>Esc</Kbd> to cancel
            </div>
          </TabsContent>
          <TabsContent value="preview">
            <div className="prose prose-invert prose-sm min-h-48 max-w-none rounded-md border border-border p-3">
              {draft ? <ReactMarkdown>{draft}</ReactMarkdown> : <p className="text-muted-foreground">Nothing to preview.</p>}
            </div>
          </TabsContent>
        </Tabs>
      ) : notes ? (
        <div className="prose prose-invert prose-sm max-w-none text-[13px] [&_p]:my-1.5">
          <ReactMarkdown>{notes}</ReactMarkdown>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
        >
          Add notes — provider, renewal dates, what runs here…
        </button>
      )}
    </SectionCard>
  );
}
