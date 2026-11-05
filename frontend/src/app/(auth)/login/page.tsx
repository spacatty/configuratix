"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { AuthCard, AuthError, AuthField } from "@/components/app/auth-card";
import { Spinner } from "@/components/app/states";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);

  const goNext = () => {
    const pendingToken = localStorage.getItem("pending_invite_token");
    if (pendingToken) {
      localStorage.removeItem("pending_invite_token");
      router.push(`/join?token=${pendingToken}`);
    } else {
      router.push("/machines");
    }
  };

  // Already authenticated → skip
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("auth_token");
      if (!token) return;
      try {
        await api.getMe();
        goNext();
      } catch {
        localStorage.removeItem("auth_token");
      }
    };
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await api.login({
        email,
        password,
        totp_code: requires2FA ? totpCode : undefined,
      });
      if (response.requires_2fa) {
        setRequires2FA(true);
        setLoading(false);
        return;
      }
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      icon={requires2FA ? ShieldCheck : undefined}
      title={requires2FA ? "Two-factor authentication" : "Sign in"}
      description={
        requires2FA ? "Enter the 6-digit code from your authenticator app." : "Access your proxy infrastructure control plane."
      }
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-foreground hover:text-primary">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!requires2FA ? (
          <>
            <AuthField label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="h-9"
              />
            </AuthField>
            <AuthField label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-9"
              />
            </AuthField>
          </>
        ) : (
          <AuthField label="Authentication code" htmlFor="totp">
            <Input
              id="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
              className="font-data h-12 text-center text-xl tracking-[0.5em]"
            />
          </AuthField>
        )}

        <AuthError>{error}</AuthError>

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading && <Spinner />}
          {loading ? (requires2FA ? "Verifying…" : "Signing in…") : requires2FA ? "Verify and sign in" : "Sign in"}
        </Button>

        {requires2FA && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setRequires2FA(false);
              setTotpCode("");
              setPassword("");
              setError("");
            }}
          >
            Use a different account
          </Button>
        )}
      </form>
    </AuthCard>
  );
}
