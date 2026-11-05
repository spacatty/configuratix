"use client";

import * as React from "react";
import { Info, ShieldCheck, ShieldOff, Smartphone, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CopyButton, SectionCard, Spinner, StatusBadge, errorMessage } from "@/components/app";
import { api, type User } from "@/lib/api";
import { FormField, PasswordInput } from "./form-field";

type Setup = { secret: string; qr_code: string; url: string };

export function TwoFactorSection({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [setup, setSetup] = React.useState<Setup | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [disableOpen, setDisableOpen] = React.useState(false);

  const start = async () => {
    setStarting(true);
    try {
      setSetup(await api.setup2FA());
    } catch (err) {
      toast.error("Couldn't start 2FA setup", { description: errorMessage(err) });
    } finally {
      setStarting(false);
    }
  };

  return (
    <SectionCard
      id="two-factor"
      className="scroll-mt-20"
      icon={Smartphone}
      title="Two-factor authentication"
      description="Require a 6-digit code from an authenticator app at sign-in."
      actions={<StatusBadge status={user.totp_enabled ? "enabled" : "disabled"} label={user.totp_enabled ? "Enabled" : "Off"} />}
      bodyClassName="space-y-4"
    >
      {user.totp_enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-[13px]">
            <ShieldCheck className="mt-0.5 size-4 text-success" />
            <p className="text-muted-foreground">
              Your account asks for an authenticator code after your password. Keep the device you enrolled safe.
            </p>
          </div>
          <Button variant="destructive" onClick={() => setDisableOpen(true)}>
            <ShieldOff />
            Turn off 2FA
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">
            Works with Google Authenticator, 1Password, Authy, Bitwarden or any TOTP app.
          </p>
          <Button onClick={start} disabled={starting}>
            {starting ? <Spinner /> : <ShieldCheck />}
            Set up 2FA
          </Button>
        </div>
      )}
      <Alert variant="info">
        <Info />
        <AlertTitle>No recovery codes</AlertTitle>
        <AlertDescription>
          Configuratix doesn&apos;t issue backup codes. If you lose your authenticator, an administrator has to reset 2FA on
          your account from the Users page. Save the setup key in your password manager as a fallback.
        </AlertDescription>
      </Alert>

      <SetupDialog
        setup={setup}
        onClose={() => setSetup(null)}
        onEnabled={() => {
          setSetup(null);
          onChanged();
        }}
      />
      <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} onDisabled={onChanged} />
    </SectionCard>
  );
}

function groupSecret(s: string) {
  return s.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") ?? s;
}

function SetupDialog({ setup, onClose, onEnabled }: { setup: Setup | null; onClose: () => void; onEnabled: () => void }) {
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (setup) {
      setCode("");
      setError(null);
    }
  }, [setup]);

  const verify = async (value = code) => {
    if (value.length !== 6) {
      setError("Enter the 6-digit code from your app");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.enable2FA(value);
      toast.success("Two-factor authentication enabled");
      onEnabled();
    } catch {
      setError("That code didn't match. Check your device clock and try the current code.");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!setup} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set up two-factor authentication</DialogTitle>
          <DialogDescription>2FA isn&apos;t active until you confirm a code in step 2.</DialogDescription>
        </DialogHeader>
        {setup && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <ol className="space-y-5">
              <li className="space-y-3">
                <p className="text-[13px] font-medium">
                  <span className="font-data mr-2 text-muted-foreground">1</span>Scan with your authenticator app
                </p>
                <div className="flex items-start gap-4">
                  {/* QR codes need a light quiet zone to scan reliably */}
                  <div className="shrink-0 rounded-md border border-border bg-white p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={setup.qr_code} alt="Authenticator QR code" className="size-36" />
                  </div>
                  <div className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
                    <p>Can&apos;t scan? Enter this setup key manually (time-based, 6 digits):</p>
                    <div className="flex items-start gap-1 rounded-md border border-border bg-surface-2 px-2 py-1.5">
                      <code className="font-data min-w-0 flex-1 break-all text-[12px] text-foreground">{groupSecret(setup.secret)}</code>
                      <CopyButton value={setup.secret} toastMessage="Setup key copied" size="xs" />
                    </div>
                  </div>
                </div>
              </li>
              <li className="space-y-2">
                <p className="text-[13px] font-medium">
                  <span className="font-data mr-2 text-muted-foreground">2</span>Enter the current code
                </p>
                <FormField id="totp-code" label={<span className="sr-only">Verification code</span>} error={error}>
                  <Input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000 000"
                    value={code}
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(v);
                      setError(null);
                      if (v.length === 6) verify(v);
                    }}
                    className="font-data h-11 text-center text-xl tracking-[0.5em]"
                  />
                </FormField>
              </li>
            </ol>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy && <Spinner />}
                Verify & enable
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ open, onOpenChange, onDisabled }: { open: boolean; onOpenChange: (o: boolean) => void; onDisabled: () => void }) {
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("Enter your password");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.disable2FA(password);
      toast.success("Two-factor authentication turned off");
      onOpenChange(false);
      onDisabled();
    } catch {
      setError("Incorrect password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Turn off two-factor?</DialogTitle>
            <DialogDescription>Your account will be protected by your password only.</DialogDescription>
          </DialogHeader>
          <Alert variant="warning">
            <TriangleAlert />
            <AlertDescription>Anyone who learns your password can sign in and control your machines.</AlertDescription>
          </Alert>
          <FormField id="disable-2fa-pw" label="Confirm with your password" error={error}>
            <PasswordInput autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive-solid" disabled={busy || !password}>
              {busy ? <Spinner /> : <ShieldOff />}
              Turn off 2FA
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
