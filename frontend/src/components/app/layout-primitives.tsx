"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

/* -------------------------------------------------------------------------- */
/* PageHeader                                                                 */
/* -------------------------------------------------------------------------- */

export interface Crumb {
  label: React.ReactNode;
  href?: string;
}

export interface PageHeaderProps extends Omit<React.ComponentProps<"div">, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Lucide icon component or element, shown left of the title. */
  icon?: LucideIcon | React.ReactElement;
  /** Right-aligned actions (buttons). Primary action last. */
  actions?: React.ReactNode;
  /** Back link shown above the title: { href, label } */
  back?: { href: string; label?: string };
  /** In-page breadcrumbs (the top bar already shows route breadcrumbs; use only for deep pages). */
  breadcrumbs?: Crumb[];
  /** Inline meta next to the title (status badge, version...). */
  badge?: React.ReactNode;
  /** Row under the description: key facts, chips. */
  meta?: React.ReactNode;
}

/** One header for every page. Place first inside the page's `space-y-6` root. */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  back,
  breadcrumbs,
  badge,
  meta,
  className,
  ...props
}: PageHeaderProps) {
  let iconNode: React.ReactNode = null;
  if (icon) {
    if (React.isValidElement(icon)) iconNode = icon;
    else {
      const Icon = icon as LucideIcon;
      iconNode = <Icon className="size-4" />;
    }
  }
  return (
    <div data-slot="page-header" className={cn("flex flex-col gap-3", className)} {...props}>
      {(back || breadcrumbs) && (
        <div className="flex items-center gap-3 text-[13px]">
          {back && (
            <Link
              href={back.href}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              {back.label ?? "Back"}
            </Link>
          )}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((c, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {c.href && i < breadcrumbs.length - 1 ? (
                        <BreadcrumbLink asChild>
                          <Link href={c.href}>{c.label}</Link>
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{c.label}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          )}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {iconNode && (
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/4%)]">
              {iconNode}
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-xl leading-8 font-semibold tracking-[-0.02em]">{title}</h1>
              {badge}
            </div>
            {description && <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
            {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SectionCard                                                                */
/* -------------------------------------------------------------------------- */

export interface SectionCardProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** Header right side. */
  actions?: React.ReactNode;
  /** Footer row (border-top). */
  footer?: React.ReactNode;
  /** Remove body padding (for tables / lists that run edge-to-edge). */
  flush?: boolean;
  bodyClassName?: string;
}

/** Card with an optional header (title/description/actions), body and footer. */
export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  footer,
  flush,
  className,
  bodyClassName,
  children,
  ...props
}: SectionCardProps) {
  const hasHeader = title || description || actions;
  return (
    <section
      data-slot="section-card"
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/3.5%)]",
        className
      )}
      {...props}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 space-y-0.5">
              {title && <h2 className="text-sm leading-5 font-semibold tracking-[-0.01em]">{title}</h2>}
              {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "p-4", bodyClassName)}>{children}</div>
      {footer && (
        <footer className="flex items-center justify-end gap-2 border-t border-border bg-white/[0.012] px-4 py-2.5">
          {footer}
        </footer>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* StatCard                                                                   */
/* -------------------------------------------------------------------------- */

export type StatTone = "default" | "primary" | "success" | "warning" | "destructive" | "info";

const toneValue: Record<StatTone, string> = {
  default: "text-foreground",
  primary: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
};
const toneBar: Record<StatTone, string> = {
  default: "bg-border-strong",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
};

export interface StatCardProps extends Omit<React.ComponentProps<"div">, "title"> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Unit or "/ total" shown smaller after the value. */
  suffix?: React.ReactNode;
  /** Secondary line: "+3 since yesterday", "12 healthy · 2 down". */
  sub?: React.ReactNode;
  /** Delta pill: number (sign shown) or node. Positive = good unless `deltaInverse`. */
  delta?: number | React.ReactNode;
  deltaInverse?: boolean;
  icon?: LucideIcon;
  /** Colours the value and the left accent bar. Use only when the number needs attention. */
  tone?: StatTone;
  /** 0..100 → progress bar under the value. */
  progress?: number;
  progressTone?: React.ComponentProps<typeof Progress>["tone"];
  /** Free slot under the value (sparkline, mini chart, chips). */
  children?: React.ReactNode;
  href?: string;
  loading?: boolean;
}

/** KPI tile. Group in `grid gap-3 sm:grid-cols-2 lg:grid-cols-4`. */
export function StatCard({
  label,
  value,
  suffix,
  sub,
  delta,
  deltaInverse,
  icon: Icon,
  tone = "default",
  progress,
  progressTone = "default",
  children,
  href,
  loading,
  className,
  ...props
}: StatCardProps) {
  let deltaNode: React.ReactNode = null;
  if (typeof delta === "number") {
    const good = deltaInverse ? delta < 0 : delta > 0;
    const zero = delta === 0;
    deltaNode = (
      <span
        className={cn(
          "font-data rounded px-1 text-[11px]",
          zero ? "text-muted-foreground" : good ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
        )}
      >
        {delta > 0 ? "+" : ""}
        {delta}
      </span>
    );
  } else if (delta) deltaNode = delta;

  const body = (
    <>
      {tone !== "default" && (
        <span aria-hidden className={cn("absolute inset-y-3 left-0 w-[2px] rounded-r", toneBar[tone])} />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 shrink-0 text-subtle-foreground" />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className={cn("font-data text-2xl leading-8 font-medium tracking-[-0.03em]", toneValue[tone])}>{value}</span>
          {suffix && <span className="font-data text-[13px] text-muted-foreground">{suffix}</span>}
          {deltaNode && <span className="ml-auto self-center">{deltaNode}</span>}
        </div>
      )}
      {typeof progress === "number" && !loading && (
        <Progress value={progress} tone={progressTone} size="sm" className="mt-2.5" />
      )}
      {children && <div className="mt-2.5">{children}</div>}
      {sub && !loading && <div className="mt-1.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </>
  );

  const cls = cn(
    "relative block overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5 shadow-[inset_0_1px_0_0_oklch(1_0_0/3.5%)]",
    href && "transition-colors hover:border-border-strong hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-ring/40 outline-none",
    className
  );

  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <div data-slot="stat-card" className={cls} {...props}>
      {body}
    </div>
  );
}

/** Horizontal strip of stats inside one card (divided). Preferred for 3–6 peer metrics. */
export function StatStrip({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-strip"
      className={cn(
        "grid grid-cols-2 divide-border overflow-hidden rounded-lg border border-border bg-card sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:divide-x [&>*]:rounded-none [&>*]:border-0 [&>*]:shadow-none",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
