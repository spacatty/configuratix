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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/data-table";
import { api, Domain, Machine, NginxConfig, DNSAccount, DNSRecord, NSStatus, DNSSyncResult } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import { ExternalLink, MoreHorizontal, Trash, Link2, FileText, Server, Globe, CheckCircle, XCircle, Cloud, Circle, Plus, RefreshCw, AlertTriangle, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function DomainsPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [configs, setConfigs] = useState<NginxConfig[]>([]);
  const [dnsAccounts, setDnsAccounts] = useState<DNSAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDNSDialog, setShowDNSDialog] = useState(false);
  const [showDNSAccountDialog, setShowDNSAccountDialog] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [newFqdn, setNewFqdn] = useState("");
  const [assignMachineId, setAssignMachineId] = useState<string>("");
  const [assignConfigId, setAssignConfigId] = useState<string>("");
  const [domainNotes, setDomainNotes] = useState("");

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
      const [domainsData, machinesData, configsData] = await Promise.all([
        api.listDomains(),
        api.listMachines(),
        api.listNginxConfigs(),
      ]);
      setDomains(domainsData);
      setMachines(machinesData);
      setConfigs(configsData);
      
      // Load DNS accounts separately - might fail if migration not run yet
      try {
        const accountsData = await api.listDNSAccounts();
        setDnsAccounts(accountsData);
      } catch {
        console.log("DNS accounts not available (migration may not be run yet)");
        setDnsAccounts([]);
      }
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
    if (!newFqdn.trim()) return;
    try {
      await api.createDomain(newFqdn.trim());
      setNewFqdn("");
      setShowCreateDialog(false);
      loadData();
      toast.success("Domain created");
    } catch (err) {
      console.error("Failed to create domain:", err);
      toast.error("Failed to create domain");
    }
  };

  const handleAssignDomain = async () => {
    if (!selectedDomain) return;
    try {
      await api.assignDomain(
        selectedDomain.id,
        assignMachineId || null,
        assignConfigId || null
      );
      setShowAssignDialog(false);
      setSelectedDomain(null);
      loadData();
      toast.success("Domain assigned");
    } catch (err) {
      console.error("Failed to assign domain:", err);
      toast.error("Failed to assign domain");
    }
  };

  const handleDeleteDomain = async () => {
    if (!selectedDomain) return;
    try {
      await api.deleteDomain(selectedDomain.id);
      setShowDeleteDialog(false);
      setSelectedDomain(null);
      loadData();
      toast.success("Domain deleted");
    } catch (err) {
      console.error("Failed to delete domain:", err);
      toast.error("Failed to delete domain");
    }
  };

  const openAssignDialog = (domain: Domain) => {
    setSelectedDomain(domain);
    setAssignMachineId(domain.assigned_machine_id || "");
    setAssignConfigId(domain.config_id || "");
    setShowAssignDialog(true);
  };

  const openNotesDialog = (domain: Domain) => {
    setSelectedDomain(domain);
    setDomainNotes(domain.notes_md || "");
    setShowNotesDialog(true);
  };

  const openDeleteDialog = (domain: Domain) => {
    setSelectedDomain(domain);
    setShowDeleteDialog(true);
  };

  const openDNSDialog = (domain: Domain) => {
    setSelectedDomain(domain);
    setShowDNSDialog(true);
  };

  const handleSaveNotes = async () => {
    if (!selectedDomain) return;
    try {
      await api.updateDomainNotes(selectedDomain.id, domainNotes);
      setShowNotesDialog(false);
      loadData();
      toast.success("Notes saved");
    } catch (err) {
      console.error("Failed to save notes:", err);
      toast.error("Failed to save notes");
    }
  };

  const handleCreateDNSAccount = async () => {
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
            <CheckCircle className="h-3 w-3 mr-1" />
            Healthy
          </Badge>
        );
      case "unhealthy":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
            <XCircle className="h-3 w-3 mr-1" />
            Unhealthy
          </Badge>
        );
      case "linked":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
            <Link2 className="h-3 w-3 mr-1" />
            Linked
          </Badge>
        );
      case "proxied":
        return (
          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
            <Cloud className="h-3 w-3 mr-1" />
            Proxied
          </Badge>
        );
      default:
        return (
          <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-xs">
            <Circle className="h-3 w-3 mr-1" />
            Idle
          </Badge>
        );
    }
  };

  const getNSStatusBadge = (status: string) => {
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
        return null;
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
              <div className="flex items-center gap-2">
                <span className="font-medium">{domain.fqdn}</span>
                <a
                  href={`https://${domain.fqdn}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {domain.dns_mode === "managed" && domain.ns_status && getNSStatusBadge(domain.ns_status)}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => getStatusBadge(row.original.status),
    },
    {
      accessorKey: "dns_mode",
      header: "DNS",
      cell: ({ row }) => {
        const domain = row.original;
        if (domain.dns_mode === "managed" && domain.dns_account_name) {
          return (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {domain.dns_account_provider === "cloudflare" ? "CF" : "DNSPod"}
              </Badge>
              <span className="text-sm text-muted-foreground">{domain.dns_account_name}</span>
            </div>
          );
        }
        return <span className="text-muted-foreground text-sm">External</span>;
      },
    },
    {
      accessorKey: "machine_name",
      header: "Machine",
      cell: ({ row }) => {
        const domain = row.original;
        return domain.machine_name ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">{domain.machine_name}</span>
            {domain.status === "linked" && domain.assigned_machine_id && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => router.push(`/machines/${domain.assigned_machine_id}`)}
              >
                <Server className="h-3 w-3" />
              </Button>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">Not assigned</span>
        );
      },
    },
    {
      accessorKey: "config_name",
      header: "Config",
      cell: ({ row }) => {
        const domain = row.original;
        return domain.config_name ? (
          <span className="text-sm">{domain.config_name}</span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const domain = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openDNSDialog(domain)}>
                <Settings2 className="h-4 w-4 mr-2" />
                DNS Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAssignDialog(domain)}>
                <Link2 className="h-4 w-4 mr-2" />
                {domain.assigned_machine_id ? "Reassign" : "Assign"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openNotesDialog(domain)}>
                <FileText className="h-4 w-4 mr-2" />
                Notes
              </DropdownMenuItem>
              {domain.assigned_machine_id && (
                <DropdownMenuItem onClick={() => router.push(`/machines/${domain.assigned_machine_id}`)}>
                  <Server className="h-4 w-4 mr-2" />
                  Go to Machine
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openDeleteDialog(domain)} className="text-destructive focus:text-destructive">
                <Trash className="h-4 w-4 mr-2" />
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
          <h1 className="text-3xl font-semibold tracking-tight">Domains</h1>
          <p className="text-muted-foreground mt-1">Manage domains, DNS records, and machine assignments.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDNSAccountDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            DNS Account
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>+ Add Domain</Button>
        </div>
      </div>

      {/* DNS Accounts Summary */}
      {dnsAccounts.length > 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">DNS Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {dnsAccounts.map((acc) => (
                <Badge key={acc.id} variant="secondary" className="flex items-center gap-2 py-1 px-3">
                  <span className={acc.provider === "cloudflare" ? "text-orange-400" : "text-blue-400"}>
                    {acc.provider === "cloudflare" ? "CF" : "DNSPod"}
                  </span>
                  <span>{acc.name}</span>
                  {acc.is_default && <CheckCircle className="h-3 w-3 text-green-400" />}
                  <button
                    onClick={() => handleDeleteDNSAccount(acc.id)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">Your Domains</CardTitle>
          <CardDescription>Domains that can be assigned to machines with nginx configurations.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={domains} searchKey="fqdn" searchPlaceholder="Search domains..." />
        </CardContent>
      </Card>

      {/* Create Domain Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Domain</DialogTitle>
            <DialogDescription>
              Enter the fully qualified domain name (FQDN) to add.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fqdn">Domain Name</Label>
              <Input
                id="fqdn"
                placeholder="example.com"
                value={newFqdn}
                onChange={(e) => setNewFqdn(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDomain}>Add Domain</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Domain Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Domain</DialogTitle>
            <DialogDescription>
              Assign {selectedDomain?.fqdn} to a machine and select a configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Machine</Label>
              <Select value={assignMachineId || "_none"} onValueChange={(v) => setAssignMachineId(v === "_none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a machine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None (Unassign)</SelectItem>
                  {machines.map((machine) => (
                    <SelectItem key={machine.id} value={machine.id}>
                      {machine.title || machine.hostname || "Unknown"} ({machine.ip_address})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nginx Configuration</Label>
              <Select value={assignConfigId || "_none"} onValueChange={(v) => setAssignConfigId(v === "_none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a configuration" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {configs.map((config) => (
                    <SelectItem key={config.id} value={config.id}>
                      {config.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssignDomain}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes Dialog */}
      <Dialog open={showNotesDialog} onOpenChange={setShowNotesDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Domain Notes</DialogTitle>
            <DialogDescription>
              Notes for {selectedDomain?.fqdn} (registrar info, expiry dates, etc.)
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 min-h-[300px]">
            <div className="space-y-2">
              <Label>Edit</Label>
              <Textarea
                className="min-h-[280px] font-mono text-sm resize-none"
                placeholder="# Domain Notes&#10;&#10;**Registrar:** Example Registrar&#10;**Expiry Date:** 2025-12-31"
                value={domainNotes}
                onChange={(e) => setDomainNotes(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="min-h-[280px] p-4 border rounded-md bg-muted/30 prose prose-invert prose-sm max-w-none overflow-auto">
                {domainNotes ? (
                  <ReactMarkdown>{domainNotes}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">No notes yet...</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNotesDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNotes}>Save Notes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DNS Settings Dialog */}
      <DNSSettingsDialog
        open={showDNSDialog}
        onOpenChange={setShowDNSDialog}
        domain={selectedDomain}
        dnsAccounts={dnsAccounts}
        onSave={() => {
          loadData();
          setShowDNSDialog(false);
        }}
      />

      {/* Create DNS Account Dialog */}
      <Dialog open={showDNSAccountDialog} onOpenChange={setShowDNSAccountDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add DNS Account</DialogTitle>
            <DialogDescription>
              Connect a DNS provider account to manage records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
                  <SelectItem value="dnspod">DNSPod</SelectItem>
                  <SelectItem value="cloudflare">Cloudflare</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account Name</Label>
              <Input
                placeholder="My DNSPod Account"
                value={dnsAccountForm.name}
                onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, name: e.target.value })}
              />
            </div>
            {dnsAccountForm.provider === "dnspod" && (
              <div className="space-y-2">
                <Label>API ID (Token ID)</Label>
                <Input
                  placeholder="123456"
                  value={dnsAccountForm.api_id}
                  onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, api_id: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{dnsAccountForm.provider === "cloudflare" ? "API Token" : "API Token (Secret)"}</Label>
              <Input
                type="password"
                placeholder="••••••••••••••••"
                value={dnsAccountForm.api_token}
                onChange={(e) => setDnsAccountForm({ ...dnsAccountForm, api_token: e.target.value })}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_default"
                checked={dnsAccountForm.is_default}
                onCheckedChange={(checked) => setDnsAccountForm({ ...dnsAccountForm, is_default: !!checked })}
              />
              <Label htmlFor="is_default" className="text-sm font-normal">
                Set as default for this provider
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDNSAccountDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDNSAccount}>Add Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Domain</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedDomain?.fqdn}</strong>?
              This will also remove any associated configurations from servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDomain} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

  // Form state
  const [dnsMode, setDnsMode] = useState("external");
  const [dnsAccountId, setDnsAccountId] = useState<string>("");
  const [ipAddress, setIpAddress] = useState("");
  const [isWildcard, setIsWildcard] = useState(false);
  const [httpsSendProxy, setHttpsSendProxy] = useState(false);
  const [httpInPorts, setHttpInPorts] = useState("80");
  const [httpOutPorts, setHttpOutPorts] = useState("80");
  const [httpsInPorts, setHttpsInPorts] = useState("443");
  const [httpsOutPorts, setHttpsOutPorts] = useState("443");

  // New record form
  const [newRecord, setNewRecord] = useState({
    name: "",
    record_type: "A",
    value: "",
    ttl: 600,
    priority: 10,
    proxied: false,
  });

  useEffect(() => {
    if (domain && open) {
      setDnsMode(domain.dns_mode || "external");
      setDnsAccountId(domain.dns_account_id || "");
      setIpAddress(domain.ip_address || "");
      setIsWildcard(domain.is_wildcard || false);
      setHttpsSendProxy(domain.https_send_proxy || false);
      setHttpInPorts((domain.http_incoming_ports || [80]).join(", "));
      setHttpOutPorts((domain.http_outgoing_ports || [80]).join(", "));
      setHttpsInPorts((domain.https_incoming_ports || [443]).join(", "));
      setHttpsOutPorts((domain.https_outgoing_ports || [443]).join(", "));
      loadRecords();
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

  const parsePorts = (str: string): number[] => {
    return str.split(",").map((p) => parseInt(p.trim())).filter((p) => !isNaN(p) && p > 0);
  };

  const handleSaveSettings = async () => {
    if (!domain) return;
    setLoading(true);
    try {
      await api.updateDomainDNS(domain.id, {
        dns_mode: dnsMode,
        dns_account_id: dnsAccountId || null,
        ip_address: ipAddress || undefined,
        is_wildcard: isWildcard,
        https_send_proxy: httpsSendProxy,
        http_incoming_ports: parsePorts(httpInPorts),
        http_outgoing_ports: parsePorts(httpOutPorts),
        https_incoming_ports: parsePorts(httpsInPorts),
        https_outgoing_ports: parsePorts(httpsOutPorts),
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

  const handleAddRecord = async () => {
    if (!domain) return;
    try {
      await api.createDNSRecord(domain.id, {
        name: newRecord.name,
        record_type: newRecord.record_type,
        value: newRecord.value,
        ttl: newRecord.ttl,
        priority: newRecord.record_type === "MX" ? newRecord.priority : undefined,
        proxied: newRecord.proxied,
      });
      setNewRecord({ name: "", record_type: "A", value: "", ttl: 600, priority: 10, proxied: false });
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            DNS Settings: {domain.fqdn}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="records">Records</TabsTrigger>
            <TabsTrigger value="sync">Sync</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-4 mt-4">
            {/* DNS Mode */}
            <div className="space-y-2">
              <Label>DNS Mode</Label>
              <Select value={dnsMode} onValueChange={setDnsMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="external">External (manage DNS elsewhere)</SelectItem>
                  <SelectItem value="managed">Managed (use provider below)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {dnsMode === "managed" && (
              <>
                <div className="space-y-2">
                  <Label>DNS Account</Label>
                  <Select value={dnsAccountId || "_none"} onValueChange={(v) => setDnsAccountId(v === "_none" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {dnsAccounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.provider === "cloudflare" ? "CF" : "DNSPod"}: {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* NS Status */}
                <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Nameserver Status</Label>
                    <Button variant="outline" size="sm" onClick={handleCheckNS} disabled={loading || !dnsAccountId}>
                      <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                      Check Now
                    </Button>
                  </div>
                  {nsStatus && (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        {nsStatus.status === "valid" ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : nsStatus.status === "pending" ? (
                          <RefreshCw className="h-4 w-4 text-yellow-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <span>{nsStatus.message}</span>
                      </div>
                      {nsStatus.expected && nsStatus.expected.length > 0 && (
                        <div>
                          <span className="text-muted-foreground">Expected: </span>
                          {nsStatus.expected.join(", ")}
                        </div>
                      )}
                      {nsStatus.actual && nsStatus.actual.length > 0 && (
                        <div>
                          <span className="text-muted-foreground">Current: </span>
                          {nsStatus.actual.join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>IP Address</Label>
                <Input
                  placeholder="192.168.1.100"
                  value={ipAddress}
                  onChange={(e) => setIpAddress(e.target.value)}
                />
              </div>
              <div className="space-y-2 flex items-end gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="wildcard"
                    checked={isWildcard}
                    onCheckedChange={(checked) => setIsWildcard(!!checked)}
                  />
                  <Label htmlFor="wildcard" className="text-sm font-normal">Wildcard</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="sendProxy"
                    checked={httpsSendProxy}
                    onCheckedChange={(checked) => setHttpsSendProxy(!!checked)}
                  />
                  <Label htmlFor="sendProxy" className="text-sm font-normal">HTTPS: SEND-PROXY</Label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>HTTP Inc. Ports</Label>
                <Input value={httpInPorts} onChange={(e) => setHttpInPorts(e.target.value)} placeholder="80" />
              </div>
              <div className="space-y-2">
                <Label>HTTP Out. Ports</Label>
                <Input value={httpOutPorts} onChange={(e) => setHttpOutPorts(e.target.value)} placeholder="80" />
              </div>
              <div className="space-y-2">
                <Label>HTTPS Inc. Ports</Label>
                <Input value={httpsInPorts} onChange={(e) => setHttpsInPorts(e.target.value)} placeholder="443" />
              </div>
              <div className="space-y-2">
                <Label>HTTPS Out. Ports</Label>
                <Input value={httpsOutPorts} onChange={(e) => setHttpsOutPorts(e.target.value)} placeholder="443" />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSaveSettings} disabled={loading}>Save Settings</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="records" className="space-y-4 mt-4">
            {dnsMode !== "managed" ? (
              <div className="p-8 text-center text-muted-foreground">
                <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>DNS records management requires managed DNS mode.</p>
                <p className="text-sm">Switch to &quot;Managed&quot; in Settings tab and select a DNS account.</p>
              </div>
            ) : (
              <>
                {/* Add Record Form */}
                <Card className="border-dashed">
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-6 gap-2 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Name</Label>
                        <Input
                          placeholder="@, www, *"
                          value={newRecord.name}
                          onChange={(e) => setNewRecord({ ...newRecord, name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={newRecord.record_type}
                          onValueChange={(v) => setNewRecord({ ...newRecord, record_type: v })}
                        >
                          <SelectTrigger>
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
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Value</Label>
                        <Input
                          placeholder="IP or target"
                          value={newRecord.value}
                          onChange={(e) => setNewRecord({ ...newRecord, value: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">TTL</Label>
                        <Input
                          type="number"
                          value={newRecord.ttl}
                          onChange={(e) => setNewRecord({ ...newRecord, ttl: parseInt(e.target.value) || 600 })}
                        />
                      </div>
                      <Button onClick={handleAddRecord} disabled={!newRecord.name || !newRecord.value}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Records Table */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Name</th>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-left p-2 font-medium">Value</th>
                        <th className="text-left p-2 font-medium">TTL</th>
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-muted-foreground">
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
                            <td className="p-2 font-mono text-xs max-w-[200px] truncate">{record.value}</td>
                            <td className="p-2">{record.ttl}</td>
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
                        ))
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
