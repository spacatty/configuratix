import {
  Ban,
  Bot,
  CalendarClock,
  FileArchive,
  FileCode,
  FolderKanban,
  Globe,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Network,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Terminal,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Extra search terms for the command palette. */
  keywords?: string[];
  /** Active only on exact path match (default: prefix match). */
  exact?: boolean;
  /** Paths that must NOT count as active even though they share the prefix. */
  excludes?: string[];
  roles?: Array<"admin" | "superadmin">;
  children?: NavItem[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
  roles?: Array<"admin" | "superadmin">;
}

/** Single source of truth for sidebar, command palette and breadcrumbs. */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: ["home", "overview"] },
      { title: "Tracker", href: "/tracker", icon: CalendarClock, keywords: ["renewals", "expiry", "reminders"] },
    ],
  },
  {
    title: "Workspace",
    items: [
      {
        title: "Machines",
        href: "/machines",
        icon: Server,
        keywords: ["servers", "agents", "hosts"],
        children: [
          { title: "All machines", href: "/machines", icon: Server, exact: true },
          { title: "Enrollment tokens", href: "/machines/tokens", icon: KeyRound, keywords: ["enroll", "install agent"] },
        ],
      },
      { title: "Projects", href: "/projects", icon: FolderKanban, keywords: ["teams", "members"] },
      { title: "Domains", href: "/domains", icon: Globe, keywords: ["fqdn", "health"], excludes: ["/domains/dns"] },
      { title: "DNS", href: "/domains/dns", icon: Network, keywords: ["records", "cloudflare", "nameservers", "zones"] },
      { title: "Jobs", href: "/jobs", icon: ListChecks, keywords: ["tasks", "logs", "history", "agent jobs"] },
    ],
  },
  {
    title: "Security",
    items: [
      { title: "Overview", href: "/security", icon: Shield, exact: true, keywords: ["security"] },
      { title: "IP blacklist", href: "/security/bans", icon: Ban, keywords: ["bans", "block"] },
      { title: "Whitelist", href: "/security/whitelist", icon: ShieldCheck, keywords: ["allow"] },
      { title: "UA patterns", href: "/security/ua-patterns", icon: Bot, keywords: ["user agent", "bots"] },
    ],
  },
  {
    title: "Tools",
    items: [
      { title: "Nginx configs", href: "/configs/nginx", icon: FileCode, keywords: ["proxy", "templates"] },
      { title: "Static", href: "/static", icon: FileArchive, keywords: ["landings", "uploads", "php"] },
      { title: "Commands", href: "/commands", icon: Terminal, keywords: ["scripts", "run"] },
    ],
  },
  {
    title: "Account",
    items: [
      { title: "Profile", href: "/profile", icon: UserCircle, keywords: ["password", "2fa", "security"] },
      { title: "Settings", href: "/settings", icon: Settings, keywords: ["agent version", "preferences"] },
    ],
  },
  {
    title: "Admin",
    roles: ["admin", "superadmin"],
    items: [{ title: "Users", href: "/admin/users", icon: Users, keywords: ["accounts", "roles"] }],
  },
];

/** Segment labels for auto breadcrumbs. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  tracker: "Tracker",
  machines: "Machines",
  tokens: "Enrollment tokens",
  projects: "Projects",
  domains: "Domains",
  dns: "DNS",
  jobs: "Jobs",
  security: "Security",
  bans: "IP blacklist",
  whitelist: "Whitelist",
  "ua-patterns": "UA patterns",
  configs: "Configs",
  nginx: "Nginx configs",
  static: "Static",
  commands: "Commands",
  profile: "Profile",
  settings: "Settings",
  admin: "Admin",
  users: "Users",
};

/** Paths that have no page of their own (breadcrumb renders as plain text). */
export const NON_LINK_PATHS = new Set(["/configs", "/admin"]);

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.excludes?.some((e) => pathname === e || pathname.startsWith(e + "/"))) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function visibleSections(role?: string | null): NavSection[] {
  const r = role as "admin" | "superadmin" | undefined;
  return NAV_SECTIONS.filter((s) => !s.roles || (r && s.roles.includes(r))).map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.roles || (r && i.roles.includes(r))),
  }));
}
