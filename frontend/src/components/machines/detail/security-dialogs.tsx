"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Eye, EyeOff, KeyRound, Plus, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/app";
import { CFX_THEME, EDITOR_OPTIONS, setupMonaco } from "../nginx/monaco-setup";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => <div className="skeleton-shimmer h-full w-full" />,
});

/** Validates a single port or a range "8000:8100". */
export function validatePortSpec(v: string, { allowRange = true, min = 1 } = {}): string | null {
  const s = v.trim();
  if (!s) return "Port is required";
  const parts = s.split(":");
  if (parts.length > 2 || (!allowRange && parts.length > 1)) return allowRange ? "Use a port (8080) or range (8000:8100)" : "Use a single port";
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n))) return "Ports are numbers";
  if (nums.some((n) => n < min || n > 65535)) return `Ports must be between ${min} and 65535`;
  if (nums.length === 2 && nums[0] >= nums[1]) return "Range start must be lower than its end";
  return null;
}

function useSubmit(fn: () => Promise<void>, close: () => void) {
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await fn();
      close();
    } catch {
      /* caller toasts */
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function SshPortDialog({
  open,
  onOpenChange,
  current,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: number;
  onSubmit: (port: number) => Promise<void>;
}) {
  const [port, setPort] = React.useState("");
  React.useEffect(() => {
    if (open) setPort("");
  }, [open]);
  const err = port ? validatePortSpec(port, { allowRange: false, min: 1024 }) ?? (Number(port) === current ? "That is the current port" : null) : null;
  const { busy, run } = useSubmit(() => onSubmit(Number(port)), () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change SSH port</DialogTitle>
          <DialogDescription>
            Currently <span className="font-data text-foreground">{current}</span>. The agent opens the new port in UFW before restarting sshd.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="ssh-port">New port</Label>
          <Input
            id="ssh-port"
            inputMode="numeric"
            autoFocus
            className="font-data"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && !err && port && run()}
            placeholder="2222"
            aria-invalid={!!err}
          />
          {err ? <p className="text-xs text-destructive">{err}</p> : <p className="text-xs text-muted-foreground">1024–65535. Keep your current session open until you&apos;ve verified the new port.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !port || !!err}>
            {busy && <Spinner />}
            Change port
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function strength(pw: string): { score: number; label: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const score = Math.min(4, s);
  return { score, label: ["Too short", "Weak", "Fair", "Good", "Strong"][score] };
}

export function PasswordDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (pw: string) => Promise<void> }) {
  const [pw, setPw] = React.useState("");
  const [confirmPw, setConfirmPw] = React.useState("");
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setPw("");
      setConfirmPw("");
      setShow(false);
    }
  }, [open]);
  const st = strength(pw);
  const err = pw && pw.length < 8 ? "At least 8 characters" : confirmPw && pw !== confirmPw ? "Passwords don't match" : null;
  const { busy, run } = useSubmit(() => onSubmit(pw), () => onOpenChange(false));
  const generate = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!@#%";
    const buf = new Uint32Array(20);
    crypto.getRandomValues(buf);
    const p = Array.from(buf, (n) => chars[n % chars.length]).join("");
    setPw(p);
    setConfirmPw(p);
    setShow(true);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change root password</DialogTitle>
          <DialogDescription>Sets the root password on the machine. It is not stored in Configuratix — save it in your password manager.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="pw">New password</Label>
              <button type="button" onClick={generate} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Generate
              </button>
            </div>
            <div className="relative">
              <Input id="pw" type={show ? "text" : "password"} autoComplete="new-password" className="font-data pr-9" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {pw && (
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1 flex-1 rounded-full bg-white/[0.07]",
                        i < st.score && (st.score <= 1 ? "bg-destructive" : st.score === 2 ? "bg-warning" : "bg-success")
                      )}
                    />
                  ))}
                </div>
                <span className="w-16 text-right text-[11px] text-muted-foreground">{st.label}</span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw2">Confirm</Label>
            <Input id="pw2" type={show ? "text" : "password"} autoComplete="new-password" className="font-data" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !err && pw === confirmPw && run()} />
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !pw || pw !== confirmPw || !!err}>
            {busy ? <Spinner /> : <KeyRound />}
            Set password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Fail2banDialog({
  open,
  onOpenChange,
  initial,
  enabled,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: string;
  enabled: boolean;
  onSubmit: (config: string) => Promise<void>;
}) {
  const [cfg, setCfg] = React.useState(initial);
  React.useEffect(() => {
    if (open) setCfg(initial);
  }, [open, initial]);
  const { busy, run } = useSubmit(() => onSubmit(cfg), () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fail2ban jail configuration</DialogTitle>
          <DialogDescription>
            Written to <span className="font-data">/etc/fail2ban/jail.local</span>
            {enabled ? " and fail2ban is restarted." : ". Applied the next time fail2ban is enabled."}
          </DialogDescription>
        </DialogHeader>
        <div className="h-72 overflow-hidden rounded-md border border-border">
          <MonacoEditor
            height="100%"
            language="ini"
            theme={CFX_THEME}
            beforeMount={setupMonaco}
            value={cfg}
            onChange={(v) => setCfg(v ?? "")}
            options={{ ...EDITOR_OPTIONS, lineNumbers: "on", stickyScroll: { enabled: false } }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !cfg.trim() || cfg === initial}>
            {busy ? <Spinner /> : <Save />}
            Save config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const COMMON_PORTS = [
  { port: "80", label: "HTTP" },
  { port: "443", label: "HTTPS" },
  { port: "8080", label: "Alt HTTP" },
  { port: "3306", label: "MySQL" },
  { port: "5432", label: "Postgres" },
  { port: "6379", label: "Redis" },
  { port: "5201", label: "iPerf3" },
];

export function AddRuleDialog({
  open,
  onOpenChange,
  existing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: { port: string; protocol: string }[];
  onSubmit: (port: string, protocol: string) => Promise<void>;
}) {
  const [port, setPort] = React.useState("");
  const [protocol, setProtocol] = React.useState("tcp");
  React.useEffect(() => {
    if (open) {
      setPort("");
      setProtocol("tcp");
    }
  }, [open]);
  const dup = existing.some((r) => r.port === port.trim() && (protocol === "both" || r.protocol.toLowerCase() === protocol));
  const err = port ? (validatePortSpec(port, { allowRange: false }) ?? (dup ? `${port}/${protocol} is already allowed` : null)) : null;
  const { busy, run } = useSubmit(() => onSubmit(port.trim(), protocol), () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Allow port</DialogTitle>
          <DialogDescription>Adds a UFW allow rule from anywhere.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-2">
              <Label htmlFor="ufw-port">Port</Label>
              <Input
                id="ufw-port"
                autoFocus
                className="font-data"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && port && !err && run()}
                placeholder="8080"
                aria-invalid={!!err}
              />
            </div>
            <div className="space-y-2">
              <Label>Protocol</Label>
              <ToggleGroup type="single" variant="outline" value={protocol} onValueChange={(v) => v && setProtocol(v)}>
                <ToggleGroupItem value="tcp" className="font-data">
                  tcp
                </ToggleGroupItem>
                <ToggleGroupItem value="udp" className="font-data">
                  udp
                </ToggleGroupItem>
                <ToggleGroupItem value="both" className="font-data">
                  both
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          {err && <p className="-mt-2 text-xs text-destructive">{err}</p>}
          <div className="flex flex-wrap gap-1.5">
            {COMMON_PORTS.map((p) => (
              <button
                key={p.port}
                type="button"
                onClick={() => setPort(p.port)}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-[4px] border px-1.5 text-[11px] transition-colors",
                  port === p.port ? "border-border-strong bg-surface-2 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="font-data">{p.port}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !port || !!err}>
            {busy ? <Spinner /> : <Plus />}
            Allow {port || "port"}/{protocol}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
