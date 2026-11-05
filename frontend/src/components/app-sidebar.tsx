"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, ChevronsUpDown, LogOut, Settings, UserCircle, FolderKanban } from "lucide-react";

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
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api, type User, type Project } from "@/lib/api";
import { Logo, LogoMark } from "@/components/logo";
import { isNavItemActive, visibleSections, type NavItem } from "@/components/app/nav";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  user: User | null;
  onLogout?: () => void;
}

function roleLabel(role?: string) {
  if (role === "superadmin") return "Super admin";
  if (role === "admin") return "Admin";
  return "Member";
}

function initials(email: string, name?: string | null) {
  if (name) return name.split(/\s+/).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export function AppSidebar({ user, onLogout }: AppSidebarProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const [projects, setProjects] = React.useState<Project[]>([]);

  React.useEffect(() => {
    if (user) api.listProjects().then(setProjects).catch(() => {});
  }, [user]);

  // Close the mobile drawer after navigation
  React.useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  const handleLogout = () => {
    if (onLogout) return onLogout();
    api.logout();
    router.push("/login");
  };

  const sections = visibleSections(user?.role);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="h-12 justify-center border-b border-sidebar-border px-3 group-data-[collapsible=icon]:px-2">
        <Link href="/dashboard" className="flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          {collapsed ? <LogoMark size="sm" /> : <Logo size="sm" />}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-1">
        {sections.map((section) => (
          <SidebarGroup key={section.title} className="py-1.5">
            <SidebarGroupLabel className="h-6 px-2 text-[11px] font-medium text-subtle-foreground">
              {section.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {section.items.map((item) =>
                  item.children?.length ? (
                    <NavGroupItem key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
                  ) : item.href === "/projects" ? (
                    <ProjectsItem key={item.href} item={item} pathname={pathname} projects={projects} collapsed={collapsed} />
                  ) : (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isNavItemActive(item, pathname)} tooltip={item.title}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-7 rounded-md">
                    <AvatarFallback className="rounded-md border border-primary/25 bg-primary/12 text-[11px] font-semibold text-[oklch(0.8_0.12_24)]">
                      {user ? initials(user.email, user.name) : "··"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate text-[13px] font-medium">{user?.name || user?.email || "Unknown"}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{roleLabel(user?.role)}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="w-60">
                <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
                  <Avatar className="size-8 rounded-md">
                    <AvatarFallback className="rounded-md bg-surface-2 text-xs">{user ? initials(user.email, user.name) : "··"}</AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 leading-tight">
                    <span className="truncate text-[13px] font-medium text-foreground">{user?.name || user?.email}</span>
                    <span className="truncate text-[11px] font-normal text-muted-foreground">{user?.email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserCircle /> Profile & security
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Parent item with children: parent is active only when no child matches exactly-ish. */
function NavGroupItem({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed: boolean }) {
  const anyActive = isNavItemActive(item, pathname);
  const [open, setOpen] = React.useState(true);
  const childActive = item.children!.some((c) => isNavItemActive(c, pathname));

  if (collapsed) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={anyActive} tooltip={item.title}>
          <Link href={item.href}>
            <item.icon />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          {/* Parent only highlights when on a sub-route none of the children claim (e.g. /machines/:id) */}
          <SidebarMenuButton isActive={anyActive && !childActive} tooltip={item.title}>
            <item.icon />
            <span className="flex-1">{item.title}</span>
            <ChevronRight className={cn("size-3.5! text-subtle-foreground transition-transform duration-200", open && "rotate-90")} />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
          <SidebarMenuSub className="mr-0 gap-px py-0.5">
            {item.children!.map((c) => (
              <SidebarMenuSubItem key={c.href}>
                <SidebarMenuSubButton asChild isActive={isNavItemActive(c, pathname)}>
                  <Link href={c.href}>
                    <span>{c.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function ProjectsItem({
  item,
  pathname,
  projects,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  projects: Project[];
  collapsed: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const active = isNavItemActive(item, pathname);
  if (collapsed || projects.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
          <Link href={item.href}>
            <FolderKanban />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  const shown = projects.slice(0, 5);
  return (
    <Collapsible open={open || (active && pathname !== "/projects")} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <div className="flex items-center">
          <SidebarMenuButton asChild isActive={pathname === "/projects"} tooltip={item.title} className="flex-1">
            <Link href="/projects">
              <FolderKanban />
              <span className="flex-1">{item.title}</span>
              <span className="font-data text-[11px] text-subtle-foreground">{projects.length}</span>
            </Link>
          </SidebarMenuButton>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label="Toggle projects"
              className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <ChevronRight className={cn("size-3.5 transition-transform duration-200", (open || (active && pathname !== "/projects")) && "rotate-90")} />
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="overflow-hidden">
          <SidebarMenuSub className="mr-0 gap-px py-0.5">
            {shown.map((p) => (
              <SidebarMenuSubItem key={p.id}>
                <SidebarMenuSubButton asChild isActive={pathname === `/projects/${p.id}`}>
                  <Link href={`/projects/${p.id}`}>
                    <span>{p.name}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
            {projects.length > shown.length && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton asChild>
                  <Link href="/projects" className="text-subtle-foreground">
                    <span>+{projects.length - shown.length} more</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
