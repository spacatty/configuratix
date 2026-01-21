"use client";

import { useState, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { api, UserWithDetails, User } from "@/lib/api";
import { toast } from "sonner";
import { 
  Plus, 
  Users,
  Shield,
  ShieldCheck,
  ShieldOff,
  MoreHorizontal,
  Key,
  Trash2,
  Server,
  FolderKanban
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithDetails | null>(null);

  // Create user form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");

  // Change password form
  const [newUserPassword, setNewUserPassword] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [usersData, userData] = await Promise.all([
        api.listUsers(),
        api.getMe(),
      ]);
      setUsers(usersData);
      setCurrentUser(userData);
    } catch (err) {
      console.error("Failed to load data:", err);
      toast.error("Failed to load users. Make sure you have admin access.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newEmail || !newPassword) {
      toast.error("Email and password are required");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setSaving(true);
    try {
      await api.createAdmin(newEmail, newPassword, newName, newRole);
      setShowCreateDialog(false);
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNewRole("user");
      loadData();
      toast.success("User created");
    } catch (err) {
      console.error("Failed to create user:", err);
      toast.error("Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  const handleChangeRole = async (userId: string, role: string) => {
    try {
      await api.updateUserRole(userId, role);
      loadData();
      toast.success("Role updated");
    } catch (err) {
      console.error("Failed to update role:", err);
      toast.error("Failed to update role");
    }
  };

  const handleChangePassword = async () => {
    if (!selectedUser || !newUserPassword) {
      toast.error("Password is required");
      return;
    }
    if (newUserPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setSaving(true);
    try {
      await api.changeUserPassword(selectedUser.id, newUserPassword);
      setShowPasswordDialog(false);
      setSelectedUser(null);
      setNewUserPassword("");
      toast.success("Password changed");
    } catch (err) {
      console.error("Failed to change password:", err);
      toast.error("Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  const handleReset2FA = async (userId: string) => {
    if (!confirm("Reset 2FA for this user? They will need to set it up again.")) {
      return;
    }

    try {
      await api.resetUser2FA(userId);
      loadData();
      toast.success("2FA reset");
    } catch (err) {
      console.error("Failed to reset 2FA:", err);
      toast.error("Failed to reset 2FA");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Delete this user? This action cannot be undone.")) {
      return;
    }

    try {
      await api.deleteUser(userId);
      loadData();
      toast.success("User deleted");
    } catch (err) {
      console.error("Failed to delete user:", err);
      toast.error("Failed to delete user");
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "superadmin":
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Super Admin</Badge>;
      case "admin":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Admin</Badge>;
      default:
        return <Badge variant="secondary">User</Badge>;
    }
  };

  const columns: ColumnDef<UserWithDetails>[] = [
    {
      accessorKey: "email",
      header: "User",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <span className="text-sm font-medium">
                {(user.name || user.email).slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div>
              <div className="font-medium">{user.name || user.email}</div>
              {user.name && (
                <div className="text-xs text-muted-foreground">{user.email}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => getRoleBadge(row.original.role),
    },
    {
      accessorKey: "totp_enabled",
      header: "2FA",
      cell: ({ row }) => {
        const user = row.original;
        return user.totp_enabled ? (
          <div className="flex items-center gap-1 text-green-500">
            <ShieldCheck className="h-4 w-4" />
            <span className="text-xs">Enabled</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-muted-foreground">
            <ShieldOff className="h-4 w-4" />
            <span className="text-xs">Disabled</span>
          </div>
        );
      },
    },
    {
      accessorKey: "machine_count",
      header: "Machines",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span>{row.original.machine_count}</span>
        </div>
      ),
    },
    {
      accessorKey: "project_count",
      header: "Projects",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-muted-foreground" />
          <span>{row.original.project_count}</span>
        </div>
      ),
    },
    {
      accessorKey: "created_at",
      header: "Joined",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const user = row.original;
        const isSelf = currentUser?.id === user.id;
        const canModify = currentUser?.role === "superadmin" || 
          (currentUser?.role === "admin" && user.role !== "superadmin" && user.role !== "admin");

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
              
              {currentUser?.role === "superadmin" && !isSelf && user.role !== "superadmin" && (
                <>
                  <DropdownMenuItem onClick={() => handleChangeRole(user.id, user.role === "admin" ? "user" : "admin")}>
                    <Shield className="mr-2 h-4 w-4" />
                    {user.role === "admin" ? "Demote to User" : "Promote to Admin"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              
              {canModify && !isSelf && (
                <>
                  <DropdownMenuItem onClick={() => {
                    setSelectedUser(user);
                    setShowPasswordDialog(true);
                  }}>
                    <Key className="mr-2 h-4 w-4" />
                    Change Password
                  </DropdownMenuItem>
                  
                  {user.totp_enabled && (
                    <DropdownMenuItem onClick={() => handleReset2FA(user.id)}>
                      <ShieldOff className="mr-2 h-4 w-4" />
                      Reset 2FA
                    </DropdownMenuItem>
                  )}
                  
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    className="text-destructive"
                    onClick={() => handleDeleteUser(user.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete User
                  </DropdownMenuItem>
                </>
              )}
              
              {isSelf && (
                <DropdownMenuItem disabled>
                  <span className="text-muted-foreground">This is you</span>
                </DropdownMenuItem>
              )}
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

  const isSuperAdmin = currentUser?.role === "superadmin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">User Management</h1>
          <p className="text-muted-foreground mt-1">
            Manage user accounts, roles, and security settings.
          </p>
        </div>
        {isSuperAdmin && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
            <Shield className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {users.filter(u => u.role === "admin" || u.role === "superadmin").length}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">2FA Enabled</CardTitle>
            <ShieldCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {users.filter(u => u.totp_enabled).length}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">2FA Disabled</CardTitle>
            <ShieldOff className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {users.filter(u => !u.totp_enabled).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">All Users</CardTitle>
          <CardDescription>
            Manage user accounts and permissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable 
            columns={columns} 
            data={users}
            searchKey="email"
            searchPlaceholder="Search users..."
          />
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Add a new user to the system.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-name">Name (optional)</Label>
              <Input
                id="new-name"
                placeholder="John Doe"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Password</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Min. 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-role">Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={saving}>
              {saving ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedUser?.name || selectedUser?.email}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-new-password">New Password</Label>
              <Input
                id="user-new-password"
                type="password"
                placeholder="Min. 8 characters"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword} disabled={saving}>
              {saving ? "Changing..." : "Change Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

