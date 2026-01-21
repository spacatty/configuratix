"use client";

import { useState, useEffect, use } from "react";
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
import { api, Machine } from "@/lib/api";
import ReactMarkdown from "react-markdown";

const DEFAULT_FAIL2BAN_CONFIG = `[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
`;

export default function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notesTab, setNotesTab] = useState<string>("preview");

  // Dialogs
  const [showAddPortDialog, setShowAddPortDialog] = useState(false);
  const [showSSHPortDialog, setShowSSHPortDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showFail2banDialog, setShowFail2banDialog] = useState(false);

  // Form states
  const [newPort, setNewPort] = useState("");
  const [newProtocol, setNewProtocol] = useState("tcp");
  const [sshPort, setSSHPort] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fail2banConfig, setFail2banConfig] = useState(DEFAULT_FAIL2BAN_CONFIG);

  useEffect(() => {
    loadMachine();
    const interval = setInterval(loadMachine, 5000); // Refresh every 5s for stats
    return () => clearInterval(interval);
  }, [id]);

  const loadMachine = async () => {
    try {
      const data = await api.getMachine(id);
      setMachine(data);
      setNotes(data.notes_md || "");
      if (data.fail2ban_config) {
        setFail2banConfig(data.fail2ban_config);
      }
    } catch (err) {
      console.error("Failed to load machine:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!machine) return;
    setSaving(true);
    try {
      await api.updateMachineNotes(machine.id, notes);
    } catch (err) {
      console.error("Failed to save notes:", err);
      alert("Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!machine) return;
    if (!confirm("Are you sure you want to delete this machine? This action cannot be undone.")) return;
    try {
      await api.deleteMachine(machine.id);
      router.push("/machines");
    } catch (err) {
      console.error("Failed to delete machine:", err);
      alert("Failed to delete machine");
    }
  };

  const handleToggleUFW = async () => {
    if (!machine) return;
    try {
      await api.toggleUFW(machine.id, !machine.ufw_enabled);
      loadMachine();
    } catch (err) {
      console.error("Failed to toggle UFW:", err);
      alert("Failed to toggle UFW");
    }
  };

  const handleToggleFail2ban = async () => {
    if (!machine) return;
    try {
      await api.toggleFail2ban(machine.id, !machine.fail2ban_enabled, fail2banConfig);
      loadMachine();
    } catch (err) {
      console.error("Failed to toggle fail2ban:", err);
      alert("Failed to toggle fail2ban");
    }
  };

  const handleChangeSSHPort = async () => {
    if (!machine) return;
    const port = parseInt(sshPort);
    if (isNaN(port) || port < 1024 || port > 65535) {
      alert("Port must be between 1024 and 65535");
      return;
    }
    try {
      await api.changeSSHPort(machine.id, port);
      setShowSSHPortDialog(false);
      setSSHPort("");
      alert("SSH port change job created. The agent will apply this change.");
      loadMachine();
    } catch (err) {
      console.error("Failed to change SSH port:", err);
      alert("Failed to change SSH port");
    }
  };

  const handleChangePassword = async () => {
    if (!machine) return;
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      alert("Password must be at least 8 characters");
      return;
    }
    try {
      await api.changeRootPassword(machine.id, newPassword);
      setShowPasswordDialog(false);
      setNewPassword("");
      setConfirmPassword("");
      alert("Root password change job created. The agent will apply this change.");
      loadMachine();
    } catch (err) {
      console.error("Failed to change password:", err);
      alert("Failed to change password");
    }
  };

  const handleAddPort = async () => {
    if (!machine || !newPort) return;
    try {
      await api.addUFWRule(machine.id, newPort, newProtocol);
      setShowAddPortDialog(false);
      setNewPort("");
      alert("UFW rule job created. The agent will apply this change.");
    } catch (err) {
      console.error("Failed to add UFW rule:", err);
      alert("Failed to add UFW rule");
    }
  };

  const handleSaveFail2banConfig = async () => {
    if (!machine) return;
    try {
      await api.toggleFail2ban(machine.id, machine.fail2ban_enabled, fail2banConfig);
      setShowFail2banDialog(false);
      alert("Fail2ban config update job created.");
      loadMachine();
    } catch (err) {
      console.error("Failed to update fail2ban config:", err);
      alert("Failed to update fail2ban config");
    }
  };

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
            </div>
            <p className="text-muted-foreground mt-1">{machine.ip_address || "No IP address"}</p>
          </div>
        </div>
        <Button variant="destructive" onClick={handleDelete}>
          Delete Machine
        </Button>
      </div>

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
                <p className="font-medium">{machine.ip_address || "Unknown"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">OS Version</p>
                <p className="font-medium">{machine.ubuntu_version || "Unknown"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Agent Version</p>
                <p className="font-medium">{machine.agent_version || "Unknown"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">SSH Port</p>
                <div className="flex items-center gap-2">
                  <p className="font-medium font-mono">{machine.ssh_port || 22}</p>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowSSHPortDialog(true)}>
                    Change
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Last Seen</p>
                <p className="font-medium">{formatDate(machine.last_seen)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* System Stats */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>System Stats</CardTitle>
            <CardDescription>Real-time resource utilization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">CPU</span>
                <span>{machine.cpu_percent?.toFixed(1) || 0}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all" 
                  style={{ width: `${machine.cpu_percent || 0}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Memory</span>
                <span>{formatBytes(machine.memory_used || 0)} / {formatBytes(machine.memory_total || 0)}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all" 
                  style={{ width: machine.memory_total > 0 ? `${(machine.memory_used / machine.memory_total) * 100}%` : "0%" }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Disk</span>
                <span>{formatBytes(machine.disk_used || 0)} / {formatBytes(machine.disk_total || 0)}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all" 
                  style={{ width: machine.disk_total > 0 ? `${(machine.disk_used / machine.disk_total) * 100}%` : "0%" }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>SSH, firewall, and intrusion prevention</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                  checked={machine.fail2ban_enabled} 
                  onCheckedChange={handleToggleFail2ban}
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
              <CardDescription>Manage allowed ports</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {machine.ufw_enabled ? "Enabled" : "Disabled"}
                </span>
                <Switch 
                  checked={machine.ufw_enabled} 
                  onCheckedChange={handleToggleUFW}
                />
              </div>
              <Button size="sm" onClick={() => setShowAddPortDialog(true)} disabled={!machine.ufw_enabled}>
                Add Port
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {/* Show SSH port */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">TCP</Badge>
                  <span className="font-mono">{machine.ssh_port || 22}</span>
                  <span className="text-xs text-muted-foreground">(SSH)</span>
                </div>
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">ALLOW</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">TCP</Badge>
                  <span className="font-mono">80</span>
                  <span className="text-xs text-muted-foreground">(HTTP)</span>
                </div>
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">ALLOW</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">TCP</Badge>
                  <span className="font-mono">443</span>
                  <span className="text-xs text-muted-foreground">(HTTPS)</span>
                </div>
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">ALLOW</Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Default ports shown. Custom rules are managed via agent jobs.
            </p>
          </CardContent>
        </Card>

        {/* Notes - Full Width */}
        <Card className="border-border/50 bg-card/50 md:col-span-2">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
            <CardDescription>Markdown notes about this machine</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={notesTab} onValueChange={setNotesTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="edit">Edit</TabsTrigger>
              </TabsList>
              <TabsContent value="preview" className="mt-4">
                <div className="min-h-[200px] p-4 border rounded-md bg-muted/30 prose prose-invert prose-sm max-w-none">
                  {notes ? (
                    <ReactMarkdown>{notes}</ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground italic">No notes yet. Click Edit to add notes.</p>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="edit" className="mt-4">
                <Textarea
                  className="min-h-[200px] font-mono text-sm"
                  placeholder="# Server Notes&#10;&#10;**Hosting:** DigitalOcean&#10;**Expiry:** 2025-12-31&#10;&#10;## Info&#10;- Monthly billing&#10;- Contact: admin@example.com"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <Button onClick={handleSaveNotes} disabled={saving} className="mt-4">
                  {saving ? "Saving..." : "Save Notes"}
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}
