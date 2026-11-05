"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Ban, Bot, Code, Eye, Globe, LayoutDashboard, Lock, Search, Shield, ShieldCheck, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api, type SecurityIPBan } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Ban reasons                                                                */
/* -------------------------------------------------------------------------- */

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

export const BAN_REASONS: Record<string, { label: string; variant: BadgeVariant }> = {
  blocked_ua: { label: "Blocked UA", variant: "destructive" },
  invalid_endpoint: { label: "Invalid path", variant: "warning" },
  manual: { label: "Manual", variant: "secondary" },
  imported: { label: "Imported", variant: "outline" },
};

export function banReasonLabel(reason: string): string {
  return BAN_REASONS[reason]?.label ?? reason.replace(/_/g, " ");
}

export function BanReasonBadge({ reason }: { reason: string }) {
  const meta = BAN_REASONS[reason];
  return <Badge variant={meta?.variant ?? "muted"}>{meta?.label ?? reason.replace(/_/g, " ")}</Badge>;
}

/* -------------------------------------------------------------------------- */
/* UA categories                                                              */
/* -------------------------------------------------------------------------- */

export const UA_CATEGORIES: Record<string, { label: string; icon: LucideIcon; description: string }> = {
  http_clients: { label: "HTTP clients", icon: Code, description: "Programming libraries like requests, axios, httpx" },
  scrapers: { label: "Scrapers & headless", icon: Search, description: "Web scrapers and headless browsers" },
  scanners: { label: "Security scanners", icon: Lock, description: "Vulnerability and port scanners" },
  seo_bots: { label: "SEO & marketing", icon: Zap, description: "Aggressive SEO crawlers" },
  ai_crawlers: { label: "AI crawlers", icon: Bot, description: "AI training data collectors" },
  generic_bad: { label: "Generic bad", icon: Eye, description: "Generic bot/spider identifiers" },
  suspicious: { label: "Suspicious", icon: Shield, description: "Empty or missing user agents" },
  custom: { label: "Custom patterns", icon: Globe, description: "Your own patterns" },
};

export function uaCategoryMeta(category: string) {
  return UA_CATEGORIES[category] ?? { label: category.replace(/_/g, " "), icon: Bot, description: "" };
}

/* -------------------------------------------------------------------------- */
/* IP validation                                                              */
/* -------------------------------------------------------------------------- */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIPv6(s: string): boolean {
  if (!s.includes(":")) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return false;
  const dbl = s.split("::").length - 1;
  if (dbl > 1) return false;
  const groups = s.split(":").filter((g) => g !== "");
  if (groups.some((g) => g.length > 4 && !IPV4.test(g))) return false;
  return dbl === 1 ? groups.length < 8 : groups.length === 8;
}

export function isValidIp(s: string): boolean {
  const v = s.trim();
  return IPV4.test(v) || isIPv6(v);
}

export function isValidIpOrCidr(s: string): boolean {
  const v = s.trim();
  if (!v.includes("/")) return isValidIp(v);
  const [ip, bits, ...rest] = v.split("/");
  if (rest.length || !/^\d{1,3}$/.test(bits)) return false;
  const n = Number(bits);
  if (IPV4.test(ip)) return n >= 0 && n <= 32;
  if (isIPv6(ip)) return n >= 0 && n <= 128;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Download helper                                                            */
/* -------------------------------------------------------------------------- */

export function downloadText(content: string, filename: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* Section nav                                                                */
/* -------------------------------------------------------------------------- */

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/security", label: "Overview", icon: LayoutDashboard },
  { href: "/security/bans", label: "IP bans", icon: Ban },
  { href: "/security/whitelist", label: "Whitelist", icon: ShieldCheck },
  { href: "/security/ua-patterns", label: "UA patterns", icon: Bot },
];

/** Segmented sub-navigation shared by the security pages. */
export function SecurityNav({ counts }: { counts?: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Security sections"
      className="inline-flex h-8 items-center gap-0.5 rounded-md border border-input bg-card/60 p-0.5"
    >
      {TABS.map((t) => {
        const active = t.href === "/security" ? pathname === "/security" : pathname?.startsWith(t.href);
        const count = counts?.[t.href];
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-surface-2 text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]"
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
            {typeof count === "number" && (
              <span className="font-data text-[11px] text-subtle-foreground">{count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Paged fetch                                                                */
/* -------------------------------------------------------------------------- */

const BAN_PAGE = 500; // backend clamps page_size to 1–500

/**
 * Fetch up to `max` bans by walking the server's pages (newest first). Returns the rows and
 * the server-side total so callers can tell when the list is truncated.
 */
export async function fetchBans(
  params: { search?: string; reason?: string; machine_id?: string; active_only?: boolean },
  max = 1000
): Promise<{ bans: SecurityIPBan[]; total: number }> {
  const first = await api.listSecurityBans({ ...params, page: 1, page_size: BAN_PAGE });
  const bans = [...(first.bans ?? [])];
  const pages = Math.min(first.total_pages || 1, Math.ceil(max / BAN_PAGE));
  for (let start = 2; start <= pages; start += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, pages - start + 1) }, (_, k) =>
        api.listSecurityBans({ ...params, page: start + k, page_size: BAN_PAGE })
      )
    );
    for (const p of batch) bans.push(...(p.bans ?? []));
  }
  return { bans: bans.slice(0, max), total: first.total ?? bans.length };
}
