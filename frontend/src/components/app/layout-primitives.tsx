"use client";

import * as React from "react";
import Link from "next/link";
import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
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
  /** Not rendered (the top bar already names the page); kept for call-site readability. */
  title?: React.ReactNode;
  /** Not rendered — pages stay compact. */
  description?: React.ReactNode;
  /** Not rendered. */
  icon?: LucideIcon | React.ReactElement;
  /** Right-aligned actions (buttons). Primary action last. */
  actions?: React.ReactNode;
  /** Not rendered — the top bar breadcrumbs navigate back. */
  back?: { href: string; label?: string };
  /** Not rendered — the top bar shows route breadcrumbs. */
  breadcrumbs?: Crumb[];
  /** Status badge, version… shown first on the left. */
  badge?: React.ReactNode;
  /** Inline metrics row (`<MetricBar>`), left of the actions. */
  stats?: React.ReactNode;
  /** Key facts, chips — quiet text after the stats. */
  meta?: React.ReactNode;
}

/**
 * Compact page bar: badge · stats · meta on the left, actions on the right — one line, no title
 * (the top bar's breadcrumbs name the page). Renders nothing when there's nothing to show.
 */
export function PageHeader({
  /* eslint-disable @typescript-eslint/no-unused-vars -- accepted, not rendered (kept off the DOM) */
  title: _title,
  description: _description,
  icon: _icon,
  back: _back,
  breadcrumbs: _breadcrumbs,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  actions,
  badge,
  stats,
  meta,
  className,
  ...props
}: PageHeaderProps) {
  if (!actions && !badge && !stats && !meta) return null;
  return (
    <div
      data-slot="page-header"
      className={cn("flex min-h-8 flex-wrap items-center justify-between gap-x-6 gap-y-3", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {badge}
        {stats}
        {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Root for list pages whose main table should fill the viewport and scroll inside
 * (pair with `<DataTable fill>`). Replaces the usual `space-y-6` root.
 */
export function FillPage({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="fill-page"
      className={cn("flex min-h-[480px] flex-col gap-4 md:h-[calc(100svh-6rem)]", className)}
      {...props}
    />
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
  /** lg+: fill the parent's height (grid cell) and scroll the body; description is dropped to save space. */
  fill?: boolean;
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
  fill,
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
        fill && "flex flex-col lg:h-full lg:min-h-0",
        className
      )}
      {...props}
    >
      {hasHeader && (
        <header className={cn("flex items-start justify-between gap-3 border-b border-border px-4", fill ? "shrink-0 items-center py-2" : "py-3")}>
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 space-y-0.5">
              {title && <h2 className="text-sm leading-5 font-semibold tracking-[-0.01em]">{title}</h2>}
              {description && !fill && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && (fill ? "p-3" : "p-4"), fill && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto", bodyClassName)}>{children}</div>
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
  /** Colours the value. Use only when the number needs attention. */
  tone?: StatTone;
  /** 0..100 → tiny inline meter. */
  progress?: number;
  progressTone?: React.ComponentProps<typeof Progress>["tone"];
  /** Small inline slot after the label (keep it tiny — chips, a mini sparkline). */
  children?: React.ReactNode;
  href?: string;
  loading?: boolean;
}

/**
 * KPI item — renders as an inline `Metric` (no box). Group in `<StatStrip>` / `<MetricBar>`,
 * ideally passed to `<PageHeader stats>`. `icon` is ignored; `sub` becomes the quiet hint.
 */
export function StatCard({
  label,
  value,
  suffix,
  sub,
  delta,
  deltaInverse,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- icons dropped from inline metrics
  icon: _icon,
  tone = "default",
  progress,
  progressTone = "default",
  children,
  href,
  loading,
  ...props
}: StatCardProps) {
  let deltaNode: React.ReactNode = null;
  if (typeof delta === "number") {
    const good = deltaInverse ? delta < 0 : delta > 0;
    deltaNode = (
      <span className={cn("font-data text-[11px]", delta === 0 ? "text-muted-foreground" : good ? "text-success" : "text-destructive")}>
        {delta > 0 ? "+" : ""}
        {delta}
      </span>
    );
  } else if (delta) deltaNode = delta;

  const meterTone: StatTone | "auto" =
    progressTone === "auto" ? "auto" : progressTone && progressTone in toneBar ? (progressTone as StatTone) : "default";

  return (
    <Metric label={label} value={value} suffix={suffix} hint={sub} tone={tone} href={href} loading={loading} {...props}>
      {(deltaNode || typeof progress === "number" || children) && (
        <span className="flex items-center gap-1.5">
          {deltaNode}
          {typeof progress === "number" && <MetricMeter value={progress} tone={meterTone} />}
          {children}
        </span>
      )}
    </Metric>
  );
}

/* -------------------------------------------------------------------------- */
/* MetricBar                                                                  */
/* -------------------------------------------------------------------------- */

export interface MetricProps extends Omit<React.ComponentProps<"div">, "title"> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Unit or "/ total" shown smaller after the value. */
  suffix?: React.ReactNode;
  /** Quiet note after the label: "latest 0.6.0", "3 stale". */
  hint?: React.ReactNode;
  /** Colours the value. Use only when the number needs attention. */
  tone?: StatTone;
  /** Tiny inline visual after the label (`<MetricMeter>` / `<MetricSegments>`). */
  children?: React.ReactNode;
  href?: string;
  loading?: boolean;
}

/** One inline item of a `MetricBar`: `2 Machines ▬▬`. No box — just type. */
export function Metric({ label, value, suffix, hint, tone = "default", children, href, loading, className, ...props }: MetricProps) {
  const body = (
    <>
      {loading ? (
        <Skeleton className="h-4 w-6 self-center" />
      ) : (
        <span className="flex items-baseline gap-0.5">
          <span className={cn("font-data text-[15px] font-medium tracking-[-0.02em]", toneValue[tone])}>{value}</span>
          {suffix && <span className="font-data text-[11px] text-muted-foreground">{suffix}</span>}
        </span>
      )}
      <span className="text-xs text-muted-foreground transition-colors group-hover/metric:text-foreground">{label}</span>
      {hint && !loading && <span className="text-[11px] text-subtle-foreground">· {hint}</span>}
      {children && !loading && <span className="self-center">{children}</span>}
    </>
  );
  const cls = cn("group/metric flex items-baseline gap-1.5 whitespace-nowrap outline-none", className);
  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <div data-slot="metric" className={cls} {...props}>
      {body}
    </div>
  );
}

/** Thin bottom meter for a `Metric` (0..100). `tone="auto"` → green / amber ≥75 / red ≥90. */
export function MetricMeter({ value, tone = "auto" }: { value: number; tone?: StatTone | "auto" }) {
  const v = Math.max(0, Math.min(100, value));
  const t: StatTone = tone === "auto" ? (v >= 90 ? "destructive" : v >= 75 ? "warning" : "success") : tone;
  return (
    <span className="block h-1 w-10 overflow-hidden rounded-full bg-border">
      <span className={cn("block h-full rounded-full transition-[width] duration-500", toneBar[t])} style={{ width: `${v}%` }} />
    </span>
  );
}

/** Proportional hairline split for a `Metric` (e.g. online / stale / offline). Zero segments are skipped. */
export function MetricSegments({ segments }: { segments: { value: number; tone: StatTone; label?: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <span className="flex h-1 w-10 gap-px overflow-hidden rounded-full bg-border">
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s, i) => (
            <span
              key={i}
              title={s.label ? `${s.value} ${s.label}` : undefined}
              className={cn("h-full transition-[flex-grow] duration-500", toneBar[s.tone])}
              style={{ flexGrow: s.value }}
            />
          ))}
    </span>
  );
}

/** Borderless one-line metrics row, items split by hairline dividers. Wraps on narrow screens. */
export function MetricBar({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="metric-bar"
      className={cn(
        "flex flex-wrap items-center gap-y-2 [&>*]:border-l [&>*]:border-border [&>*]:px-4 [&>*:first-child]:border-l-0 [&>*:first-child]:pl-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Horizontal strip of stats inside one card (divided). Preferred for 3–6 peer metrics. */
export function StatStrip(props: React.ComponentProps<"div">) {
  return <MetricBar {...props} />;
}
