"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/app";

const EMOJIS = ["📁", "⚙️", "🗂️", "🧩", "🔐", "🐘", "🐳", "📜", "🛡️", "📦"];
const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#64748b"];

export interface CategoryForm {
  name: string;
  emoji: string;
  color: string;
}

export function CategoryDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: CategoryForm | null;
  onSubmit: (f: CategoryForm) => Promise<void>;
}) {
  const [form, setForm] = React.useState<CategoryForm>({ name: "", emoji: "📁", color: COLORS[0] });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) setForm(initial ?? { name: "", emoji: "📁", color: COLORS[0] });
  }, [open, initial]);
  const submit = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ ...form, name: form.name.trim() });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit category" : "New config category"}</DialogTitle>
          <DialogDescription>Group extra files you want to edit on this machine (app configs, systemd units…).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="e.g. Redis" />
          </div>
          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setForm({ ...form, emoji: e })}
                  className={cn("flex size-7 items-center justify-center rounded-md border text-sm", form.emoji === e ? "border-border-strong bg-surface-2" : "border-transparent hover:bg-surface-2/60")}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  className={cn("flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background", form.color === c && "ring-2 ring-foreground/60")}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                >
                  {form.color === c && <Check className="size-3 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !form.name.trim()}>
            {busy && <Spinner />}
            {initial ? "Save" : "Create category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface PathForm {
  name: string;
  path: string;
  file_type: string;
  reload_command: string;
}

const FILE_TYPES = [
  { value: "text", label: "Plain text" },
  { value: "nginx", label: "nginx" },
  { value: "php", label: "PHP / ini" },
  { value: "ssh", label: "SSH" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "shell", label: "Shell" },
];

export function PathDialog({
  open,
  onOpenChange,
  initial,
  categoryName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: PathForm | null;
  categoryName?: string;
  onSubmit: (f: PathForm) => Promise<void>;
}) {
  const [form, setForm] = React.useState<PathForm>({ name: "", path: "", file_type: "text", reload_command: "" });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) setForm(initial ?? { name: "", path: "", file_type: "text", reload_command: "" });
  }, [open, initial]);
  const pathError = form.path && !/^\/[^\0]*[^/]$/.test(form.path) ? "Use an absolute file path, e.g. /etc/redis/redis.conf" : null;
  const valid = form.name.trim() && form.path.trim() && !pathError;
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onSubmit({ ...form, name: form.name.trim(), path: form.path.trim(), reload_command: form.reload_command.trim() });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit file path" : "Add file path"}</DialogTitle>
          <DialogDescription>{categoryName ? `In “${categoryName}”. ` : ""}The agent reads and writes this file on demand.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="space-y-2">
              <Label htmlFor="path-name">Display name</Label>
              <Input id="path-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="redis.conf" />
            </div>
            <div className="space-y-2">
              <Label>Syntax</Label>
              <Select value={form.file_type} onValueChange={(v) => setForm({ ...form, file_type: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="path-path">Absolute path</Label>
            <Input
              id="path-path"
              className="font-data"
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
              placeholder="/etc/redis/redis.conf"
              aria-invalid={!!pathError}
            />
            {pathError && <p className="text-xs text-destructive">{pathError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="path-reload">Reload command (optional)</Label>
            <Input
              id="path-reload"
              className="font-data"
              value={form.reload_command}
              onChange={(e) => setForm({ ...form, reload_command: e.target.value })}
              placeholder="systemctl reload redis-server"
            />
            <p className="text-xs text-muted-foreground">Runs after a successful save.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !valid}>
            {busy && <Spinner />}
            {initial ? "Save path" : "Add path"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
