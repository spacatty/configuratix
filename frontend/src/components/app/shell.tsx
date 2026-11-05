"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/logo";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { NON_LINK_PATHS, SEGMENT_LABELS } from "@/components/app/nav";

/* -------------------------------------------------------------------------- */
/* Breadcrumb label overrides                                                 */
/* -------------------------------------------------------------------------- */

type LabelMap = Record<string, React.ReactNode>;
const BreadcrumbCtx = React.createContext<{
  labels: LabelMap;
  setLabel: (href: string, label: React.ReactNode | null) => void;
} | null>(null);

export function BreadcrumbLabelProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = React.useState<LabelMap>({});
  const setLabel = React.useCallback((href: string, label: React.ReactNode | null) => {
    setLabels((prev) => {
      if (label === null) {
        if (!(href in prev)) return prev;
        const next = { ...prev };
        delete next[href];
        return next;
      }
      if (prev[href] === label) return prev;
      return { ...prev, [href]: label };
    });
  }, []);
  const value = React.useMemo(() => ({ labels, setLabel }), [labels, setLabel]);
  return <BreadcrumbCtx.Provider value={value}>{children}</BreadcrumbCtx.Provider>;
}

/**
 * Override the top-bar breadcrumb label for the current page (or a given href).
 *   useBreadcrumbLabel(machine ? machineDisplayName(machine) : null);
 * Pass a string (preferred) so equality checks avoid loops.
 */
export function useBreadcrumbLabel(label: string | null | undefined, href?: string) {
  const ctx = React.useContext(BreadcrumbCtx);
  const pathname = usePathname();
  const target = href ?? pathname;
  const setLabel = ctx?.setLabel;
  React.useEffect(() => {
    if (!setLabel || !label) return;
    setLabel(target, label);
    return () => setLabel(target, null);
  }, [setLabel, target, label]);
}

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{16,}$|^\d+$/i;

export function useRouteCrumbs(): Array<{ href: string; label: React.ReactNode; link: boolean }> {
  const pathname = usePathname() ?? "/";
  const ctx = React.useContext(BreadcrumbCtx);
  const labels = ctx?.labels ?? {};
  const segs = pathname.split("/").filter(Boolean);
  return segs.map((seg, i) => {
    const href = "/" + segs.slice(0, i + 1).join("/");
    const override = labels[href];
    let label: React.ReactNode = override ?? SEGMENT_LABELS[seg];
    if (!label) {
      label = UUIDISH.test(seg) ? <span className="font-data text-[12px]">{seg.slice(0, 8)}</span> : decodeURIComponent(seg);
    }
    return { href, label, link: !NON_LINK_PATHS.has(href) };
  });
}

/** Breadcrumbs derived from the pathname + overrides. Used in the top bar. */
export function RouteBreadcrumbs({ className }: { className?: string }) {
  const crumbs = useRouteCrumbs();
  if (crumbs.length === 0) return null;
  return (
    <Breadcrumb className={cn("min-w-0", className)}>
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <React.Fragment key={c.href}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className={cn(!last && "hidden md:inline-flex", "max-w-[260px]")}>
                {last ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : c.link ? (
                  <BreadcrumbLink asChild>
                    <Link href={c.href}>{c.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <span className="truncate">{c.label}</span>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/* -------------------------------------------------------------------------- */
/* BrandedLoader                                                              */
/* -------------------------------------------------------------------------- */

/** Full-screen boot loader (auth check, root redirect). */
export function BrandedLoader({ label = "Connecting to control plane", className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("relative flex min-h-svh items-center justify-center overflow-hidden bg-background", className)}
    >
      <div aria-hidden className="bg-grid-fade pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute top-[-20%] left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-[100px]" />
      <div className="relative flex animate-fade-in-up flex-col items-center gap-5">
        <div className="relative">
          <LogoMark size="xl" glow />
          <svg className="absolute -inset-3 size-[72px] animate-spin-slow text-primary" viewBox="0 0 72 72" fill="none" aria-hidden>
            <circle cx="36" cy="36" r="34" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" />
            <path d="M36 2a34 34 0 0 1 34 34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-sm font-semibold tracking-[-0.02em]">Configuratix</span>
          <span className="font-data flex items-center gap-2 text-[11px] text-muted-foreground">
            {label}
            <span className="inline-flex gap-0.5">
              <span className="size-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="size-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:200ms]" />
              <span className="size-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:400ms]" />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Fixed app background: grid + faint noise + top brand haze. Place once behind content. */
export function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="bg-grid-fade absolute inset-0 opacity-70" />
      <div className="bg-noise absolute inset-0 opacity-[0.025] mix-blend-overlay" />
      <div className="absolute top-[-280px] left-1/2 h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-primary/[0.05] blur-[110px]" />
    </div>
  );
}
