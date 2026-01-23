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
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { api, Machine, EnrollmentToken, ProjectWithStats, MachineGroup, MachineGroupMember, BACKEND_URL } from "@/lib/api";
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
  FolderOpen,
  Pencil,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Users
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Common emojis for groups
const GROUP_EMOJIS = ["📁", "🖥️", "🌐", "🔧", "🚀", "⭐", "🔒", "📦", "🏢", "💻", "🛠️", "📡", "🔥", "💎", "🎯"];

// Preset colors for groups
const GROUP_COLORS = [
  "#6366f1", // Indigo
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#f43f5e", // Rose
  "#ef4444", // Red
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#14b8a6", // Teal
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#64748b", // Slate
];

export default function MachinesPage() {
  const router = useRouter();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [groups, setGroups] = useState<MachineGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, MachineGroupMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreateTokenDialog, setShowCreateTokenDialog] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<EnrollmentToken | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>("all");
  
  // Group management state
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<MachineGroup | null>(null);
  const [groupForm, setGroupForm] = useState({ name: "", emoji: "📁", color: "#6366f1" });
  const [groupMachineIds, setGroupMachineIds] = useState<string[]>([]); // Machines to add to group
  const [showAssignGroupsDialog, setShowAssignGroupsDialog] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null); // Filter by group

  useEffect(() => {
    loadData();
  }, [selectedProject]);

  const loadData = async () => {
    try {
      const [machinesData, projectsData, groupsData] = await Promise.all([
        api.listMachines(undefined, selectedProject === "all" ? undefined : selectedProject),
        api.listProjects(),
        api.listMachineGroups(),
      ]);
      setMachines(machinesData);
      setProjects(projectsData);
      setGroups(groupsData);
      
      // Load members for each group
      const membersMap: Record<string, MachineGroupMember[]> = {};
      await Promise.all(
        groupsData.map(async (group) => {
          try {
            membersMap[group.id] = await api.getGroupMembers(group.id);
          } catch {
            membersMap[group.id] = [];
          }
        })
      );
      setGroupMembers(membersMap);
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

  // Group management
  const openGroupDialog = async (group?: MachineGroup) => {
    if (group) {
      setEditingGroup(group);
      setGroupForm({ name: group.name, emoji: group.emoji, color: group.color });
      // Load existing members
      const members = groupMembers[group.id] || [];
      setGroupMachineIds(members.map(m => m.id));
    } else {
      setEditingGroup(null);
      setGroupForm({ name: "", emoji: "📁", color: "#6366f1" });
      setGroupMachineIds([]);
    }
    setShowGroupDialog(true);
  };

  const handleSaveGroup = async () => {
    if (!groupForm.name.trim()) {
      toast.error("Group name is required");
      return;
    }
    setSubmitting(true);
    try {
      let groupId = editingGroup?.id;
      if (editingGroup) {
        await api.updateMachineGroup(editingGroup.id, groupForm);
      } else {
        const created = await api.createMachineGroup(groupForm);
        groupId = created.id;
      }
      
      // Update members (replace all) if we have a groupId
      if (groupId) {
        await api.setGroupMembers(groupId, groupMachineIds);
      }
      
      toast.success(editingGroup ? "Group updated" : "Group created");
      setShowGroupDialog(false);
      loadData();
    } catch (err) {
      console.error("Failed to save group:", err);
      toast.error("Failed to save group");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("Delete this group? Machines will not be deleted.")) return;
    try {
      await api.deleteMachineGroup(groupId);
      toast.success("Group deleted");
      loadData();
    } catch (err) {
      console.error("Failed to delete group:", err);
      toast.error("Failed to delete group");
    }
  };

  const openAssignGroupsDialog = async (machine: Machine) => {
    setSelectedMachine(machine);
    try {
      const machineGroups = await api.getMachineGroups(machine.id);
      setSelectedGroupIds(machineGroups.map(g => g.id));
    } catch {
      setSelectedGroupIds([]);
    }
    setShowAssignGroupsDialog(true);
  };

  const handleAssignGroups = async () => {
    if (!selectedMachine) return;
    setSubmitting(true);
    try {
      await api.setMachineGroups(selectedMachine.id, selectedGroupIds);
      toast.success("Groups updated");
      setShowAssignGroupsDialog(false);
      loadData();
    } catch (err) {
      console.error("Failed to assign groups:", err);
      toast.error("Failed to assign groups");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveFromGroup = async (groupId: string, machineId: string) => {
    try {
      await api.removeGroupMember(groupId, machineId);
      toast.success("Removed from group");
      loadData();
    } catch (err) {
      console.error("Failed to remove from group:", err);
      toast.error("Failed to remove from group");
    }
  };

  const handleMoveInGroup = async (groupId: string, machineId: string, direction: "up" | "down") => {
    const members = groupMembers[groupId] || [];
    const currentIndex = members.findIndex(m => m.id === machineId);
    if (currentIndex === -1) return;
    
    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= members.length) return;
    
    const newOrder = [...members];
    [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];
    
    try {
      await api.reorderGroupMembers(groupId, newOrder.map(m => m.id));
      loadData();
    } catch (err) {
      console.error("Failed to reorder:", err);
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
              <DropdownMenuItem onClick={() => openAssignGroupsDialog(machine)}>
                <Users className="mr-2 h-4 w-4" />
                Assign to Groups
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
          <Button variant="outline" onClick={() => openGroupDialog()}>
            <FolderOpen className="mr-2 h-4 w-4" />
            New Group
          </Button>
          <Button onClick={() => setShowCreateTokenDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Machine
          </Button>
        </div>
      </div>

      {/* Group Filter Badges */}
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {/* All badge */}
          <button
            onClick={() => setSelectedGroupFilter(null)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedGroupFilter === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            <span>📋</span>
            <span>All</span>
            <span className="text-xs opacity-70">({machines.length})</span>
          </button>
          
          {/* Group badges */}
          {groups.map((group) => {
            const members = groupMembers[group.id] || [];
            const isSelected = selectedGroupFilter === group.id;
            return (
              <div key={group.id} className="relative group/badge">
                <button
                  onClick={() => setSelectedGroupFilter(isSelected ? null : group.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    isSelected
                      ? "text-white"
                      : "bg-muted hover:bg-muted/80"
                  }`}
                  style={isSelected ? { backgroundColor: group.color } : undefined}
                >
                  <span>{group.emoji}</span>
                  <span>{group.name}</span>
                  <span className="text-xs opacity-70">({members.length})</span>
                </button>
                {/* Edit/Delete dropdown on hover */}
                <div className="absolute -top-1 -right-1 opacity-0 group-hover/badge:opacity-100 transition-opacity flex gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openGroupDialog(group); }}
                    className="h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center hover:bg-muted"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }}
                    className="h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center hover:bg-destructive hover:text-white hover:border-destructive"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Machines Table */}
      <Card className="border-border/50 bg-card/50 flex-1 flex flex-col overflow-hidden">
        <CardContent className="flex-1 overflow-auto p-6">
          <DataTable 
            columns={columns} 
            data={selectedGroupFilter 
              ? machines.filter(m => (groupMembers[selectedGroupFilter] || []).some(gm => gm.id === m.id))
              : machines
            }
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

      {/* Create/Edit Group Dialog */}
      <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Group" : "Create Group"}</DialogTitle>
            <DialogDescription>
              Organize your machines into groups for easier management.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Group Name and Preview */}
            <div className="flex items-center gap-3">
              <div 
                className="text-2xl p-2 rounded-md cursor-pointer relative group/emoji"
                style={{ backgroundColor: `${groupForm.color}20` }}
              >
                {groupForm.emoji}
              </div>
              <Input
                placeholder="Group name..."
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                className="flex-1"
              />
            </div>

            {/* Emoji and Color pickers in a compact row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Emoji</Label>
                <div className="flex flex-wrap gap-1">
                  {GROUP_EMOJIS.slice(0, 10).map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setGroupForm({ ...groupForm, emoji })}
                      className={`text-sm p-1.5 rounded border transition-colors ${
                        groupForm.emoji === emoji 
                          ? "border-primary bg-primary/10" 
                          : "border-transparent hover:bg-muted"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Color</Label>
                <div className="flex flex-wrap gap-1">
                  {GROUP_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setGroupForm({ ...groupForm, color })}
                      className={`h-6 w-6 rounded border-2 transition-transform ${
                        groupForm.color === color 
                          ? "border-foreground scale-110" 
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
            
            {/* Machine Selection */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Machines ({groupMachineIds.length} selected)
              </Label>
              <div className="max-h-40 overflow-y-auto border border-border rounded-md p-2 space-y-1">
                {machines.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">No machines available</p>
                ) : (
                  machines.map((machine) => (
                    <label
                      key={machine.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={groupMachineIds.includes(machine.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setGroupMachineIds([...groupMachineIds, machine.id]);
                          } else {
                            setGroupMachineIds(groupMachineIds.filter(id => id !== machine.id));
                          }
                        }}
                      />
                      <span className="text-sm flex-1 truncate">
                        {machine.title || machine.hostname || machine.ip_address}
                      </span>
                      <span className="text-xs text-muted-foreground">{machine.ip_address}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGroupDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveGroup} disabled={submitting}>
              {submitting ? "Saving..." : editingGroup ? "Save Changes" : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Groups Dialog */}
      <Dialog open={showAssignGroupsDialog} onOpenChange={setShowAssignGroupsDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign to Groups</DialogTitle>
            <DialogDescription>
              Select which groups {selectedMachine?.hostname || selectedMachine?.title || "this machine"} should belong to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-64 overflow-y-auto py-2">
            {groups.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                <p>No groups created yet.</p>
                <Button 
                  variant="link" 
                  className="mt-2" 
                  onClick={() => {
                    setShowAssignGroupsDialog(false);
                    openGroupDialog();
                  }}
                >
                  Create your first group
                </Button>
              </div>
            ) : (
              groups.map((group) => (
                <label
                  key={group.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={selectedGroupIds.includes(group.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedGroupIds([...selectedGroupIds, group.id]);
                      } else {
                        setSelectedGroupIds(selectedGroupIds.filter(id => id !== group.id));
                      }
                    }}
                  />
                  <span 
                    className="text-lg p-1 rounded" 
                    style={{ backgroundColor: `${group.color}20` }}
                  >
                    {group.emoji}
                  </span>
                  <span className="font-medium">{group.name}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {group.machine_count || 0}
                  </Badge>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignGroupsDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssignGroups} disabled={submitting || groups.length === 0}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
