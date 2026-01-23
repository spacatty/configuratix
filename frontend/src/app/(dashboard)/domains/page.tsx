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
import { DataTable } from "@/components/ui/data-table";
import { api, Domain, Machine, NginxConfig } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import { ExternalLink, MoreHorizontal, Trash, Link2, FileText, Server, Globe, CheckCircle, XCircle, Cloud, Circle, RefreshCw, Settings2 } from "lucide-react";
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

  const getNSStatusBadge = (status: string | null) => {
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
              <DropdownMenuItem onClick={() => router.push("/domains/dns")}>
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
          <p className="text-muted-foreground mt-1">Manage domains and their machine assignments.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/domains/dns")}>
            <Settings2 className="h-4 w-4 mr-2" />
            DNS Management
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>+ Add Domain</Button>
        </div>
      </div>

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
    </div>
  );
}
