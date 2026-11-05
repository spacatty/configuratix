"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, ChevronsUpDown, LogOut, Plus, Search } from "lucide-react";

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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { api, type User, type Project } from "@/lib/api";
import { JOBS_CHANGED_EVENT } from "@/lib/jobs";
import { usePolling } from "@/hooks/use-polling";
import { Logo, LogoMark } from "@/components/logo";
import { StatusDot, statusToneText, type StatusTone } from "@/components/app/status";
import { useCommandPalette, useQuickActions } from "@/components/app/command-palette";
import { JobsIndicator } from "@/components/app/jobs";
import { isNavItemActive, sectionsForPlacement, type NavItem } from "@/components/app/nav";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  user: User | null;
  onLogout?: () => void;
}

/* ------------------------------------------------------------------ */
/* Live status (one lightweight poll for badges + footer status line)  */
/* ------------------------------------------------------------------ */

type BadgeTone = Extract<StatusTone, "info" | "warning" | "destructive">;
type NavBadgeData = { count: number; tone: BadgeTone; pulse?: boolean; label: string };

interface SidebarStatus {
  badges: Record<string, NavBadgeData | undefined>;
  agentVersion: string | null;
  online: number;
  total: number;
}

/** Dashboard summary every 30s (paused while hidden). Errors → null (no badges, no status line). */
function useSidebarStatus(enabled: boolean): SidebarStatus | null {
  const { data, error, refresh } = usePolling(() => api.getDashboard(), 30_000, { enabled });

  // Jobs started/cancelled anywhere in the app → refresh the running badge right away.
  React.useEffect(() => {
    const h = () => void refresh();
    window.addEventListener(JOBS_CHANGED_EVENT, h);
    return () => window.removeEventListener(JOBS_CHANGED_EVENT, h);
  }, [refresh]);

  return React.useMemo(() => {
    if (!data || error) return null;
    const running = data.jobs?.running ?? 0;
    const offline = data.machines?.offline ?? 0;
    const domainIssues = (data.domains?.unhealthy ?? 0) + (data.domains?.apply_failed ?? 0);
    return {
      badges: {
        "/jobs": running > 0 ? { count: running, tone: "info", pulse: true, label: `${running} running` } : undefined,
        "/machines": offline > 0 ? { count: offline, tone: "warning", label: `${offline} offline` } : undefined,
        "/domains":
          domainIssues > 0 ? { count: domainIssues, tone: "destructive", label: `${domainIssues} unhealthy or failed` } : undefined,
      },
      agentVersion: data.machines?.latest_agent_version ?? null,
      online: data.machines?.online ?? 0,
      total: data.machines?.total ?? 0,
    };
  }, [data, error]);
}

const BADGE_TONE: Record<BadgeTone, string> = {
  info: "bg-info/12 text-info ring-info/25",
  warning: "bg-warning/12 text-warning ring-warning/25",
  destructive: "bg-destructive/12 text-destructive ring-destructive/25",
};

/** Count pill (expanded) — hidden in icon mode, where `NavDot` takes over. */
function NavBadge({ badge }: { badge?: NavBadgeData }) {
  if (!badge) return null;
  return (
    <span
      title={badge.label}
      className={cn(
        "ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center gap-1 rounded-[5px] px-1.5 font-data text-[10.5px] font-medium ring-1 ring-inset group-data-[collapsible=icon]:hidden",
        BADGE_TONE[badge.tone]
      )}
    >
      {badge.pulse && <StatusDot tone={badge.tone} pulse size="xs" />}
      {badge.count > 99 ? "99+" : badge.count}
    </span>
  );
}

/** Corner dot on the icon in collapsed mode. */
function NavDot({ badge }: { badge?: NavBadgeData }) {
  if (!badge) return null;
  return (
    <span className="pointer-events-none absolute top-1 right-1 hidden group-data-[collapsible=icon]:flex">
      <StatusDot tone={badge.tone} pulse={badge.pulse} size="xs" className="ring-2 ring-sidebar" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Styling                                                             */
/* ------------------------------------------------------------------ */

/** Nav row: 13px label, subtle surface + left brand bar + red icon when active. */
const NAV_BUTTON = cn(
  "relative h-8 gap-2.5 px-2.5 text-[13px] font-normal text-sidebar-foreground/75 transition-colors duration-150",
  "hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground",
  "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
  "data-[active=true]:shadow-[inset_0_0_0_1px_oklch(1_0_0/5%)]",
  "before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[2px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary before:opacity-0 before:shadow-[0_0_8px_0_var(--primary)] before:transition-opacity",
  "data-[active=true]:before:opacity-100",
  "[&>svg]:text-subtle-foreground hover:[&>svg]:text-sidebar-accent-foreground data-[active=true]:[&>svg]:text-primary"
);

const SUB_BUTTON = cn(
  "h-7 px-2 text-[12.5px] text-muted-foreground transition-colors duration-150",
  "hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground",
  "data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground"
);

const SUB_LIST = "mx-0 ml-[17px] gap-px border-sidebar-border py-1 pr-0 pl-2";

const COLLAPSE_ANIM =
  "overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down";

/** Brand tick on the sub-list rail next to the active child. */
function SubActiveTick() {
  return (
    <span
      aria-hidden
      className="absolute top-1.5 bottom-1.5 -left-[9px] w-[2px] rounded-full bg-primary shadow-[0_0_6px_0_var(--primary)]"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

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
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const [projects, setProjects] = React.useState<Project[]>([]);
  const status = useSidebarStatus(!!user);

  React.useEffect(() => {
    if (user) api.listProjects().then(setProjects).catch(() => {});
  }, [user]);

  // Close the mobile drawer after navigation
  React.useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  const sections = sectionsForPlacement(user?.role, "nav");

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="gap-0 p-0">
        <div className="flex h-12 items-center border-b border-sidebar-border px-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Link
            href="/dashboard"
            aria-label="Configuratix — dashboard"
            className="flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {collapsed ? <LogoMark size="sm" /> : <Logo size="sm" />}
          </Link>
          {!collapsed && (
            <div className="ml-auto">
              <QuickCreateButton collapsed={collapsed} />
            </div>
          )}
        </div>
        <div className="flex px-2 pt-2.5 pb-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <SearchButton collapsed={collapsed} />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-1.5 [scrollbar-color:var(--sidebar-border)_transparent] [scrollbar-width:thin]">
        {sections.map((section, i) => (
          <SidebarGroup key={section.title} className="px-2 py-1">
            {i > 0 && (
              <div aria-hidden className="mx-auto mb-1 hidden h-px w-5 bg-sidebar-border group-data-[collapsible=icon]:block" />
            )}
            {!section.headless && (
              <SidebarGroupLabel className="h-7 px-2.5 pt-1.5 text-[10.5px] font-medium tracking-[0.09em] text-subtle-foreground uppercase">
                {section.title}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {section.items.map((item) =>
                  item.children?.length ? (
                    <NavGroupItem
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      collapsed={collapsed}
                      badge={status?.badges[item.href]}
                    />
                  ) : item.href === "/projects" ? (
                    <ProjectsItem key={item.href} item={item} pathname={pathname} projects={projects} collapsed={collapsed} />
                  ) : (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isNavItemActive(item, pathname)}
                        tooltip={status?.badges[item.href] ? `${item.title} · ${status.badges[item.href]!.label}` : item.title}
                        className={NAV_BUTTON}
                      >
                        <Link href={item.href}>
                          <item.icon />
                          <span className="flex-1 truncate">{item.title}</span>
                          <NavBadge badge={status?.badges[item.href]} />
                        </Link>
                      </SidebarMenuButton>
                      <NavDot badge={status?.badges[item.href]} />
                    </SidebarMenuItem>
                  )
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="flex-row items-center gap-1 border-t border-sidebar-border p-1.5 group-data-[collapsible=icon]:flex-col">
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
          <UserMenu user={user} onLogout={onLogout} isMobile={isMobile} />
        </div>
        <JobsIndicator side={isMobile ? "top" : "right"} align="end" iconOnly className="h-8 shrink-0 px-2 text-muted-foreground" />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/* ------------------------------------------------------------------ */
/* Header: search + quick create                                       */
/* ------------------------------------------------------------------ */

function useIsMac() {
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  return isMac;
}

const HEADER_BTN =
  "inline-flex h-8 items-center rounded-md border border-sidebar-border bg-background/50 text-muted-foreground outline-none transition-colors hover:border-border-strong hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:border-border-strong data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground";

function SearchButton({ collapsed }: { collapsed: boolean }) {
  const { open } = useCommandPalette();
  const { isMobile, setOpenMobile } = useSidebar();
  const isMac = useIsMac();
  const onClick = () => {
    if (isMobile) setOpenMobile(false);
    open();
  };

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onClick} aria-label="Search" className={cn(HEADER_BTN, "w-8 justify-center")}>
            <Search className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Search <span className="ml-1 font-data text-muted-foreground">{isMac ? "⌘K" : "Ctrl K"}</span>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cn(HEADER_BTN, "w-full min-w-0 gap-2 pr-1 pl-2.5 text-[13px]")}>
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 truncate text-left">Search…</span>
      <span className="hidden shrink-0 items-center gap-0.5 md:inline-flex">
        <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

function QuickCreateButton({ collapsed }: { collapsed: boolean }) {
  const { actions, run } = useQuickActions();
  const { isMobile, setOpenMobile } = useSidebar();
  const create = actions.filter((a) => a.kind === "create");

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Create" className={cn(HEADER_BTN, "w-8 shrink-0 justify-center")}>
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={collapsed ? "right" : "bottom"}>Create</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side={collapsed ? "right" : "bottom"}
        align="start"
        sideOffset={6}
        className="w-80"
      >
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Create</DropdownMenuLabel>
        <DropdownMenuGroup>
          {create.map((a) => (
            <DropdownMenuItem
              key={a.slash}
              onSelect={() => {
                if (isMobile) setOpenMobile(false);
                run(a.slash);
              }}
              className="items-start gap-2.5 py-1.5"
            >
              <a.icon className="mt-0.5" />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="text-[13px]">{a.title}</span>
                <span className="truncate text-[11px] text-muted-foreground">{a.hint}</span>
              </span>
              <DropdownMenuShortcut className="mt-0.5 font-data tracking-normal text-primary/80">{a.slash}</DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/* Nav items                                                           */
/* ------------------------------------------------------------------ */

/** Collapsible parent (Machines, Security). Auto-expands when one of its routes becomes active. */
function NavGroupItem({
  item,
  pathname,
  collapsed,
  badge,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  badge?: NavBadgeData;
}) {
  const anyActive = isNavItemActive(item, pathname);
  const childActive = item.children!.some((c) => isNavItemActive(c, pathname));
  const [open, setOpen] = React.useState(anyActive);
  const [wasActive, setWasActive] = React.useState(anyActive);
  if (anyActive !== wasActive) {
    setWasActive(anyActive);
    if (anyActive) setOpen(true);
  }

  if (collapsed) {
    // Icon rail: the parent opens a flyout with its children.
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              isActive={anyActive}
              tooltip={badge ? `${item.title} · ${badge.label}` : item.title}
              className={NAV_BUTTON}
            >
              <item.icon />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-52">
            <DropdownMenuLabel className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              {item.title}
              {badge && <span className={cn("ml-auto font-data text-[10.5px]", statusToneText[badge.tone])}>{badge.label}</span>}
            </DropdownMenuLabel>
            {item.children!.map((c) => (
              <DropdownMenuItem key={c.href} asChild className={cn(isNavItemActive(c, pathname) && "text-foreground [&_svg]:text-primary!")}>
                <Link href={c.href}>
                  <c.icon />
                  {c.title}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <NavDot badge={badge} />
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          {/* Parent only highlights on a sub-route none of the children claim (e.g. /machines/:id) */}
          <SidebarMenuButton isActive={anyActive && !childActive} className={NAV_BUTTON}>
            <item.icon className={cn(anyActive && "text-primary!")} />
            <span className={cn("flex-1 truncate", anyActive && "text-sidebar-accent-foreground")}>{item.title}</span>
            <NavBadge badge={badge} />
            <ChevronRight
              className={cn(
                "size-3.5! shrink-0 text-subtle-foreground! transition-transform duration-200",
                !badge && "ml-auto",
                open && "rotate-90"
              )}
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className={COLLAPSE_ANIM}>
          <SidebarMenuSub className={SUB_LIST}>
            {item.children!.map((c) => {
              const active = isNavItemActive(c, pathname);
              return (
                <SidebarMenuSubItem key={c.href}>
                  {active && <SubActiveTick />}
                  <SidebarMenuSubButton asChild isActive={active} className={SUB_BUTTON}>
                    <Link href={c.href}>
                      <span>{c.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/** Projects: link + count + toggle revealing up to 5 projects. */
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
  const active = isNavItemActive(item, pathname);
  const onProject = active && pathname !== "/projects";
  const [open, setOpen] = React.useState(onProject);
  const [wasOnProject, setWasOnProject] = React.useState(onProject);
  if (onProject !== wasOnProject) {
    setWasOnProject(onProject);
    if (onProject) setOpen(true);
  }

  if (collapsed || projects.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} tooltip={item.title} className={NAV_BUTTON}>
          <Link href={item.href}>
            <item.icon />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  const shown = projects.slice(0, 5);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={pathname === "/projects"} className={cn(NAV_BUTTON, "pr-8")}>
          <Link href="/projects">
            <item.icon className={cn(active && "text-primary!")} />
            <span className={cn("flex-1 truncate", active && "text-sidebar-accent-foreground")}>{item.title}</span>
            <span className="font-data text-[11px] text-subtle-foreground">{projects.length}</span>
          </Link>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={open ? "Hide projects" : "Show projects"}
            className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-[5px] text-subtle-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-200", open && "rotate-90")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className={COLLAPSE_ANIM}>
          <SidebarMenuSub className={SUB_LIST}>
            {shown.map((p) => {
              const isActive = pathname === `/projects/${p.id}` || pathname.startsWith(`/projects/${p.id}/`);
              return (
                <SidebarMenuSubItem key={p.id}>
                  {isActive && <SubActiveTick />}
                  <SidebarMenuSubButton asChild isActive={isActive} className={SUB_BUTTON}>
                    <Link href={`/projects/${p.id}`}>
                      <span>{p.name}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
            {projects.length > shown.length && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton asChild className={cn(SUB_BUTTON, "text-subtle-foreground")}>
                  <Link href="/projects">
                    <span>View all {projects.length}</span>
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

/* ------------------------------------------------------------------ */
/* Footer: system status + user menu                                   */
/* ------------------------------------------------------------------ */

function UserMenu({ user, onLogout, isMobile }: { user: User | null; onLogout?: () => void; isMobile: boolean }) {
  const router = useRouter();
  const menuSections = sectionsForPlacement(user?.role, "user-menu");
  const handleLogout = () => {
    if (onLogout) return onLogout();
    api.logout();
    router.push("/login");
  };
  const ini = user ? initials(user.email, user.name) : "··";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip={user?.name || user?.email || "Account"}
              className="h-8 gap-2 px-1.5 text-muted-foreground hover:bg-sidebar-accent/55 hover:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground group-data-[collapsible=icon]:p-1!"
            >
              <Avatar className="size-5 rounded-[5px]">
                <AvatarFallback className="rounded-[5px] bg-surface-2 text-[9.5px] font-medium text-muted-foreground">
                  {ini}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">
                {user?.name || user?.email?.split("@")[0] || "Account"}
              </span>
              <ChevronsUpDown className="ml-auto size-3! text-subtle-foreground!" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="w-64">
            <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
              <Avatar className="size-8 rounded-md">
                <AvatarFallback className="rounded-md bg-surface-2 text-xs">{ini}</AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 leading-tight">
                <span className="truncate text-[13px] font-medium text-foreground">{user?.name || user?.email?.split("@")[0]}</span>
                <span className="truncate font-data text-[11px] font-normal text-muted-foreground">{user?.email}</span>
                <span className="text-[11px] font-normal text-subtle-foreground">{roleLabel(user?.role)}</span>
              </div>
            </DropdownMenuLabel>
            {menuSections.map((s) => (
              <React.Fragment key={s.title}>
                <DropdownMenuSeparator />
                {s.title !== "Account" && (
                  <DropdownMenuLabel className="py-1 text-[11px] font-medium text-muted-foreground">{s.title}</DropdownMenuLabel>
                )}
                <DropdownMenuGroup>
                  {s.items.map((it) => (
                    <DropdownMenuItem key={it.href} asChild>
                      <Link href={it.href}>
                        <it.icon />
                        {it.title}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </React.Fragment>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
