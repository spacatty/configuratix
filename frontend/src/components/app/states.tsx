"use client";

import * as React from "react";
import { CircleAlert, Inbox, RotateCw, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                 */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary action (usually a <Button size="sm">). */
  action?: React.ReactNode;
  /** Secondary action / docs link. */
  secondaryAction?: React.ReactNode;
  /** compact: for inside tables/cards; default: page sections. */
  size?: "compact" | "default";
  /** Draw a dashed frame (use when the empty state stands alone on a page). */
  bordered?: boolean;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  secondaryAction,
  size = "default",
  bordered,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "compact" ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        bordered && "rounded-lg border border-dashed border-border-strong bg-card/40",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/5%)]",
          size === "compact" ? "size-8" : "size-10"
        )}
      >
        <Icon className={size === "compact" ? "size-4" : "size-5"} />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {secondaryAction}
          {action}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ErrorState                                                                 */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  title?: React.ReactNode;
  /** Error object or message. */
  error?: unknown;
  onRetry?: () => void | Promise<unknown>;
  size?: "compact" | "default";
  bordered?: boolean;
}

export function errorMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function ErrorState({
  title = "Something went wrong",
  error,
  onRetry,
  size = "default",
  bordered = true,
  className,
  ...props
}: ErrorStateProps) {
  const [retrying, setRetrying] = React.useState(false);
  const msg = errorMessage(error);
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "compact" ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        bordered && "rounded-lg border border-destructive/20 bg-destructive/[0.04]",
        className
      )}
      {...props}
    >
      <div className="flex size-10 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10 text-destructive">
        <CircleAlert className="size-5" />
      </div>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {msg && <p className="font-data line-clamp-4 text-xs break-words text-muted-foreground">{msg}</p>}
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await onRetry();
            } finally {
              setRetrying(false);
            }
          }}
        >
          <RotateCw className={cn(retrying && "animate-spin")} />
          Retry
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

/** Inline spinner. */
export function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("size-4 animate-spin", className)} aria-hidden {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export interface LoadingStateProps extends React.ComponentProps<"div"> {
  label?: React.ReactNode;
  size?: "compact" | "default";
}

/** Centered spinner + label. Prefer skeletons for tables/cards. */
export function LoadingState({ label = "Loading…", size = "default", className, ...props }: LoadingStateProps) {
  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2.5 text-[13px] text-muted-foreground",
        size === "compact" ? "py-6" : "py-16",
        className
      )}
      {...props}
    >
      <Spinner className="text-primary" />
      <span>{label}</span>
    </div>
  );
}

/** Skeleton rows matching DataTable density. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  showHeader = true,
  className,
}: {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  className?: string;
}) {
  const widths = ["w-40", "w-24", "w-32", "w-16", "w-20", "w-28", "w-12"];
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      {showHeader && (
        <div className="flex h-9 items-center gap-6 border-b border-border px-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className={cn("h-2.5", i === 0 ? "w-24" : "w-14")} />
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-10 items-center gap-6 border-b border-border/70 px-4 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-3", widths[(c + r) % widths.length], c === 0 && "w-44")}
              style={{ opacity: 1 - r * 0.08 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a SectionCard / StatCard grid. */
export function CardSkeleton({ lines = 3, header = true, className }: { lines?: number; header?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      {header && (
        <div className="space-y-1.5 border-b border-border px-4 py-3">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-2.5 w-52" />
        </div>
      )}
      <div className="space-y-2.5 p-4">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn("h-3", i % 3 === 0 ? "w-full" : i % 3 === 1 ? "w-4/5" : "w-3/5")} />
        ))}
      </div>
    </div>
  );
}

export function StatGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card px-4 py-3.5">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-6 w-16" />
          <Skeleton className="mt-2.5 h-2.5 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Full page skeleton: header + stats + table. Use while the first fetch runs. */
export function PageSkeleton({ stats = true, className }: { stats?: boolean; className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      {stats && <StatGridSkeleton />}
      <TableSkeleton />
    </div>
  );
}
