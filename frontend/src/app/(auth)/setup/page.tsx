"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { AuthCard, AuthError, AuthField } from "@/components/app/auth-card";
import { LoadingState, Spinner } from "@/components/app/states";

export default function SetupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const status = await api.checkSetup();
        if (!status.needs_setup) {
          router.push("/login");
          return;
        }
      } catch {
        // If the check fails, allow setup anyway
      }
      setChecking(false);
    };
    checkSetup();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) return setError("Passwords do not match");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setLoading(true);
    try {
      await api.createFirstAdmin({ email, password });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  if (checking) return <LoadingState label="Checking setup status…" />;

  return (
    <AuthCard
      icon={Rocket}
      title="Set up Configuratix"
      description="Create the first administrator account. You can invite more users afterwards."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField label="Admin email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="admin@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="h-9"
          />
        </AuthField>
        <AuthField label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="h-9"
          />
        </AuthField>
        <AuthField label="Confirm password" htmlFor="confirmPassword">
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="h-9"
          />
        </AuthField>

        <AuthError>{error}</AuthError>

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading && <Spinner />}
          {loading ? "Creating account…" : "Create admin account"}
        </Button>
      </form>
    </AuthCard>
  );
}
