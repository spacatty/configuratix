"use client";

import * as React from "react";
import { KeyRound, Save, TriangleAlert, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CardSkeleton,
  CopyableMono,
  ErrorState,
  KeyValueList,
  PageHeader,
  RelativeTime,
  SectionCard,
  Spinner,
  errorMessage,
  usePolling,
} from "@/components/app";
import { UserRoleBadge } from "@/components/admin/user-role-badge";
import { FormField, InitialsAvatar, MIN_PASSWORD_LENGTH, PasswordInput, PasswordRules } from "@/components/profile/form-field";
import { TwoFactorSection } from "@/components/profile/two-factor";
import { formatDateTime } from "@/lib/format";
import { api, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "password", label: "Password" },
  { id: "two-factor", label: "Two-factor" },
];

export default function ProfilePage() {
  const { data: user, loading, error, refresh, setData } = usePolling(() => api.getMe(), 0);

  return (
    <div className="space-y-6">
      <PageHeader icon={UserRound} title="Profile" description="Your account details and sign-in security." />

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
          <div />
          <div className="max-w-3xl space-y-4">
            <CardSkeleton lines={4} />
            <CardSkeleton lines={4} />
          </div>
        </div>
      ) : !user ? (
        <ErrorState title="Couldn't load your profile" error={error} onRetry={refresh} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
          <SectionNav />
          <div className="max-w-3xl min-w-0 space-y-4">
            <ProfileSection user={user} onSaved={(u) => setData(u)} />
            <PasswordSection user={user} onChanged={refresh} />
            <TwoFactorSection user={user} onChanged={refresh} />
          </div>
        </div>
      )}
    </div>
  );
}

function SectionNav() {
  const [active, setActive] = React.useState("profile");
  React.useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <nav aria-label="Profile sections" className="hidden lg:block">
      <ul className="sticky top-20 space-y-0.5">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                setActive(s.id);
              }}
              className={cn(
                "block rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                active === s.id ? "bg-surface-2 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ProfileSection({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const [name, setName] = React.useState(user.name ?? "");
  const [saving, setSaving] = React.useState(false);
  const dirty = name.trim() !== (user.name ?? "").trim();
  const error = name.trim().length > 100 ? "Keep it under 100 characters" : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || error) return;
    setSaving(true);
    try {
      const updated = await api.updateProfile(name.trim());
      onSaved(updated);
      toast.success("Profile updated");
    } catch (err) {
      toast.error("Couldn't update profile", { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      id="profile"
      title="Profile"
      description="How you appear to teammates in projects and job history."
      className="scroll-mt-20"
    >
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-3">
          <InitialsAvatar name={name || user.email} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium">{name.trim() || user.email}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <UserRoleBadge role={user.role} />
            </div>
          </div>
        </div>
        <FormField id="display-name" label="Display name" error={error} hint="Leave empty to show your email.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={120} className="max-w-sm" />
        </FormField>
        <KeyValueList
          items={[
            { label: "Email", value: <CopyableMono value={user.email} /> },
            { label: "User ID", value: <CopyableMono value={user.id} display={`${user.id.slice(0, 8)}…`} /> },
            { label: "Member since", value: <span className="font-data">{formatDateTime(user.created_at, false)}</span> },
          ]}
        />
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          {dirty && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setName(user.name ?? "")} disabled={saving}>
              Reset
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!dirty || !!error || saving}>
            {saving ? <Spinner /> : <Save />}
            Save changes
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function PasswordSection({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirmPw, setConfirmPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const rules = [
    { label: `${MIN_PASSWORD_LENGTH}+ characters`, ok: next.length >= MIN_PASSWORD_LENGTH },
    { label: "Different from current", ok: !!next && next !== current },
    { label: "Confirmation matches", ok: !!next && next === confirmPw },
  ];
  const valid = !!current && rules.every((r) => r.ok);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    setBusy(true);
    setServerError(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirmPw("");
      setSubmitted(false);
      toast.success("Password changed");
      onChanged();
    } catch (err) {
      const msg = errorMessage(err);
      setServerError(/invalid|incorrect|wrong|401|current/i.test(msg) ? "Current password is incorrect." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      id="password"
      icon={KeyRound}
      title="Password"
      description={
        user.password_changed_at ? (
          <>
            Last changed <RelativeTime date={user.password_changed_at} />
          </>
        ) : (
          "Never changed since the account was created."
        )
      }
      className="scroll-mt-20"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <input type="text" autoComplete="username" value={user.email} readOnly hidden />
        <FormField id="pw-current" label="Current password" error={submitted && !current ? "Enter your current password" : null} className="max-w-sm">
          <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="pw-new" label="New password">
            <PasswordInput autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </FormField>
          <FormField id="pw-confirm" label="Confirm new password">
            <PasswordInput autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </FormField>
        </div>
        {(next || submitted) && <PasswordRules rules={rules} />}
        {serverError && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end border-t border-border pt-3">
          <Button type="submit" size="sm" disabled={busy || (submitted && !valid)}>
            {busy ? <Spinner /> : <KeyRound />}
            Update password
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
