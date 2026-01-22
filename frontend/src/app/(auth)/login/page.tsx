"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";
import { ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);

  // Check if already authenticated
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("auth_token");
      if (token) {
        try {
          await api.getMe();
          // Already authenticated, check for pending invite
          const pendingToken = localStorage.getItem("pending_invite_token");
          if (pendingToken) {
            localStorage.removeItem("pending_invite_token");
            router.push(`/join?token=${pendingToken}`);
          } else {
            router.push("/machines");
          }
        } catch {
          // Token invalid
          localStorage.removeItem("auth_token");
        }
      }
    };
    checkAuth();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await api.login({ 
        email, 
        password, 
        totp_code: requires2FA ? totpCode : undefined 
      });
      
      if (response.requires_2fa) {
        setRequires2FA(true);
        setLoading(false);
        return;
      }
      
      // Check for pending invite token
      const pendingToken = localStorage.getItem("pending_invite_token");
      if (pendingToken) {
        localStorage.removeItem("pending_invite_token");
        router.push(`/join?token=${pendingToken}`);
      } else {
        router.push("/machines");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
      
      {/* Subtle grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '50px 50px'
        }}
      />
      
      {/* Glow orbs */}
      <div className="absolute top-1/4 -right-32 w-96 h-96 rounded-full bg-primary/10 blur-[120px]" />
      <div className="absolute bottom-1/4 -left-32 w-64 h-64 rounded-full bg-primary/5 blur-[100px]" />

      <Card className="w-full max-w-md relative border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="space-y-4 pb-6">
          <Logo size="lg" />
          <CardDescription className="text-muted-foreground">
            {requires2FA 
              ? "Enter your two-factor authentication code"
              : "Sign in to manage your proxy infrastructure"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {!requires2FA ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-11 bg-input/50 border-border/50 focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-11 bg-input/50 border-border/50 focus:border-primary/50 transition-colors"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-center p-4 bg-muted/50 rounded-lg">
                  <ShieldCheck className="h-12 w-12 text-primary" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="totp" className="text-sm font-medium">
                    Authentication Code
                  </Label>
                  <Input
                    id="totp"
                    type="text"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    className="h-14 text-center text-2xl tracking-widest font-mono bg-input/50 border-border/50 focus:border-primary/50 transition-colors"
                    autoFocus
                  />
                  <p className="text-xs text-center text-muted-foreground">
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>
                <Button 
                  type="button"
                  variant="ghost" 
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setRequires2FA(false);
                    setTotpCode("");
                    setPassword("");
                  }}
                >
                  Use a different account
                </Button>
              </div>
            )}
            
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}
            
            <Button 
              type="submit" 
              className="w-full h-11 font-medium bg-primary hover:bg-primary/90 transition-all duration-200"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle 
                      className="opacity-25" 
                      cx="12" 
                      cy="12" 
                      r="10" 
                      stroke="currentColor" 
                      strokeWidth="4"
                      fill="none"
                    />
                    <path 
                      className="opacity-75" 
                      fill="currentColor" 
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {requires2FA ? "Verifying..." : "Signing in..."}
                </span>
              ) : (
                requires2FA ? "Verify & Sign in" : "Sign in"
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center border-t border-border/50 pt-6">
          <p className="text-sm text-muted-foreground">
            Don't have an account?{" "}
            <a href="/register" className="text-primary hover:underline font-medium">
              Sign up
            </a>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
