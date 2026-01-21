"use client";

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
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { api, User } from "@/lib/api";
import { 
  LayoutDashboard, 
  Server, 
  Globe, 
  Terminal, 
  FileCode, 
  Settings,
  FolderKanban,
  Users,
  Shield,
  UserCircle,
  LogOut,
  ChevronUp
} from "lucide-react";

interface AppSidebarProps {
  user: User | null;
}

const getNavigation = (role: string) => {
  const nav = [
    {
      label: "Overview",
      items: [
        {
          title: "Dashboard",
          url: "/dashboard",
          icon: <LayoutDashboard className="h-4 w-4" />,
        },
      ],
    },
    {
      label: "Workspace",
      items: [
        {
          title: "Projects",
          url: "/projects",
          icon: <FolderKanban className="h-4 w-4" />,
        },
        {
          title: "Machines",
          url: "/machines",
          icon: <Server className="h-4 w-4" />,
        },
        {
          title: "Domains",
          url: "/domains",
          icon: <Globe className="h-4 w-4" />,
        },
      ],
    },
    {
      label: "Tools",
      items: [
        {
          title: "Commands",
          url: "/commands",
          icon: <Terminal className="h-4 w-4" />,
        },
        {
          title: "Nginx Configs",
          url: "/configs/nginx",
          icon: <FileCode className="h-4 w-4" />,
        },
      ],
    },
    {
      label: "Account",
      items: [
        {
          title: "Profile",
          url: "/profile",
          icon: <UserCircle className="h-4 w-4" />,
        },
        {
          title: "Settings",
          url: "/settings",
          icon: <Settings className="h-4 w-4" />,
        },
      ],
    },
  ];

  // Add admin section for superadmin
  if (role === "superadmin") {
    nav.push({
      label: "Admin",
      items: [
        {
          title: "Users",
          url: "/admin/users",
          icon: <Users className="h-4 w-4" />,
        },
        {
          title: "All Data",
          url: "/admin/overview",
          icon: <Shield className="h-4 w-4" />,
        },
      ],
    });
  } else if (role === "admin") {
    nav.push({
      label: "Admin",
      items: [
        {
          title: "Users",
          url: "/admin/users",
          icon: <Users className="h-4 w-4" />,
        },
      ],
    });
  }

  return nav;
};

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

  const navigation = getNavigation(user?.role || "user");

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
            <Server className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg tracking-tight">Configuratix</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navigation.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                    >
                      <a href={item.url} className="flex items-center gap-3">
                        {item.icon}
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
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
