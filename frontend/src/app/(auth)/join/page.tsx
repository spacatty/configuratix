"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { AuthCard, AuthField } from "@/components/app/auth-card";
import { LoadingState, Spinner } from "@/components/app/states";

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inviteToken, setInviteToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handleJoin = async (token?: string) => {
    const tokenToUse = token || inviteToken;
    if (!tokenToUse.trim()) {
      toast.error("Invite token is required");
      return;
    }
    setLoading(true);
    try {
      const result = await api.requestJoinProject(tokenToUse.trim());
      toast.success(`Requested to join “${result.project_name}”`, { description: "A project admin needs to approve your request." });
      router.push("/projects");
    } catch {
      toast.error("Invalid or expired invite token");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const tokenFromUrl = searchParams.get("token");
    if (tokenFromUrl) setInviteToken(tokenFromUrl);

    const checkAuth = async () => {
      const token = localStorage.getItem("auth_token");
      if (token) {
        try {
          await api.getMe();
          setIsAuthenticated(true);
          if (tokenFromUrl) handleJoin(tokenFromUrl);
        } catch {
          localStorage.removeItem("auth_token");
          setIsAuthenticated(false);
        }
      }
      setCheckingAuth(false);
    };
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleLoginRedirect = () => {
    if (inviteToken) localStorage.setItem("pending_invite_token", inviteToken.trim());
    router.push("/login");
  };

  if (checkingAuth) return <LoadingState label="Checking session…" />;

  return (
    <AuthCard
      icon={FolderKanban}
      title="Join a project"
      description="Paste an invite token to request access. A project admin approves new members."
      footer={
        !isAuthenticated ? (
          <>
            No account yet?{" "}
            <Link href="/register" className="font-medium text-foreground hover:text-primary">
              Register
            </Link>
          </>
        ) : undefined
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (isAuthenticated) handleJoin();
          else handleLoginRedirect();
        }}
      >
        <AuthField label="Invite token" htmlFor="invite-token">
          <Input
            id="invite-token"
            placeholder="Paste the invite token"
            value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)}
            className="font-data h-9"
            autoFocus
            spellCheck={false}
          />
        </AuthField>

        {isAuthenticated ? (
          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading && <Spinner />}
            {loading ? "Requesting…" : "Request access"}
          </Button>
        ) : (
          <>
            <p className="text-[13px] text-muted-foreground">Sign in first — your token is kept and applied after login.</p>
            <Button type="submit" size="lg" className="w-full">
              Sign in to continue
            </Button>
          </>
        )}
      </form>
    </AuthCard>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <JoinContent />
    </Suspense>
  );
}
