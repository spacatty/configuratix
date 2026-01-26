"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { api, DNSManagedDomain, DNSAccount } from "@/lib/api";
import { Globe, CheckCircle, Plus, RefreshCw, Trash, Settings2 } from "lucide-react";
import { toast } from "sonner";

export default function DNSManagementPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<DNSManagedDomain[]>([]);
  const [dnsAccounts, setDnsAccounts] = useState<DNSAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDomainDialog, setShowAddDomainDialog] = useState(false);
  const [showDNSAccountDialog, setShowDNSAccountDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<DNSManagedDomain | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newFqdn, setNewFqdn] = useState("");
  const [newDnsAccountId, setNewDnsAccountId] = useState("");

  // DNS Account form
  const [dnsAccountForm, setDnsAccountForm] = useState({
    provider: "dnspod",
    name: "",
    api_id: "",
    api_token: "",
    is_default: false,
  });

  const loadData = async () => {
    try {
      const [domainsData, accountsData] = await Promise.all([
        api.listDNSManagedDomains().catch(() => []),
        api.listDNSAccounts().catch(() => []),
      ]);
      setDomains(domainsData);
      setDnsAccounts(accountsData);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateDomain = async () => {
    if (!newFqdn.trim()) {
      toast.error("Domain name is required");
      return;
    }
    setSubmitting(true);
    try {
      await api.createDNSManagedDomain({
        fqdn: newFqdn.trim(),
        dns_account_id: newDnsAccountId || undefined,
      });
      toast.success("Domain added to DNS management");
      setShowAddDomainDialog(false);
      setNewFqdn("");
      setNewDnsAccountId("");
      loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create domain");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDomain = async () => {
    if (!selectedDomain) return;
    setSubmitting(true);
    try {
      await api.deleteDNSManagedDomain(selectedDomain.id);
      toast.success("Domain removed from DNS management");
      setShowDeleteDialog(false);
      setSelectedDomain(null);
      loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete domain");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDNSAccount = async () => {
    if (!dnsAccountForm.name || !dnsAccountForm.api_token) {
      toast.error("Name and API Token are required");
      return;
    }
    setSubmitting(true);
    try {
      await api.createDNSAccount(dnsAccountForm);
      toast.success("DNS account created");
      setShowDNSAccountDialog(false);
      setDnsAccountForm({ provider: "dnspod", name: "", api_id: "", api_token: "", is_default: false });
      loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDNSAccount = async (id: string) => {
    try {
      await api.deleteDNSAccount(id);
      toast.success("DNS account deleted");
      loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
    }
  };

  const openDNSSettings = (domain: DNSManagedDomain) => {
    router.push(`/domains/dns/${domain.id}`);
  };

  const openDeleteDialog = (domain: DNSManagedDomain) => {
    setSelectedDomain(domain);
    setShowDeleteDialog(true);
  };

  const getNSStatusBadge = (status: string | null) => {
    switch (status) {
      case "valid":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
            <CheckCircle className="h-3 w-3 mr-1" />
            NS OK
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
            Pending
          </Badge>
        );
      case "invalid":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
            NS Invalid
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-xs">
            <Globe className="h-3 w-3 mr-1" />
            Unknown
          </Badge>
        );
    }
  };

  const columns: ColumnDef<DNSManagedDomain>[] = [
    {
      accessorKey: "fqdn",
      header: "Domain",
      cell: ({ row }) => {
        const domain = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center">
              <Globe className="h-5 w-5 text-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-medium">{domain.fqdn}</span>
              {getNSStatusBadge(domain.ns_status)}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "dns_account_name",
      header: "DNS Account",
      cell: ({ row }) => {
        const domain = row.original;
        if (domain.dns_account_name) {
          return (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {domain.dns_account_provider === "cloudflare" ? "☁️ CF" : "🌐 DNSPod"}
              </Badge>
              <span className="text-sm">{domain.dns_account_name}</span>
            </div>
          );
        }
        return <span className="text-muted-foreground text-sm">Not configured</span>;
      },
    },
    {
      accessorKey: "proxy_mode",
      header: "Mode",
      cell: ({ row }) => {
        const mode = row.original.proxy_mode;
        if (mode === "wildcard") {
          return <Badge className="bg-purple-500/20 text-purple-400">Wildcard</Badge>;
        } else if (mode === "separate") {
          return <Badge className="bg-purple-500/20 text-purple-400">Passthrough</Badge>;
        }
        return <Badge variant="secondary">Static</Badge>;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const domain = row.original;
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openDNSSettings(domain)}
            >
              <Settings2 className="h-4 w-4 mr-2" />
              Configure
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openDeleteDialog(domain)}
              className="text-destructive hover:text-destructive"
            >
              <Trash className="h-4 w-4" />
            </Button>
          </div>
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
          <h1 className="text-3xl font-semibold tracking-tight">DNS Management</h1>
          <p className="text-muted-foreground mt-1">Manage DNS records for your domains via Cloudflare or DNSPod.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDNSAccountDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            DNS Account
          </Button>
          <Button onClick={() => setShowAddDomainDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Domain
          </Button>
        </div>
      </div>

      {/* DNS Accounts Summary */}
      {dnsAccounts.length > 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">DNS Provider Accounts</CardTitle>
            <CardDescription>Connected DNS provider accounts for managing records</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {dnsAccounts.map((acc) => (
                <Badge key={acc.id} variant="secondary" className="flex items-center gap-2 py-1.5 px-3">
                  <span className={acc.provider === "cloudflare" ? "text-orange-400" : "text-blue-400"}>
                    {acc.provider === "cloudflare" ? "☁️ Cloudflare" : "🌐 DNSPod"}
                  </span>
                  <span className="font-medium">{acc.name}</span>
                  {acc.is_default && <CheckCircle className="h-3 w-3 text-green-400" />}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 ml-1 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteDNSAccount(acc.id)}
                  >
                    <Trash className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Domains Table */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Managed Domains</CardTitle>
          <CardDescription>Domains with DNS management enabled</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={domains} />
        </CardContent>
      </Card>

      {/* Add Domain Dialog */}
      <Dialog open={showAddDomainDialog} onOpenChange={setShowAddDomainDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Domain to DNS Management</DialogTitle>
            <DialogDescription>
              Enter a domain to manage its DNS records through this panel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Domain Name</Label>
              <Input
                placeholder="example.com"
                value={newFqdn}
                onChange={(e) => setNewFqdn(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>DNS Account (optional)</Label>
              <Select value={newDnsAccountId || "none"} onValueChange={(v) => setNewDnsAccountId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (manual)</SelectItem>
                  {dnsAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.provider === "cloudflare" ? "☁️" : "🌐"} {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDomainDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDomain} disabled={submitting}>
              {submitting ? "Adding..." : "Add Domain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DNS Account Dialog */}
      <Dialog open={showDNSAccountDialog} onOpenChange={setShowDNSAccountDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add DNS Provider Account</DialogTitle>
            <DialogDescription>
              Connect a DNS provider account to manage records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={dnsAccountForm.provider}
                onValueChange={(v) => setDnsAccountForm({ ...dnsAccountForm, provider: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cloudflare">☁️ Cloudflare</SelectItem>
                  <SelectItem value="dnspod">🌐 DNSPod</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account Name</Label>
              <Input
                placeholder="My Cloudflare Account"
                value={dnsAccountForm.name}
                onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, name: e.target.value })}
              />
            </div>
            {dnsAccountForm.provider === "dnspod" && (
              <div className="space-y-2">
                <Label>API ID</Label>
                <Input
                  placeholder="123456"
                  value={dnsAccountForm.api_id}
                  onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, api_id: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>API Token</Label>
              <Input
                type="password"
                placeholder="••••••••••••••••"
                value={dnsAccountForm.api_token}
                onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, api_token: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_default"
                checked={dnsAccountForm.is_default}
                onCheckedChange={(c) => setDnsAccountForm({ ...dnsAccountForm, is_default: !!c })}
              />
              <Label htmlFor="is_default" className="text-sm">Set as default account</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDNSAccountDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDNSAccount} disabled={submitting}>
              {submitting ? "Adding..." : "Add Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Domain from DNS Management</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{selectedDomain?.fqdn}</strong> from DNS management?
              This will delete all local DNS record data. Records on the provider will NOT be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDomain} disabled={submitting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {submitting ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
