"use client";

import * as React from "react";
import { Eye, FileText, Pencil, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, SectionCard, Spinner, errorMessage, useConfirm } from "@/components/app";
import { api } from "@/lib/api";
import { MarkdownView } from "./project-shared";

export function ProjectNotesTab({
  projectId,
  notes,
  canEdit,
  onSaved,
}: {
  projectId: string;
  notes: string;
  canEdit: boolean;
  onSaved: (notes: string) => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState(false);
  const [mode, setMode] = React.useState<"write" | "preview">("write");
  const [draft, setDraft] = React.useState(notes);
  const [saving, setSaving] = React.useState(false);
  const dirty = editing && draft !== notes;

  React.useEffect(() => {
    if (!editing) setDraft(notes);
  }, [notes, editing]);

  // Warn before leaving the page with unsaved notes.
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = React.useCallback(async () => {
    setSaving(true);
    try {
      await api.updateProject(projectId, { notes_md: draft });
      onSaved(draft);
      setEditing(false);
      toast.success("Notes saved");
    } catch (err) {
      toast.error("Couldn't save notes", { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved, projectId]);

  const cancel = async () => {
    if (dirty) {
      const ok = await confirm({ title: "Discard changes?", description: "Your unsaved edits to the notes will be lost.", confirmText: "Discard", destructive: true });
      if (!ok) return;
    }
    setDraft(notes);
    setEditing(false);
  };

  const start = () => {
    setDraft(notes);
    setMode("write");
    setEditing(true);
  };

  if (!editing) {
    return (
      <SectionCard
        icon={FileText}
        title="Notes"
        description="Markdown runbook, contacts and context for this project."
        actions={
          canEdit && notes ? (
            <Button size="sm" variant="outline" onClick={start}>
              <Pencil />
              Edit
            </Button>
          ) : null
        }
      >
        {notes ? (
          <MarkdownView source={notes} />
        ) : (
          <EmptyState
            icon={FileText}
            size="compact"
            bordered={false}
            title="No notes yet"
            description={canEdit ? "Document access details, maintenance windows or runbooks. Markdown is supported." : "The project owner hasn't written any notes."}
            action={
              canEdit ? (
                <Button size="sm" onClick={start}>
                  <Pencil />
                  Write notes
                </Button>
              ) : undefined
            }
          />
        )}
      </SectionCard>
    );
  }

  return (
    <SectionCard
      icon={FileText}
      title="Edit notes"
      description={dirty ? "Unsaved changes" : "Markdown supported"}
      actions={
        <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "write" | "preview")}>
          <ToggleGroupItem value="write" aria-label="Write">
            <Pencil />
            Write
          </ToggleGroupItem>
          <ToggleGroupItem value="preview" aria-label="Preview">
            <Eye />
            Preview
          </ToggleGroupItem>
        </ToggleGroup>
      }
      footer={
        <>
          <span className="mr-auto hidden text-xs text-muted-foreground sm:inline">
            <Kbd>Ctrl</Kbd> <Kbd>S</Kbd> to save · <Kbd>Esc</Kbd> to cancel
          </span>
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? <Spinner /> : <Save />}
            Save notes
          </Button>
        </>
      }
    >
      {mode === "write" ? (
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              if (dirty && !saving) save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder={"## Access\n- Bastion: `ssh ops@…`\n\n## Maintenance\nSundays 02:00–04:00 UTC"}
          className="font-data min-h-[360px] resize-y text-[12.5px] leading-relaxed"
        />
      ) : draft.trim() ? (
        <div className="min-h-[360px]">
          <MarkdownView source={draft} />
        </div>
      ) : (
        <p className="min-h-[360px] text-sm text-muted-foreground">Nothing to preview.</p>
      )}
    </SectionCard>
  );
}
