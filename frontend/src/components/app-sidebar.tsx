"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { api, User, Project } from "@/lib/api";
import { Logo } from "@/components/logo";
import { 
  LayoutDashboard, 
  Server, 
  Globe, 
  Terminal, 
  FileCode, 
  FileArchive,
  Settings,
  FolderKanban,
  Users,
  Shield,
  UserCircle,
  LogOut,
  ChevronUp,
  ChevronRight,
  KeyRound
} from "lucide-react";

interface AppSidebarProps {
  user: User | null;
}

const getRoleBadge = (role: string) => {
  switch (role) {
    case "superadmin":
      return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]">Super Admin</Badge>;
    case "admin":
      return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">Admin</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px]">User</Badge>;
  }
};

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [machinesOpen, setMachinesOpen] = useState(true);

  useEffect(() => {
    if (user) {
      api.listProjects().then(setProjects).catch(() => {});
    }
  }, [user]);

  const handleLogout = () => {
    api.logout();
    router.push("/login");
  };

  const getInitials = (email: string, name?: string) => {
    if (name) {
      return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
  };

  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Logo size="md" />
      </SidebarHeader>
      <SidebarContent>
        {/* Overview */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Overview
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/dashboard")}>
                  <a href="/dashboard" className="flex items-center gap-3">
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Dashboard</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Workspace */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Machines - Collapsible with Enrollment Tokens */}
              <Collapsible open={machinesOpen} onOpenChange={setMachinesOpen} defaultOpen>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton isActive={isActive("/machines")}>
                      <Server className="h-4 w-4" />
                      <span className="flex-1">Machines</span>
                      <ChevronRight className={`h-4 w-4 transition-transform ${machinesOpen ? "rotate-90" : ""}`} />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={pathname === "/machines"}>
                          <a href="/machines">All Machines</a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={pathname === "/machines/tokens"}>
                          <a href="/machines/tokens" className="flex items-center gap-2">
                            <KeyRound className="h-3 w-3" />
                            Enrollment Tokens
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {/* Projects - Collapsible with subitems */}
              <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton isActive={isActive("/projects")}>
                      <FolderKanban className="h-4 w-4" />
                      <span className="flex-1">Projects</span>
                      <ChevronRight className={`h-4 w-4 transition-transform ${projectsOpen ? "rotate-90" : ""}`} />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={pathname === "/projects"}>
                          <a href="/projects">All Projects</a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      {projects.slice(0, 5).map((project) => (
                        <SidebarMenuSubItem key={project.id}>
                          <SidebarMenuSubButton asChild isActive={pathname === `/projects/${project.id}`}>
                            <a href={`/projects/${project.id}`} className="truncate">
                              {project.name}
                            </a>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                      {projects.length > 5 && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <a href="/projects" className="text-muted-foreground">
                              +{projects.length - 5} more...
                            </a>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {/* Domains */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/domains") && !pathname.includes("/dns")}>
                  <a href="/domains" className="flex items-center gap-3">
                    <Globe className="h-4 w-4" />
                    <span>Domains</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* DNS Management - Last in Workspace */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/domains/dns")}>
                  <a href="/domains/dns" className="flex items-center gap-3">
                    <Settings className="h-4 w-4" />
                    <span>DNS Management</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Tools */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Tools
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/static")}>
                  <a href="/static" className="flex items-center gap-3">
                    <FileArchive className="h-4 w-4" />
                    <span>Static</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/configs/nginx")}>
                  <a href="/configs/nginx" className="flex items-center gap-3">
                    <FileCode className="h-4 w-4" />
                    <span>Nginx Configs</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/commands")}>
                  <a href="/commands" className="flex items-center gap-3">
                    <Terminal className="h-4 w-4" />
                    <span>Commands</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Account */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Account
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/profile")}>
                  <a href="/profile" className="flex items-center gap-3">
                    <UserCircle className="h-4 w-4" />
                    <span>Profile</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/settings")}>
                  <a href="/settings" className="flex items-center gap-3">
                    <Settings className="h-4 w-4" />
                    <span>Settings</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin */}
        {(user?.role === "superadmin" || user?.role === "admin") && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin/users")}>
                    <a href="/admin/users" className="flex items-center gap-3">
                      <Users className="h-4 w-4" />
                      <span>Users</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {user?.role === "superadmin" && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/admin/overview")}>
                      <a href="/admin/overview" className="flex items-center gap-3">
                        <Shield className="h-4 w-4" />
                        <span>All Data</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full rounded-md p-2 hover:bg-sidebar-accent transition-colors text-left">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {user ? getInitials(user.email, user.name || undefined) : "??"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user?.name || user?.email || "Unknown"}
                </p>
                <div className="mt-0.5">
                  {user && getRoleBadge(user.role)}
                </div>
              </div>
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled className="flex flex-col items-start">
              <span className="font-medium">{user?.name || user?.email}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/profile")}>
              <UserCircle className="h-4 w-4 mr-2" />
              Profile & Security
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
