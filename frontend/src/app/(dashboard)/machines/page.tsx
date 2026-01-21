"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, Machine, EnrollmentToken } from "@/lib/api";

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [newToken, setNewToken] = useState<EnrollmentToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [tokenName, setTokenName] = useState("");

  const loadData = async () => {
    try {
      const [machinesData, tokensData] = await Promise.all([
        api.listMachines(),
        api.listEnrollmentTokens(),
      ]);
      setMachines(machinesData);
      setTokens(tokensData);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateToken = async () => {
    try {
      const token = await api.createEnrollmentToken(tokenName || undefined);
      setNewToken(token);
      setShowCreateDialog(false);
      setShowTokenDialog(true);
      setTokenName("");
      loadData();
    } catch (err) {
      console.error("Failed to create token:", err);
    }
  };

  const handleDeleteMachine = async (id: string) => {
    if (!confirm("Are you sure you want to delete this machine?")) return;
    try {
      await api.deleteMachine(id);
      loadData();
    } catch (err) {
      console.error("Failed to delete machine:", err);
    }
  };

  const getInstallCommand = (token: string) => {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
    return `curl -sSL ${backendUrl}/install.sh | sudo bash -s -- ${token}`;
  };

  const formatDate = (date: string | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleString();
  };

  const getStatusBadge = (machine: Machine) => {
    if (!machine.last_seen) {
      return <Badge variant="secondary">Never connected</Badge>;
    }
    const lastSeen = new Date(machine.last_seen);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / 1000 / 60;
    
    if (diffMinutes < 5) {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Online</Badge>;
    } else if (diffMinutes < 60) {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Idle</Badge>;
    }
    return <Badge variant="destructive">Offline</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Machines</h1>
          <p className="text-muted-foreground mt-1">
            Manage your proxy server agents
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="bg-primary hover:bg-primary/90 neon-glow">
          Create Enrollment Token
        </Button>
      </div>

      {/* Enrollment Tokens */}
      {tokens.length > 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg">Active Enrollment Tokens</CardTitle>
            <CardDescription>Tokens that can be used to enroll new agents</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tokens.map((token) => (
                <div key={token.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{token.name || "Unnamed Token"}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires: {formatDate(token.expires_at)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => api.deleteEnrollmentToken(token.id).then(loadData)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Machines List */}
      {machines.length === 0 ? (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>No machines enrolled</CardTitle>
            <CardDescription>
              Create an enrollment token and run the install command on your server to get started.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {machines.map((machine) => (
            <Card key={machine.id} className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{machine.hostname || "Unknown"}</CardTitle>
                    <CardDescription>{machine.ip_address || "No IP"}</CardDescription>
                  </div>
                  {getStatusBadge(machine)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">OS:</span>
                    <span>{machine.ubuntu_version || "Unknown"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Agent:</span>
                    <span>{machine.agent_version || "Unknown"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last seen:</span>
                    <span>{formatDate(machine.last_seen)}</span>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => window.location.href = `/machines/${machine.id}`}
                  >
                    View Details
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDeleteMachine(machine.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Token Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Enrollment Token</DialogTitle>
            <DialogDescription>
              Create a new token to enroll an agent. The token will expire in 24 hours.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token-name">Token Name</Label>
              <Input
                id="token-name"
                placeholder="e.g., Production Server 1"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to identify this token
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateToken}>
              Create Token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token Created Dialog */}
      <Dialog open={showTokenDialog} onOpenChange={setShowTokenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enrollment Token Created</DialogTitle>
            <DialogDescription>
              Use this command on your Ubuntu server to install the agent.
              The token expires in 24 hours.
            </DialogDescription>
          </DialogHeader>
          {newToken && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted font-mono text-sm break-all">
                {getInstallCommand(newToken.token || "")}
              </div>
              <Button
                className="w-full"
                onClick={async () => {
                  const text = getInstallCommand(newToken.token || "");
                  try {
                    await navigator.clipboard.writeText(text);
                    alert("Copied to clipboard!");
                  } catch {
                    // Fallback for HTTP sites (clipboard API requires HTTPS)
                    const textarea = document.createElement("textarea");
                    textarea.value = text;
                    textarea.style.position = "fixed";
                    textarea.style.opacity = "0";
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand("copy");
                    document.body.removeChild(textarea);
                    alert("Copied to clipboard!");
                  }
                }}
              >
                Copy to Clipboard
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                This token will only be shown once. Make sure to copy it now.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
