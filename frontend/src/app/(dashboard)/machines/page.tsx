"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { api, Machine, EnrollmentToken, ProjectWithStats, BACKEND_URL } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { toast } from "sonner";
import { 
  Copy, 
  Plus, 
  Server, 
  Activity, 
  Trash2, 
  ExternalLink,
  Shield,
  HardDrive,
  Cpu,
  MoreHorizontal,
  FolderOpen
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MachinesPage() {
  const router = useRouter();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateTokenDialog, setShowCreateTokenDialog] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<EnrollmentToken | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>("all");

  useEffect(() => {
    loadData();
  }, [selectedProject]);

  const loadData = async () => {
    try {
      const [machinesData, projectsData] = await Promise.all([
        api.listMachines(undefined, selectedProject === "all" ? undefined : selectedProject),
        api.listProjects(),
      ]);
      setMachines(machinesData);
      setProjects(projectsData);
    } catch (err) {
      console.error("Failed to load data:", err);
      toast.error("Failed to load machines");
    } finally {
      setLoading(false);
    }
  };

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

  const handleCopy = async (text: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      toast.success("Copied to clipboard");
    } else {
      toast.error("Failed to copy");
    }
  };

  const getStatusBadge = (machine: Machine) => {
    if (!machine.last_seen) {
      return <Badge variant="secondary" className="text-xs">Never connected</Badge>;
    }
    const lastSeen = new Date(machine.last_seen);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / 1000 / 60;
    
    if (diffMinutes < 5) {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">Online</Badge>;
    } else if (diffMinutes < 60) {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">Idle</Badge>;
    }
    return <Badge variant="destructive" className="text-xs">Offline</Badge>;
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const columns: ColumnDef<Machine>[] = [
    {
      accessorKey: "title",
      header: "Machine",
      cell: ({ row }) => {
        const machine = row.original;
        const displayName = machine.title || machine.hostname || "Unknown";
        const showHostname = machine.title && machine.hostname && machine.title !== machine.hostname;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div>
              <a 
                href={`/machines/${machine.id}`}
                className="font-medium hover:text-primary transition-colors cursor-pointer"
              >
                {displayName}
              </a>
              <div className="text-xs text-muted-foreground">
                {showHostname && (
                  <>
                    <span>{machine.hostname}</span>
                    <span className="mx-1">•</span>
                  </>
                )}
                <span>{machine.ip_address || "No IP"}</span>
              </div>
            </div>
          </div>
        );
      },
      filterFn: (row, id, filterValue) => {
        const machine = row.original;
        const search = filterValue.toLowerCase();
        return (
          (machine.title?.toLowerCase().includes(search) || false) ||
          (machine.hostname?.toLowerCase().includes(search) || false) ||
          (machine.ip_address?.toLowerCase().includes(search) || false)
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => getStatusBadge(row.original),
    },
    {
      accessorKey: "project_name",
      header: "Project",
      cell: ({ row }) => {
        const project = row.original.project_name;
        return project ? (
          <Badge variant="outline" className="text-xs">
            <FolderOpen className="h-3 w-3 mr-1" />
            {project}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        );
      },
    },
    {
      accessorKey: "cpu_percent",
      header: "CPU",
      cell: ({ row }) => {
        const cpu = row.original.cpu_percent || 0;
        return (
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className={`h-full ${cpu > 80 ? 'bg-red-500' : cpu > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(cpu, 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-10">{cpu.toFixed(0)}%</span>
          </div>
        );
      },
    },
    {
      accessorKey: "memory_used",
      header: "Memory",
      cell: ({ row }) => {
        const used = row.original.memory_used || 0;
        const total = row.original.memory_total || 0;
        const percent = total > 0 ? (used / total) * 100 : 0;
        return (
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className={`h-full ${percent > 80 ? 'bg-red-500' : percent > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(percent, 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-20">{formatBytes(used)}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "disk_used",
      header: "Disk",
      cell: ({ row }) => {
        const used = row.original.disk_used || 0;
        const total = row.original.disk_total || 0;
        const percent = total > 0 ? (used / total) * 100 : 0;
        return (
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className={`h-full ${percent > 80 ? 'bg-red-500' : percent > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(percent, 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-20">{formatBytes(used)}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "security",
      header: "Security",
      cell: ({ row }) => {
        const machine = row.original;
        return (
          <div className="flex items-center gap-1">
            {machine.ufw_enabled && (
              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-500 border-green-500/30">
                <Shield className="h-3 w-3 mr-1" />
                UFW
              </Badge>
            )}
            {machine.fail2ban_enabled && (
              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">
                F2B
              </Badge>
            )}
            {machine.access_token_set && (
              <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-500 border-purple-500/30">
                🔒
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const machine = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => router.push(`/machines/${machine.id}`)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCopy(machine.ip_address || "")}>
                <Copy className="mr-2 h-4 w-4" />
                Copy IP
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive"
                onClick={async () => {
                  if (confirm("Delete this machine?")) {
                    await api.deleteMachine(machine.id);
                    loadData();
                    toast.success("Machine deleted");
                  }
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
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

  // Use backend URL for install script (backend serves it on port 8080)
  const installCommand = createdToken 
    ? `curl -sSL ${BACKEND_URL}/install.sh | sudo bash -s -- ${createdToken.token}`
    : "";

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Machines</h1>
          <p className="text-muted-foreground mt-1">
            Manage your server fleet. {machines.length} machine(s) registered.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreateTokenDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Machine
          </Button>
        </div>
      </div>

      {/* Machines Table */}
      <Card className="border-border/50 bg-card/50 flex-1 flex flex-col overflow-hidden">
        <CardContent className="flex-1 overflow-auto p-6">
          <DataTable 
            columns={columns} 
            data={machines}
            searchKey="title"
            searchPlaceholder="Search machines by name, hostname, or IP..."
          />
        </CardContent>
      </Card>

      {/* Create Token Dialog */}
      <Dialog open={showCreateTokenDialog} onOpenChange={(open) => {
        setShowCreateTokenDialog(open);
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
                  onClick={() => handleCopy(installCommand)}
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
                setShowCreateTokenDialog(false);
                setCreatedToken(null);
              }}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowCreateTokenDialog(false)}>
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
    </div>
  );
}
