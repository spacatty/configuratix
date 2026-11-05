"use client";

import * as React from "react";
import { Shield, TriangleAlert, User as UserIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner, errorMessage } from "@/components/app";
import { EMAIL_RE, FormField, MIN_PASSWORD_LENGTH, PasswordInput } from "@/components/profile/form-field";

/* ------------------------------------------------------------------ create */

export function CreateUserDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (v: { email: string; name: string; password: string; role: string }) => Promise<void>;
}) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState("user");
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setPassword("");
      setRole("user");
      setSubmitted(false);
      setServerError(null);
    }
  }, [open]);

  const errors = {
    email: !email.trim() ? "Email is required" : !EMAIL_RE.test(email.trim()) ? "Enter a valid email address" : null,
    password: !password ? "Password is required" : password.length < MIN_PASSWORD_LENGTH ? `At least ${MIN_PASSWORD_LENGTH} characters` : null,
  };
  const invalid = !!(errors.email || errors.password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    setBusy(true);
    setServerError(null);
    try {
      await onSubmit({ email: email.trim(), name: name.trim(), password, role });
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
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>Create an account directly. Share the password through a secure channel.</DialogDescription>
          </DialogHeader>
          <FormField id="cu-email" label="Email" error={submitted ? errors.email : null}>
            <Input type="email" autoFocus autoComplete="off" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField id="cu-name" label="Display name" optional>
            <Input autoComplete="off" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField id="cu-password" label="Initial password" error={submitted ? errors.password : null} hint={`Min. ${MIN_PASSWORD_LENGTH} characters. Use the wand to generate one.`}>
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onGenerate={setPassword} />
          </FormField>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <RadioGroup value={role} onValueChange={setRole} className="grid grid-cols-2 gap-2">
              <RadioCard value="user" title="User" description="Own machines & projects" icon={<UserIcon />} />
              <RadioCard value="admin" title="Admin" description="Manage regular users" icon={<Shield />} />
            </RadioGroup>
          </div>
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
            <Button type="submit" disabled={busy || (submitted && invalid)}>
              {busy && <Spinner />}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ set password */

export function SetPasswordDialog({
  userLabel,
  open,
  onOpenChange,
  onSubmit,
}: {
  userLabel: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [pw, setPw] = React.useState("");
  const [confirmPw, setConfirmPw] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPw("");
      setConfirmPw("");
      setSubmitted(false);
      setServerError(null);
    }
  }, [open]);

  const errors = {
    pw: !pw ? "Password is required" : pw.length < MIN_PASSWORD_LENGTH ? `At least ${MIN_PASSWORD_LENGTH} characters` : null,
    confirm: confirmPw !== pw ? "Passwords don't match" : null,
  };
  const invalid = !!(errors.pw || errors.confirm);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    setBusy(true);
    setServerError(null);
    try {
      await onSubmit(pw);
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
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Set new password</DialogTitle>
            <DialogDescription>
              For <span className="font-medium text-foreground">{userLabel}</span>. Their current password stops working immediately.
            </DialogDescription>
          </DialogHeader>
          <FormField id="sp-pw" label="New password" error={submitted ? errors.pw : null}>
            <PasswordInput
              autoFocus
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onGenerate={(g) => {
                setPw(g);
                setConfirmPw(g);
              }}
            />
          </FormField>
          <FormField id="sp-confirm" label="Confirm password" error={submitted || (confirmPw && confirmPw.length >= pw.length) ? errors.confirm : null}>
            <PasswordInput autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
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
            <Button type="submit" disabled={busy || (submitted && invalid)}>
              {busy && <Spinner />}
              Set password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
