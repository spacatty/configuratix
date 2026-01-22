"use client";

import { useState, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/ui/data-table";
import { api, EnrollmentToken, BACKEND_URL } from "@/lib/api";
import { toast } from "sonner";
import { Copy, Plus, Trash2, KeyRound, Clock, CheckCircle, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function EnrollmentTokensPage() {
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedToken, setSelectedToken] = useState<EnrollmentToken | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<EnrollmentToken | null>(null);

  const loadData = async () => {
    try {
      const tokensData = await api.listEnrollmentTokens();
      setTokens(tokensData);
    } catch (err) {
      console.error("Failed to load tokens:", err);
      toast.error("Failed to load tokens");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCreateToken = async () => {
    try {
      const token = await api.createEnrollmentToken(tokenName || undefined);
      setCreatedToken(token);
      setTokenName("");
      loadData();
      toast.success("Enrollment token created");
    } catch (err) {
      console.error("Failed to create token:", err);
      toast.error("Failed to create token");
    }
  };

  const handleDeleteToken = async () => {
    if (!selectedToken) return;
    try {
      await api.deleteEnrollmentToken(selectedToken.id);
      setShowDeleteDialog(false);
      setSelectedToken(null);
      loadData();
      toast.success("Token deleted");
    } catch (err) {
      console.error("Failed to delete token:", err);
      toast.error("Failed to delete token");
    }
  };

  const openDeleteDialog = (token: EnrollmentToken) => {
    setSelectedToken(token);
    setShowDeleteDialog(true);
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      toast.success("Copied to clipboard");
    } catch (err) {
      toast.error("Failed to copy");
    }
  };

  const installCommand = createdToken 
    ? `curl -sSL ${BACKEND_URL}/install.sh | sudo bash -s -- ${createdToken.token}`
    : "";

  const activeTokens = tokens.filter(t => !t.used_at);
  const usedTokens = tokens.filter(t => t.used_at);

  const getStatusBadge = (token: EnrollmentToken) => {
    if (token.used_at) {
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
          <CheckCircle className="h-3 w-3 mr-1" />
          Used
        </Badge>
      );
    }
    if (new Date(token.expires_at) < new Date()) {
      return <Badge variant="destructive">Expired</Badge>;
    }
    return (
      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
        <Clock className="h-3 w-3 mr-1" />
        Active
      </Badge>
    );
  };

  const columns: ColumnDef<EnrollmentToken>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const token = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-yellow-500" />
            </div>
            <span className="font-medium">{token.name || "Unnamed Token"}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => getStatusBadge(row.original),
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      accessorKey: "expires_at",
      header: "Expires",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.expires_at).toLocaleString()}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const token = row.original;
        if (token.used_at) return null;
        
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => copyToClipboard(`curl -sSL ${BACKEND_URL}/install.sh | sudo bash -s -- ${token.token}`)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Install Command
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openDeleteDialog(token)} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

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
          <h1 className="text-3xl font-semibold tracking-tight">Enrollment Tokens</h1>
          <p className="text-muted-foreground mt-1">
            Manage tokens for agent installation. {activeTokens.length} active, {usedTokens.length} used.
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Token
        </Button>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">Your Tokens</CardTitle>
          <CardDescription>Enrollment tokens allow new machines to register with the system.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={tokens} searchKey="name" searchPlaceholder="Search tokens..." />
        </CardContent>
      </Card>

      {/* Create Token Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => {
        setShowCreateDialog(open);
        if (!open) setCreatedToken(null);
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {createdToken ? "Installation Command" : "Create Enrollment Token"}
            </DialogTitle>
            <DialogDescription>
              {createdToken
                ? "Run this command on your server to install the agent:"
                : "Create a token to register a new machine with the agent."}
            </DialogDescription>
          </DialogHeader>

          {createdToken ? (
            <div className="space-y-4">
              <div className="relative">
                <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto">
                  {installCommand}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(installCommand)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>This token will expire on {new Date(createdToken.expires_at).toLocaleString()}.</p>
                <p className="mt-2">Requirements: Ubuntu 22.04 or 24.04, root access.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">Token Name (optional)</Label>
                <Input
                  id="token-name"
                  placeholder="e.g., Production Server 1"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {createdToken ? (
              <Button onClick={() => {
                setShowCreateDialog(false);
                setCreatedToken(null);
              }}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateToken}>
                  Create Token
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Token</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{selectedToken?.name || "Unnamed Token"}&quot;? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteToken} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
