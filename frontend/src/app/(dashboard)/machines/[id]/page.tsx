"use client";

import { useState, useEffect, use, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, Machine } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import dynamic from "next/dynamic";

// Dynamically import terminal to avoid SSR issues
const WebSocketTerminal = dynamic(
  () => import("@/components/terminal").then((mod) => mod.WebSocketTerminal),
  { ssr: false, loading: () => <div className="h-[400px] bg-black rounded-lg animate-pulse" /> }
);

const DEFAULT_FAIL2BAN_CONFIG = `[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
`;

const LOG_TYPES = [
  { value: "nginx_access", label: "Nginx Access" },
  { value: "nginx_error", label: "Nginx Error" },
  { value: "syslog", label: "System Log" },
  { value: "auth", label: "Auth Log" },
  { value: "fail2ban", label: "Fail2ban" },
];

export default function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Local state for edits (to prevent refresh issues)
  const [localNotes, setLocalNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesTab, setNotesTab] = useState<string>("preview");

  // Optimistic UI states
  const [ufwEnabled, setUfwEnabled] = useState(false);
  const [fail2banEnabled, setFail2banEnabled] = useState(false);
  const [pendingUFW, setPendingUFW] = useState(false);
  const [pendingFail2ban, setPendingFail2ban] = useState(false);

  // Dialogs
  const [showAddPortDialog, setShowAddPortDialog] = useState(false);
  const [showSSHPortDialog, setShowSSHPortDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showFail2banDialog, setShowFail2banDialog] = useState(false);
  const [showConfirmUFWDialog, setShowConfirmUFWDialog] = useState(false);
  const [showConfirmFail2banDialog, setShowConfirmFail2banDialog] = useState(false);
  const [pendingToggleValue, setPendingToggleValue] = useState(false);

  // Form states
  const [newPort, setNewPort] = useState("");
  const [newProtocol, setNewProtocol] = useState("tcp");
  const [sshPort, setSSHPort] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fail2banConfig, setFail2banConfig] = useState(DEFAULT_FAIL2BAN_CONFIG);

  // Logs state
  const [selectedLogType, setSelectedLogType] = useState("nginx_access");
  const [logLines, setLogLines] = useState(100);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);

  // Initial load
  useEffect(() => {
    loadMachine();
  }, [id]);

  // Periodic refresh for stats only (not notes)
  useEffect(() => {
    const interval = setInterval(() => {
      loadMachineStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [id]);

  // Auto-refresh logs
  useEffect(() => {
    if (autoRefreshLogs && activeTab === "logs") {
      const interval = setInterval(loadLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefreshLogs, activeTab, selectedLogType, logLines]);

  const loadMachine = async () => {
    try {
      const data = await api.getMachine(id);
      setMachine(data);
      // Only set notes if not dirty (user hasn't made edits)
      if (!notesDirty) {
        setLocalNotes(data.notes_md || "");
      }
      if (data.fail2ban_config) {
        setFail2banConfig(data.fail2ban_config);
      }
      setUfwEnabled(data.ufw_enabled);
      setFail2banEnabled(data.fail2ban_enabled);
    } catch (err) {
      console.error("Failed to load machine:", err);
      toast.error("Failed to load machine");
    } finally {
      setLoading(false);
    }
  };

  const loadMachineStats = async () => {
    try {
      const data = await api.getMachine(id);
      // Only update stats, not notes or config (preserve local edits)
      setMachine(prev => prev ? {
        ...prev,
        cpu_percent: data.cpu_percent,
        memory_used: data.memory_used,
        memory_total: data.memory_total,
        disk_used: data.disk_used,
        disk_total: data.disk_total,
        last_seen: data.last_seen,
        ssh_port: data.ssh_port,
        // Only update these if not pending
        ufw_enabled: pendingUFW ? prev.ufw_enabled : data.ufw_enabled,
        fail2ban_enabled: pendingFail2ban ? prev.fail2ban_enabled : data.fail2ban_enabled,
      } : null);
      
      // Sync optimistic state with server if not pending
      if (!pendingUFW) setUfwEnabled(data.ufw_enabled);
      if (!pendingFail2ban) setFail2banEnabled(data.fail2ban_enabled);
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  };

  const loadLogs = useCallback(async () => {
    if (!machine) return;
    setLogsLoading(true);
    try {
      const data = await api.getMachineLogs(machine.id, selectedLogType, logLines);
      setLogs(data.logs);
      // Auto-scroll to bottom
      if (logsRef.current) {
        logsRef.current.scrollTop = logsRef.current.scrollHeight;
      }
    } catch (err) {
      console.error("Failed to load logs:", err);
      toast.error("Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  }, [machine, selectedLogType, logLines]);

  const handleSaveNotes = async () => {
    if (!machine) return;
    setSaving(true);
    try {
      await api.updateMachineNotes(machine.id, localNotes);
      setNotesDirty(false);
      toast.success("Notes saved successfully");
    } catch (err) {
      console.error("Failed to save notes:", err);
      toast.error("Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  const handleNotesChange = (value: string) => {
    setLocalNotes(value);
    setNotesDirty(true);
  };

  const handleDelete = async () => {
    if (!machine) return;
    if (!confirm("Are you sure you want to delete this machine? This action cannot be undone.")) return;
    try {
      await api.deleteMachine(machine.id);
      toast.success("Machine deleted");
      router.push("/machines");
    } catch (err) {
      console.error("Failed to delete machine:", err);
      toast.error("Failed to delete machine");
    }
  };

  const handleUFWToggleRequest = (newValue: boolean) => {
    setPendingToggleValue(newValue);
    setShowConfirmUFWDialog(true);
  };

  const handleConfirmUFWToggle = async () => {
    if (!machine) return;
    setShowConfirmUFWDialog(false);
    
    // Optimistic update
    setUfwEnabled(pendingToggleValue);
    setPendingUFW(true);
    
    try {
      await api.toggleUFW(machine.id, pendingToggleValue);
      toast.success(`Firewall ${pendingToggleValue ? "enabled" : "disabled"} job created`);
      // Wait a bit then allow server sync
      setTimeout(() => setPendingUFW(false), 10000);
    } catch (err) {
      console.error("Failed to toggle UFW:", err);
      // Revert optimistic update
      setUfwEnabled(!pendingToggleValue);
      setPendingUFW(false);
      toast.error("Failed to toggle firewall");
    }
  };

  const handleFail2banToggleRequest = (newValue: boolean) => {
    setPendingToggleValue(newValue);
    setShowConfirmFail2banDialog(true);
  };

  const handleConfirmFail2banToggle = async () => {
    if (!machine) return;
    setShowConfirmFail2banDialog(false);
    
    // Optimistic update
    setFail2banEnabled(pendingToggleValue);
    setPendingFail2ban(true);
    
    try {
      await api.toggleFail2ban(machine.id, pendingToggleValue, fail2banConfig);
      toast.success(`Fail2ban ${pendingToggleValue ? "enabled" : "disabled"} job created`);
      setTimeout(() => setPendingFail2ban(false), 10000);
    } catch (err) {
      console.error("Failed to toggle fail2ban:", err);
      setFail2banEnabled(!pendingToggleValue);
      setPendingFail2ban(false);
      toast.error("Failed to toggle Fail2ban");
    }
  };

  const handleChangeSSHPort = async () => {
    if (!machine) return;
    const port = parseInt(sshPort);
    if (isNaN(port) || port < 1024 || port > 65535) {
      toast.error("Port must be between 1024 and 65535");
      return;
    }
    try {
      await api.changeSSHPort(machine.id, port);
      setShowSSHPortDialog(false);
      setSSHPort("");
      toast.success("SSH port change job created");
    } catch (err) {
      console.error("Failed to change SSH port:", err);
      toast.error("Failed to change SSH port");
    }
  };

  const handleChangePassword = async () => {
    if (!machine) return;
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    try {
      await api.changeRootPassword(machine.id, newPassword);
      setShowPasswordDialog(false);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Root password change job created");
    } catch (err) {
      console.error("Failed to change password:", err);
      toast.error("Failed to change password");
    }
  };

  const handleAddPort = async () => {
    if (!machine || !newPort) return;
    try {
      await api.addUFWRule(machine.id, newPort, newProtocol);
      setShowAddPortDialog(false);
      setNewPort("");
      toast.success("UFW rule job created");
    } catch (err) {
      console.error("Failed to add UFW rule:", err);
      toast.error("Failed to add UFW rule");
    }
  };

  const handleRemoveUFWRule = async (port: string, protocol: string) => {
    if (!machine) return;
    if (!confirm(`Are you sure you want to remove the rule for port ${port}/${protocol}?`)) return;
    try {
      await api.removeUFWRule(machine.id, port, protocol);
      toast.success("UFW rule removal job created");
    } catch (err) {
      console.error("Failed to remove UFW rule:", err);
      toast.error("Failed to remove UFW rule");
    }
  };

  const handleSaveFail2banConfig = async () => {
    if (!machine) return;
    try {
      await api.toggleFail2ban(machine.id, fail2banEnabled, fail2banConfig);
      setShowFail2banDialog(false);
      toast.success("Fail2ban config update job created");
    } catch (err) {
      console.error("Failed to update fail2ban config:", err);
      toast.error("Failed to update fail2ban config");
    }
  };

  const handleDownloadLogs = () => {
    const blob = new Blob([logs], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${machine?.hostname || "machine"}-${selectedLogType}-${new Date().toISOString()}.log`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Logs downloaded");
  };

  const filteredLogs = logSearch
    ? logs.split("\n").filter(line => line.toLowerCase().includes(logSearch.toLowerCase())).join("\n")
    : logs;

  const getStatusBadge = () => {
    if (!machine?.last_seen) {
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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (date: string | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!machine) {
    return (
      <div className="space-y-6">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Machine Not Found</CardTitle>
            <CardDescription>The requested machine could not be found.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push("/machines")}>Back to Machines</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/machines")}>
            ← Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">{machine.hostname || "Unknown"}</h1>
              {getStatusBadge()}
              {(pendingUFW || pendingFail2ban) && (
                <Badge variant="outline" className="animate-pulse">
                  Applying changes...
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1">{machine.ip_address || "No IP address"}</p>
          </div>
        </div>
        <Button variant="destructive" onClick={handleDelete}>
          Delete Machine
        </Button>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Machine Info */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle>Machine Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Hostname</p>
                    <p className="font-medium">{machine.hostname || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">IP Address</p>
                    <p className="font-medium font-mono">{machine.ip_address || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">OS Version</p>
                    <p className="font-medium">{machine.ubuntu_version || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Agent Version</p>
                    <p className="font-medium font-mono">{machine.agent_version || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last Seen</p>
                    <p className="font-medium">{formatDate(machine.last_seen)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Owner</p>
                    <p className="font-medium">{machine.owner_name || machine.owner_email || "Unassigned"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* System Stats */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle>System Resources</CardTitle>
                <CardDescription>Real-time hardware utilization</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">CPU Usage</span>
                    <span className="font-mono">{machine.cpu_percent?.toFixed(1) || 0}%</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${(machine.cpu_percent || 0) > 80 ? 'bg-red-500' : (machine.cpu_percent || 0) > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${machine.cpu_percent || 0}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Memory</span>
                    <span className="font-mono">{formatBytes(machine.memory_used || 0)} / {formatBytes(machine.memory_total || 0)}</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${machine.memory_total > 0 && (machine.memory_used / machine.memory_total) > 0.8 ? 'bg-red-500' : machine.memory_total > 0 && (machine.memory_used / machine.memory_total) > 0.5 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: machine.memory_total > 0 ? `${(machine.memory_used / machine.memory_total) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Disk</span>
                    <span className="font-mono">{formatBytes(machine.disk_used || 0)} / {formatBytes(machine.disk_total || 0)}</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${machine.disk_total > 0 && (machine.disk_used / machine.disk_total) > 0.9 ? 'bg-red-500' : machine.disk_total > 0 && (machine.disk_used / machine.disk_total) > 0.7 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: machine.disk_total > 0 ? `${(machine.disk_used / machine.disk_total) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Status Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${machine.last_seen && new Date(machine.last_seen).getTime() > Date.now() - 60000 ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="font-medium text-sm">{machine.last_seen && new Date(machine.last_seen).getTime() > Date.now() - 60000 ? 'Online' : 'Offline'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${ufwEnabled ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">Firewall</p>
                    <p className="font-medium text-sm">{ufwEnabled ? 'Active' : 'Inactive'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${fail2banEnabled ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">Fail2ban</p>
                    <p className="font-medium text-sm">{fail2banEnabled ? 'Active' : 'Inactive'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4">
                <div>
                  <p className="text-xs text-muted-foreground">SSH Port</p>
                  <p className="font-medium text-sm font-mono">{machine.ssh_port || 22}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6 mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Security Settings */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle>Authentication</CardTitle>
                <CardDescription>SSH access and password management</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* SSH Port */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium text-sm">SSH Port</p>
                    <p className="text-xs text-muted-foreground">
                      Currently: <span className="font-mono">{machine.ssh_port || 22}</span>
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowSSHPortDialog(true)}>
                    Change
                  </Button>
                </div>

                {/* Root Password */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium text-sm">Root Password</p>
                    <p className="text-xs text-muted-foreground">
                      {machine.root_password_set ? "Password has been changed" : "Using default password"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowPasswordDialog(true)}>
                    Change
                  </Button>
                </div>

                {/* Fail2ban */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium text-sm">Fail2ban</p>
                      <p className="text-xs text-muted-foreground">SSH brute-force protection</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowFail2banDialog(true)}>
                      Configure
                    </Button>
                    <Switch 
                      checked={fail2banEnabled} 
                      onCheckedChange={handleFail2banToggleRequest}
                      disabled={pendingFail2ban}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* UFW Firewall */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Firewall (UFW)</CardTitle>
                  <CardDescription>Manage port access rules</CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {ufwEnabled ? "Active" : "Inactive"}
                    </span>
                    <Switch 
                      checked={ufwEnabled} 
                      onCheckedChange={handleUFWToggleRequest}
                      disabled={pendingUFW}
                    />
                  </div>
                  <Button size="sm" onClick={() => setShowAddPortDialog(true)} disabled={!ufwEnabled}>
                    Add Rule
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {/* Display actual UFW rules from agent */}
                  {machine.ufw_rules && machine.ufw_rules.length > 0 ? (
                    machine.ufw_rules.map((rule, idx) => {
                      const isSSHPort = rule.port === String(machine.ssh_port || 22);
                      const portLabel = rule.port === "80" ? "HTTP" : 
                                       rule.port === "443" ? "HTTPS" : 
                                       isSSHPort ? "SSH" : null;
                      return (
                        <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 group">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="w-12 justify-center uppercase">
                              {rule.protocol}
                            </Badge>
                            <span className="font-mono font-medium">{rule.port}</span>
                            {portLabel && (
                              <span className="text-xs text-muted-foreground">({portLabel})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={
                              rule.action === "ALLOW" 
                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                : "bg-red-500/20 text-red-400 border-red-500/30"
                            }>
                              {rule.action}
                            </Badge>
                            {isSSHPort ? (
                              <span className="text-xs text-muted-foreground">Protected</span>
                            ) : (
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                                onClick={() => handleRemoveUFWRule(rule.port, rule.protocol)}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center text-muted-foreground py-4">
                      No firewall rules detected. Agent may need to report rules.
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground text-center mt-4">
                  Rules sync every 5 seconds from agent. SSH port is protected from deletion.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4 mt-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Server Logs</CardTitle>
                  <CardDescription>View and search log files</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={selectedLogType} onValueChange={setSelectedLogType}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOG_TYPES.map(lt => (
                        <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={logLines.toString()} onValueChange={(v) => setLogLines(parseInt(v))}>
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50 lines</SelectItem>
                      <SelectItem value="100">100 lines</SelectItem>
                      <SelectItem value="500">500 lines</SelectItem>
                      <SelectItem value="1000">1000 lines</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Switch checked={autoRefreshLogs} onCheckedChange={setAutoRefreshLogs} />
                    <span className="text-sm text-muted-foreground">Auto</span>
                  </div>
                  <Button onClick={loadLogs} disabled={logsLoading} size="sm">
                    {logsLoading ? "Loading..." : "Refresh"}
                  </Button>
                  <Button onClick={handleDownloadLogs} disabled={!logs} size="sm" variant="outline">
                    Download
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Input
                  placeholder="Search logs..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="max-w-sm"
                />
                <pre 
                  ref={logsRef}
                  className="bg-black/50 text-green-400 p-4 rounded-lg font-mono text-xs overflow-auto max-h-[500px] whitespace-pre-wrap"
                >
                  {filteredLogs || "Click Refresh to load logs..."}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Terminal Tab */}
        <TabsContent value="terminal" className="space-y-4 mt-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Terminal</CardTitle>
              <CardDescription>
                Real-time shell access via WebSocket. Full PTY support.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[450px] rounded-lg overflow-hidden border border-border/50">
                <WebSocketTerminal
                  machineId={machine.id}
                  apiUrl={api.getApiUrl()}
                  token={localStorage.getItem("token") || ""}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Connected via WebSocket. Supports interactive commands, colors, and full shell features.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" className="space-y-4 mt-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>Markdown notes about this machine</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={notesTab} onValueChange={setNotesTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                  <TabsTrigger value="edit">
                    Edit {notesDirty && <span className="ml-1 text-orange-400">•</span>}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="preview" className="mt-4">
                  <div className="min-h-[200px] p-4 border rounded-md bg-muted/30 prose prose-invert prose-sm max-w-none">
                    {localNotes ? (
                      <ReactMarkdown>{localNotes}</ReactMarkdown>
                    ) : (
                      <p className="text-muted-foreground italic">No notes yet. Click Edit to add notes.</p>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="edit" className="mt-4">
                  <Textarea
                    className="min-h-[200px] font-mono text-sm"
                    placeholder="# Server Notes&#10;&#10;**Hosting:** DigitalOcean&#10;**Expiry:** 2025-12-31&#10;&#10;## Info&#10;- Monthly billing&#10;- Contact: admin@example.com"
                    value={localNotes}
                    onChange={(e) => handleNotesChange(e.target.value)}
                  />
                  <div className="flex items-center gap-2 mt-4">
                    <Button onClick={handleSaveNotes} disabled={saving || !notesDirty}>
                      {saving ? "Saving..." : "Save Notes"}
                    </Button>
                    {notesDirty && (
                      <span className="text-sm text-orange-400">Unsaved changes</span>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Port Dialog */}
      <Dialog open={showAddPortDialog} onOpenChange={setShowAddPortDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Firewall Rule</DialogTitle>
            <DialogDescription>
              Allow a new port through the firewall.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                placeholder="8080"
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Protocol</Label>
              <div className="flex gap-2">
                <Button
                  variant={newProtocol === "tcp" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNewProtocol("tcp")}
                >
                  TCP
                </Button>
                <Button
                  variant={newProtocol === "udp" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNewProtocol("udp")}
                >
                  UDP
                </Button>
                <Button
                  variant={newProtocol === "both" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNewProtocol("both")}
                >
                  Both
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddPortDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPort}>
              Add Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change SSH Port Dialog */}
      <Dialog open={showSSHPortDialog} onOpenChange={setShowSSHPortDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change SSH Port</DialogTitle>
            <DialogDescription>
              Change the SSH daemon port. Current port: {machine.ssh_port || 22}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ssh-port">New SSH Port</Label>
              <Input
                id="ssh-port"
                type="number"
                placeholder="2222"
                min="1024"
                max="65535"
                value={sshPort}
                onChange={(e) => setSSHPort(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Must be between 1024 and 65535. UFW will be updated automatically.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSSHPortDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangeSSHPort}>
              Change Port
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Root Password</DialogTitle>
            <DialogDescription>
              Set a new root password for this machine.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Password must be at least 8 characters.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword}>
              Change Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fail2ban Config Dialog */}
      <Dialog open={showFail2banDialog} onOpenChange={setShowFail2banDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fail2ban Configuration</DialogTitle>
            <DialogDescription>
              Configure the fail2ban jail settings. This protects SSH from brute-force attacks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              className="min-h-[300px] font-mono text-sm"
              value={fail2banConfig}
              onChange={(e) => setFail2banConfig(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setFail2banConfig(DEFAULT_FAIL2BAN_CONFIG)}>
                Reset to Default
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFail2banDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveFail2banConfig}>
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm UFW Toggle Dialog */}
      <Dialog open={showConfirmUFWDialog} onOpenChange={setShowConfirmUFWDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingToggleValue ? "Enable" : "Disable"} Firewall?
            </DialogTitle>
            <DialogDescription>
              {pendingToggleValue
                ? "Enabling the firewall will block all incoming connections except allowed ports. Make sure SSH is allowed to avoid lockout."
                : "Disabling the firewall will allow all incoming connections. This may expose your server to security risks."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmUFWDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant={pendingToggleValue ? "default" : "destructive"} 
              onClick={handleConfirmUFWToggle}
            >
              {pendingToggleValue ? "Enable Firewall" : "Disable Firewall"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Fail2ban Toggle Dialog */}
      <Dialog open={showConfirmFail2banDialog} onOpenChange={setShowConfirmFail2banDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingToggleValue ? "Enable" : "Disable"} Fail2ban?
            </DialogTitle>
            <DialogDescription>
              {pendingToggleValue
                ? "Fail2ban will monitor authentication logs and ban IPs with too many failed login attempts."
                : "Disabling Fail2ban will stop monitoring for brute-force attacks. Your server may be more vulnerable to SSH attacks."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmFail2banDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant={pendingToggleValue ? "default" : "destructive"} 
              onClick={handleConfirmFail2banToggle}
            >
              {pendingToggleValue ? "Enable Fail2ban" : "Disable Fail2ban"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
