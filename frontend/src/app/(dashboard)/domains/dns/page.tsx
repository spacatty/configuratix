"use client";

import { useState, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/data-table";
import { api, Domain, DNSAccount, DNSRecord, NSStatus, DNSSyncResult } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { Globe, CheckCircle, XCircle, Cloud, Plus, RefreshCw, AlertTriangle, X, Copy, Trash, Settings2 } from "lucide-react";
import { toast } from "sonner";

export default function DNSManagementPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [dnsAccounts, setDnsAccounts] = useState<DNSAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDNSAccountDialog, setShowDNSAccountDialog] = useState(false);
  const [showDNSSettingsDialog, setShowDNSSettingsDialog] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        api.listDomains(),
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

  const openDNSSettings = (domain: Domain) => {
    setSelectedDomain(domain);
    setShowDNSSettingsDialog(true);
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
      case "external":
        return (
          <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">
            <Globe className="h-3 w-3 mr-1" />
            External
          </Badge>
        );
      default:
        return (
          <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">
            <Globe className="h-3 w-3 mr-1" />
            Not Configured
          </Badge>
        );
    }
  };

  const columns: ColumnDef<Domain>[] = [
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
              {domain.dns_mode === "managed" && domain.ns_status && getNSStatusBadge(domain.ns_status)}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "dns_mode",
      header: "DNS Mode",
      cell: ({ row }) => {
        const domain = row.original;
        if (domain.dns_mode === "managed") {
          return (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
              Managed
            </Badge>
          );
        }
        return (
          <Badge variant="secondary">
            External
          </Badge>
        );
      },
    },
    {
      accessorKey: "dns_account_name",
      header: "DNS Account",
      cell: ({ row }) => {
        const domain = row.original;
        if (domain.dns_mode === "managed" && domain.dns_account_name) {
          return (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {domain.dns_account_provider === "cloudflare" ? "☁️ CF" : "🌐 DNSPod"}
              </Badge>
              <span className="text-sm">{domain.dns_account_name}</span>
            </div>
          );
        }
        return <span className="text-muted-foreground text-sm">—</span>;
      },
    },
    {
      accessorKey: "ns_status",
      header: "NS Status",
      cell: ({ row }) => {
        const domain = row.original;
        if (domain.dns_mode !== "managed") {
          return <span className="text-muted-foreground text-sm">—</span>;
        }
        return getNSStatusBadge(domain.ns_status);
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const domain = row.original;
        return (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openDNSSettings(domain)}
          >
            <Settings2 className="h-4 w-4 mr-2" />
            Configure
          </Button>
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
        <Button variant="outline" onClick={() => setShowDNSAccountDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add DNS Account
        </Button>
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
          <CardTitle className="text-lg">Domain DNS Configuration</CardTitle>
          <CardDescription>Configure DNS settings and manage records for each domain.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={domains} searchKey="fqdn" searchPlaceholder="Search domains..." />
        </CardContent>
      </Card>

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
    </div>
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
  domain: Domain | null;
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
  const [dnsMode, setDnsMode] = useState("external");
  const [dnsAccountId, setDnsAccountId] = useState<string>("");

  // Get selected account provider
  const selectedAccount = dnsAccounts.find(a => a.id === dnsAccountId);
  const isCloudflare = selectedAccount?.provider === "cloudflare";

  // New record form - proxied defaults to true for Cloudflare
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
      setDnsMode(domain.dns_mode || "external");
      setDnsAccountId(domain.dns_account_id || "");
      setExpectedNS(null);
      setNsStatus(null);
      loadRecords();
      
      // Load nameservers if account is already set
      if (domain.dns_account_id) {
        loadExpectedNameservers(domain.dns_account_id);
      }
    }
  }, [domain, open]);

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
      await api.updateDomainDNS(domain.id, {
        dns_mode: dnsMode,
        dns_account_id: dnsAccountId || "",
      });
      toast.success("DNS settings saved");
      onSave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckNS = async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const status = await api.checkDomainNS(domain.id);
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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="records" disabled={dnsMode !== "managed"}>Records</TabsTrigger>
            <TabsTrigger value="sync" disabled={dnsMode !== "managed"}>Sync</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-6 mt-6">
            {/* DNS Mode Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">DNS Mode</Label>
              <Select value={dnsMode} onValueChange={setDnsMode}>
                <SelectTrigger className="h-10 w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="external">External (manage DNS elsewhere)</SelectItem>
                  <SelectItem value="managed">Managed (use provider below)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {dnsMode === "external" 
                  ? "You manage DNS records outside of this system" 
                  : "We will manage DNS records via the selected provider"}
              </p>
            </div>

            {/* Managed Mode Configuration */}
            {dnsMode === "managed" && (
              <>
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

                {/* NS Status */}
                <div className="p-4 border rounded-lg bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium">Nameserver Status</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">Check if domain nameservers point to the DNS provider</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleCheckNS} disabled={loading || !dnsAccountId}>
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

                {/* DNS Debug Tools */}
                <div className="p-4 border rounded-lg bg-muted/20 space-y-4">
                  <div>
                    <Label className="text-sm font-medium">DNS Debug Tools</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Query DNS records for debugging</p>
                  </div>

                  {/* List all from provider */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={handleListProviderRecords} disabled={loadingProviderRecords || !dnsAccountId}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loadingProviderRecords ? "animate-spin" : ""}`} />
                        List All from Provider
                      </Button>
                      <span className="text-xs text-muted-foreground">Fetch all records from {isCloudflare ? "Cloudflare" : "DNSPod"}</span>
                    </div>
                    {providerRecords && (
                      <div className="mt-2 border rounded overflow-hidden">
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

                  {/* Public DNS Lookup */}
                  <div className="border-t pt-4 space-y-2">
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
                        Public Lookup
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
                </div>
              </>
            )}

            {/* External Mode Message */}
            {dnsMode === "external" && (
              <div className="p-6 text-center border rounded-lg bg-muted/10">
                <Globe className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-muted-foreground">DNS is managed externally.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Switch to &quot;Managed&quot; mode to configure DNS records through this interface.
                </p>
              </div>
            )}

            <DialogFooter className="pt-4 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSaveSettings} disabled={loading}>Save Settings</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="records" className="space-y-6 mt-6">
            {dnsMode !== "managed" ? (
              <div className="p-12 text-center border rounded-lg bg-muted/10">
                <Globe className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">DNS records management requires managed DNS mode.</p>
                <p className="text-sm text-muted-foreground mt-1">Switch to &quot;Managed&quot; in Settings tab and select a DNS account.</p>
              </div>
            ) : (
              <>
                {/* Add Record Form */}
                <div className="p-4 border rounded-lg bg-muted/10 space-y-4">
                  <Label className="text-sm font-medium">Add New Record</Label>
                  
                  {/* Main fields row */}
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
                    {/* Proxied toggle - Cloudflare only */}
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

                    {/* Custom Ports toggle */}
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

                    {/* Port inputs - only show if customPorts enabled */}
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
                        <th className="text-left p-2 font-medium">Value</th>
                        <th className="text-left p-2 font-medium">TTL</th>
                        {isCloudflare && <th className="text-left p-2 font-medium">Proxy</th>}
                        <th className="text-left p-2 font-medium">Ports</th>
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.length === 0 ? (
                        <tr>
                          <td colSpan={isCloudflare ? 8 : 7} className="p-8 text-center text-muted-foreground">
                            No records yet. Add one above or import from provider.
                          </td>
                        </tr>
                      ) : (
                        records.map((record) => {
                          const hasCustomPorts = record.http_incoming_port || record.https_incoming_port;
                          return (
                            <tr key={record.id} className="border-t hover:bg-muted/30">
                              <td className="p-2 font-mono">{record.name}</td>
                              <td className="p-2">
                                <Badge variant="outline">{record.record_type}</Badge>
                              </td>
                              <td className="p-2 font-mono text-xs max-w-[180px] truncate" title={record.value}>{record.value}</td>
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
                              <td className="p-2 text-xs text-muted-foreground">
                                {hasCustomPorts ? (
                                  <span title={`HTTP: ${record.http_incoming_port || 80}→${record.http_outgoing_port || 80}, HTTPS: ${record.https_incoming_port || 443}→${record.https_outgoing_port || 443}`}>
                                    {record.http_incoming_port || 80}/{record.https_incoming_port || 443}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">default</span>
                                )}
                              </td>
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
                              <td className="p-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 hover:text-destructive"
                                  onClick={() => handleDeleteRecord(record.id)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="sync" className="space-y-4 mt-4">
            {dnsMode !== "managed" || !dnsAccountId ? (
              <div className="p-8 text-center text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>DNS sync requires managed DNS mode with a configured account.</p>
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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

