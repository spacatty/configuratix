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
import { DataTable } from "@/components/ui/data-table";
import { api, ProjectWithStats } from "@/lib/api";
import { toast } from "sonner";
import { 
  Plus, 
  FolderKanban, 
  Server, 
  Users,
  MoreHorizontal,
  ExternalLink,
  Trash2,
  Share2,
  Copy
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch (err) {
      console.error("Failed to load projects:", err);
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      toast.error("Project name is required");
      return;
    }

    setCreating(true);
    try {
      await api.createProject(projectName);
      setShowCreateDialog(false);
      setProjectName("");
      loadProjects();
      toast.success("Project created");
    } catch (err) {
      console.error("Failed to create project:", err);
      toast.error("Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const handleJoinProject = async () => {
    if (!inviteToken.trim()) {
      toast.error("Invite token is required");
      return;
    }

    setCreating(true);
    try {
      const result = await api.requestJoinProject(inviteToken);
      setShowJoinDialog(false);
      setInviteToken("");
      toast.success(`Requested to join "${result.project_name}". Waiting for approval.`);
    } catch (err) {
      console.error("Failed to join project:", err);
      toast.error("Invalid or expired invite link");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Are you sure you want to delete this project? Machines will be unlinked but not deleted.")) {
      return;
    }

    try {
      await api.deleteProject(id);
      loadProjects();
      toast.success("Project deleted");
    } catch (err) {
      console.error("Failed to delete project:", err);
      toast.error("Failed to delete project");
    }
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        // Fallback for HTTP
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand("copy");
        document.body.removeChild(textArea);
        return success;
      }
    } catch {
      return false;
    }
  };

  const toggleSharing = async (project: ProjectWithStats) => {
    try {
      const updated = await api.toggleProjectSharing(project.id, !project.sharing_enabled);
      if (updated.sharing_enabled && updated.invite_token) {
        const inviteUrl = `${window.location.origin}/join?token=${updated.invite_token}`;
        const copied = await copyToClipboard(inviteUrl);
        if (copied) {
          toast.success("Sharing enabled! Invite link copied to clipboard.");
        } else {
          toast.success("Sharing enabled! Token: " + updated.invite_token);
        }
      } else {
        toast.success("Sharing disabled");
      }
      loadProjects();
    } catch (err) {
      console.error("Failed to toggle sharing:", err);
      toast.error("Failed to toggle sharing");
    }
  };

  const copyInviteLink = async (token: string) => {
    const inviteUrl = `${window.location.origin}/join?token=${token}`;
    const copied = await copyToClipboard(inviteUrl);
    if (copied) {
      toast.success("Invite link copied");
    } else {
      toast.error("Failed to copy. Token: " + token);
    }
  };

  const columns: ColumnDef<ProjectWithStats>[] = [
    {
      accessorKey: "name",
      header: "Project",
      cell: ({ row }) => {
        const project = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center">
              <FolderKanban className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <a 
                href={`/projects/${project.id}`}
                className="font-medium hover:text-primary transition-colors cursor-pointer"
              >
                {project.name}
              </a>
              <div className="text-xs text-muted-foreground">
                by {project.owner_name}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "machine_count",
      header: "Machines",
      cell: ({ row }) => {
        const project = row.original;
        return (
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span>{project.machine_count}</span>
            <span className="text-muted-foreground text-xs">
              ({project.online_machines} online)
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "member_count",
      header: "Members",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span>{row.original.member_count + 1}</span>
        </div>
      ),
    },
    {
      accessorKey: "sharing_enabled",
      header: "Sharing",
      cell: ({ row }) => {
        const project = row.original;
        return project.sharing_enabled ? (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
            <Share2 className="h-3 w-3 mr-1" />
            Enabled
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">Disabled</Badge>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const project = row.original;
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
              <DropdownMenuItem onClick={() => router.push(`/projects/${project.id}`)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                View Details
              </DropdownMenuItem>
              {project.sharing_enabled && project.invite_token && (
                <DropdownMenuItem onClick={() => copyInviteLink(project.invite_token!)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Invite Link
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => toggleSharing(project)}>
                <Share2 className="mr-2 h-4 w-4" />
                {project.sharing_enabled ? "Disable Sharing" : "Enable Sharing"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive"
                onClick={() => handleDeleteProject(project.id)}
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Organize machines into projects and collaborate with your team.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setShowJoinDialog(true)}>
            Join Project
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projects.length}</div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Machines</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {projects.reduce((acc, p) => acc + p.machine_count, 0)}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Online Machines</CardTitle>
            <Server className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {projects.reduce((acc, p) => acc + p.online_machines, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Projects Table */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">Your Projects</CardTitle>
          <CardDescription>
            Projects you own or are a member of.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable 
            columns={columns} 
            data={projects}
            searchKey="name"
            searchPlaceholder="Search projects..."
          />
        </CardContent>
      </Card>

      {/* Create Project Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Create a project to organize your machines and collaborate with others.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                placeholder="e.g., Production Servers"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateProject} disabled={creating}>
              {creating ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Join Project Dialog */}
      <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join a Project</DialogTitle>
            <DialogDescription>
              Enter the invite token you received to request access to a project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-token">Invite Token</Label>
              <Input
                id="invite-token"
                placeholder="Paste the invite token here"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJoinDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleJoinProject} disabled={creating}>
              {creating ? "Requesting..." : "Request Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

