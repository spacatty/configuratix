"use client";

import * as React from "react";
import { CheckCircle2, Link2, RefreshCw, Share2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CopyableMono, RelativeTime, Spinner, errorMessage, useConfirm } from "@/components/app";
import { FormField } from "@/components/profile/form-field";
import { api, type Project, type ProjectWithStats } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { inviteLink, parseInviteInput } from "./project-shared";

/* -------------------------------------------------------------- name (create / rename) */

export function ProjectNameDialog({
  open,
  onOpenChange,
  mode,
  initialName = "",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "rename";
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = React.useState(initialName);
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName(initialName);
      setTouched(false);
      setServerError(null);
    }
  }, [open, initialName]);

  const trimmed = name.trim();
  const error = !trimmed ? "Name is required" : trimmed.length > 100 ? "Keep it under 100 characters" : null;
  const unchanged = mode === "rename" && trimmed === initialName.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (error || unchanged) return;
    setBusy(true);
    setServerError(null);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "New project" : "Rename project"}</DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Projects group machines and let you share access with teammates."
                : "The new name is visible to every member."}
            </DialogDescription>
          </DialogHeader>
          <FormField id="project-name" label="Project name" error={touched ? error : null}>
            <Input
              autoFocus
              placeholder="e.g. Production EU"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          </FormField>
          {serverError && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || (touched && !!error) || unchanged}>
              {busy && <Spinner />}
              {mode === "create" ? "Create project" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- join */

export function JoinProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [joined, setJoined] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
      setJoined(null);
    }
  }, [open]);

  const token = parseInviteInput(value);
  const parsedFromLink = !!token && token !== value.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError("Paste an invite link or token");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestJoinProject(token);
      setJoined(res.project_name || "the project");
    } catch (err) {
      const msg = errorMessage(err);
      setError(/not found|invalid|expired|404/i.test(msg) ? "This invite is invalid or has expired. Ask the project owner for a new link." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        {joined ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-success" />
                Request sent
              </DialogTitle>
              <DialogDescription>
                You asked to join <span className="font-medium text-foreground">{joined}</span>. The project owner has to
                approve the request — it appears in your project list once accepted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Join a project</DialogTitle>
              <DialogDescription>Paste the invite link or token you received from a project owner.</DialogDescription>
            </DialogHeader>
            <FormField
              id="invite-token"
              label="Invite link or token"
              error={error}
              hint={parsedFromLink ? <>Token detected from link: <span className="font-data">{token.slice(0, 12)}…</span></> : undefined}
            >
              <Input
                autoFocus
                className="font-data"
                placeholder="https://…/join?token=…"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !token}>
                {busy && <Spinner />}
                Request access
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- sharing */

export function ShareProjectDialog({
  project,
  open,
  onOpenChange,
  onChanged,
}: {
  project: ProjectWithStats | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: (p: Project) => void;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const [state, setState] = React.useState<Pick<Project, "sharing_enabled" | "invite_token" | "invite_expires_at"> | null>(null);

  React.useEffect(() => {
    if (open && project) setState({ sharing_enabled: project.sharing_enabled, invite_token: project.invite_token, invite_expires_at: project.invite_expires_at });
  }, [open, project]);

  if (!project) return null;
  const enabled = state?.sharing_enabled ?? project.sharing_enabled;
  const token = state?.invite_token;

  const setSharing = async (next: boolean) => {
    if (!next) {
      const ok = await confirm({
        title: "Disable sharing?",
        description: "The current invite link stops working. Existing members keep their access.",
        confirmText: "Disable sharing",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const updated = await api.toggleProjectSharing(project.id, next);
      setState({ sharing_enabled: updated.sharing_enabled, invite_token: updated.invite_token, invite_expires_at: updated.invite_expires_at });
      onChanged(updated);
      if (updated.sharing_enabled && updated.invite_token) {
        const copied = await copyToClipboard(inviteLink(updated.invite_token));
        toast.success("Sharing enabled", { description: copied ? "Invite link copied to clipboard." : undefined });
      } else {
        toast.success("Sharing disabled");
      }
    } catch (err) {
      toast.error("Couldn't update sharing", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!token) return;
    if (await copyToClipboard(inviteLink(token))) toast.success("Invite link copied");
    else toast.error("Couldn't access the clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-4 text-muted-foreground" />
            Share “{project.name}”
          </DialogTitle>
          <DialogDescription>
            Anyone with the invite can request access. You approve each request before they see anything.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-2/40 px-3 py-2.5">
          <div className="space-y-0.5">
            <Label htmlFor="share-switch">Invite link</Label>
            <p className="text-xs text-muted-foreground">{enabled ? "Active — new requests are accepted." : "Off — nobody can request access."}</p>
          </div>
          <div className="flex items-center gap-2">
            {busy && <Spinner />}
            <Switch id="share-switch" checked={enabled} disabled={busy} onCheckedChange={setSharing} />
          </div>
        </div>

        {enabled && token && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Link</Label>
              <div className="flex gap-2">
                <Input readOnly value={inviteLink(token)} className="font-data text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" onClick={copyLink}>
                  <Link2 />
                  Copy link
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                Token <CopyableMono value={token} display={`${token.slice(0, 10)}…`} copyLabel="Copy token" />
              </span>
              {state?.invite_expires_at && (
                <span>
                  Expires <RelativeTime date={state.invite_expires_at} />
                </span>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {enabled && token && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  // Enabling again issues a fresh token (7-day expiry) and invalidates the old one.
                  const updated = await api.toggleProjectSharing(project.id, true);
                  setState({ sharing_enabled: updated.sharing_enabled, invite_token: updated.invite_token, invite_expires_at: updated.invite_expires_at });
                  onChanged(updated);
                  toast.success("New invite link generated", { description: "The previous link no longer works." });
                } catch (err) {
                  toast.error("Couldn't regenerate link", { description: errorMessage(err) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw />
              Regenerate
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
