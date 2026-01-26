"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, DNSManagedDomain, DNSAccount, DNSRecord, NSStatus, DNSSyncResult, Machine, PassthroughPoolResponse, WildcardPoolResponse, RotationHistory, MachineGroupWithCount } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { Globe, CheckCircle, XCircle, AlertTriangle, RefreshCw, Copy, Trash, Settings2, Play, Pause, RotateCcw, Server, History, Zap, Users, MoreHorizontal, ArrowLeft, X, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

// Passthrough Record Row Component
function PassthroughRecordRow({
  record,
  domain,
  onEdit,
  onDelete,
  onRotate,
  onPauseResume,
  onShowHistory,
}: {
  record: DNSRecord;
  domain: DNSManagedDomain;
  onEdit: () => void;
  onDelete: () => void;
  onRotate: (poolId: string, isWildcard: boolean) => void;
  onPauseResume: (poolId: string, isWildcard: boolean, isPaused: boolean) => void;
  onShowHistory: (poolId: string, isWildcard: boolean) => void;
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
        <td colSpan={7} className="py-2 px-3 text-center text-muted-foreground text-xs">
          <RefreshCw className="h-3 w-3 animate-spin inline mr-1" />
          Loading...
        </td>
      </tr>
    );
  }

  const members = poolData?.members || [];
  const groupCount = poolData?.pool.group_ids?.length || 0;
  const currentMachine = members.find(m => m.machine_id === poolData?.pool.current_machine_id);
  const lastRotation = poolData?.pool.updated_at ? new Date(poolData.pool.updated_at) : null;

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const groups = poolData?.groups || [];

  return (
    <tr className="border-t hover:bg-muted/20">
      <td className="py-3 px-4">
        <span className="font-mono font-medium">
          {record.name === "@" ? domain.fqdn : `${record.name}.${domain.fqdn}`}
        </span>
      </td>
      <td className="py-3 px-4">
        <code className="text-xs bg-muted/50 px-1.5 py-0.5 rounded">
          {poolData?.pool.target_ip}:{poolData?.pool.target_port}/{poolData?.pool.target_port_http || 80}
        </code>
      </td>
      <td className="py-3 px-4">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-help">
                {members.length} machine{members.length !== 1 ? "s" : ""}{groupCount > 0 ? ` + ${groupCount} group${groupCount !== 1 ? "s" : ""}` : ""}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="space-y-2 text-xs">
                {groups.length > 0 && (
                  <div>
                    <div className="font-medium mb-1">Groups:</div>
                    {groups.map(g => (
                      <div key={g.id} className="flex items-center gap-1">
                        <span>{g.emoji}</span>
                        <span>{g.name}</span>
                        <span className="text-muted-foreground">({g.machine_count} machines)</span>
                      </div>
                    ))}
                  </div>
                )}
                {members.length > 0 && (
                  <div>
                    <div className="font-medium mb-1">Direct Members:</div>
                    {members.slice(0, 5).map(m => (
                      <div key={m.id} className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${m.is_online ? "bg-green-500" : "bg-red-500"}`} />
                        <span>{m.machine_name}</span>
                        <span className="text-muted-foreground">- {m.machine_ip}</span>
                      </div>
                    ))}
                    {members.length > 5 && (
                      <div className="text-muted-foreground">+{members.length - 5} more...</div>
                    )}
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </td>
      <td className="py-3 px-4">
        {currentMachine ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="font-medium">{currentMachine.machine_name}</span>
            <span className="text-muted-foreground text-sm">- {currentMachine.machine_ip}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-muted-foreground text-sm">
        {lastRotation ? formatRelativeTime(lastRotation) : "—"}
      </td>
      <td className="py-3 px-4">
        {poolData?.pool.is_paused ? (
          <Badge variant="secondary">⏸ Paused</Badge>
        ) : (
          <Badge className="bg-green-600 hover:bg-green-600">▶ Active</Badge>
        )}
      </td>
      <td className="py-3 px-4 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {poolData && (
              <>
                <DropdownMenuItem onClick={() => onRotate(poolData.pool.id, false)}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Rotate Now
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPauseResume(poolData.pool.id, false, poolData.pool.is_paused)}>
                  {poolData.pool.is_paused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                  {poolData.pool.is_paused ? "Resume Rotation" : "Pause Rotation"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onShowHistory(poolData.pool.id, false)}>
                  <History className="h-4 w-4 mr-2" />
                  View History
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={onEdit}>
              <Settings2 className="h-4 w-4 mr-2" />
              Edit Configuration
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash className="h-4 w-4 mr-2" />
              Delete Record
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

export default function DomainDNSSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const domainId = params.id as string;

  // Domain and accounts
  const [domain, setDomain] = useState<DNSManagedDomain | null>(null);
  const [dnsAccounts, setDnsAccounts] = useState<DNSAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState("settings");
  
  // Settings state
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
  
  // Rotation history dialog
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [historyPoolId, setHistoryPoolId] = useState<string | null>(null);
  const [historyIsWildcard, setHistoryIsWildcard] = useState(false);
  const [historyData, setHistoryData] = useState<RotationHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Get passthrough records (mode = 'dynamic')
  const passthroughRecords = records.filter(r => r.mode === "dynamic" && r.record_type === "A");

  // Get selected account provider
  const selectedAccount = dnsAccounts.find(a => a.id === dnsAccountId);
  const isCloudflare = selectedAccount?.provider === "cloudflare";
  const isDeSEC = selectedAccount?.provider === "desec";
  const isNjalla = selectedAccount?.provider === "njalla";
  const isClouDNS = selectedAccount?.provider === "cloudns";

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

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [domainData, accountsData] = await Promise.all([
          api.getDNSManagedDomain(domainId),
          api.listDNSAccounts().catch(() => []),
        ]);
        setDomain(domainData);
        setDnsAccounts(accountsData);
        setDnsAccountId(domainData.dns_account_id || "");
        setProxyMode(domainData.proxy_mode || "static");
        
        // Load nameservers if account is set
        if (domainData.dns_account_id) {
          loadExpectedNameservers(domainData.dns_account_id, domainData.fqdn);
        }
      } catch (err) {
        console.error("Failed to load domain:", err);
        toast.error("Failed to load domain");
        router.push("/domains/dns");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [domainId, router]);

  // Load records when domain is available
  useEffect(() => {
    if (domain) {
      loadRecords();
      loadMachines();
      loadGroups();
      if (domain.proxy_mode === "wildcard") {
        loadWildcardPool();
      }
    }
  }, [domain]);

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
      const history = await api.getRecordPoolHistory(data.pool.id);
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

  const loadExpectedNameservers = async (accountId: string, fqdn: string) => {
    if (!accountId) {
      setExpectedNS(null);
      return;
    }
    setLoadingNS(true);
    try {
      const result = await api.getExpectedNameservers(accountId, fqdn);
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
    if (newAccountId && domain) {
      loadExpectedNameservers(newAccountId, domain.fqdn);
    } else {
      setExpectedNS(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!domain) return;
    setSaving(true);
    try {
      await api.updateDNSManagedDomain(domain.id, {
        dns_account_id: dnsAccountId || null,
      });
      if (proxyMode !== domain.proxy_mode) {
        await api.setDomainProxyMode(domain.id, proxyMode);
      }
      toast.success("DNS settings saved");
      // Refresh domain data
      const updated = await api.getDNSManagedDomain(domain.id);
      setDomain(updated);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWildcardPool = async () => {
    if (!domain) return;
    const hasMachines = poolForm.machine_ids.length > 0 || poolForm.group_ids.length > 0;
    if (!poolForm.target_ip || !hasMachines) {
      toast.error("Target IP and at least one machine or group are required");
      return;
    }
    setSaving(true);
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
      setSaving(false);
    }
  };

  const handleSavePassthroughRecord = async () => {
    if (!domain) return;
    if (!passthroughForm.name || !passthroughForm.target_ip) {
      toast.error("Subdomain and target IP are required");
      return;
    }
    const hasMachines = passthroughForm.machine_ids.length > 0 || passthroughForm.group_ids.length > 0;
    if (!hasMachines) {
      toast.error("At least one machine or group is required");
      return;
    }
    setSaving(true);
    try {
      let recordId = editingPassthrough?.id;
      
      if (!editingPassthrough) {
        const existingRecord = records.find(r => 
          r.name === passthroughForm.name && r.record_type === "A"
        );
        
        if (existingRecord) {
          recordId = existingRecord.id;
        } else {
          const newRec = await api.createDNSRecord(domain.id, {
            name: passthroughForm.name,
            record_type: "A",
            value: "0.0.0.0",
            ttl: 60,
            priority: 0,
            proxied: false,
            http_incoming_port: 80,
            http_outgoing_port: 80,
            https_incoming_port: 443,
            https_outgoing_port: 443,
          });
          recordId = newRec.id;
        }
      }
      
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
      setSaving(false);
    }
  };

  const handleDeletePassthroughRecord = async (record: DNSRecord) => {
    if (!domain) return;
    try {
      await api.deleteRecordPool(record.id);
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

  const handleCheckNS = async () => {
    if (!domain) return;
    setSaving(true);
    try {
      const status = await api.checkDNSDomainNS(domain.id);
      setNsStatus(status);
      toast.success("NS check completed");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to check NS");
    } finally {
      setSaving(false);
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
    setSaving(true);
    try {
      const result = await api.compareDNSRecords(domain.id);
      setSyncResult(result);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to compare records");
    } finally {
      setSaving(false);
    }
  };

  const handleSyncToRemote = async () => {
    if (!domain) return;
    setSaving(true);
    try {
      await api.applyDNSToRemote(domain.id);
      toast.success("Records synced to provider");
      loadRecords();
      setSyncResult(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSaving(false);
    }
  };

  const handleSyncFromRemote = async () => {
    if (!domain) return;
    setSaving(true);
    try {
      await api.importDNSFromRemote(domain.id);
      toast.success("Records imported from provider");
      loadRecords();
      setSyncResult(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to import");
    } finally {
      setSaving(false);
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
      } else {
        loadRecords();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate");
    }
  };

  const handlePauseResume = async (poolId: string, isWildcard: boolean, isPaused: boolean) => {
    try {
      if (isWildcard) {
        if (isPaused) {
          await api.resumeWildcardPool(poolId);
        } else {
          await api.pauseWildcardPool(poolId);
        }
        loadWildcardPool();
      } else {
        if (isPaused) {
          await api.resumeRecordPool(poolId);
        } else {
          await api.pauseRecordPool(poolId);
        }
        loadRecords();
      }
      toast.success(isPaused ? "Rotation resumed" : "Rotation paused");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleShowRotationHistory = async (poolId: string, isWildcard: boolean) => {
    setHistoryPoolId(poolId);
    setHistoryIsWildcard(isWildcard);
    setLoadingHistory(true);
    setShowHistoryDialog(true);
    try {
      const history = isWildcard 
        ? await api.getWildcardPoolHistory(poolId)
        : await api.getRecordPoolHistory(poolId);
      setHistoryData(history);
    } catch (err) {
      console.error("Failed to load history:", err);
      setHistoryData([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!domain) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Domain not found</p>
        <Button onClick={() => router.push("/domains/dns")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to DNS Management
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/domains/dns")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center">
              <Globe className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{domain.fqdn}</h1>
              <p className="text-muted-foreground text-sm">DNS Settings & Records</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <Card>
        <CardContent className="p-6">
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
                        {acc.provider === "cloudflare" ? "☁️ Cloudflare" : acc.provider === "desec" ? "🔒 deSEC" : acc.provider === "njalla" ? "🛡️ Njalla" : acc.provider === "cloudns" ? "🌍 ClouDNS" : "🌐 DNSPod"}: {acc.name}
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

              {/* Proxy Mode Selector */}
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
                      <p className="text-xs text-muted-foreground">Manage DNS records directly with your provider.</p>
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
                      <p className="text-xs text-muted-foreground">Route traffic through rotating proxy pools.</p>
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

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => router.push("/domains/dns")}>Cancel</Button>
                <Button onClick={handleSaveSettings} disabled={saving}>
                  {saving ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="records" className="space-y-6 mt-6">
              {!dnsAccountId ? (
                <div className="p-12 text-center border rounded-lg bg-muted/10">
                  <Globe className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p className="text-muted-foreground">DNS records management requires a configured DNS account.</p>
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
                          placeholder="IP address or hostname"
                          value={newRecord.value}
                          onChange={(e) => setNewRecord({ ...newRecord, value: e.target.value })}
                        />
                      </div>
                      <div className="col-span-1 space-y-1.5">
                        <Label className="text-xs text-muted-foreground">TTL</Label>
                        <Input
                          className="h-10"
                          type="number"
                          value={newRecord.ttl}
                          onChange={(e) => setNewRecord({ ...newRecord, ttl: parseInt(e.target.value) || 600 })}
                        />
                      </div>
                      {isCloudflare && (
                        <div className="col-span-1 flex items-center gap-2 pb-2">
                          <Checkbox
                            id="proxied"
                            checked={newRecord.proxied}
                            onCheckedChange={(c) => setNewRecord({ ...newRecord, proxied: !!c })}
                          />
                          <Label htmlFor="proxied" className="text-xs">Proxied</Label>
                        </div>
                      )}
                      {isDeSEC && (
                        <div className="col-span-1 flex items-center pb-2">
                          <span className="text-xs text-muted-foreground">Min TTL: 3600s</span>
                        </div>
                      )}
                      {isNjalla && (
                        <div className="col-span-1 flex items-center pb-2">
                          <span className="text-xs text-muted-foreground">Privacy-focused DNS</span>
                        </div>
                      )}
                      {isClouDNS && (
                        <div className="col-span-1 flex items-center pb-2">
                          <span className="text-xs text-muted-foreground">Free tier: 3 zones</span>
                        </div>
                      )}
                      <div className="col-span-2 flex items-end">
                        <Button className="w-full h-10" onClick={handleAddRecord}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Records Table */}
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="py-3 px-4 text-left font-medium">Name</th>
                          <th className="py-3 px-4 text-left font-medium">Type</th>
                          <th className="py-3 px-4 text-left font-medium">Value</th>
                          <th className="py-3 px-4 text-left font-medium">TTL</th>
                          <th className="py-3 px-4 text-left font-medium">Status</th>
                          <th className="py-3 px-4 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.filter(r => r.mode !== "dynamic").map((record) => (
                          <tr key={record.id} className="border-t">
                            <td className="py-3 px-4 font-mono">
                              {record.name === "@" ? domain.fqdn : `${record.name}.${domain.fqdn}`}
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="outline">{record.record_type}</Badge>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs max-w-xs truncate">
                              {record.value}
                            </td>
                            <td className="py-3 px-4">{record.ttl}s</td>
                            <td className="py-3 px-4">
                              {record.sync_status === "synced" ? (
                                <Badge className="bg-green-500/20 text-green-400">Synced</Badge>
                              ) : record.sync_status === "error" ? (
                                <Badge variant="destructive">Error</Badge>
                              ) : (
                                <Badge variant="secondary">Pending</Badge>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteRecord(record.id)}
                              >
                                <Trash className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {records.filter(r => r.mode !== "dynamic").length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-muted-foreground">
                              No records yet. Add one above.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="passthrough" className="space-y-6 mt-6">
              {proxyMode === "wildcard" ? (
                /* Wildcard Mode Configuration */
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Wildcard Pool Configuration</h3>
                      <p className="text-sm text-muted-foreground">Manage *.{domain.fqdn} passthrough</p>
                    </div>
                    {wildcardPool && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRotateNow(wildcardPool.pool.id, true)}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Rotate Now
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePauseResume(wildcardPool.pool.id, true, wildcardPool.pool.is_paused)}
                        >
                          {wildcardPool.pool.is_paused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                          {wildcardPool.pool.is_paused ? "Resume" : "Pause"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Pool Form */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Target IP (final destination)</Label>
                      <Input
                        placeholder="192.168.1.100"
                        value={poolForm.target_ip}
                        onChange={(e) => setPoolForm(f => ({ ...f, target_ip: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label>HTTPS Port</Label>
                        <Input
                          type="number"
                          value={poolForm.target_port}
                          onChange={(e) => setPoolForm(f => ({ ...f, target_port: parseInt(e.target.value) || 443 }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>HTTP Port</Label>
                        <Input
                          type="number"
                          value={poolForm.target_port_http}
                          onChange={(e) => setPoolForm(f => ({ ...f, target_port_http: parseInt(e.target.value) || 80 }))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Strategy</Label>
                      <Select value={poolForm.rotation_strategy} onValueChange={(v) => setPoolForm(f => ({ ...f, rotation_strategy: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="round_robin">Round Robin</SelectItem>
                          <SelectItem value="random">Random</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Interval (minutes)</Label>
                      <Input
                        type="number"
                        value={poolForm.interval_minutes}
                        onChange={(e) => setPoolForm(f => ({ ...f, interval_minutes: parseInt(e.target.value) || 60 }))}
                      />
                    </div>
                    <div className="flex items-end gap-4">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="health_wild"
                          checked={poolForm.health_check_enabled}
                          onCheckedChange={(c) => setPoolForm(f => ({ ...f, health_check_enabled: !!c }))}
                        />
                        <Label htmlFor="health_wild">Skip offline servers</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="include_root"
                          checked={poolForm.include_root}
                          onCheckedChange={(c) => setPoolForm(f => ({ ...f, include_root: !!c }))}
                        />
                        <Label htmlFor="include_root">Include @</Label>
                      </div>
                    </div>
                  </div>

                  {/* Machine Selection */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Proxy Machines</Label>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPoolForm(f => ({ ...f, machine_ids: machines.map(m => m.id) }))}>
                          Select All
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setPoolForm(f => ({ ...f, machine_ids: [] }))}>
                          Unselect All
                        </Button>
                      </div>
                    </div>
                    
                    {/* Groups */}
                    {groups.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Groups:</p>
                        <div className="flex flex-wrap gap-2">
                          {groups.map(g => (
                            <Badge
                              key={g.id}
                              variant={poolForm.group_ids.includes(g.id) ? "default" : "outline"}
                              className="cursor-pointer"
                              onClick={() => {
                                setPoolForm(f => ({
                                  ...f,
                                  group_ids: f.group_ids.includes(g.id)
                                    ? f.group_ids.filter(id => id !== g.id)
                                    : [...f.group_ids, g.id]
                                }));
                              }}
                            >
                              {g.emoji} {g.name} ({g.machine_count})
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Machines */}
                    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 border rounded-lg">
                      {machines.map(m => (
                        <label key={m.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer">
                          <Checkbox
                            checked={poolForm.machine_ids.includes(m.id)}
                            onCheckedChange={(c) => {
                              setPoolForm(f => ({
                                ...f,
                                machine_ids: c
                                  ? [...f.machine_ids, m.id]
                                  : f.machine_ids.filter(id => id !== m.id)
                              }));
                            }}
                          />
                          <div className={`w-2 h-2 rounded-full ${m.last_seen && (Date.now() - new Date(m.last_seen).getTime()) < 120000 ? "bg-green-500" : "bg-red-500"}`} />
                          <span className="text-sm truncate">{m.title || m.hostname}</span>
                          <span className="text-xs text-muted-foreground">- {m.primary_ip || m.ip_address}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {poolForm.group_ids.length} group(s) + {poolForm.machine_ids.length} individual machine(s) selected
                    </p>
                  </div>

                  <Button onClick={handleSaveWildcardPool} disabled={saving} className="w-full">
                    {saving ? "Saving..." : "Save Wildcard Pool"}
                  </Button>
                </div>
              ) : (
                /* Separate Mode - Per-Record Configuration */
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Passthrough Records</h3>
                      <p className="text-sm text-muted-foreground">Configure individual A record pools</p>
                    </div>
                    <Button onClick={() => { resetPassthroughForm(); setEditingPassthrough(null); setShowAddPassthrough(true); }}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Record
                    </Button>
                  </div>

                  {/* Records Table */}
                  {passthroughRecords.length > 0 ? (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="py-3 px-4 text-left font-medium">Subdomain</th>
                            <th className="py-3 px-4 text-left font-medium">Target</th>
                            <th className="py-3 px-4 text-left font-medium">Pool</th>
                            <th className="py-3 px-4 text-left font-medium">Current</th>
                            <th className="py-3 px-4 text-left font-medium">Last Update</th>
                            <th className="py-3 px-4 text-left font-medium">Status</th>
                            <th className="py-3 px-4 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {passthroughRecords.map(record => (
                            <PassthroughRecordRow
                              key={record.id}
                              record={record}
                              domain={domain}
                              onEdit={() => editPassthroughRecord(record)}
                              onDelete={() => handleDeletePassthroughRecord(record)}
                              onRotate={handleRotateNow}
                              onPauseResume={handlePauseResume}
                              onShowHistory={handleShowRotationHistory}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-12 text-center border rounded-lg bg-muted/10">
                      <Zap className="h-12 w-12 mx-auto mb-4 opacity-30" />
                      <p className="text-muted-foreground">No passthrough records configured yet.</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Add a record to start routing traffic through proxy pools.
                      </p>
                    </div>
                  )}

                  {/* Add/Edit Form */}
                  {showAddPassthrough && (
                    <div className="p-4 border rounded-lg bg-muted/10 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{editingPassthrough ? "Edit" : "New"} Passthrough Record</h4>
                        <Button variant="ghost" size="sm" onClick={() => { setShowAddPassthrough(false); setEditingPassthrough(null); }}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <Label>Subdomain</Label>
                          <Input
                            placeholder="www, api, @"
                            value={passthroughForm.name}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, name: e.target.value }))}
                            disabled={!!editingPassthrough}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Target IP</Label>
                          <Input
                            placeholder="192.168.1.100"
                            value={passthroughForm.target_ip}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, target_ip: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>HTTPS Port</Label>
                          <Input
                            type="number"
                            value={passthroughForm.target_port}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, target_port: parseInt(e.target.value) || 443 }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>HTTP Port</Label>
                          <Input
                            type="number"
                            value={passthroughForm.target_port_http}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, target_port_http: parseInt(e.target.value) || 80 }))}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Strategy</Label>
                          <Select value={passthroughForm.rotation_strategy} onValueChange={(v) => setPassthroughForm(f => ({ ...f, rotation_strategy: v }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="round_robin">Round Robin</SelectItem>
                              <SelectItem value="random">Random</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Interval (min)</Label>
                          <Input
                            type="number"
                            value={passthroughForm.interval_minutes}
                            onChange={(e) => setPassthroughForm(f => ({ ...f, interval_minutes: parseInt(e.target.value) || 60 }))}
                          />
                        </div>
                        <div className="flex items-end pb-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="health_sep"
                              checked={passthroughForm.health_check_enabled}
                              onCheckedChange={(c) => setPassthroughForm(f => ({ ...f, health_check_enabled: !!c }))}
                            />
                            <Label htmlFor="health_sep">Skip offline</Label>
                          </div>
                        </div>
                      </div>

                      {/* Machine Selection */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Proxy Machines</Label>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPassthroughForm(f => ({ ...f, machine_ids: machines.map(m => m.id) }))}>
                              Select All
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setPassthroughForm(f => ({ ...f, machine_ids: [] }))}>
                              Unselect All
                            </Button>
                          </div>
                        </div>
                        
                        {groups.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {groups.map(g => (
                              <Badge
                                key={g.id}
                                variant={passthroughForm.group_ids.includes(g.id) ? "default" : "outline"}
                                className="cursor-pointer"
                                onClick={() => {
                                  setPassthroughForm(f => ({
                                    ...f,
                                    group_ids: f.group_ids.includes(g.id)
                                      ? f.group_ids.filter(id => id !== g.id)
                                      : [...f.group_ids, g.id]
                                  }));
                                }}
                              >
                                {g.emoji} {g.name} ({g.machine_count})
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto p-2 border rounded-lg">
                          {machines.map(m => (
                            <label key={m.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer">
                              <Checkbox
                                checked={passthroughForm.machine_ids.includes(m.id)}
                                onCheckedChange={(c) => {
                                  setPassthroughForm(f => ({
                                    ...f,
                                    machine_ids: c
                                      ? [...f.machine_ids, m.id]
                                      : f.machine_ids.filter(id => id !== m.id)
                                  }));
                                }}
                              />
                              <div className={`w-2 h-2 rounded-full ${m.last_seen && (Date.now() - new Date(m.last_seen).getTime()) < 120000 ? "bg-green-500" : "bg-red-500"}`} />
                              <span className="text-sm truncate">{m.title || m.hostname}</span>
                              <span className="text-xs text-muted-foreground">- {m.primary_ip || m.ip_address}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => { setShowAddPassthrough(false); setEditingPassthrough(null); }}>
                          Cancel
                        </Button>
                        <Button onClick={handleSavePassthroughRecord} disabled={saving}>
                          {saving ? "Saving..." : editingPassthrough ? "Update" : "Create"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="sync" className="space-y-6 mt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Record Synchronization</h3>
                  <p className="text-sm text-muted-foreground">Compare and sync records with DNS provider</p>
                </div>
                <Button onClick={handleCompareRecords} disabled={saving}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${saving ? "animate-spin" : ""}`} />
                  Compare Records
                </Button>
              </div>

              {syncResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-green-500">To Create</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">{syncResult.created?.length || 0}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-yellow-500">To Update</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">{syncResult.updated?.length || 0}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-red-500">To Delete</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">{syncResult.deleted?.length || 0}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-orange-500">Conflicts</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">{syncResult.conflicts?.length || 0}</p>
                      </CardContent>
                    </Card>
                  </div>

                  {syncResult.in_sync ? (
                    <p className="text-sm text-green-500">✓ All records are in sync</p>
                  ) : (
                    <div className="flex gap-2">
                      <Button onClick={handleSyncToRemote} disabled={saving} variant="outline">
                        Push to Provider
                      </Button>
                      <Button onClick={handleSyncFromRemote} disabled={saving} variant="outline">
                        Pull from Provider
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="debug" className="space-y-6 mt-6">
              {/* NS Status Check */}
              <div className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Nameserver Status</h3>
                    <p className="text-sm text-muted-foreground">Check if domain is pointing to correct nameservers</p>
                  </div>
                  <Button onClick={handleCheckNS} disabled={saving} variant="outline">
                    <RefreshCw className={`h-4 w-4 mr-2 ${saving ? "animate-spin" : ""}`} />
                    Check NS
                  </Button>
                </div>
                {nsStatus && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
                    {nsStatus.valid ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    <span>{nsStatus.message}</span>
                  </div>
                )}
              </div>

              {/* DNS Lookup */}
              <div className="p-4 border rounded-lg space-y-4">
                <h3 className="font-medium">DNS Lookup (Public)</h3>
                <div className="flex gap-2">
                  <Input
                    placeholder="Subdomain (@ for root)"
                    value={lookupSubdomain}
                    onChange={(e) => setLookupSubdomain(e.target.value)}
                    className="w-48"
                  />
                  <Button onClick={handleDNSLookup} disabled={loadingLookup} variant="outline">
                    {loadingLookup ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Lookup"}
                  </Button>
                </div>
                {dnsLookupResult && (
                  <div className="p-3 rounded-lg bg-muted/30 space-y-2">
                    <p className="text-sm font-medium">Results for: {dnsLookupResult.lookup}</p>
                    {Object.entries(dnsLookupResult.results).map(([type, data]) => (
                      <div key={type} className="text-sm">
                        <span className="font-medium">{type}:</span>{" "}
                        {data.error ? (
                          <span className="text-red-400">{data.error}</span>
                        ) : (
                          data.records.join(", ")
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Provider Records */}
              <div className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Provider Records</h3>
                  <Button onClick={handleListProviderRecords} disabled={loadingProviderRecords} variant="outline">
                    {loadingProviderRecords ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Fetch All"}
                  </Button>
                </div>
                {providerRecords && (
                  <div className="border rounded overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="py-2 px-3 text-left">Name</th>
                          <th className="py-2 px-3 text-left">Type</th>
                          <th className="py-2 px-3 text-left">Value</th>
                          <th className="py-2 px-3 text-left">TTL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providerRecords.map((r, i) => (
                          <tr key={i} className="border-t">
                            <td className="py-2 px-3 font-mono">{r.name}</td>
                            <td className="py-2 px-3">{r.type}</td>
                            <td className="py-2 px-3 font-mono text-xs max-w-xs truncate">{r.value}</td>
                            <td className="py-2 px-3">{r.ttl}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Rotation History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Rotation History
            </DialogTitle>
            <DialogDescription>
              Complete log of DNS record rotations
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-[60vh] overflow-y-auto">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : historyData.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No rotation history yet
              </div>
            ) : (
              <div className="space-y-3">
                {historyData.map((entry) => (
                  <div key={entry.id} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline">{entry.trigger}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.rotated_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="flex items-center gap-1">
                        <Server className="h-3 w-3" />
                        <span>{entry.from_machine_name || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">({entry.from_ip})</span>
                      </div>
                      <span className="text-muted-foreground">→</span>
                      <div className="flex items-center gap-1">
                        <Server className="h-3 w-3" />
                        <span className="font-medium">{entry.to_machine_name || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">({entry.to_ip})</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHistoryDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

