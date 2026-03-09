"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/ui/data-table";
import { api, Domain, Machine, NginxConfig, DomainGroup, DomainGroupWithCount } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import { ExternalLink, MoreHorizontal, Trash, Link2, FileText, Server, Globe, Circle, CheckCircle, XCircle, Cloud, FolderOpen, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";

const GROUP_EMOJIS = ["📁", "🖥️", "🌐", "🔧", "🚀", "⭐", "🔒", "📦", "🏢", "💻", "🛠️", "📡", "🔥", "💎", "🎯"];
const GROUP_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4"];

/** Returns the apex/root domain for grouping (e.g. "sub.sample.com" -> "sample.com") */
function getApexDomain(fqdn: string): string {
  const parts = fqdn.split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return fqdn;
}

/** Sort domains for display: group by apex, apex domain first in each group, then alphabetically */
function sortDomainsByApex(list: Domain[]): Domain[] {
  return [...list].sort((a, b) => {
    const apexA = getApexDomain(a.fqdn);
    const apexB = getApexDomain(b.fqdn);
    if (apexA !== apexB) return apexA.localeCompare(apexB);
    const aIsApex = a.fqdn === apexA;
    const bIsApex = b.fqdn === apexB;
    if (aIsApex && !bIsApex) return -1;
    if (!aIsApex && bIsApex) return 1;
    return a.fqdn.localeCompare(b.fqdn);
  });
}

export default function DomainsPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [configs, setConfigs] = useState<NginxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [newFqdn, setNewFqdn] = useState("");
  const [assignMachineId, setAssignMachineId] = useState<string>("");
  const [assignConfigId, setAssignConfigId] = useState<string>("");
  const [domainNotes, setDomainNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Domain groups (mirror machines page)
  const [groups, setGroups] = useState<DomainGroupWithCount[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, { id: string; fqdn: string; status: string; position: number }[]>>({});
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DomainGroupWithCount | null>(null);
  const [groupForm, setGroupForm] = useState({ name: "", emoji: "📁", color: "#6366f1" });
  const [groupDomainIds, setGroupDomainIds] = useState<string[]>([]);
  const [showAssignGroupsDialog, setShowAssignGroupsDialog] = useState(false);
  const [selectedDomainForGroups, setSelectedDomainForGroups] = useState<Domain | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const loadData = async () => {
    try {
      const [domainsData, machinesData, configsData, groupsData] = await Promise.all([
        api.listDomains(),
        api.listMachines(),
        api.listNginxConfigs(),
        api.listDomainGroups(),
      ]);
      setDomains(domainsData);
      setMachines(machinesData);
      setConfigs(configsData);
      setGroups(groupsData);
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
    if (!newFqdn.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.createDomain(newFqdn.trim());
      setNewFqdn("");
      setShowCreateDialog(false);
      loadData();
      toast.success("Domain created");
    } catch (err) {
      console.error("Failed to create domain:", err);
      toast.error("Failed to create domain");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignDomain = async () => {
    if (!selectedDomain || submitting) return;
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDomain = async () => {
    if (!selectedDomain || submitting) return;
    setSubmitting(true);
    try {
      await api.deleteDomain(selectedDomain.id);
      setShowDeleteDialog(false);
      setSelectedDomain(null);
      loadData();
      toast.success("Domain deleted");
    } catch (err) {
      console.error("Failed to delete domain:", err);
      toast.error("Failed to delete domain");
    } finally {
      setSubmitting(false);
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

  const openGroupDialog = async (group?: DomainGroupWithCount) => {
    if (group) {
      setEditingGroup(group);
      setGroupForm({ name: group.name, emoji: group.emoji, color: group.color });
      const members = await api.getDomainGroupMembers(group.id);
      setGroupDomainIds(members.map((m) => m.id));
    } else {
      setEditingGroup(null);
      setGroupForm({ name: "", emoji: "📁", color: "#6366f1" });
      setGroupDomainIds([]);
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
        await api.updateDomainGroup(editingGroup.id, groupForm);
      } else {
        const created = await api.createDomainGroup(groupForm);
        groupId = created.id;
      }
      if (groupId) {
        await api.setDomainGroupMembers(groupId, groupDomainIds);
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
    if (!confirm("Delete this group? Domains will not be deleted.")) return;
    try {
      await api.deleteDomainGroup(groupId);
      toast.success("Group deleted");
      setSelectedGroupFilter(null);
      loadData();
    } catch (err) {
      console.error("Failed to delete group:", err);
      toast.error("Failed to delete group");
    }
  };

  const openAssignGroupsDialog = async (domain: Domain) => {
    setSelectedDomainForGroups(domain);
    try {
      const domainGroups = await api.getDomainGroups(domain.id);
      setSelectedGroupIds(domainGroups.map((g) => g.id));
    } catch {
      setSelectedGroupIds([]);
    }
    setShowAssignGroupsDialog(true);
  };

  const handleAssignGroups = async () => {
    if (!selectedDomainForGroups) return;
    setSubmitting(true);
    try {
      await api.setDomainGroups(selectedDomainForGroups.id, selectedGroupIds);
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

  const handleSaveNotes = async () => {
    if (!selectedDomain || submitting) return;
    setSubmitting(true);
    try {
      await api.updateDomainNotes(selectedDomain.id, domainNotes);
      setShowNotesDialog(false);
      loadData();
      toast.success("Notes saved");
    } catch (err) {
      console.error("Failed to save notes:", err);
      toast.error("Failed to save notes");
    } finally {
      setSubmitting(false);
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


  const columns: ColumnDef<Domain>[] = [
    {
      accessorKey: "fqdn",
      header: "Domain",
      cell: ({ row }) => {
        const domain = row.original;
        const apex = getApexDomain(domain.fqdn);
        const isApex = domain.fqdn === apex;
        return (
          <div className="flex items-center gap-3 py-0.5">
            <div className="h-8 w-8 rounded-md bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center flex-shrink-0">
              <Globe className="h-4 w-4 text-blue-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{domain.fqdn}</span>
                <a
                  href={`https://${domain.fqdn}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {isApex ? `Apex · ${domain.config_name || domain.machine_name || "—"}` : `↳ ${apex}`}
              </p>
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
              <DropdownMenuItem onClick={() => openAssignDialog(domain)}>
                <Link2 className="h-4 w-4 mr-2" />
                {domain.assigned_machine_id ? "Reassign" : "Assign"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAssignGroupsDialog(domain)}>
                <Users className="h-4 w-4 mr-2" />
                Assign to Groups
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

  const filteredDomains = useMemo(() => {
    if (!selectedGroupFilter) return domains;
    const members = groupMembers[selectedGroupFilter] || [];
    const memberIds = new Set(members.map((m) => m.id));
    return domains.filter((d) => memberIds.has(d.id));
  }, [domains, selectedGroupFilter, groupMembers]);

  const displayDomains = useMemo(() => sortDomainsByApex(filteredDomains), [filteredDomains]);

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
          <p className="text-muted-foreground mt-1">Manage domains and their machine assignments.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => openGroupDialog()}>
            <FolderOpen className="mr-2 h-4 w-4" />
            New Group
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>+ Add Domain</Button>
        </div>
      </div>

      {/* Group filter badges */}
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedGroupFilter(null)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedGroupFilter === null ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            <span>📋</span>
            <span>All</span>
            <span className="text-xs opacity-70">({domains.length})</span>
          </button>
          {groups.map((group) => {
            const isSelected = selectedGroupFilter === group.id;
            const memberCount = group.domain_count ?? 0;
            const handleFilterClick = async () => {
              if (isSelected) {
                setSelectedGroupFilter(null);
              } else {
                try {
                  const members = await api.getDomainGroupMembers(group.id);
                  setGroupMembers((prev) => ({ ...prev, [group.id]: members }));
                  setSelectedGroupFilter(group.id);
                } catch (err) {
                  toast.error("Failed to load group members");
                }
              }
            };
            return (
              <div key={group.id} className="relative group/badge">
                <button
                  onClick={handleFilterClick}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    isSelected ? "text-white" : "bg-muted hover:bg-muted/80"
                  }`}
                  style={isSelected ? { backgroundColor: group.color } : undefined}
                >
                  <span>{group.emoji}</span>
                  <span>{group.name}</span>
                  <span className="text-xs opacity-70">({memberCount})</span>
                </button>
                <div className="absolute -top-1 -right-1 opacity-0 group-hover/badge:opacity-100 transition-opacity flex gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openGroupDialog(group); }}
                    className="h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center hover:bg-muted"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }}
                    className="h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center hover:bg-destructive hover:text-white hover:border-destructive"
                  >
                    <Trash className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Card className="border-border/50 bg-card/50">
        <CardContent className="pt-5 pb-5">
          <DataTable
            columns={columns}
            data={displayDomains}
            searchKey="fqdn"
            searchPlaceholder="Search domains..."
          />
        </CardContent>
      </Card>

      {/* Create Domain Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Domain</DialogTitle>
            <DialogDescription>
              Enter the fully qualified domain name (FQDN) to add.
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDomain} disabled={submitting}>
              {submitting ? "Adding..." : "Add Domain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Domain Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Assign Domain</DialogTitle>
            <DialogDescription>
              Assign {selectedDomain?.fqdn} to a machine and select a configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Machine</Label>
              <Select value={assignMachineId || "_none"} onValueChange={(v) => setAssignMachineId(v === "_none" ? "" : v)}>
                <SelectTrigger className="h-11">
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
                <SelectTrigger className="h-11">
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
            <Button onClick={handleAssignDomain} disabled={submitting}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes Dialog */}
      <Dialog open={showNotesDialog} onOpenChange={setShowNotesDialog}>
        <DialogContent className="sm:max-w-3xl">
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
            <Button onClick={handleSaveNotes} disabled={submitting}>
              {submitting ? "Saving..." : "Save Notes"}
            </Button>
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
            <AlertDialogAction onClick={handleDeleteDomain} disabled={submitting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {submitting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create/Edit Group Dialog */}
      <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Group" : "Create Group"}</DialogTitle>
            <DialogDescription>Organize your domains into groups for easier management.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl p-2 rounded-md" style={{ backgroundColor: `${groupForm.color}20` }}>
                {groupForm.emoji}
              </div>
              <Input
                placeholder="Group name..."
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                className="flex-1"
              />
            </div>
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
                        groupForm.emoji === emoji ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"
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
                        groupForm.color === color ? "border-foreground scale-110" : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Domains ({groupDomainIds.length} selected)</Label>
              <div className="max-h-40 overflow-y-auto border border-border rounded-md p-2 space-y-1">
                {domains.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">No domains yet</p>
                ) : (
                  domains.map((domain) => (
                    <label
                      key={domain.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={groupDomainIds.includes(domain.id)}
                        onCheckedChange={(checked) => {
                          if (checked) setGroupDomainIds([...groupDomainIds, domain.id]);
                          else setGroupDomainIds(groupDomainIds.filter((id) => id !== domain.id));
                        }}
                      />
                      <span className="text-sm flex-1 truncate">{domain.fqdn}</span>
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
              Select which groups <strong>{selectedDomainForGroups?.fqdn}</strong> should belong to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-64 overflow-y-auto py-2">
            {groups.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                <p>No groups created yet.</p>
                <Button variant="outline" className="mt-2" onClick={() => { setShowAssignGroupsDialog(false); openGroupDialog(); }}>
                  Create a group
                </Button>
              </div>
            ) : (
              groups.map((group) => (
                <label
                  key={group.id}
                  className="flex items-center gap-2 p-2 rounded border border-border hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedGroupIds.includes(group.id)}
                    onCheckedChange={(checked) => {
                      if (checked) setSelectedGroupIds([...selectedGroupIds, group.id]);
                      else setSelectedGroupIds(selectedGroupIds.filter((id) => id !== group.id));
                    }}
                  />
                  <span className="text-lg">{group.emoji}</span>
                  <span className="text-sm font-medium">{group.name}</span>
                  <span className="text-xs text-muted-foreground">({group.domain_count ?? 0})</span>
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
