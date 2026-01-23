"use client";

import { useState, useEffect } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/data-table";
import { api, DNSManagedDomain, DNSAccount, DNSRecord, NSStatus, DNSSyncResult, Machine, PassthroughPoolResponse, WildcardPoolResponse, RotationHistory, MachineGroupWithCount } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { Globe, CheckCircle, XCircle, Cloud, Plus, RefreshCw, AlertTriangle, X, Copy, Trash, Settings2, Play, Pause, RotateCcw, Server, History, Zap, Users } from "lucide-react";
import { toast } from "sonner";

export default function DNSManagementPage() {
  const [domains, setDomains] = useState<DNSManagedDomain[]>([]);
  const [dnsAccounts, setDnsAccounts] = useState<DNSAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDomainDialog, setShowAddDomainDialog] = useState(false);
  const [showDNSAccountDialog, setShowDNSAccountDialog] = useState(false);
  const [showDNSSettingsDialog, setShowDNSSettingsDialog] = useState(false);
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

  const handleAddDomain = async () => {
    if (!newFqdn.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.createDNSManagedDomain({
        fqdn: newFqdn.trim(),
        dns_account_id: newDnsAccountId || undefined,
      });
      setNewFqdn("");
      setNewDnsAccountId("");
      setShowAddDomainDialog(false);
      loadData();
      toast.success("Domain added for DNS management");
    } catch (err: unknown) {
      console.error("Failed to add domain:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add domain");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDomain = async () => {
    if (!selectedDomain || submitting) return;
    setSubmitting(true);
    try {
      await api.deleteDNSManagedDomain(selectedDomain.id);
      setShowDeleteDialog(false);
      setSelectedDomain(null);
      loadData();
      toast.success("Domain removed from DNS management");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete domain");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDNSAccount = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.createDNSAccount({
        provider: dnsAccountForm.provider,
        name: dnsAccountForm.name,
        api_id: dnsAccountForm.provider === "dnspod" ? dnsAccountForm.api_id : undefined,
        api_token: dnsAccountForm.api_token,
        is_default: dnsAccountForm.is_default,
      });
      setShowDNSAccountDialog(false);
      setDnsAccountForm({ provider: "dnspod", name: "", api_id: "", api_token: "", is_default: false });
      loadData();
      toast.success("DNS account created");
    } catch (err: unknown) {
      console.error("Failed to create DNS account:", err);
      toast.error(err instanceof Error ? err.message : "Failed to create DNS account");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDNSAccount = async (id: string) => {
    try {
      await api.deleteDNSAccount(id);
      loadData();
      toast.success("DNS account deleted");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
    }
  };

  const openDNSSettings = (domain: DNSManagedDomain) => {
    setSelectedDomain(domain);
    setShowDNSSettingsDialog(true);
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
            <XCircle className="h-3 w-3 mr-1" />
            Invalid NS
          </Badge>
        );
      default:
        return (
          <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">
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
      accessorKey: "ns_status",
      header: "NS Status",
      cell: ({ row }) => getNSStatusBadge(row.original.ns_status),
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
                  <button
                    onClick={() => handleDeleteDNSAccount(acc.id)}
                    className="ml-1 hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {dnsAccounts.length === 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardContent className="py-12 text-center">
            <Globe className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium mb-2">No DNS Accounts</h3>
            <p className="text-muted-foreground mb-4">
              Add a DNS provider account to start managing DNS records for your domains.
            </p>
            <Button onClick={() => setShowDNSAccountDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add DNS Account
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Domains Table */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">DNS Managed Domains</CardTitle>
          <CardDescription>Domains configured for DNS management through this system.</CardDescription>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <div className="py-12 text-center">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <h3 className="text-lg font-medium mb-2">No DNS Managed Domains</h3>
              <p className="text-muted-foreground mb-4">
                Add a domain to start managing its DNS records.
              </p>
              <Button onClick={() => setShowAddDomainDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Domain
              </Button>
            </div>
          ) : (
            <DataTable columns={columns} data={domains} searchKey="fqdn" searchPlaceholder="Search domains..." />
          )}
        </CardContent>
      </Card>

      {/* Add Domain Dialog */}
      <Dialog open={showAddDomainDialog} onOpenChange={setShowAddDomainDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Domain for DNS Management</DialogTitle>
            <DialogDescription>
              Add a domain to manage its DNS records through this system.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fqdn">Domain Name</Label>
              <Input
                id="fqdn"
                className="h-11"
                placeholder="example.com"
                value={newFqdn}
                onChange={(e) => setNewFqdn(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>DNS Account (optional)</Label>
              <Select value={newDnsAccountId || "_none"} onValueChange={(v) => setNewDnsAccountId(v === "_none" ? "" : v)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None (configure later)</SelectItem>
                  {dnsAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.provider === "cloudflare" ? "☁️ Cloudflare" : "🌐 DNSPod"}: {acc.name}
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
            <Button onClick={handleAddDomain} disabled={submitting || !newFqdn.trim()}>
              {submitting ? "Adding..." : "Add Domain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create DNS Account Dialog */}
      <Dialog open={showDNSAccountDialog} onOpenChange={setShowDNSAccountDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add DNS Account</DialogTitle>
            <DialogDescription>
              Connect a DNS provider account to manage records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={dnsAccountForm.provider}
                  onValueChange={(v) => setDnsAccountForm({ ...dnsAccountForm, provider: v })}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dnspod">🌐 DNSPod</SelectItem>
                    <SelectItem value="cloudflare">☁️ Cloudflare</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Account Name</Label>
                <Input
                  className="h-11"
                  placeholder="My DNSPod Account"
                  value={dnsAccountForm.name}
                  onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, name: e.target.value })}
                />
              </div>
            </div>
            {dnsAccountForm.provider === "dnspod" && (
              <div className="space-y-2">
                <Label>API ID (Token ID)</Label>
                <Input
                  className="h-11"
                  placeholder="123456"
                  value={dnsAccountForm.api_id}
                  onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, api_id: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{dnsAccountForm.provider === "cloudflare" ? "API Token" : "API Token (Secret)"}</Label>
              <Input
                className="h-11"
                type="password"
                placeholder="••••••••••••••••"
                value={dnsAccountForm.api_token}
                onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, api_token: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {dnsAccountForm.provider === "cloudflare" 
                  ? "Get this from Cloudflare Dashboard → My Profile → API Tokens"
                  : "Get this from DNSPod Console → Account → API Token"}
              </p>
            </div>
            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="is_default"
                checked={dnsAccountForm.is_default}
                onCheckedChange={(checked) => setDnsAccountForm({ ...dnsAccountForm, is_default: !!checked })}
              />
              <Label htmlFor="is_default" className="text-sm font-normal cursor-pointer">
                Set as default for this provider
              </Label>
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

      {/* DNS Settings Dialog */}
      <DNSSettingsDialog
        open={showDNSSettingsDialog}
        onOpenChange={setShowDNSSettingsDialog}
        domain={selectedDomain}
        dnsAccounts={dnsAccounts}
        onSave={() => {
          loadData();
          setShowDNSSettingsDialog(false);
        }}
      />

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

// Passthrough Record Row Component (for Separate mode)
function PassthroughRecordRow({
  record,
  domain,
  onEdit,
  onDelete,
  onRotate,
  onPauseResume,
}: {
  record: DNSRecord;
  domain: DNSManagedDomain;
  onEdit: () => void;
  onDelete: () => void;
  onRotate: (poolId: string, isWildcard: boolean) => void;
  onPauseResume: (poolId: string, isWildcard: boolean, isPaused: boolean) => void;
}) {
  const [poolData, setPoolData] = useState<PassthroughPoolResponse | null>(null);
  const [loadingPool, setLoadingPool] = useState(true);

  useEffect(() => {
    const loadPool = async () => {
      try {
        const data = await api.getRecordPool(record.id);
        setPoolData(data);
      } catch {
        // Pool might not exist
      } finally {
        setLoadingPool(false);
      }
    };
    loadPool();
  }, [record.id]);

  if (loadingPool) {
    return (
      <tr className="border-t">
        <td colSpan={5} className="p-3 text-center text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
          Loading...
        </td>
      </tr>
    );
  }

  const currentMachine = poolData?.members.find(m => m.machine_id === poolData.pool.current_machine_id);

  return (
    <tr className="border-t hover:bg-muted/30">
      <td className="p-3">
        <div className="font-mono font-medium">{record.name === "@" ? domain.fqdn : `${record.name}.${domain.fqdn}`}</div>
      </td>
      <td className="p-3">
        <div className="space-y-0.5">
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded block">
            HTTPS → {poolData?.pool.target_ip}:{poolData?.pool.target_port}
          </code>
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded block">
            HTTP → {poolData?.pool.target_ip}:{poolData?.pool.target_port_http || 80}
          </code>
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {poolData?.members.length || 0} machines
          </Badge>
          {currentMachine && (
            <span className="text-xs text-muted-foreground">
              → {currentMachine.machine_name} ({currentMachine.machine_ip})
            </span>
          )}
        </div>
      </td>
      <td className="p-3">
        {poolData?.pool.is_paused ? (
          <Badge variant="secondary" className="text-xs">⏸ Paused</Badge>
        ) : (
          <Badge variant="default" className="text-xs bg-green-600">▶ Active</Badge>
        )}
      </td>
      <td className="p-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {poolData && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onRotate(poolData.pool.id, false)} title="Rotate now">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onPauseResume(poolData.pool.id, false, poolData.pool.is_paused)} title={poolData.pool.is_paused ? "Resume" : "Pause"}>
                {poolData.pool.is_paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit} title="Edit">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive" title="Delete">
            <Trash className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// DNS Settings Dialog Component
function DNSSettingsDialog({
  open,
  onOpenChange,
  domain,
  dnsAccounts,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: DNSManagedDomain | null;
  dnsAccounts: DNSAccount[];
  onSave: () => void;
}) {
  const [activeTab, setActiveTab] = useState("settings");
  const [loading, setLoading] = useState(false);
  const [nsStatus, setNsStatus] = useState<NSStatus | null>(null);
  const [records, setRecords] = useState<DNSRecord[]>([]);
  const [syncResult, setSyncResult] = useState<DNSSyncResult | null>(null);
  const [expectedNS, setExpectedNS] = useState<{
    found: boolean;
    nameservers: string[];
    message: string;
    provider: string;
  } | null>(null);
  const [loadingNS, setLoadingNS] = useState(false);
  const [dnsLookupResult, setDnsLookupResult] = useState<{
    domain: string;
    subdomain: string;
    lookup: string;
    results: Record<string, { type: string; records: string[]; error?: string }>;
  } | null>(null);
  const [lookupSubdomain, setLookupSubdomain] = useState("@");
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [providerRecords, setProviderRecords] = useState<Array<{
    name: string;
    type: string;
    value: string;
    ttl: number;
    proxied?: boolean;
  }> | null>(null);
  const [loadingProviderRecords, setLoadingProviderRecords] = useState(false);

  // Form state
  const [dnsAccountId, setDnsAccountId] = useState<string>("");
  const [proxyMode, setProxyMode] = useState<string>("static");

  // Passthrough state
  const [machines, setMachines] = useState<Machine[]>([]);
  const [wildcardPool, setWildcardPool] = useState<WildcardPoolResponse | null>(null);
  const [selectedRecordForPool, setSelectedRecordForPool] = useState<DNSRecord | null>(null);
  const [recordPool, setRecordPool] = useState<PassthroughPoolResponse | null>(null);
  const [rotationHistory, setRotationHistory] = useState<RotationHistory[]>([]);
  const [showPoolConfig, setShowPoolConfig] = useState(false);
  const [poolForm, setPoolForm] = useState({
    target_ip: "",
    target_port: 443,
    target_port_http: 80,
    rotation_strategy: "round_robin",
    rotation_mode: "interval",
    interval_minutes: 60,
    scheduled_times: [] as string[],
    health_check_enabled: true,
    include_root: true,
    machine_ids: [] as string[],
    group_ids: [] as string[],
  });
  
  // Separate mode passthrough records
  const [showAddPassthrough, setShowAddPassthrough] = useState(false);
  const [editingPassthrough, setEditingPassthrough] = useState<DNSRecord | null>(null);
  const [passthroughForm, setPassthroughForm] = useState({
    name: "",
    target_ip: "",
    target_port: 443,
    target_port_http: 80,
    rotation_strategy: "round_robin",
    interval_minutes: 60,
    health_check_enabled: true,
    machine_ids: [] as string[],
    group_ids: [] as string[],
  });
  const [groups, setGroups] = useState<MachineGroupWithCount[]>([]);
  
  // Get passthrough records (mode = 'dynamic')
  const passthroughRecords = records.filter(r => r.mode === "dynamic" && r.record_type === "A");

  // Get selected account provider
  const selectedAccount = dnsAccounts.find(a => a.id === dnsAccountId);
  const isCloudflare = selectedAccount?.provider === "cloudflare";

  // New record form
  const [newRecord, setNewRecord] = useState({
    name: "",
    record_type: "A",
    value: "",
    ttl: 600,
    priority: 10,
    proxied: true,
    customPorts: false,
    httpInPort: 80,
    httpOutPort: 80,
    httpsInPort: 443,
    httpsOutPort: 443,
  });

  useEffect(() => {
    if (domain && open) {
      setDnsAccountId(domain.dns_account_id || "");
      setProxyMode(domain.proxy_mode || "static");
      setExpectedNS(null);
      setNsStatus(null);
      loadRecords();
      loadMachines();
      loadGroups();
      
      // Load nameservers if account is already set
      if (domain.dns_account_id) {
        loadExpectedNameservers(domain.dns_account_id);
      }
      
      // Load wildcard pool if in wildcard mode
      if (domain.proxy_mode === "wildcard") {
        loadWildcardPool();
      }
    }
  }, [domain, open]);

  const loadMachines = async () => {
    try {
      const data = await api.listMachines();
      setMachines(data);
    } catch (err) {
      console.error("Failed to load machines:", err);
    }
  };

  const loadGroups = async () => {
    try {
      const data = await api.listMachineGroups();
      setGroups(data);
    } catch (err) {
      console.error("Failed to load groups:", err);
    }
  };

  const loadWildcardPool = async () => {
    if (!domain) return;
    try {
      const data = await api.getWildcardPool(domain.id);
      setWildcardPool(data);
      setPoolForm({
        target_ip: data.pool.target_ip,
        target_port: data.pool.target_port,
        target_port_http: data.pool.target_port_http || 80,
        rotation_strategy: data.pool.rotation_strategy,
        rotation_mode: data.pool.rotation_mode,
        interval_minutes: data.pool.interval_minutes,
        scheduled_times: data.pool.scheduled_times || [],
        health_check_enabled: data.pool.health_check_enabled,
        include_root: data.pool.include_root,
        machine_ids: data.members.map(m => m.machine_id),
        group_ids: data.pool.group_ids || [],
      });
    } catch {
      // No pool yet
      setWildcardPool(null);
    }
  };

  const loadRecordPool = async (record: DNSRecord) => {
    try {
      const data = await api.getRecordPool(record.id);
      setRecordPool(data);
      setPoolForm({
        target_ip: data.pool.target_ip,
        target_port: data.pool.target_port,
        target_port_http: data.pool.target_port_http || 80,
        rotation_strategy: data.pool.rotation_strategy,
        rotation_mode: data.pool.rotation_mode,
        interval_minutes: data.pool.interval_minutes,
        scheduled_times: data.pool.scheduled_times || [],
        health_check_enabled: data.pool.health_check_enabled,
        include_root: true,
        machine_ids: data.members.map(m => m.machine_id),
        group_ids: data.pool.group_ids || [],
      });
      // Load history
      const history = await api.getRotationHistory(data.pool.id);
      setRotationHistory(history);
    } catch {
      setRecordPool(null);
      setPoolForm({
        target_ip: "",
        target_port: 443,
        target_port_http: 80,
        rotation_strategy: "round_robin",
        rotation_mode: "interval",
        interval_minutes: 60,
        scheduled_times: [],
        health_check_enabled: true,
        include_root: true,
        machine_ids: [],
        group_ids: [],
      });
      setRotationHistory([]);
    }
  };

  const loadRecords = async () => {
    if (!domain) return;
    try {
      const data = await api.listDNSRecords(domain.id);
      setRecords(data);
    } catch (err) {
      console.error("Failed to load records:", err);
    }
  };

  const loadExpectedNameservers = async (accountId: string) => {
    if (!domain || !accountId) {
      setExpectedNS(null);
      return;
    }
    setLoadingNS(true);
    try {
      const result = await api.getExpectedNameservers(accountId, domain.fqdn);
      setExpectedNS(result);
    } catch (err) {
      console.error("Failed to get expected nameservers:", err);
      setExpectedNS(null);
    } finally {
      setLoadingNS(false);
    }
  };

  const handleAccountChange = (value: string) => {
    const newAccountId = value === "_none" ? "" : value;
    setDnsAccountId(newAccountId);
    if (newAccountId) {
      loadExpectedNameservers(newAccountId);
    } else {
      setExpectedNS(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!domain) return;
    setLoading(true);
    try {
      await api.updateDNSManagedDomain(domain.id, {
        dns_account_id: dnsAccountId || null,
      });
      // Update proxy mode if changed
      if (proxyMode !== domain.proxy_mode) {
        await api.setDomainProxyMode(domain.id, proxyMode);
      }
      toast.success("DNS settings saved");
      onSave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWildcardPool = async () => {
    if (!domain) return;
    const hasMachines = poolForm.machine_ids.length > 0 || poolForm.group_ids.length > 0;
    if (!poolForm.target_ip || !hasMachines) {
      toast.error("Target IP and at least one machine or group are required");
      return;
    }
    setLoading(true);
    try {
      await api.createOrUpdateWildcardPool(domain.id, {
        include_root: poolForm.include_root,
        target_ip: poolForm.target_ip,
        target_port: poolForm.target_port,
        target_port_http: poolForm.target_port_http,
        rotation_strategy: poolForm.rotation_strategy,
        rotation_mode: poolForm.rotation_mode,
        interval_minutes: poolForm.interval_minutes,
        scheduled_times: poolForm.scheduled_times,
        health_check_enabled: poolForm.health_check_enabled,
        machine_ids: poolForm.machine_ids,
        group_ids: poolForm.group_ids,
      });
      toast.success("Wildcard pool saved");
      loadWildcardPool();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save pool");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRecordPool = async () => {
    if (!selectedRecordForPool) return;
    const hasMachines = poolForm.machine_ids.length > 0 || poolForm.group_ids.length > 0;
    if (!poolForm.target_ip || !hasMachines) {
      toast.error("Target IP and at least one machine or group are required");
      return;
    }
    setLoading(true);
    try {
      await api.createOrUpdateRecordPool(selectedRecordForPool.id, {
        target_ip: poolForm.target_ip,
        target_port: poolForm.target_port,
        rotation_strategy: poolForm.rotation_strategy,
        rotation_mode: poolForm.rotation_mode,
        interval_minutes: poolForm.interval_minutes,
        scheduled_times: poolForm.scheduled_times,
        health_check_enabled: poolForm.health_check_enabled,
        machine_ids: poolForm.machine_ids,
        group_ids: poolForm.group_ids,
      });
      toast.success("Pool saved - record set to dynamic mode");
      setShowPoolConfig(false);
      loadRecords();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save pool");
    } finally {
      setLoading(false);
    }
  };

  const handleRotateNow = async (poolId: string, isWildcard: boolean) => {
    try {
      if (isWildcard) {
        await api.rotateWildcardPool(poolId);
      } else {
        await api.rotateRecordPool(poolId);
      }
      toast.success("Rotation triggered");
      if (isWildcard) {
        loadWildcardPool();
      } else if (selectedRecordForPool) {
        loadRecordPool(selectedRecordForPool);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Rotation failed");
    }
  };

  const handlePauseResume = async (poolId: string, isWildcard: boolean, isPaused: boolean) => {
    try {
      if (isWildcard) {
        isPaused ? await api.resumeWildcardPool(poolId) : await api.pauseWildcardPool(poolId);
      } else {
        isPaused ? await api.resumeRecordPool(poolId) : await api.pauseRecordPool(poolId);
      }
      toast.success(isPaused ? "Rotation resumed" : "Rotation paused");
      if (isWildcard) {
        loadWildcardPool();
      } else if (selectedRecordForPool) {
        loadRecordPool(selectedRecordForPool);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDeleteRecordPool = async () => {
    if (!selectedRecordForPool) return;
    try {
      await api.deleteRecordPool(selectedRecordForPool.id);
      toast.success("Pool deleted - record set to static mode");
      setShowPoolConfig(false);
      setRecordPool(null);
      loadRecords();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete pool");
    }
  };

  // Separate mode: Create/Edit passthrough record
  const handleSavePassthroughRecord = async () => {
    const hasMachines = passthroughForm.machine_ids.length > 0 || passthroughForm.group_ids.length > 0;
    if (!domain || !passthroughForm.name || !passthroughForm.target_ip || !hasMachines) {
      toast.error("Please fill all required fields (need at least one machine or group)");
      return;
    }
    setLoading(true);
    try {
      let recordId = editingPassthrough?.id;
      
      // If creating new, first create the DNS record
      if (!editingPassthrough) {
        // Create A record with mode=dynamic
        const newRec = await api.createDNSRecord(domain.id, {
          name: passthroughForm.name,
          record_type: "A",
          value: "0.0.0.0", // Placeholder, will be managed by pool
          ttl: 60,
          priority: 0,
          proxied: false,
          httpInPort: 80,
          httpOutPort: 80,
          httpsInPort: 443,
          httpsOutPort: 443,
        });
        recordId = newRec.id;
      }
      
      // Create/update the passthrough pool
      await api.createOrUpdateRecordPool(recordId!, {
        target_ip: passthroughForm.target_ip,
        target_port: passthroughForm.target_port,
        target_port_http: passthroughForm.target_port_http,
        rotation_strategy: passthroughForm.rotation_strategy,
        rotation_mode: "interval",
        interval_minutes: passthroughForm.interval_minutes,
        health_check_enabled: passthroughForm.health_check_enabled,
        machine_ids: passthroughForm.machine_ids,
        group_ids: passthroughForm.group_ids,
      });
      
      toast.success(editingPassthrough ? "Passthrough record updated" : "Passthrough record created");
      setShowAddPassthrough(false);
      setEditingPassthrough(null);
      resetPassthroughForm();
      loadRecords();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save passthrough record");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePassthroughRecord = async (record: DNSRecord) => {
    if (!domain) return;
    try {
      // Delete the pool first (sets mode back to static)
      await api.deleteRecordPool(record.id);
      // Then delete the record itself
      await api.deleteDNSRecord(domain.id, record.id);
      toast.success("Passthrough record deleted");
      loadRecords();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const editPassthroughRecord = async (record: DNSRecord) => {
    setEditingPassthrough(record);
    setShowAddPassthrough(true);
    // Load existing pool config
    try {
      const poolData = await api.getRecordPool(record.id);
      setPassthroughForm({
        name: record.name,
        target_ip: poolData.pool.target_ip,
        target_port: poolData.pool.target_port,
        target_port_http: poolData.pool.target_port_http || 80,
        rotation_strategy: poolData.pool.rotation_strategy,
        interval_minutes: poolData.pool.interval_minutes,
        health_check_enabled: poolData.pool.health_check_enabled,
        machine_ids: poolData.members.map(m => m.machine_id),
        group_ids: poolData.pool.group_ids || [],
      });
    } catch {
      // Pool might not exist yet
      setPassthroughForm(f => ({ ...f, name: record.name, group_ids: [], target_port_http: 80 }));
    }
  };

  const resetPassthroughForm = () => {
    setPassthroughForm({
      name: "",
      target_ip: "",
      target_port: 443,
      target_port_http: 80,
      rotation_strategy: "round_robin",
      interval_minutes: 60,
      health_check_enabled: true,
      machine_ids: [],
      group_ids: [],
    });
  };

  const openPoolConfig = (record: DNSRecord) => {
    setSelectedRecordForPool(record);
    loadRecordPool(record);
    setShowPoolConfig(true);
  };

  const handleCheckNS = async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const status = await api.checkDNSDomainNS(domain.id);
      setNsStatus(status);
      toast.success("NS check completed");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to check NS");
    } finally {
      setLoading(false);
    }
  };

  const handleDNSLookup = async () => {
    if (!domain) return;
    setLoadingLookup(true);
    try {
      const result = await api.lookupDNS(domain.id, lookupSubdomain === "@" ? "" : lookupSubdomain);
      setDnsLookupResult(result);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to lookup DNS");
    } finally {
      setLoadingLookup(false);
    }
  };

  const handleListProviderRecords = async () => {
    if (!domain) return;
    setLoadingProviderRecords(true);
    try {
      const result = await api.listRemoteRecords(domain.id);
      setProviderRecords(result.records);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch provider records");
    } finally {
      setLoadingProviderRecords(false);
    }
  };

  const handleAddRecord = async () => {
    if (!domain) return;
    try {
      await api.createDNSRecord(domain.id, {
        name: newRecord.name,
        record_type: newRecord.record_type,
        value: newRecord.value,
        ttl: newRecord.ttl,
        priority: newRecord.record_type === "MX" ? newRecord.priority : undefined,
        proxied: isCloudflare ? newRecord.proxied : false,
        http_incoming_port: newRecord.customPorts ? newRecord.httpInPort : undefined,
        http_outgoing_port: newRecord.customPorts ? newRecord.httpOutPort : undefined,
        https_incoming_port: newRecord.customPorts ? newRecord.httpsInPort : undefined,
        https_outgoing_port: newRecord.customPorts ? newRecord.httpsOutPort : undefined,
      });
      setNewRecord({ 
        name: "", 
        record_type: "A", 
        value: "", 
        ttl: 600, 
        priority: 10, 
        proxied: true, 
        customPorts: false,
        httpInPort: 80,
        httpOutPort: 80,
        httpsInPort: 443,
        httpsOutPort: 443,
      });
      loadRecords();
      toast.success("Record added");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add record");
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!domain) return;
    try {
      await api.deleteDNSRecord(domain.id, recordId);
      loadRecords();
      toast.success("Record deleted");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete record");
    }
  };

  const handleCompareRecords = async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const result = await api.compareDNSRecords(domain.id);
      setSyncResult(result);
      loadRecords();
      if (result.in_sync) {
        toast.success("Records are in sync");
      } else {
        toast.info(`Found ${result.conflicts.length} conflicts, ${result.created.length} local-only, ${result.deleted.length} remote-only`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to compare records");
    } finally {
      setLoading(false);
    }
  };

  const handleApplyToRemote = async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const result = await api.applyDNSToRemote(domain.id);
      setSyncResult(null);
      loadRecords();
      toast.success(`Applied: ${result.created.length} created, ${result.updated.length} updated, ${result.deleted.length} deleted`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to apply changes");
    } finally {
      setLoading(false);
    }
  };

  const handleImportFromRemote = async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const result = await api.importDNSFromRemote(domain.id);
      setSyncResult(null);
      loadRecords();
      toast.success(`Imported ${result.imported} records`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to import records");
    } finally {
      setLoading(false);
    }
  };

  if (!domain) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            DNS Settings: {domain.fqdn}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="records" disabled={!dnsAccountId || proxyMode !== "static"}>Records</TabsTrigger>
            <TabsTrigger value="passthrough" disabled={!dnsAccountId || proxyMode === "static"}>Passthrough</TabsTrigger>
            <TabsTrigger value="sync" disabled={!dnsAccountId || proxyMode !== "static"}>Sync</TabsTrigger>
            <TabsTrigger value="debug" disabled={!dnsAccountId}>Debug</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-6 mt-6">
            {/* DNS Account */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">DNS Account</Label>
              <Select value={dnsAccountId || "_none"} onValueChange={handleAccountChange}>
                <SelectTrigger className="h-10 w-full sm:w-80">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {dnsAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.provider === "cloudflare" ? "☁️ Cloudflare" : "🌐 DNSPod"}: {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dnsAccounts.length === 0 && (
                <p className="text-xs text-muted-foreground">No DNS accounts configured. Add one from the main page.</p>
              )}
              
              {/* Expected Nameservers */}
              {dnsAccountId && (
                <div className="mt-3 p-3 rounded-md bg-muted/30 border">
                  {loadingNS ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Loading nameservers...
                    </div>
                  ) : expectedNS ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {expectedNS.found ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        )}
                        <span className="text-sm font-medium">{expectedNS.message}</span>
                      </div>
                      {expectedNS.found && expectedNS.nameservers.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">Point your domain to these nameservers:</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={async () => {
                                await copyToClipboard(expectedNS.nameservers.join("\n"));
                                toast.success("Nameservers copied to clipboard");
                              }}
                            >
                              <Copy className="h-3 w-3 mr-1" />
                              Copy
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {expectedNS.nameservers.map((ns, i) => (
                              <code
                                key={i}
                                className="px-2 py-1 bg-background rounded text-xs font-mono cursor-pointer hover:bg-muted transition-colors"
                                onClick={async () => {
                                  await copyToClipboard(ns);
                                  toast.success(`Copied: ${ns}`);
                                }}
                                title="Click to copy"
                              >
                                {ns}
                              </code>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Proxy Mode Selector - Right after DNS Account */}
            {dnsAccountId && (
              <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
                <div>
                  <Label className="text-sm font-medium">Proxy Mode</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">How DNS records are routed</p>
                </div>
                <div className="flex gap-4">
                  <label className={`flex-1 p-3 rounded-lg border cursor-pointer transition-colors ${proxyMode === "static" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                    <input
                      type="radio"
                      name="proxy_mode"
                      value="static"
                      checked={proxyMode === "static"}
                      onChange={() => setProxyMode("static")}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="h-4 w-4" />
                      <span className="font-medium text-sm">Static (DNS Provider)</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Manage DNS records directly with your provider. Standard DNS management.</p>
                  </label>
                  <label className={`flex-1 p-3 rounded-lg border cursor-pointer transition-colors ${proxyMode !== "static" ? "border-purple-500 bg-purple-500/10" : "border-border hover:bg-muted/30"}`}>
                    <input
                      type="radio"
                      name="proxy_mode"
                      value="passthrough"
                      checked={proxyMode !== "static"}
                      onChange={() => setProxyMode("separate")}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="h-4 w-4" />
                      <span className="font-medium text-sm">Passthrough (Dynamic)</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Route traffic through rotating proxy pools. DNS auto-managed.</p>
                  </label>
                </div>
                {proxyMode !== "static" && (
                  <p className="text-xs text-muted-foreground bg-purple-500/10 p-2 rounded">
                    ⚡ Passthrough mode enabled. Configure pools in the <strong>Passthrough</strong> tab.
                  </p>
                )}
              </div>
            )}

            {/* No Account Message */}
            {!dnsAccountId && (
              <div className="p-6 text-center border rounded-lg bg-muted/10">
                <Globe className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-muted-foreground">No DNS account selected.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Select a DNS account above to manage records for this domain.
                </p>
              </div>
            )}

            <DialogFooter className="pt-4 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSaveSettings} disabled={loading}>Save Settings</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="records" className="space-y-6 mt-6">
            {!dnsAccountId ? (
              <div className="p-12 text-center border rounded-lg bg-muted/10">
                <Globe className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">DNS records management requires a configured DNS account.</p>
                <p className="text-sm text-muted-foreground mt-1">Select a DNS account in the Settings tab.</p>
              </div>
            ) : (
              <>
                {/* Add Record Form */}
                <div className="p-4 border rounded-lg bg-muted/10 space-y-4">
                  <Label className="text-sm font-medium">Add New Record</Label>
                  
                  <div className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-2 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input
                        className="h-10"
                        placeholder="@, www, *"
                        value={newRecord.name}
                        onChange={(e) => setNewRecord({ ...newRecord, name: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Type</Label>
                      <Select
                        value={newRecord.record_type}
                        onValueChange={(v) => setNewRecord({ ...newRecord, record_type: v })}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A">A</SelectItem>
                          <SelectItem value="AAAA">AAAA</SelectItem>
                          <SelectItem value="CNAME">CNAME</SelectItem>
                          <SelectItem value="TXT">TXT</SelectItem>
                          <SelectItem value="MX">MX</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-4 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Value</Label>
                      <Input
                        className="h-10"
                        placeholder="IP address or target hostname"
                        value={newRecord.value}
                        onChange={(e) => setNewRecord({ ...newRecord, value: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">TTL</Label>
                      <Input
                        className="h-10"
                        type="number"
                        value={newRecord.ttl}
                        onChange={(e) => setNewRecord({ ...newRecord, ttl: parseInt(e.target.value) || 600 })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Button className="h-10 w-full" onClick={handleAddRecord} disabled={!newRecord.name || !newRecord.value}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Options row */}
                  <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-border/50">
                    {isCloudflare && (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="newRecordProxied"
                          checked={newRecord.proxied}
                          onCheckedChange={(checked) => setNewRecord({ ...newRecord, proxied: !!checked })}
                        />
                        <Label htmlFor="newRecordProxied" className="text-sm font-normal cursor-pointer flex items-center gap-1">
                          <Cloud className={`h-4 w-4 ${newRecord.proxied ? "text-orange-400" : "text-muted-foreground"}`} />
                          Proxied (CF)
                        </Label>
                      </div>
                    )}

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="newRecordCustomPorts"
                        checked={newRecord.customPorts}
                        onCheckedChange={(checked) => setNewRecord({ ...newRecord, customPorts: !!checked })}
                      />
                      <Label htmlFor="newRecordCustomPorts" className="text-sm font-normal cursor-pointer">
                        Custom Ports
                      </Label>
                    </div>

                    {newRecord.customPorts && (
                      <div className="flex items-center gap-3 ml-4">
                        <div className="flex items-center gap-1">
                          <Label className="text-xs text-muted-foreground whitespace-nowrap">HTTP:</Label>
                          <Input
                            className="h-8 w-16 text-xs"
                            type="number"
                            value={newRecord.httpInPort}
                            onChange={(e) => setNewRecord({ ...newRecord, httpInPort: parseInt(e.target.value) || 80 })}
                          />
                          <span className="text-muted-foreground">→</span>
                          <Input
                            className="h-8 w-16 text-xs"
                            type="number"
                            value={newRecord.httpOutPort}
                            onChange={(e) => setNewRecord({ ...newRecord, httpOutPort: parseInt(e.target.value) || 80 })}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <Label className="text-xs text-muted-foreground whitespace-nowrap">HTTPS:</Label>
                          <Input
                            className="h-8 w-16 text-xs"
                            type="number"
                            value={newRecord.httpsInPort}
                            onChange={(e) => setNewRecord({ ...newRecord, httpsInPort: parseInt(e.target.value) || 443 })}
                          />
                          <span className="text-muted-foreground">→</span>
                          <Input
                            className="h-8 w-16 text-xs"
                            type="number"
                            value={newRecord.httpsOutPort}
                            onChange={(e) => setNewRecord({ ...newRecord, httpsOutPort: parseInt(e.target.value) || 443 })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Records Table */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Name</th>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-left p-2 font-medium">Value / Pool</th>
                        <th className="text-left p-2 font-medium">Mode</th>
                        <th className="text-left p-2 font-medium">TTL</th>
                        {isCloudflare && <th className="text-left p-2 font-medium">Proxy</th>}
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.length === 0 ? (
                        <tr>
                          <td colSpan={isCloudflare ? 7 : 6} className="p-8 text-center text-muted-foreground">
                            No records yet. Add one above or import from provider.
                          </td>
                        </tr>
                      ) : (
                        records.map((record) => (
                          <tr key={record.id} className="border-t hover:bg-muted/30">
                            <td className="p-2 font-mono">{record.name}</td>
                            <td className="p-2">
                              <Badge variant="outline">{record.record_type}</Badge>
                            </td>
                            <td className="p-2 font-mono text-xs max-w-[150px] truncate" title={record.value}>
                              {record.mode === "dynamic" ? (
                                <span className="text-purple-400">🔄 Dynamic pool</span>
                              ) : (
                                record.value
                              )}
                            </td>
                            <td className="p-2">
                              {record.record_type === "A" ? (
                                <Badge 
                                  variant={record.mode === "dynamic" ? "default" : "secondary"}
                                  className={`cursor-pointer text-xs ${record.mode === "dynamic" ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" : "hover:bg-muted"}`}
                                  onClick={() => openPoolConfig(record)}
                                >
                                  {record.mode === "dynamic" ? "⚡ Dynamic" : "Static"}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">Static</span>
                              )}
                            </td>
                            <td className="p-2">{record.ttl}</td>
                            {isCloudflare && (
                              <td className="p-2">
                                {record.proxied ? (
                                  <Cloud className="h-4 w-4 text-orange-400" title="Proxied" />
                                ) : (
                                  <Cloud className="h-4 w-4 text-muted-foreground/30" title="DNS only" />
                                )}
                              </td>
                            )}
                            <td className="p-2">
                              {record.sync_status === "synced" && (
                                <Badge className="bg-green-500/20 text-green-400 text-xs">Synced</Badge>
                              )}
                              {record.sync_status === "pending" && (
                                <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Pending</Badge>
                              )}
                              {record.sync_status === "conflict" && (
                                <Badge className="bg-red-500/20 text-red-400 text-xs">Conflict</Badge>
                              )}
                              {record.sync_status === "local_only" && (
                                <Badge className="bg-blue-500/20 text-blue-400 text-xs">Local Only</Badge>
                              )}
                              {record.sync_status === "error" && (
                                <Badge className="bg-red-500/20 text-red-400 text-xs">Error</Badge>
                              )}
                            </td>
                            <td className="p-2 flex gap-1">
                              {record.record_type === "A" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 hover:text-purple-400"
                                  onClick={() => openPoolConfig(record)}
                                  title="Configure passthrough"
                                >
                                  <Zap className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:text-destructive"
                                onClick={() => handleDeleteRecord(record.id)}
                                title="Delete record"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </TabsContent>

          {/* Passthrough Tab - Dynamic Mode Configuration */}
          <TabsContent value="passthrough" className="space-y-6 mt-6">
            {/* Passthrough Mode Selector */}
            <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
              <div>
                <Label className="text-sm font-medium">Passthrough Mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">How proxy pools are organized</p>
              </div>
              <div className="flex gap-4">
                <label className={`flex-1 p-3 rounded-lg border cursor-pointer transition-colors ${proxyMode === "separate" ? "border-purple-500 bg-purple-500/10" : "border-border hover:bg-muted/30"}`}>
                  <input
                    type="radio"
                    name="passthrough_mode"
                    value="separate"
                    checked={proxyMode === "separate"}
                    onChange={() => setProxyMode("separate")}
                    className="sr-only"
                  />
                  <div className="flex items-center gap-2 mb-1">
                    <Settings2 className="h-4 w-4" />
                    <span className="font-medium text-sm">Separate Records</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Each subdomain has its own pool, target server, and port config.</p>
                </label>
                <label className={`flex-1 p-3 rounded-lg border cursor-pointer transition-colors ${proxyMode === "wildcard" ? "border-purple-500 bg-purple-500/10" : "border-border hover:bg-muted/30"}`}>
                  <input
                    type="radio"
                    name="passthrough_mode"
                    value="wildcard"
                    checked={proxyMode === "wildcard"}
                    onChange={() => setProxyMode("wildcard")}
                    className="sr-only"
                  />
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="h-4 w-4" />
                    <span className="font-medium text-sm">Wildcard</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Single pool handles *.{domain?.fqdn}. One target server for all.</p>
                </label>
              </div>
            </div>

            {/* Separate Mode - Per-record configuration */}
            {proxyMode === "separate" && (
              <div className="space-y-4">
                <div className="p-4 border rounded-lg bg-gradient-to-r from-purple-500/10 to-blue-500/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Settings2 className="h-5 w-5 text-purple-500" />
                        <h3 className="font-semibold">Separate Records Passthrough</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Each subdomain has its own proxy pool and target server.
                      </p>
                    </div>
                    <Button onClick={() => { resetPassthroughForm(); setEditingPassthrough(null); setShowAddPassthrough(true); }}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Record
                    </Button>
                  </div>
                </div>
                
                {/* Passthrough Records List */}
                {passthroughRecords.length === 0 ? (
                  <div className="p-6 text-center border rounded-lg border-dashed">
                    <Zap className="h-8 w-8 mx-auto mb-3 text-purple-500 opacity-50" />
                    <p className="text-muted-foreground text-sm">
                      No passthrough records configured yet.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Click "Add Record" to create your first passthrough subdomain.
                    </p>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium">Subdomain</th>
                          <th className="text-left p-3 font-medium">Target</th>
                          <th className="text-left p-3 font-medium">Pool</th>
                          <th className="text-left p-3 font-medium">Status</th>
                          <th className="text-right p-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {passthroughRecords.map((record) => (
                          <PassthroughRecordRow 
                            key={record.id} 
                            record={record} 
                            domain={domain}
                            onEdit={() => editPassthroughRecord(record)}
                            onDelete={() => handleDeletePassthroughRecord(record)}
                            onRotate={handleRotateNow}
                            onPauseResume={handlePauseResume}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Add/Edit Passthrough Record Form */}
                {showAddPassthrough && (
                  <div className="p-4 border rounded-lg bg-muted/10 space-y-5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{editingPassthrough ? "Edit" : "New"} Passthrough Record</h4>
                      <Button variant="ghost" size="sm" onClick={() => { setShowAddPassthrough(false); setEditingPassthrough(null); }}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    {/* Subdomain */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Subdomain</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="www"
                          value={passthroughForm.name}
                          onChange={(e) => setPassthroughForm(f => ({ ...f, name: e.target.value }))}
                          disabled={!!editingPassthrough}
                          className="max-w-[200px]"
                        />
                        <span className="text-sm text-muted-foreground">.{domain?.fqdn}</span>
                      </div>
                    </div>

                    {/* Target Configuration */}
                    <div className="space-y-2 p-3 border rounded-md bg-background/50">
                      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Configuration</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Target IP</Label>
                          <Input
                            placeholder="192.168.1.100"
                            value={passthroughForm.target_ip}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, target_ip: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">HTTPS (443 →)</Label>
                          <Input
                            type="number"
                            placeholder="443"
                            value={passthroughForm.target_port}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, target_port: parseInt(e.target.value) || 443 }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">HTTP (80 →)</Label>
                          <Input
                            type="number"
                            placeholder="80"
                            value={passthroughForm.target_port_http}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, target_port_http: parseInt(e.target.value) || 80 }))}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Rotation Settings */}
                    <div className="space-y-2 p-3 border rounded-md bg-background/50">
                      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rotation Settings</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        <div className="space-y-1">
                          <Label className="text-xs">Strategy</Label>
                          <Select value={passthroughForm.rotation_strategy} onValueChange={(v) => setPassthroughForm(f => ({ ...f, rotation_strategy: v }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="round_robin">Round Robin</SelectItem>
                              <SelectItem value="random">Random</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Interval (minutes)</Label>
                          <Input
                            type="number"
                            value={passthroughForm.interval_minutes}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, interval_minutes: parseInt(e.target.value) || 60 }))}
                          />
                        </div>
                        <div className="flex items-center gap-2 h-9">
                          <Checkbox
                            id="pt_health_check"
                            checked={passthroughForm.health_check_enabled}
                            onCheckedChange={(c) => setPassthroughForm(f => ({ ...f, health_check_enabled: !!c }))}
                          />
                          <Label htmlFor="pt_health_check" className="text-xs">Skip offline servers</Label>
                        </div>
                      </div>
                    </div>

                    {/* Proxy Pool Selection */}
                    <div className="space-y-3 p-3 border rounded-md bg-background/50">
                      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Proxy Pool</Label>
                      
                      {/* Group Selection */}
                      <div className="space-y-1.5">
                        <Label className="text-xs flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          Groups (machines auto-included)
                        </Label>
                      {groups.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-2 border rounded-md">No groups created yet</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {groups.map((group) => {
                            const isSelected = passthroughForm.group_ids.includes(group.id);
                            return (
                              <Badge
                                key={group.id}
                                variant={isSelected ? "default" : "outline"}
                                className="cursor-pointer"
                                style={isSelected ? { backgroundColor: group.color || undefined } : undefined}
                                onClick={() => {
                                  setPassthroughForm(f => ({
                                    ...f,
                                    group_ids: isSelected
                                      ? f.group_ids.filter(id => id !== group.id)
                                      : [...f.group_ids, group.id]
                                  }));
                                }}
                              >
                                {group.emoji && <span className="mr-1">{group.emoji}</span>}
                                {group.name}
                                <span className="ml-1 opacity-70">({group.machine_count})</span>
                              </Badge>
                            );
                          })}
                        </div>
                      )}
                    </div>

                      {/* Machine Selection */}
                      <div className="space-y-1.5 mt-3 pt-3 border-t border-dashed">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs flex items-center gap-1">
                            <Server className="h-3 w-3" />
                            Individual Machines
                          </Label>
                          <div className="flex gap-1">
                            <Button 
                              type="button"
                              variant="ghost" 
                              size="sm" 
                              className="h-5 text-[10px] px-1.5"
                              onClick={() => setPassthroughForm(f => ({ ...f, machine_ids: machines.map(m => m.id) }))}
                            >
                              All
                            </Button>
                            <Button 
                              type="button"
                              variant="ghost" 
                              size="sm" 
                              className="h-5 text-[10px] px-1.5"
                              onClick={() => setPassthroughForm(f => ({ ...f, machine_ids: [] }))}
                            >
                              None
                            </Button>
                          </div>
                        </div>
                        <div className="border rounded-md max-h-32 overflow-y-auto bg-background">
                          {machines.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground text-center">No machines available</p>
                          ) : (
                            machines.map((machine) => {
                              const isSelected = passthroughForm.machine_ids.includes(machine.id);
                              const isOnline = machine.status === "online";
                              return (
                                <label
                                  key={machine.id}
                                  className={`flex items-center gap-2 p-1.5 hover:bg-muted/30 cursor-pointer border-b last:border-b-0 ${isSelected ? "bg-primary/5" : ""}`}
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) => {
                                      setPassthroughForm(f => ({
                                        ...f,
                                        machine_ids: checked
                                          ? [...f.machine_ids, machine.id]
                                          : f.machine_ids.filter(id => id !== machine.id)
                                      }));
                                    }}
                                  />
                                  <div className={`h-2 w-2 rounded-full flex-shrink-0 ${isOnline ? "bg-green-500" : "bg-red-500"}`} />
                                  <span className="text-xs font-medium">{machine.name || machine.hostname || "Unknown"}</span>
                                  <span className="text-muted-foreground">-</span>
                                  <span className="text-xs text-muted-foreground font-mono">{machine.ip_address}</span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground pt-2">
                        {passthroughForm.group_ids.length > 0 && (
                          <span className="text-primary font-medium">{passthroughForm.group_ids.length} group(s)</span>
                        )}
                        {passthroughForm.group_ids.length > 0 && passthroughForm.machine_ids.length > 0 && " + "}
                        {passthroughForm.machine_ids.length > 0 && (
                          <span>{passthroughForm.machine_ids.length} individual machine(s)</span>
                        )}
                        {passthroughForm.group_ids.length === 0 && passthroughForm.machine_ids.length === 0 && (
                          <span className="text-destructive">No machines selected</span>
                        )}
                      </p>
                    </div>

                    <div className="flex justify-end gap-2 pt-3">
                      <Button variant="outline" onClick={() => { setShowAddPassthrough(false); setEditingPassthrough(null); }}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleSavePassthroughRecord} 
                        disabled={loading || !passthroughForm.name || !passthroughForm.target_ip || (passthroughForm.machine_ids.length === 0 && passthroughForm.group_ids.length === 0)}
                      >
                        {loading ? "Saving..." : (editingPassthrough ? "Update" : "Create")} Record
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Wildcard Mode - Single pool configuration */}
            {proxyMode === "wildcard" && (
              <>
            <div className="p-4 border rounded-lg bg-gradient-to-r from-purple-500/10 to-blue-500/10">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-5 w-5 text-purple-500" />
                <h3 className="font-semibold">Wildcard Passthrough: *.{domain?.fqdn}</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                All subdomains will route through your proxy pool. DNS records will automatically rotate between selected machines.
              </p>
            </div>

            {/* Pool Configuration */}
            <div className="space-y-4 p-4 border rounded-lg">
              <h4 className="font-medium">Target Server</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Target IP (final destination)</Label>
                  <Input
                    placeholder="192.168.1.100"
                    value={poolForm.target_ip}
                    onChange={(e) => setPoolForm(f => ({ ...f, target_ip: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">HTTPS Port (443→)</Label>
                  <Input
                    type="number"
                    placeholder="443"
                    value={poolForm.target_port}
                    onChange={(e) => setPoolForm(f => ({ ...f, target_port: parseInt(e.target.value) || 443 }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">HTTP Port (80→)</Label>
                  <Input
                    type="number"
                    placeholder="80"
                    value={poolForm.target_port_http}
                    onChange={(e) => setPoolForm(f => ({ ...f, target_port_http: parseInt(e.target.value) || 80 }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="include_root"
                  checked={poolForm.include_root}
                  onCheckedChange={(c) => setPoolForm(f => ({ ...f, include_root: !!c }))}
                />
                <Label htmlFor="include_root" className="text-sm">Include root domain ({domain?.fqdn})</Label>
              </div>
            </div>

            {/* Proxy Pool */}
            <div className="space-y-4 p-4 border rounded-lg">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Proxy Pool</h4>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    id="health_check"
                    checked={poolForm.health_check_enabled}
                    onCheckedChange={(c) => setPoolForm(f => ({ ...f, health_check_enabled: !!c }))}
                  />
                  <Label htmlFor="health_check">Skip offline servers</Label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Rotation Strategy</Label>
                  <Select value={poolForm.rotation_strategy} onValueChange={(v) => setPoolForm(f => ({ ...f, rotation_strategy: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round_robin">Round Robin</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rotate Every (minutes)</Label>
                  <Input
                    type="number"
                    value={poolForm.interval_minutes}
                    onChange={(e) => setPoolForm(f => ({ ...f, interval_minutes: parseInt(e.target.value) || 60 }))}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Select Proxy Machines</Label>
                  <div className="flex gap-1">
                    <Button 
                      type="button"
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-xs px-2"
                      onClick={() => setPoolForm(f => ({ ...f, machine_ids: machines.map(m => m.id) }))}
                    >
                      Select All
                    </Button>
                    <Button 
                      type="button"
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-xs px-2"
                      onClick={() => setPoolForm(f => ({ ...f, machine_ids: [] }))}
                    >
                      Unselect All
                    </Button>
                  </div>
                </div>
                <div className="border rounded-md max-h-48 overflow-y-auto">
                  {machines.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground text-center">No machines available</p>
                  ) : (
                    machines.map((machine) => {
                      const isSelected = poolForm.machine_ids.includes(machine.id);
                      const isOnline = machine.status === "online";
                      const isCurrent = wildcardPool?.pool.current_machine_id === machine.id;
                      return (
                        <label
                          key={machine.id}
                          className={`flex items-center gap-3 p-2 hover:bg-muted/30 cursor-pointer border-b last:border-b-0 ${isSelected ? "bg-primary/5" : ""}`}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              setPoolForm(f => ({
                                ...f,
                                machine_ids: checked
                                  ? [...f.machine_ids, machine.id]
                                  : f.machine_ids.filter(id => id !== machine.id)
                              }));
                            }}
                          />
                          <div className={`h-2 w-2 rounded-full flex-shrink-0 ${isOnline ? "bg-green-500" : "bg-red-500"}`} title={isOnline ? "Online" : "Offline"} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{machine.name || machine.hostname || "Unknown"}</span>
                              <span className="text-muted-foreground">-</span>
                              <span className="text-xs text-muted-foreground font-mono">{machine.ip_address}</span>
                              {isCurrent && <Badge variant="default" className="text-[10px] py-0 ml-auto">Current</Badge>}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{poolForm.machine_ids.length} machine(s) selected</p>
              </div>
            </div>

            {/* Pool Status & Controls */}
            {wildcardPool && (
              <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={wildcardPool.pool.is_paused ? "secondary" : "default"}>
                      {wildcardPool.pool.is_paused ? "⏸ Paused" : "▶ Active"}
                    </Badge>
                    {wildcardPool.pool.last_rotated_at && (
                      <span className="text-xs text-muted-foreground">
                        Last rotated: {new Date(wildcardPool.pool.last_rotated_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePauseResume(wildcardPool.pool.id, true, wildcardPool.pool.is_paused)}
                    >
                      {wildcardPool.pool.is_paused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
                      {wildcardPool.pool.is_paused ? "Resume" : "Pause"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRotateNow(wildcardPool.pool.id, true)}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Rotate Now
                    </Button>
                  </div>
                </div>
                
                {/* Current Machine */}
                {wildcardPool.pool.current_machine_id && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Currently pointing to:</span>
                    <code className="bg-muted px-2 py-0.5 rounded">
                      {wildcardPool.members.find(m => m.machine_id === wildcardPool.pool.current_machine_id)?.machine_name || "Unknown"}
                    </code>
                    <span className="text-muted-foreground">
                      ({wildcardPool.members.find(m => m.machine_id === wildcardPool.pool.current_machine_id)?.machine_ip})
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Save Button */}
            <div className="flex justify-end gap-2">
              <Button onClick={handleSaveWildcardPool} disabled={loading || !poolForm.target_ip || (poolForm.machine_ids.length === 0 && poolForm.group_ids.length === 0)}>
                {loading ? "Saving..." : "Save Passthrough Configuration"}
              </Button>
            </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="sync" className="space-y-4 mt-4">
            {!dnsAccountId ? (
              <div className="p-8 text-center text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>DNS sync requires a configured DNS account.</p>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button onClick={handleCompareRecords} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                    Compare with Provider
                  </Button>
                  <Button variant="outline" onClick={handleImportFromRemote} disabled={loading}>
                    Import from Provider
                  </Button>
                  <Button variant="outline" onClick={handleApplyToRemote} disabled={loading || !syncResult || syncResult.in_sync}>
                    Apply to Provider
                  </Button>
                </div>

                {syncResult && (
                  <div className="space-y-4">
                    {syncResult.in_sync ? (
                      <div className="p-4 border rounded-lg bg-green-500/10 border-green-500/30 flex items-center gap-3">
                        <CheckCircle className="h-5 w-5 text-green-500" />
                        <span>All records are in sync with the provider.</span>
                      </div>
                    ) : (
                      <>
                        {syncResult.conflicts.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                                <AlertTriangle className="h-4 w-4" />
                                Conflicts ({syncResult.conflicts.length})
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-2">
                                {syncResult.conflicts.map((c, i) => (
                                  <div key={i} className="p-2 border rounded text-sm">
                                    <div className="font-mono">{c.record_name} ({c.record_type})</div>
                                    <div className="text-xs text-muted-foreground">
                                      Local: {c.local_value} | Remote: {c.remote_value}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {syncResult.created.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm flex items-center gap-2 text-blue-400">
                                <Plus className="h-4 w-4" />
                                Local Only - Will Create ({syncResult.created.length})
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="flex flex-wrap gap-2">
                                {syncResult.created.map((r, i) => (
                                  <Badge key={i} variant="outline">
                                    {r.name} ({r.type}): {r.value}
                                  </Badge>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {syncResult.deleted.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm flex items-center gap-2 text-yellow-400">
                                <Trash className="h-4 w-4" />
                                Remote Only - Will Delete ({syncResult.deleted.length})
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="flex flex-wrap gap-2">
                                {syncResult.deleted.map((r, i) => (
                                  <Badge key={i} variant="outline">
                                    {r.name} ({r.type}): {r.value}
                                  </Badge>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Debug Tab */}
          <TabsContent value="debug" className="space-y-6 mt-6">
            {/* Expected Nameservers */}
            {dnsAccountId && expectedNS && (
              <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
                <div>
                  <Label className="text-sm font-medium">Expected Nameservers</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Nameservers you should configure at your registrar</p>
                </div>
                {loadingNS ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Loading nameservers...
                  </div>
                ) : expectedNS.found ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {expectedNS.nameservers.map((ns, i) => (
                        <code 
                          key={i} 
                          className="px-2 py-1 bg-muted rounded text-sm cursor-pointer hover:bg-muted/80" 
                          onClick={() => copyToClipboard(ns)}
                          title="Click to copy"
                        >
                          {ns}
                        </code>
                      ))}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => copyToClipboard(expectedNS.nameservers.join("\n"))}>
                      <Copy className="h-3 w-3 mr-1" />
                      Copy All
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{expectedNS.message}</p>
                )}
              </div>
            )}

            {/* NS Status */}
            {dnsAccountId && (
              <div className="p-4 border rounded-lg bg-muted/20">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Nameserver Status</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Check if domain nameservers point to the DNS provider</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleCheckNS} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                    Check Now
                  </Button>
                </div>
                {nsStatus && (
                  <div className="mt-3 p-3 rounded-md bg-background/50 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      {nsStatus.status === "valid" ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : nsStatus.status === "pending" ? (
                        <RefreshCw className="h-4 w-4 text-yellow-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="font-medium">{nsStatus.message}</span>
                    </div>
                    {nsStatus.expected && nsStatus.expected.length > 0 && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Expected: </span>
                        <code className="bg-muted px-1 py-0.5 rounded">{nsStatus.expected.join(", ")}</code>
                      </div>
                    )}
                    {nsStatus.actual && nsStatus.actual.length > 0 && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Current: </span>
                        <code className="bg-muted px-1 py-0.5 rounded">{nsStatus.actual.join(", ")}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* DNS Debug Tools */}
            {dnsAccountId && (
              <div className="p-4 border rounded-lg bg-muted/20 space-y-4">
                <div>
                  <Label className="text-sm font-medium">Provider Records</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Fetch all records directly from {isCloudflare ? "Cloudflare" : "DNSPod"}</p>
                </div>

                <div className="space-y-2">
                  <Button variant="outline" size="sm" onClick={handleListProviderRecords} disabled={loadingProviderRecords}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loadingProviderRecords ? "animate-spin" : ""}`} />
                    List All from Provider
                  </Button>
                  {providerRecords && (
                    <div className="border rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-1.5 font-medium">Name</th>
                            <th className="text-left p-1.5 font-medium">Type</th>
                            <th className="text-left p-1.5 font-medium">Value</th>
                            <th className="text-left p-1.5 font-medium">TTL</th>
                            {isCloudflare && <th className="text-left p-1.5 font-medium">Proxy</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {providerRecords.length === 0 ? (
                            <tr><td colSpan={isCloudflare ? 5 : 4} className="p-2 text-center text-muted-foreground">No records on provider</td></tr>
                          ) : (
                            providerRecords.map((r, i) => (
                              <tr key={i} className="border-t">
                                <td className="p-1.5 font-mono">{r.name}</td>
                                <td className="p-1.5"><Badge variant="outline" className="text-xs py-0">{r.type}</Badge></td>
                                <td className="p-1.5 font-mono max-w-[200px] truncate" title={r.value}>{r.value}</td>
                                <td className="p-1.5">{r.ttl}</td>
                                {isCloudflare && (
                                  <td className="p-1.5">
                                    <Cloud className={`h-3 w-3 ${r.proxied ? "text-orange-400" : "text-muted-foreground/30"}`} />
                                  </td>
                                )}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Public DNS Lookup */}
            {dnsAccountId && (
              <div className="p-4 border rounded-lg bg-muted/20 space-y-4">
                <div>
                  <Label className="text-sm font-medium">Public DNS Lookup</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Query public DNS servers for record propagation</p>
                </div>
                <div className="flex gap-2 items-center">
                  <Input
                    className="h-8 w-28 text-sm"
                    placeholder="@ or www"
                    value={lookupSubdomain}
                    onChange={(e) => setLookupSubdomain(e.target.value || "@")}
                  />
                  <span className="text-xs text-muted-foreground">.{domain?.fqdn}</span>
                  <Button variant="outline" size="sm" onClick={handleDNSLookup} disabled={loadingLookup}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loadingLookup ? "animate-spin" : ""}`} />
                    Lookup
                  </Button>
                </div>
                {dnsLookupResult && (
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(dnsLookupResult.results).map(([type, data]) => (
                      <div key={type} className="p-2 rounded bg-background/50 text-xs">
                        <div className="font-medium text-muted-foreground mb-1">{type}</div>
                        {data.records.length > 0 ? (
                          <div className="space-y-0.5">
                            {data.records.map((r, i) => (
                              <code key={i} className="block font-mono text-foreground truncate" title={r}>{r}</code>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!dnsAccountId && (
              <div className="p-8 text-center text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Debug tools require a configured DNS account.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Record Pool Configuration Dialog */}
        <Dialog open={showPoolConfig} onOpenChange={(open) => { setShowPoolConfig(open); if (!open) setSelectedRecordForPool(null); }}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-purple-500" />
                Passthrough Pool: {selectedRecordForPool?.name}.{domain?.fqdn}
              </DialogTitle>
              <DialogDescription>
                Configure dynamic DNS rotation through a pool of proxy servers.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              {/* Mode Toggle */}
              <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                <Label>Mode:</Label>
                <div className="flex gap-2">
                  <Badge
                    variant={selectedRecordForPool?.mode !== "dynamic" ? "default" : "secondary"}
                    className="cursor-pointer"
                    onClick={() => {
                      if (selectedRecordForPool?.mode === "dynamic") {
                        handleDeleteRecordPool();
                      }
                    }}
                  >
                    Static
                  </Badge>
                  <Badge
                    variant={selectedRecordForPool?.mode === "dynamic" ? "default" : "secondary"}
                    className="cursor-pointer bg-purple-500/20 text-purple-400"
                  >
                    Dynamic
                  </Badge>
                </div>
                {selectedRecordForPool?.mode === "dynamic" && recordPool && (
                  <div className="ml-auto flex items-center gap-2">
                    <Badge variant={recordPool.pool.is_paused ? "secondary" : "default"}>
                      {recordPool.pool.is_paused ? "⏸ Paused" : "▶ Active"}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Target Server */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Target IP (final destination)</Label>
                  <Input
                    placeholder="192.168.1.100"
                    value={poolForm.target_ip}
                    onChange={(e) => setPoolForm(f => ({ ...f, target_ip: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Target Port</Label>
                  <Input
                    type="number"
                    value={poolForm.target_port}
                    onChange={(e) => setPoolForm(f => ({ ...f, target_port: parseInt(e.target.value) || 443 }))}
                  />
                </div>
              </div>

              {/* Pool Settings */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Strategy</Label>
                  <Select value={poolForm.rotation_strategy} onValueChange={(v) => setPoolForm(f => ({ ...f, rotation_strategy: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round_robin">Round Robin</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Interval (min)</Label>
                  <Input
                    type="number"
                    value={poolForm.interval_minutes}
                    onChange={(e) => setPoolForm(f => ({ ...f, interval_minutes: parseInt(e.target.value) || 60 }))}
                  />
                </div>
                <div className="flex items-end pb-1">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="health_rec"
                      checked={poolForm.health_check_enabled}
                      onCheckedChange={(c) => setPoolForm(f => ({ ...f, health_check_enabled: !!c }))}
                    />
                    <Label htmlFor="health_rec" className="text-xs">Skip offline</Label>
                  </div>
                </div>
              </div>

              {/* Machine Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Proxy Machines</Label>
                  <div className="flex gap-1">
                    <Button 
                      type="button"
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-xs px-2"
                      onClick={() => setPoolForm(f => ({ ...f, machine_ids: machines.map(m => m.id) }))}
                    >
                      Select All
                    </Button>
                    <Button 
                      type="button"
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-xs px-2"
                      onClick={() => setPoolForm(f => ({ ...f, machine_ids: [] }))}
                    >
                      Unselect All
                    </Button>
                  </div>
                </div>
                <div className="border rounded-md max-h-40 overflow-y-auto">
                  {machines.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground text-center">No machines</p>
                  ) : (
                    machines.map((machine) => {
                      const isSelected = poolForm.machine_ids.includes(machine.id);
                      const isOnline = machine.status === "online";
                      const isCurrent = recordPool?.pool.current_machine_id === machine.id;
                      return (
                        <label
                          key={machine.id}
                          className={`flex items-center gap-3 p-2 hover:bg-muted/30 cursor-pointer border-b last:border-b-0 ${isSelected ? "bg-primary/5" : ""}`}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              setPoolForm(f => ({
                                ...f,
                                machine_ids: checked
                                  ? [...f.machine_ids, machine.id]
                                  : f.machine_ids.filter(id => id !== machine.id)
                              }));
                            }}
                          />
                          <div className={`h-2 w-2 rounded-full flex-shrink-0 ${isOnline ? "bg-green-500" : "bg-red-500"}`} />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm">{machine.name || machine.hostname || "Unknown"}</span>
                            <span className="text-muted-foreground mx-1">-</span>
                            <span className="text-xs text-muted-foreground font-mono">{machine.ip_address}</span>
                            {isCurrent && <Badge variant="default" className="text-[10px] py-0 ml-2">Current</Badge>}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Controls */}
              {recordPool && (
                <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePauseResume(recordPool.pool.id, false, recordPool.pool.is_paused)}
                  >
                    {recordPool.pool.is_paused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
                    {recordPool.pool.is_paused ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRotateNow(recordPool.pool.id, false)}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Rotate Now
                  </Button>
                  {recordPool.pool.last_rotated_at && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      Last: {new Date(recordPool.pool.last_rotated_at).toLocaleString()}
                    </span>
                  )}
                </div>
              )}

              {/* History */}
              {rotationHistory.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1">
                    <History className="h-3 w-3" /> Recent Rotations
                  </Label>
                  <div className="max-h-24 overflow-y-auto border rounded-md">
                    {rotationHistory.slice(0, 5).map((h) => (
                      <div key={h.id} className="p-2 text-xs border-b last:border-b-0 flex items-center gap-2">
                        <span className="text-muted-foreground">{new Date(h.rotated_at).toLocaleString()}</span>
                        <span>{h.from_machine_name || h.from_ip}</span>
                        <span>→</span>
                        <span className="font-medium">{h.to_machine_name || h.to_ip}</span>
                        <Badge variant="outline" className="text-[10px] ml-auto">{h.trigger}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPoolConfig(false)}>Cancel</Button>
              <Button onClick={handleSaveRecordPool} disabled={loading || !poolForm.target_ip || (poolForm.machine_ids.length === 0 && poolForm.group_ids.length === 0)}>
                {loading ? "Saving..." : "Save Pool"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
