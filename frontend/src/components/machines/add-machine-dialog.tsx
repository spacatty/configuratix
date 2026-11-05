"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, KeyRound, Plus, Terminal } from "lucide-react";
import { api, getBackendUrl, type EnrollmentToken, type Machine } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CopyButton, RelativeTime, Spinner, StatusDot, errorMessage, invalidatePickerCache, machineDisplayName, machineIp, usePolling } from "@/components/app";

export function installCommand(token: string) {
  return `curl -sSL ${getBackendUrl()}/install.sh | sudo bash -s -- ${token}`;
}

/** Copyable shell one-liner block. */
export function InstallCommand({ token }: { token: string }) {
  const cmd = installCommand(token);
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card/60 px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Terminal className="size-3" />
          Run as root on the server
        </span>
        <CopyButton value={cmd} toastMessage="Install command copied" label="Copy command" size="sm" />
      </div>
      <pre className="font-data overflow-x-auto px-3 py-3 text-[12px] leading-relaxed whitespace-pre-wrap break-all text-foreground">
        <span className="select-none text-subtle-foreground">$ </span>
        {cmd}
      </pre>
    </div>
  );
}

/**
 * "Add machine" flow: optional name → enrollment token → copyable install command
 * → live wait until the agent enrolls (polls machines + tokens).
 */
export function AddMachineDialog({
  open,
  onOpenChange,
  knownMachineIds,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knownMachineIds: string[];
  onEnrolled?: (m: Machine) => void;
}) {
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [token, setToken] = React.useState<EnrollmentToken | null>(null);
  const [enrolled, setEnrolled] = React.useState<Machine | null>(null);
  const baseline = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (open) {
      setName("");
      setToken(null);
      setEnrolled(null);
      baseline.current = new Set(knownMachineIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const waiting = open && !!token && !enrolled;
  const { data: poll } = usePolling(
    async () => {
      const [machines, tokens] = await Promise.all([
        api.listMachines().catch(() => [] as Machine[]),
        api.listEnrollmentTokens().catch(() => [] as EnrollmentToken[]),
      ]);
      return { machines, tokenUsed: !!tokens.find((t) => t.id === token?.id)?.used_at };
    },
    4000,
    { enabled: waiting, deps: [token?.id] }
  );

  React.useEffect(() => {
    if (!waiting || !poll) return;
    // New = not known when the dialog opened AND created after the token (guards against an unloaded baseline).
    const since = token ? new Date(token.created_at).getTime() - 60_000 : 0;
    const fresh = poll.machines.filter((m) => !baseline.current.has(m.id) && new Date(m.created_at).getTime() >= since);
    if (fresh.length > 0) {
      const newest = [...fresh].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
      setEnrolled(newest);
      invalidatePickerCache("machines");
      onEnrolled?.(newest);
      toast.success("Machine enrolled", { description: machineDisplayName(newest) });
    }
  }, [poll, waiting, onEnrolled, token]);

  const create = async () => {
    setCreating(true);
    try {
      const t = await api.createEnrollmentToken(name.trim() || undefined);
      setToken(t);
    } catch (e) {
      toast.error("Couldn't create enrollment token", { description: errorMessage(e) });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add machine</DialogTitle>
          <DialogDescription>
            Install the Configuratix agent on an Ubuntu server. It enrolls with a one-time token and starts reporting within seconds.
          </DialogDescription>
        </DialogHeader>

        {!token ? (
          <div className="space-y-4">
            <ol className="grid gap-2 text-[13px] sm:grid-cols-3">
              {["Create a one-time token", "Run the install command", "Agent appears here"].map((s, i) => (
                <li key={s} className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-2.5 py-2">
                  <span className="font-data flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-[11px] text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{s}</span>
                </li>
              ))}
            </ol>
            <div className="space-y-2">
              <Label htmlFor="token-name">Token label (optional)</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. fra-web-03"
                onKeyDown={(e) => e.key === "Enter" && create()}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">Tokens are single-use and expire after 24 hours.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <InstallCommand token={token.token ?? ""} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <KeyRound className="size-3" />
                {token.name || "Unnamed token"}
              </span>
              <span>
                Expires <RelativeTime date={token.expires_at} />
              </span>
            </div>
            {enrolled ? (
              <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/[0.07] px-3 py-3 animate-fade-in-up">
                <CheckCircle2 className="size-5 text-success" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{machineDisplayName(enrolled)} enrolled</div>
                  <div className="font-data text-xs text-muted-foreground">{machineIp(enrolled) ?? enrolled.hostname ?? "—"}</div>
                </div>
                <Button size="sm" asChild>
                  <Link href={`/machines/${enrolled.id}`} onClick={() => onOpenChange(false)}>
                    Open
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-3">
                <StatusDot tone="info" pulse size="md" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">Waiting for the agent…</div>
                  <div className="text-xs text-muted-foreground">
                    {poll?.tokenUsed ? "Token redeemed — finishing enrollment." : "Keep this open; it updates automatically once the agent checks in."}
                  </div>
                </div>
                <Spinner className="text-muted-foreground" />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {!token ? (
            <>
              <Button variant="outline" asChild>
                <Link href="/machines/tokens">Manage tokens</Link>
              </Button>
              <Button onClick={create} disabled={creating}>
                {creating ? <Spinner /> : <Plus />}
                Create token
              </Button>
            </>
          ) : (
            <Button variant={enrolled ? "default" : "outline"} onClick={() => onOpenChange(false)}>
              {enrolled ? "Done" : "Close"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
