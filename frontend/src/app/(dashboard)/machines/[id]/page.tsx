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
import { api, Machine } from "@/lib/api";
import ReactMarkdown from "react-markdown";

interface MachineStats {
  cpu_percent: number;
  memory_used: number;
  memory_total: number;
  disk_used: number;
  disk_total: number;
}

interface UFWRule {
  port: string;
  protocol: string;
  action: string;
}

export default function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddPortDialog, setShowAddPortDialog] = useState(false);
  const [newPort, setNewPort] = useState("");
  const [newProtocol, setNewProtocol] = useState("tcp");
  const [notesTab, setNotesTab] = useState<string>("edit");

  // Mock data for now - will be populated by agent
  const [stats] = useState<MachineStats>({
    cpu_percent: 0,
    memory_used: 0,
    memory_total: 0,
    disk_used: 0,
    disk_total: 0,
  });

  const [ufwRules] = useState<UFWRule[]>([
    { port: "22", protocol: "tcp", action: "ALLOW" },
    { port: "80", protocol: "tcp", action: "ALLOW" },
    { port: "443", protocol: "tcp", action: "ALLOW" },
  ]);

  useEffect(() => {
    loadMachine();
  }, [id]);

  const loadMachine = async () => {
    try {
      const data = await api.getMachine(id);
      setMachine(data);
      setNotes(data.notes_md || "");
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
                <p className="text-muted-foreground">Last Seen</p>
                <p className="font-medium">{formatDate(machine.last_seen)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="font-medium">{formatDate(machine.created_at)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* System Stats */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>System Stats</CardTitle>
            <CardDescription>Resource utilization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">CPU</span>
                <span>{stats.cpu_percent.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all" 
                  style={{ width: `${stats.cpu_percent}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Memory</span>
                <span>{formatBytes(stats.memory_used)} / {formatBytes(stats.memory_total)}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all" 
                  style={{ width: stats.memory_total > 0 ? `${(stats.memory_used / stats.memory_total) * 100}%` : "0%" }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Disk</span>
                <span>{formatBytes(stats.disk_used)} / {formatBytes(stats.disk_total)}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all" 
                  style={{ width: stats.disk_total > 0 ? `${(stats.disk_used / stats.disk_total) * 100}%` : "0%" }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Stats will be populated when agent reports
            </p>
          </CardContent>
        </Card>

        {/* UFW Firewall */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Firewall (UFW)</CardTitle>
              <CardDescription>Manage allowed ports</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAddPortDialog(true)}>
              Add Port
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ufwRules.map((rule, index) => (
                <div key={index} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{rule.protocol.toUpperCase()}</Badge>
                    <span className="font-mono">{rule.port}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                      {rule.action}
                    </Badge>
                    {!["22", "80", "443"].includes(rule.port) && (
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive">
                        ×
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Changes will be applied via agent job
            </p>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
            <CardDescription>Markdown notes about this machine</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={notesTab} onValueChange={setNotesTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="edit">Edit</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="mt-4">
                <Textarea
                  className="min-h-[200px] font-mono text-sm"
                  placeholder="# Server Notes&#10;&#10;**Hosting:** DigitalOcean&#10;**Expiry:** 2025-12-31&#10;&#10;## Info&#10;- Monthly billing&#10;- Contact: admin@example.com"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </TabsContent>
              <TabsContent value="preview" className="mt-4">
                <div className="min-h-[200px] p-4 border rounded-md bg-muted/30 prose prose-invert prose-sm max-w-none">
                  {notes ? (
                    <ReactMarkdown>{notes}</ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground italic">No notes yet...</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
            <Button onClick={handleSaveNotes} disabled={saving}>
              {saving ? "Saving..." : "Save Notes"}
            </Button>
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
            <Button onClick={() => {
              // TODO: Create job to add UFW rule
              alert("This will create a job to add the UFW rule on the agent");
              setShowAddPortDialog(false);
              setNewPort("");
            }}>
              Add Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

