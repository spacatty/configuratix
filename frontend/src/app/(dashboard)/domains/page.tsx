"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/ui/data-table";
import { api, Domain, Machine, NginxConfig, DomainGroup, DomainGroupWithCount } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import { ExternalLink, MoreHorizontal, Trash, Link2, FileText, Server, Circle, CheckCircle, XCircle, Cloud, FolderOpen, Pencil, Users, HeartPulse } from "lucide-react";
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

/** Fuzzy match config name (e.g. `land` matches `Landing Page`) */
function fuzzyConfigMatch(configName: string | null | undefined, query: string): boolean {
  if (!configName || !query.trim()) return false;
  const nl = configName.toLowerCase();
  const ql = query.toLowerCase().trim();
  if (nl.includes(ql)) return true;
  let i = 0;
  for (const c of nl) {
    if (c === ql[i]) i++;
    if (i >= ql.length) return true;
  }
  return false;
}

function DomainStatusIcon({ status }: { status: string }) {
  const box = "h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0 ";
  switch (status) {
    case "healthy":
      return (
        <div className={box + "bg-green-500/15"} title="Healthy">
          <CheckCircle className="h-4 w-4 text-green-500" />
        </div>
      );
    case "unhealthy":
      return (
        <div className={box + "bg-red-500/15"} title="Unhealthy">
          <XCircle className="h-4 w-4 text-red-500" />
        </div>
      );
    case "linked":
      return (
        <div className={box + "bg-blue-500/15"} title="Linked">
          <Link2 className="h-4 w-4 text-blue-500" />
        </div>
      );
    case "proxied":
      return (
        <div className={box + "bg-purple-500/15"} title="Proxied">
          <Cloud className="h-4 w-4 text-purple-500" />
        </div>
      );
    default:
      return (
        <div className={box + "bg-zinc-500/15"} title="Idle">
          <Circle className="h-4 w-4 text-zinc-400" />
        </div>
      );
  }
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
  // Created-at filter (date range)
  const [createdFrom, setCreatedFrom] = useState<string>("");
  const [createdTo, setCreatedTo] = useState<string>("");
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DomainGroupWithCount | null>(null);
  const [groupForm, setGroupForm] = useState({ name: "", emoji: "📁", color: "#6366f1" });
  const [groupDomainIds, setGroupDomainIds] = useState<string[]>([]);
  const [showAssignGroupsDialog, setShowAssignGroupsDialog] = useState(false);
  const [selectedDomainForGroups, setSelectedDomainForGroups] = useState<Domain | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showBulkAssignDialog, setShowBulkAssignDialog] = useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [showBulkGroupsDialog, setShowBulkGroupsDialog] = useState(false);
  const [bulkGroupIds, setBulkGroupIds] = useState<string[]>([]);
  const [showCustomCheckDialog, setShowCustomCheckDialog] = useState(false);
  const [customCheckDomain, setCustomCheckDomain] = useState<Domain | null>(null);
  const [customExpectedStatus, setCustomExpectedStatus] = useState("200");

  const selectedDomainIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  );

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

  const openCustomCheckDialog = (domain: Domain) => {
    setCustomCheckDomain(domain);
    setCustomExpectedStatus(String(domain.health_check_expected_status ?? 200));
    setShowCustomCheckDialog(true);
  };

  const handleSaveCustomCheck = async () => {
    if (!customCheckDomain || submitting) return;
    const code = parseInt(customExpectedStatus, 10);
    if (Number.isNaN(code) || code < 100 || code > 599) {
      toast.error("Enter a valid HTTP status (100–599)");
      return;
    }
    setSubmitting(true);
    try {
      await api.updateDomainHealthCheck(customCheckDomain.id, code);
      setShowCustomCheckDialog(false);
      loadData();
      toast.success("Custom check updated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update custom check");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForceHealthCheck = async (domain: Domain) => {
    try {
      await api.triggerDomainHealthCheck(domain.id);
      await loadData();
      toast.success("Health check completed");
    } catch (err) {
      console.error(err);
      toast.error("Health check failed");
    }
  };

  const handleBulkAssign = async () => {
    if (selectedDomainIds.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.bulkAssignDomains(
        selectedDomainIds,
        assignMachineId || null,
        assignConfigId || null
      );
      if (res.errors.length) {
        toast.warning(`Updated ${res.ok} domain(s); ${res.errors.length} failed`);
      } else {
        toast.success(`Updated ${res.ok} domain(s)`);
      }
      setShowBulkAssignDialog(false);
      setRowSelection({});
      loadData();
    } catch (err) {
      console.error(err);
      toast.error("Bulk assign failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDomainIds.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await api.bulkDeleteDomains(selectedDomainIds);
      setShowBulkDeleteDialog(false);
      setRowSelection({});
      loadData();
      toast.success("Domains deleted");
    } catch (err) {
      console.error(err);
      toast.error("Bulk delete failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkAddToGroups = async () => {
    if (selectedDomainIds.length === 0 || bulkGroupIds.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      for (const gid of bulkGroupIds) {
        await api.addDomainGroupMembers(gid, selectedDomainIds);
      }
      setShowBulkGroupsDialog(false);
      setBulkGroupIds([]);
      setRowSelection({});
      loadData();
      toast.success("Domains added to groups");
    } catch (err) {
      console.error(err);
      toast.error("Failed to add to groups");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkForceHealthCheck = async () => {
    if (selectedDomainIds.length === 0) return;
    try {
      const res = await api.bulkCheckDomains(selectedDomainIds);
      const failed = res.results.filter((r) => r.error);
      if (failed.length) {
        toast.warning(`Checked ${res.results.length - failed.length}; ${failed.length} failed`);
      } else {
        toast.success(`Health check finished for ${res.results.length} domain(s)`);
      }
      loadData();
    } catch (err) {
      console.error(err);
      toast.error("Bulk health check failed");
    }
  };

  const columns: ColumnDef<Domain>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all on this page"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label={`Select ${row.original.fqdn}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "fqdn",
      header: "Domain",
      filterFn: (row, _columnId, filterValue) => {
        const raw = String(filterValue ?? "").trim();
        if (!raw) return true;
        const m = raw.match(/^config:\s*(.*)$/i);
        if (m) {
          const q = m[1].trim();
          return fuzzyConfigMatch(row.original.config_name, q);
        }
        return row.original.fqdn.toLowerCase().includes(raw.toLowerCase());
      },
      cell: ({ row }) => {
        const domain = row.original;
        const apex = getApexDomain(domain.fqdn);
        const isApex = domain.fqdn === apex;
        return (
          <div className="flex items-center gap-3 py-0.5">
            <DomainStatusIcon status={domain.status} />
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
      accessorKey: "machine_name",
      header: "Machine",
      cell: ({ row }) => {
        const domain = row.original;
        return domain.machine_name ? (
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <span className="text-sm">{domain.machine_name}</span>
              {domain.machine_ip && (
                <span className="text-xs text-muted-foreground">{domain.machine_ip}</span>
              )}
            </div>
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
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => {
        const domain = row.original;
        if (!domain.created_at) return <span className="text-muted-foreground text-xs">—</span>;
        const d = new Date(domain.created_at);
        return <span className="text-xs text-muted-foreground">{d.toLocaleDateString()}</span>;
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
              <DropdownMenuItem onClick={() => openCustomCheckDialog(domain)}>
                <HeartPulse className="h-4 w-4 mr-2" />
                Custom check
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleForceHealthCheck(domain)}
                disabled={!domain.assigned_machine_id}
              >
                <HeartPulse className="h-4 w-4 mr-2" />
                Force health check now
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
    let list = domains;
    if (selectedGroupFilter) {
      const members = groupMembers[selectedGroupFilter] || [];
      const memberIds = new Set(members.map((m) => m.id));
      list = list.filter((d) => memberIds.has(d.id));
    }
    if (createdFrom || createdTo) {
      list = list.filter((d) => {
        if (!d.created_at) return false;
        const t = new Date(d.created_at).getTime();
        const from = createdFrom ? new Date(createdFrom + "T00:00:00").getTime() : 0;
        const to = createdTo ? new Date(createdTo + "T23:59:59").getTime() : Number.MAX_SAFE_INTEGER;
        return t >= from && t <= to;
      });
    }
    return list;
  }, [domains, selectedGroupFilter, groupMembers, createdFrom, createdTo]);

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
          <div className="flex flex-wrap items-center gap-3 pb-4">
            <span className="text-sm text-muted-foreground">Created:</span>
            <Input
              type="date"
              className="h-9 w-40"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
              placeholder="From"
            />
            <Input
              type="date"
              className="h-9 w-40"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
              placeholder="To"
            />
            {(createdFrom || createdTo) && (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { setCreatedFrom(""); setCreatedTo(""); }}>
                Clear
              </Button>
            )}
          </div>
          {selectedDomainIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-border/50 mb-4">
              <span className="text-sm text-muted-foreground mr-2">
                {selectedDomainIds.length} selected
              </span>
              <Button size="sm" variant="secondary" onClick={() => setShowBulkAssignDialog(true)}>
                Reassign
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowBulkGroupsDialog(true)}>
                Add to groups
              </Button>
              <Button size="sm" variant="secondary" onClick={handleBulkForceHealthCheck}>
                Force health check
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setShowBulkDeleteDialog(true)}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRowSelection({})}>
                Clear selection
              </Button>
            </div>
          )}
          <DataTable
            columns={columns}
            data={displayDomains}
            searchKey="fqdn"
            searchPlaceholder="Search… use config:name to filter by config"
            getRowId={(row) => row.id}
            enableRowSelection
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
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

      {/* Bulk reassign */}
      <Dialog open={showBulkAssignDialog} onOpenChange={setShowBulkAssignDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk reassign</DialogTitle>
            <DialogDescription>
              Assign {selectedDomainIds.length} domain(s) to a machine and configuration.
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
            <Button variant="outline" onClick={() => setShowBulkAssignDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkAssign} disabled={submitting}>
              {submitting ? "Saving..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedDomainIds.length} domain(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Associated server configuration may need manual cleanup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={submitting}
              onClick={() => void handleBulkDelete()}
            >
              {submitting ? "Deleting..." : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showBulkGroupsDialog} onOpenChange={setShowBulkGroupsDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add selected to groups</DialogTitle>
            <DialogDescription>
              Domains keep any groups they are already in. Only new memberships are added.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-64 overflow-y-auto py-2">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No groups yet.</p>
            ) : (
              groups.map((group) => (
                <label
                  key={group.id}
                  className="flex items-center gap-2 p-2 rounded border border-border hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={bulkGroupIds.includes(group.id)}
                    onCheckedChange={(checked) => {
                      if (checked) setBulkGroupIds([...bulkGroupIds, group.id]);
                      else setBulkGroupIds(bulkGroupIds.filter((id) => id !== group.id));
                    }}
                  />
                  <span className="text-lg">{group.emoji}</span>
                  <span className="text-sm font-medium">{group.name}</span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkGroupsDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkAddToGroups} disabled={submitting || bulkGroupIds.length === 0}>
              {submitting ? "Saving..." : "Add to groups"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCustomCheckDialog} onOpenChange={setShowCustomCheckDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom check</DialogTitle>
            <DialogDescription>
              HTTP status that counts as healthy for{" "}
              <strong>{customCheckDomain?.fqdn}</strong> (default 200). Mismatch marks the domain unhealthy
              even when the server responds.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="expected-status">Expected HTTP status</Label>
            <Input
              id="expected-status"
              type="number"
              min={100}
              max={599}
              className="h-10"
              value={customExpectedStatus}
              onChange={(e) => setCustomExpectedStatus(e.target.value)}
            />
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!customCheckDomain}
              onClick={async () => {
                if (!customCheckDomain) return;
                await handleForceHealthCheck(customCheckDomain);
              }}
            >
              Force health check now
            </Button>
            <div className="flex gap-2 justify-end flex-1">
              <Button variant="outline" onClick={() => setShowCustomCheckDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveCustomCheck} disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
