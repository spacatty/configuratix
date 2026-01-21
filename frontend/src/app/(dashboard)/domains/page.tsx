"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, Domain, Machine, NginxConfig } from "@/lib/api";
import ReactMarkdown from "react-markdown";

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [configs, setConfigs] = useState<NginxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [newFqdn, setNewFqdn] = useState("");
  const [assignMachineId, setAssignMachineId] = useState<string>("");
  const [assignConfigId, setAssignConfigId] = useState<string>("");
  const [domainNotes, setDomainNotes] = useState("");
  const [notesTab, setNotesTab] = useState<string>("edit");

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
    if (!newFqdn.trim()) return;
    try {
      await api.createDomain(newFqdn.trim());
      setNewFqdn("");
      setShowCreateDialog(false);
      loadData();
    } catch (err) {
      console.error("Failed to create domain:", err);
      alert("Failed to create domain");
    }
  };

  const handleAssignDomain = async () => {
    if (!selectedDomain) return;
    try {
      await api.assignDomain(
        selectedDomain.id,
        assignMachineId || null,
        assignConfigId || null
      );
      setShowAssignDialog(false);
      setSelectedDomain(null);
      loadData();
    } catch (err) {
      console.error("Failed to assign domain:", err);
      alert("Failed to assign domain");
    }
  };

  const handleDeleteDomain = async (id: string) => {
    if (!confirm("Are you sure you want to delete this domain?")) return;
    try {
      await api.deleteDomain(id);
      loadData();
    } catch (err) {
      console.error("Failed to delete domain:", err);
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
    setNotesTab("edit");
    setShowNotesDialog(true);
  };

  const handleSaveNotes = async () => {
    if (!selectedDomain) return;
    try {
      await api.updateDomainNotes(selectedDomain.id, domainNotes);
      setShowNotesDialog(false);
      loadData();
    } catch (err) {
      console.error("Failed to save notes:", err);
      alert("Failed to save notes");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Healthy</Badge>;
      case "unhealthy":
        return <Badge variant="destructive">Unhealthy</Badge>;
      case "linked":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Linked</Badge>;
      default:
        return <Badge variant="secondary">Idle</Badge>;
    }
  };

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
          <p className="text-muted-foreground mt-1">
            Manage domain assignments and configurations
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="bg-primary hover:bg-primary/90 neon-glow">
          Add Domain
        </Button>
      </div>

      {domains.length === 0 ? (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>No domains configured</CardTitle>
            <CardDescription>
              Add a domain to get started. You can then assign it to a machine.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {domains.map((domain) => (
            <Card key={domain.id} className="border-border/50 bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {getStatusBadge(domain.status)}
                    <div>
                      <h3 className="font-semibold">{domain.fqdn}</h3>
                      <p className="text-sm text-muted-foreground">
                        {domain.machine_name ? (
                          <>Assigned to {domain.machine_name} ({domain.machine_ip})</>
                        ) : (
                          "Not assigned"
                        )}
                        {domain.config_name && (
                          <> • Config: {domain.config_name}</>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openNotesDialog(domain)}
                    >
                      Notes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openAssignDialog(domain)}
                    >
                      {domain.assigned_machine_id ? "Reassign" : "Assign"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteDomain(domain.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Domain Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Domain</DialogTitle>
            <DialogDescription>
              Enter the fully qualified domain name (FQDN) to add.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fqdn">Domain Name</Label>
              <Input
                id="fqdn"
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
            <Button onClick={handleCreateDomain}>Add Domain</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Domain Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Domain</DialogTitle>
            <DialogDescription>
              Assign {selectedDomain?.fqdn} to a machine and select a configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Machine</Label>
              <Select value={assignMachineId || "_none"} onValueChange={(v) => setAssignMachineId(v === "_none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a machine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None (Unassign)</SelectItem>
                  {machines.map((machine) => (
                    <SelectItem key={machine.id} value={machine.id}>
                      {machine.hostname} ({machine.ip_address})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nginx Configuration</Label>
              <Select value={assignConfigId || "_none"} onValueChange={(v) => setAssignConfigId(v === "_none" ? "" : v)}>
                <SelectTrigger>
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
            <Button onClick={handleAssignDomain}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes Dialog with Markdown Preview */}
      <Dialog open={showNotesDialog} onOpenChange={setShowNotesDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Domain Notes</DialogTitle>
            <DialogDescription>
              Notes for {selectedDomain?.fqdn} (registrar info, expiry dates, etc.)
            </DialogDescription>
          </DialogHeader>
          <Tabs value={notesTab} onValueChange={setNotesTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="edit" className="mt-4">
              <Textarea
                className="min-h-[300px] font-mono text-sm"
                placeholder="# Domain Notes&#10;&#10;**Registrar:** Example Registrar&#10;**Expiry Date:** 2025-12-31&#10;&#10;## Renewal Info&#10;- Auto-renewal enabled&#10;- Contact: admin@example.com"
                value={domainNotes}
                onChange={(e) => setDomainNotes(e.target.value)}
              />
            </TabsContent>
            <TabsContent value="preview" className="mt-4">
              <div className="min-h-[300px] p-4 border rounded-md bg-muted/30 prose prose-invert prose-sm max-w-none">
                {domainNotes ? (
                  <ReactMarkdown>{domainNotes}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">No notes yet...</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNotesDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNotes}>Save Notes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
