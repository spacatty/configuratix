"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/ui/data-table";
import { api, ProjectWithStats, ProjectMember, Machine, User } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
import { 
  ArrowLeft,
  FolderKanban,
  Server,
  Users,
  Share2,
  Copy,
  Trash2,
  MoreHorizontal,
  Check,
  X,
  Edit,
  Settings,
  FileText
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ReactMarkdown from "react-markdown";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<ProjectWithStats | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [projectName, setProjectName] = useState("");
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [selectedMember, setSelectedMember] = useState<ProjectMember | null>(null);
  const [memberRole, setMemberRole] = useState("member");
  const [canViewNotes, setCanViewNotes] = useState(false);

  // Check if current user is project owner or superadmin
  const isOwner = currentUser && project && (
    currentUser.id === project.owner_id || currentUser.role === "superadmin"
  );

  useEffect(() => {
    loadCurrentUser();
    loadProject();
    loadMembers();
    loadMachines();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadCurrentUser = async () => {
    try {
      const user = await api.getMe();
      setCurrentUser(user);
    } catch (err) {
      console.error("Failed to load user:", err);
    }
  };

  const loadProject = async () => {
    try {
      const data = await api.getProject(id);
      setProject(data);
      setNotes(data.notes_md || "");
      setProjectName(data.name);
    } catch (err) {
      console.error("Failed to load project:", err);
      toast.error("Failed to load project");
      router.push("/projects");
    } finally {
      setLoading(false);
    }
  };

  const loadMembers = async () => {
    try {
      const data = await api.listProjectMembers(id);
      setMembers(data);
    } catch (err) {
      console.error("Failed to load members:", err);
    }
  };

  const loadMachines = async () => {
    try {
      const data = await api.listMachines(undefined, id);
      setMachines(data);
    } catch (err) {
      console.error("Failed to load machines:", err);
    }
  };


  const handleSaveNotes = async () => {
    try {
      await api.updateProject(id, { notes_md: notes });
      toast.success("Notes saved");
      setEditingNotes(false);
      loadProject();
    } catch (err) {
      console.error("Failed to save notes:", err);
      toast.error("Failed to save notes");
    }
  };

  const handleSaveProject = async () => {
    try {
      await api.updateProject(id, { name: projectName });
      toast.success("Project updated");
      setShowEditDialog(false);
      loadProject();
    } catch (err) {
      console.error("Failed to update project:", err);
      toast.error("Failed to update project");
    }
  };

  const toggleSharing = async () => {
    if (!project) return;
    try {
      const updated = await api.toggleProjectSharing(id, !project.sharing_enabled);
      if (updated.sharing_enabled && updated.invite_token) {
        const copied = await copyToClipboard(updated.invite_token);
        if (copied) {
          toast.success("Sharing enabled! Invite token copied.");
        } else {
          toast.success("Sharing enabled! Token: " + updated.invite_token);
        }
      } else {
        toast.success("Sharing disabled");
      }
      loadProject();
    } catch (err) {
      console.error("Failed to toggle sharing:", err);
      toast.error("Failed to toggle sharing");
    }
  };

  const copyInviteToken = async () => {
    if (!project?.invite_token) return;
    const copied = await copyToClipboard(project.invite_token);
    if (copied) {
      toast.success("Invite token copied");
    } else {
      toast.error("Failed to copy. Token: " + project.invite_token);
    }
  };

  const handleApproveMember = async () => {
    if (!selectedMember) return;
    try {
      await api.approveMember(id, selectedMember.id, memberRole, canViewNotes);
      toast.success("Member approved");
      setShowApproveDialog(false);
      setSelectedMember(null);
      loadMembers();
    } catch (err) {
      console.error("Failed to approve member:", err);
      toast.error("Failed to approve member");
    }
  };

  const handleDenyMember = async (member: ProjectMember) => {
    try {
      await api.denyMember(id, member.id);
      toast.success("Request denied");
      loadMembers();
    } catch (err) {
      console.error("Failed to deny member:", err);
      toast.error("Failed to deny member");
    }
  };

  const handleRemoveMember = async (member: ProjectMember) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    try {
      await api.removeMember(id, member.id);
      toast.success("Member removed");
      loadMembers();
    } catch (err) {
      console.error("Failed to remove member:", err);
      toast.error("Failed to remove member");
    }
  };

  const handleUpdateMember = async (member: ProjectMember, updates: { role?: string; can_view_notes?: boolean }) => {
    try {
      await api.updateMember(id, member.id, updates);
      toast.success("Member updated");
      loadMembers();
    } catch (err) {
      console.error("Failed to update member:", err);
      toast.error("Failed to update member");
    }
  };

  const memberColumns: ColumnDef<ProjectMember>[] = [
    {
      accessorKey: "user_email",
      header: "User",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.user_name || row.original.user_email}</div>
          {row.original.user_name && (
            <div className="text-sm text-muted-foreground">{row.original.user_email}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const member = row.original;
        if (member.status === "pending") {
          return <Badge variant="secondary">Pending</Badge>;
        }
        return (
          <Badge className={member.role === "manager" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : ""}>
            {member.role}
          </Badge>
        );
      },
    },
    {
      accessorKey: "can_view_notes",
      header: "View Notes",
      cell: ({ row }) => {
        const member = row.original;
        if (member.status !== "approved") return null;
        return member.can_view_notes ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground" />
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const member = row.original;
        
        // Only owner can manage members
        if (!isOwner) {
          return null;
        }
        
        if (member.status === "pending") {
          return (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-green-500"
                onClick={() => {
                  setSelectedMember(member);
                  setMemberRole("member");
                  setCanViewNotes(false);
                  setShowApproveDialog(true);
                }}
              >
                <Check className="h-4 w-4 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={() => handleDenyMember(member)}
              >
                <X className="h-4 w-4 mr-1" />
                Deny
              </Button>
            </div>
          );
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => handleUpdateMember(member, { 
                  role: member.role === "manager" ? "member" : "manager" 
                })}
              >
                <Settings className="mr-2 h-4 w-4" />
                Make {member.role === "manager" ? "Member" : "Manager"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleUpdateMember(member, { 
                  can_view_notes: !member.can_view_notes 
                })}
              >
                <FileText className="mr-2 h-4 w-4" />
                {member.can_view_notes ? "Revoke" : "Allow"} Notes Access
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => handleRemoveMember(member)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const machineColumns: ColumnDef<Machine>[] = [
    {
      accessorKey: "title",
      header: "Machine",
      cell: ({ row }) => {
        const machine = row.original;
        const isOnline = machine.last_seen && 
          new Date(machine.last_seen).getTime() > Date.now() - 60000;
        return (
          <div className="flex items-center gap-3">
            <div className={`h-2 w-2 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`} />
            <div>
              <a
                href={`/machines/${machine.id}`}
                className="font-medium hover:text-primary transition-colors"
              >
                {machine.title || machine.hostname || machine.ip_address}
              </a>
              {machine.ip_address && (
                <div className="text-sm text-muted-foreground">{machine.ip_address}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "hostname",
      header: "Hostname",
    },
    {
      accessorKey: "ubuntu_version",
      header: "OS",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.ubuntu_version || "-"}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!project) {
    return null;
  }

  const pendingMembers = members.filter(m => m.status === "pending");
  const approvedMembers = members.filter(m => m.status === "approved");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/projects")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center">
              <FolderKanban className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{project.name}</h1>
              <p className="text-sm text-muted-foreground">
                by {project.owner_name || project.owner_email}
              </p>
            </div>
          </div>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowEditDialog(true)}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <Button
              variant={project.sharing_enabled ? "secondary" : "default"}
              onClick={toggleSharing}
            >
              <Share2 className="mr-2 h-4 w-4" />
              {project.sharing_enabled ? "Disable Sharing" : "Enable Sharing"}
            </Button>
            {project.sharing_enabled && project.invite_token && (
              <Button variant="outline" onClick={copyInviteToken}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Token
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Machines</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{project.machine_count}</div>
            <p className="text-xs text-muted-foreground">
              {project.online_machines} online, {project.offline_machines} offline
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approvedMembers.length + 1}</div>
            {pendingMembers.length > 0 && (
              <p className="text-xs text-amber-500">{pendingMembers.length} pending</p>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sharing</CardTitle>
            <Share2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge className={project.sharing_enabled ? "bg-green-500/20 text-green-400" : ""}>
              {project.sharing_enabled ? "Enabled" : "Disabled"}
            </Badge>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Created</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium">
              {new Date(project.created_at).toLocaleDateString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="machines" className="space-y-4">
        <TabsList>
          <TabsTrigger value="machines">Machines</TabsTrigger>
          <TabsTrigger value="members">
            Members
            {pendingMembers.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs flex items-center justify-center">
                {pendingMembers.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="machines">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Project Machines</CardTitle>
              <CardDescription>
                Machines linked to this project.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {machines.length > 0 ? (
                <DataTable columns={machineColumns} data={machines} searchKey="title" />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No machines linked to this project yet.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle>Project Members</CardTitle>
              <CardDescription>
                Users with access to this project.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable columns={memberColumns} data={members} searchKey="user_email" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Project Notes</CardTitle>
                <CardDescription>
                  Markdown notes about this project.
                </CardDescription>
              </div>
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (editingNotes) {
                      handleSaveNotes();
                    } else {
                      setEditingNotes(true);
                    }
                  }}
                >
                  {editingNotes ? "Save" : "Edit"}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {editingNotes ? (
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Write project notes here... (Markdown supported)"
                  className="min-h-[300px] font-mono"
                />
              ) : (
                <div className="prose prose-invert max-w-none min-h-[100px]">
                  {notes ? (
                    <ReactMarkdown>{notes}</ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground">No notes yet.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Project Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update project details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveProject}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Member Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Member</DialogTitle>
            <DialogDescription>
              Set the role and permissions for {selectedMember?.user_name || selectedMember?.user_email}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={memberRole} onValueChange={setMemberRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member (Read Only)</SelectItem>
                  <SelectItem value="manager">Manager (Full Access)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="can-view-notes">Can View Machine Notes</Label>
              <Switch
                id="can-view-notes"
                checked={canViewNotes}
                onCheckedChange={setCanViewNotes}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleApproveMember}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

