"use client";

import { useState, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, Machine, EnrollmentToken, ProjectWithStats, MachineGroup, MachineGroupMember, BACKEND_URL } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { toast } from "sonner";
import { 
  Copy, 
  Plus, 
  Server, 
  Trash2, 
  ExternalLink,
  MoreHorizontal,
  FolderOpen,
  Pencil,
  Users,
  Globe,
  Cpu,
  Activity
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
  const [quickFilter, setQuickFilter] = useState<string | null>(null); // Online | High Load | Has Domains | Used By DNS | No Project | Security Issues

  // Helpers for status and pressure (used by summary, filters, and cells)
  const getMinutesSinceSeen = (m: Machine) => 
    m.last_seen ? (Date.now() - new Date(m.last_seen).getTime()) / 1000 / 60 : Infinity;
  const isOnline = (m: Machine) => getMinutesSinceSeen(m) < 5;
  const isIdle = (m: Machine) => getMinutesSinceSeen(m) < 60 && getMinutesSinceSeen(m) >= 5;
  const isOffline = (m: Machine) => !m.last_seen || getMinutesSinceSeen(m) >= 60;

  const getResourcePressure = (m: Machine) => {
    const cpu = m.cpu_percent ?? 0;
    const memPct = (m.memory_total ?? 0) > 0 ? ((m.memory_used ?? 0) / m.memory_total!) * 100 : 0;
    const diskPct = (m.disk_total ?? 0) > 0 ? ((m.disk_used ?? 0) / m.disk_total!) * 100 : 0;
    const max = Math.max(cpu, memPct, diskPct);
    if (max >= 90) return "critical";
    if (max >= 75) return "high";
    if (max >= 50) return "medium";
    return "low";
  };
  const isHighLoad = (m: Machine) => getResourcePressure(m) === "high" || getResourcePressure(m) === "critical";
  const hasDomains = (m: Machine) => (m.assigned_domains_count ?? 0) > 0;
  const usedByDNS = (m: Machine) => (m.passthrough_pool_count ?? 0) + (m.wildcard_pool_count ?? 0) > 0;
  const hasNoProject = (m: Machine) => !m.project_id && !m.project_name;
  const hasSecurityGaps = (m: Machine) => !m.ufw_enabled || !m.fail2ban_enabled;

  // Filtered list: project + group + quick filter
  const filteredMachines = useMemo(() => {
    let list = machines;
    if (selectedGroupFilter) {
      const members = groupMembers[selectedGroupFilter] ?? [];
      const ids = new Set(members.map((x) => x.id));
      list = list.filter((m) => ids.has(m.id));
    }
    if (quickFilter === "Online") list = list.filter(isOnline);
    else if (quickFilter === "High Load") list = list.filter(isHighLoad);
    else if (quickFilter === "Has Domains") list = list.filter(hasDomains);
    else if (quickFilter === "Used By DNS") list = list.filter(usedByDNS);
    else if (quickFilter === "No Project") list = list.filter(hasNoProject);
    else if (quickFilter === "Security Issues") list = list.filter(hasSecurityGaps);
    return list;
  }, [machines, selectedGroupFilter, groupMembers, quickFilter]);

  /** Table order: newest first by creation date */
  const machinesNewestFirst = useMemo(
    () =>
      [...filteredMachines].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [filteredMachines]
  );

  // Summary counts (over filtered-by-project list for display)
  const summaryCounts = useMemo(() => {
    const list = machines;
    return {
      total: list.length,
      online: list.filter(isOnline).length,
      overloaded: list.filter(isHighLoad).length,
      withDomains: list.filter(hasDomains).length,
      usedByDNS: list.filter(usedByDNS).length,
      noProject: list.filter(hasNoProject).length,
      securityIssues: list.filter(hasSecurityGaps).length,
    };
  }, [machines]);

  useEffect(() => {
    loadData();
  }, [selectedProject]);

  const loadData = async () => {
    try {
      // Load projects and groups always
      const [projectsData, groupsData] = await Promise.all([
        api.listProjects(),
        api.listMachineGroups(),
      ]);
      setProjects(projectsData);
      setGroups(groupsData);

      // Load machines - handle empty results gracefully
      try {
        const machinesData = await api.listMachines(undefined, selectedProject === "all" ? undefined : selectedProject);
        setMachines(machinesData || []);
      } catch (err) {
        console.error("Failed to load machines for project:", err);
        setMachines([]); // Show empty list instead of error
      }
      
      // Load members for each group in parallel
      const membersMap: Record<string, MachineGroupMember[]> = {};
      await Promise.all(
        groupsData.map(async (group) => {
          try {
            const members = await api.getGroupMembers(group.id);
            membersMap[group.id] = members || [];
          } catch (err) {
            console.error(`Failed to load members for group ${group.id}:`, err);
            membersMap[group.id] = [];
          }
        })
      );
      setGroupMembers(membersMap);
    } catch (err) {
      console.error("Failed to load data:", err);
      toast.error("Failed to load data");
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
        const online = isOnline(machine);
        const idle = isIdle(machine);
        return (
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center">
                <Server className="h-4 w-4 text-muted-foreground" />
              </div>
              <div
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                  online ? "bg-green-500" : idle ? "bg-yellow-500" : "bg-muted-foreground"
                }`}
              />
            </div>
            <div className="min-w-0">
              <a
                href={`/machines/${machine.id}`}
                className="font-medium text-sm hover:text-primary transition-colors cursor-pointer block truncate"
              >
                {displayName}
              </a>
              <span className="text-xs text-muted-foreground font-mono">
                {machine.primary_ip || machine.ip_address || "—"}
              </span>
            </div>
          </div>
        );
      },
      filterFn: (row, id, filterValue) => {
        const machine = row.original;
        const search = (filterValue as string)?.toLowerCase() ?? "";
        if (!search) return true;
        return (
          (machine.title?.toLowerCase().includes(search) ?? false) ||
          (machine.hostname?.toLowerCase().includes(search) ?? false) ||
          (machine.primary_ip?.toLowerCase().includes(search) ?? false) ||
          (machine.ip_address?.toLowerCase().includes(search) ?? false)
        );
      },
    },
    {
      id: "workload",
      header: "Workload",
      accessorFn: (row) => row.assigned_domains_count ?? 0,
      cell: ({ row }) => {
        const m = row.original;
        const total = m.assigned_domains_count ?? 0;
        const healthy = m.healthy_domains_count ?? 0;
        const unhealthy = m.unhealthy_domains_count ?? 0;
        const proxied = m.proxied_domains_count ?? 0;
        if (total === 0) return <span className="text-muted-foreground text-xs">—</span>;
        const rest = total - healthy - unhealthy - proxied;
        const summary = (m.assigned_domains_summary || []) as { fqdn: string; status: string }[];
        const inner = (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1" title={`${total} domains (${healthy} healthy, ${unhealthy} unhealthy, ${proxied} proxied)`}>
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">{total}</span>
              <span className="text-xs text-muted-foreground">domains</span>
            </div>
            {total > 0 && (
              <div className="flex h-1.5 w-16 rounded-full overflow-hidden bg-muted" title="Healthy / Unhealthy / Proxied">
                <div className="bg-green-500/80" style={{ width: `${(healthy / total) * 100}%` }} />
                <div className="bg-red-500/80" style={{ width: `${(unhealthy / total) * 100}%` }} />
                <div className="bg-blue-500/80" style={{ width: `${(proxied / total) * 100}%` }} />
                {rest > 0 && <div className="bg-muted-foreground/50" style={{ width: `${(rest / total) * 100}%` }} />}
              </div>
            )}
          </div>
        );
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-default inline-flex">{inner}</div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-h-48 overflow-y-auto p-2">
              <div className="space-y-1 font-medium mb-1">Domains</div>
              <ul className="space-y-0.5 text-left">
                {summary.length > 0 ? summary.map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-4">
                    <span className="truncate max-w-[200px]">{d.fqdn}</span>
                    <Badge variant={d.status === "healthy" ? "default" : d.status === "unhealthy" ? "destructive" : "secondary"} className="text-[10px] shrink-0">
                      {d.status}
                    </Badge>
                  </li>
                )) : (
                  <li className="text-muted-foreground">—</li>
                )}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      id: "dns_role",
      header: "DNS role",
      accessorFn: (row) => (row.passthrough_pool_count ?? 0) + (row.wildcard_pool_count ?? 0) + (row.active_dns_target_count ?? 0),
      cell: ({ row }) => {
        const m = row.original;
        const passthrough = m.passthrough_pool_count ?? 0;
        const wildcard = m.wildcard_pool_count ?? 0;
        const active = m.active_dns_target_count ?? 0;
        if (passthrough === 0 && wildcard === 0) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {passthrough > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                {passthrough} pass
              </Badge>
            )}
            {wildcard > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                {wildcard} wild
              </Badge>
            )}
            {active > 0 && (
              <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                <Activity className="h-3 w-3 mr-0.5" />
                {active} active
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: "resources",
      header: "Resources",
      accessorFn: (row) => {
        const cpu = row.cpu_percent ?? 0;
        const mem = (row.memory_total ?? 0) > 0 ? ((row.memory_used ?? 0) / row.memory_total!) * 100 : 0;
        const disk = (row.disk_total ?? 0) > 0 ? ((row.disk_used ?? 0) / row.disk_total!) * 100 : 0;
        return Math.max(cpu, mem, disk);
      },
      cell: ({ row }) => {
        const machine = row.original;
        const cpu = machine.cpu_percent ?? 0;
        const memUsed = machine.memory_used ?? 0;
        const memTotal = machine.memory_total ?? 0;
        const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
        const diskUsed = machine.disk_used ?? 0;
        const diskTotal = machine.disk_total ?? 0;
        const diskPercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;
        const pressure = getResourcePressure(machine);
        const getBarColor = (pct: number) => (pct > 80 ? "bg-red-500" : pct > 50 ? "bg-yellow-500" : "bg-green-500");
        return (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5" title={`CPU ${cpu.toFixed(0)}%`}>
              <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="w-10 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${getBarColor(cpu)}`} style={{ width: `${Math.min(cpu, 100)}%` }} />
              </div>
              <span className="text-xs text-muted-foreground w-6 text-right">{cpu.toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-1.5" title={`RAM ${formatBytes(memUsed)} / ${formatBytes(memTotal)}`}>
              <div className="w-10 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${getBarColor(memPercent)}`} style={{ width: `${Math.min(memPercent, 100)}%` }} />
              </div>
              <span className="text-xs text-muted-foreground w-6 text-right">{memPercent.toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-1.5" title={`Disk ${formatBytes(diskUsed)} / ${formatBytes(diskTotal)}`}>
              <div className="w-10 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${getBarColor(diskPercent)}`} style={{ width: `${Math.min(diskPercent, 100)}%` }} />
              </div>
              <span className="text-xs text-muted-foreground w-6 text-right">{diskPercent.toFixed(0)}%</span>
            </div>
            <Badge
              variant="outline"
              className={
                pressure === "critical"
                  ? "border-red-500/50 text-red-600 text-xs"
                  : pressure === "high"
                    ? "border-yellow-500/50 text-yellow-600 text-xs"
                    : "text-muted-foreground text-xs"
              }
            >
              {pressure === "critical" ? "High" : pressure === "high" ? "Load" : "OK"}
            </Badge>
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
              <DropdownMenuItem onClick={() => handleCopy(machine.primary_ip || machine.ip_address || "")}>
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
            Manage your server fleet. {summaryCounts.total} machine(s) registered.
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

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Online</div>
            <div className="text-lg font-semibold">{summaryCounts.online}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">High load</div>
            <div className="text-lg font-semibold">{summaryCounts.overloaded}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">With domains</div>
            <div className="text-lg font-semibold">{summaryCounts.withDomains}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Used by DNS</div>
            <div className="text-lg font-semibold">{summaryCounts.usedByDNS}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">No project</div>
            <div className="text-lg font-semibold">{summaryCounts.noProject}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Security issues</div>
            <div className="text-lg font-semibold">{summaryCounts.securityIssues}</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground mr-1">Quick filters:</span>
        {(["Online", "High Load", "Has Domains", "Used By DNS", "No Project", "Security Issues"] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setQuickFilter(quickFilter === filter ? null : filter)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              quickFilter === filter ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            {filter}
          </button>
        ))}
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
            const isSelected = selectedGroupFilter === group.id;
            const memberCount = group.machine_count || 0;
            
            const handleFilterClick = async () => {
              if (isSelected) {
                setSelectedGroupFilter(null);
              } else {
                try {
                  const members = await api.getGroupMembers(group.id);
                  const membersList = members || [];
                  flushSync(() => {
                    setGroupMembers(prev => ({ ...prev, [group.id]: membersList }));
                  });
                  flushSync(() => {
                    setSelectedGroupFilter(group.id);
                  });
                } catch (err) {
                  console.error("Failed to load group members:", err);
                  toast.error("Failed to load group members");
                }
              }
            };
            
            return (
              <div key={group.id} className="relative group/badge">
                <button
                  onClick={handleFilterClick}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    isSelected
                      ? "text-white"
                      : "bg-muted hover:bg-muted/80"
                  }`}
                  style={isSelected ? { backgroundColor: group.color } : undefined}
                >
                  <span>{group.emoji}</span>
                  <span>{group.name}</span>
                  <span className="text-xs opacity-70">({memberCount})</span>
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
            data={machinesNewestFirst}
            searchKey="title"
            searchPlaceholder="Search machines by name, hostname, or IP..."
            initialState={{ sorting: [{ id: "title", desc: false }] }}
            emptyMessage={
              filteredMachines.length === 0 && machines.length > 0
                ? "No machines match the current filters."
                : "No machines yet. Add a machine to get started."
            }
            getRowClassName={(machine) => {
              const pressure = getResourcePressure(machine);
              const offlineWithWork = isOffline(machine) && (hasDomains(machine) || usedByDNS(machine));
              if (pressure === "critical" || pressure === "high") return "bg-red-500/5";
              if (offlineWithWork) return "bg-yellow-500/5";
              return undefined;
            }}
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
                        {machine.title || machine.hostname || machine.primary_ip || machine.ip_address}
                      </span>
                      <span className="text-xs text-muted-foreground">{machine.primary_ip || machine.ip_address}</span>
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
