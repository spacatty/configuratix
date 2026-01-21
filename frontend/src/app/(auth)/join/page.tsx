"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { FolderKanban, Loader2 } from "lucide-react";

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inviteToken, setInviteToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Get token from URL if present
    const tokenFromUrl = searchParams.get("token");
    if (tokenFromUrl) {
      setInviteToken(tokenFromUrl);
    }

    // Check if user is authenticated
    const checkAuth = async () => {
      const token = localStorage.getItem("auth_token");
      if (token) {
        try {
          await api.getMe();
          setIsAuthenticated(true);
          // If token in URL and authenticated, auto-join
          if (tokenFromUrl) {
            handleJoin(tokenFromUrl);
          }
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

  const handleJoin = async (token?: string) => {
    const tokenToUse = token || inviteToken;
    if (!tokenToUse.trim()) {
      toast.error("Invite token is required");
      return;
    }

    setLoading(true);
    try {
      const result = await api.requestJoinProject(tokenToUse);
      toast.success(`Requested to join "${result.project_name}". Waiting for approval.`);
      router.push("/projects");
    } catch (err) {
      console.error("Failed to join project:", err);
      toast.error("Invalid or expired invite token");
    } finally {
      setLoading(false);
    }
  };

  const handleLoginRedirect = () => {
    // Store the token to use after login
    if (inviteToken) {
      localStorage.setItem("pending_invite_token", inviteToken);
    }
    router.push("/login");
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md border-border/50 bg-card/95 backdrop-blur">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center">
            <FolderKanban className="h-7 w-7 text-blue-500" />
          </div>
          <CardTitle className="text-2xl">Join a Project</CardTitle>
          <CardDescription>
            Enter an invite token to request access to a project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-token">Invite Token</Label>
              <Input
                id="invite-token"
                placeholder="Paste the invite token here"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
              />
            </div>

            {isAuthenticated ? (
              <Button 
                onClick={() => handleJoin()} 
                disabled={loading} 
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Requesting...
                  </>
                ) : (
                  "Request Access"
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  You need to be logged in to join a project.
                </p>
                <Button onClick={handleLoginRedirect} className="w-full">
                  Log In to Continue
                </Button>
                <div className="text-center">
                  <Button variant="link" onClick={() => router.push("/register")} className="text-sm">
                    Don&apos;t have an account? Register
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <JoinContent />
    </Suspense>
  );
}

