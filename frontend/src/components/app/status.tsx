"use client";

import * as React from "react";
import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Clock,
  LoaderCircle,
  TriangleAlert,
  CircleHelp,
  Info,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "destructive" | "info" | "muted" | "primary";

export interface StatusMeta {
  tone: StatusTone;
  label: string;
  /** Animated halo (live / in-progress states). */
  pulse: boolean;
  icon: LucideIcon;
}

/**
 * The single status → visual mapping for the whole app.
 * Keys are lower-cased; unknown statuses render as muted with Title-cased label.
 */
const STATUS_MAP: Record<string, StatusMeta> = {
  // machines / agents
  online: { tone: "success", label: "Online", pulse: true, icon: CircleCheck },
  stale: { tone: "warning", label: "Stale", pulse: false, icon: Clock },
  offline: { tone: "destructive", label: "Offline", pulse: false, icon: CircleX },
  // jobs
  pending: { tone: "muted", label: "Pending", pulse: false, icon: CircleDashed },
  queued: { tone: "muted", label: "Queued", pulse: false, icon: CircleDashed },
  running: { tone: "info", label: "Running", pulse: true, icon: LoaderCircle },
  completed: { tone: "success", label: "Completed", pulse: false, icon: CircleCheck },
  succeeded: { tone: "success", label: "Succeeded", pulse: false, icon: CircleCheck },
  failed: { tone: "destructive", label: "Failed", pulse: false, icon: CircleX },
  cancelled: { tone: "muted", label: "Cancelled", pulse: false, icon: CircleSlash },
  canceled: { tone: "muted", label: "Cancelled", pulse: false, icon: CircleSlash },
  rolled_back: { tone: "warning", label: "Rolled back", pulse: false, icon: TriangleAlert },
  // domains / health
  healthy: { tone: "success", label: "Healthy", pulse: false, icon: CircleCheck },
  unhealthy: { tone: "destructive", label: "Unhealthy", pulse: false, icon: CircleX },
  degraded: { tone: "warning", label: "Degraded", pulse: false, icon: TriangleAlert },
  unknown: { tone: "muted", label: "Unknown", pulse: false, icon: CircleHelp },
  checking: { tone: "info", label: "Checking", pulse: true, icon: LoaderCircle },
  // generic
  success: { tone: "success", label: "Success", pulse: false, icon: CircleCheck },
  ok: { tone: "success", label: "OK", pulse: false, icon: CircleCheck },
  active: { tone: "success", label: "Active", pulse: false, icon: CircleCheck },
  enabled: { tone: "success", label: "Enabled", pulse: false, icon: CircleCheck },
  approved: { tone: "success", label: "Approved", pulse: false, icon: CircleCheck },
  warning: { tone: "warning", label: "Warning", pulse: false, icon: TriangleAlert },
  paused: { tone: "warning", label: "Paused", pulse: false, icon: Clock },
  error: { tone: "destructive", label: "Error", pulse: false, icon: CircleX },
  denied: { tone: "destructive", label: "Denied", pulse: false, icon: CircleX },
  expired: { tone: "destructive", label: "Expired", pulse: false, icon: CircleX },
  info: { tone: "info", label: "Info", pulse: false, icon: Info },
  disabled: { tone: "muted", label: "Disabled", pulse: false, icon: CircleSlash },
  inactive: { tone: "muted", label: "Inactive", pulse: false, icon: CircleSlash },
  neutral: { tone: "muted", label: "—", pulse: false, icon: CircleDashed },
};

function titleCase(s: string) {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function getStatusMeta(status: string | null | undefined): StatusMeta {
  const key = (status ?? "unknown").toLowerCase().trim();
  return STATUS_MAP[key] ?? { tone: "muted", label: titleCase(key || "unknown"), pulse: false, icon: CircleHelp };
}

const DOT_TONE: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  muted: "bg-subtle-foreground",
  primary: "bg-primary",
};

const BADGE_TONE: Record<StatusTone, string> = {
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/25 bg-info/10 text-info",
  muted: "border-border bg-muted/60 text-muted-foreground",
  primary: "border-primary/30 bg-primary/12 text-[oklch(0.78_0.13_24)]",
};

export const statusToneText: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
  muted: "text-muted-foreground",
  primary: "text-primary",
};

export interface StatusDotProps extends React.ComponentProps<"span"> {
  /** Any status key from the map (online, running, failed, healthy...). */
  status?: string | null;
  /** Override tone directly instead of `status`. */
  tone?: StatusTone;
  /** Override pulsing (defaults to status meta). */
  pulse?: boolean;
  size?: "xs" | "sm" | "md";
}

/** 6–8px status dot with optional live pulse halo. */
export function StatusDot({ status, tone, pulse, size = "sm", className, ...props }: StatusDotProps) {
  const meta = getStatusMeta(status);
  const t = tone ?? meta.tone;
  const p = pulse ?? (tone ? false : meta.pulse);
  const dim = size === "xs" ? "size-1.5" : size === "sm" ? "size-2" : "size-2.5";
  return (
    <span
      data-slot="status-dot"
      aria-hidden
      className={cn("relative inline-flex shrink-0", dim, className)}
      {...props}
    >
      {p && <span className={cn("absolute inset-0 rounded-full animate-pulse-dot", DOT_TONE[t])} />}
      <span
        className={cn(
          "relative inline-flex rounded-full",
          dim,
          DOT_TONE[t],
          t !== "muted" && "shadow-[0_0_6px_0_currentColor]",
          statusToneText[t]
        )}
      />
    </span>
  );
}

export interface StatusBadgeProps extends Omit<React.ComponentProps<"span">, "children"> {
  status: string | null | undefined;
  /** Override the label text. */
  label?: React.ReactNode;
  /** Leading visual: dot (default), icon, or none. */
  indicator?: "dot" | "icon" | "none";
  tone?: StatusTone;
  size?: "sm" | "md";
}

/** Tinted pill with dot/icon + label. `<StatusBadge status={job.status} />` */
export function StatusBadge({
  status,
  label,
  indicator = "dot",
  tone,
  size = "sm",
  className,
  ...props
}: StatusBadgeProps) {
  const meta = getStatusMeta(status);
  const t = tone ?? meta.tone;
  const Icon = meta.icon;
  return (
    <span
      data-slot="status-badge"
      data-status={status ?? undefined}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        BADGE_TONE[t],
        className
      )}
      {...props}
    >
      {indicator === "dot" && <StatusDot tone={t} pulse={meta.pulse} size="xs" />}
      {indicator === "icon" && (
        <Icon className={cn("size-3 shrink-0", meta.icon === LoaderCircle && meta.pulse && "animate-spin")} />
      )}
      {label ?? meta.label}
    </span>
  );
}

/** Dot + plain label (no pill) — for dense tables. */
export function StatusText({
  status,
  label,
  className,
  ...props
}: { status: string | null | undefined; label?: React.ReactNode } & React.ComponentProps<"span">) {
  const meta = getStatusMeta(status);
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px]", className)} {...props}>
      <StatusDot status={status} />
      <span className={meta.tone === "muted" ? "text-muted-foreground" : "text-foreground"}>{label ?? meta.label}</span>
    </span>
  );
}
