"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toneText, usageTone, type UsageTone } from "./utils";

/** Compact "used/total" for table cells, e.g. 3.3/7.8 GB. */
function usedOfTotal(used: number | null | undefined, total: number | null | undefined): string | null {
  if (!total || used == null) return null;
  const full = formatBytes(total); // e.g. "7.8 GB"
  const unit = full.split(" ")[1] ?? "";
  const div = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] ?? 1;
  const u = used / div;
  // "3.2/7.8G": the unit initial keeps the column narrow.
  return `${u >= 100 ? Math.round(u) : u.toFixed(1)}/${full.replace(/\s*([KMGT])B$/, "$1")}`;
}

/** Ring gauge for the detail overview. */
export function RingGauge({
  label,
  value,
  sub,
  size = 88,
}: {
  label: string;
  value: number | null;
  sub?: React.ReactNode;
  size?: number;
}) {
  const tone = usageTone(value);
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const color =
    tone === "destructive"
      ? "var(--destructive)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "success"
          ? "var(--success)"
          : "var(--muted-foreground)";
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(1 0 0 / 7%)" strokeWidth={stroke} />
          {value != null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c - (c * v) / 100}
              style={{ transition: "stroke-dashoffset 600ms ease-out, stroke 300ms" }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-data text-lg leading-none font-semibold", toneText[tone])}>
            {value == null ? "—" : Math.round(v)}
            {value != null && <span className="text-[11px] font-normal text-muted-foreground">%</span>}
          </span>
        </div>
      </div>
      <div className="min-w-0 space-y-0.5">
        <div className="text-[13px] font-medium">{label}</div>
        {sub && <div className="font-data text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

type ResourceProps = {
  label: string;
  value: number | null;
  used?: number | null;
  total?: number | null;
  stale?: boolean;
  lastSeen?: string | null;
};

function ResourceTooltip({ label, value, used, total, stale, lastSeen }: ResourceProps) {
  const amount = usedOfTotal(used, total);
  return (
    <>
      {label} {value == null ? "—" : `${value.toFixed(1)}%`}
      {amount ? ` · ${amount}` : ""}
      {stale && (
        <div className="font-sans text-muted-foreground">
          Last reported {lastSeen ? new Date(lastSeen).toLocaleString() : "unknown"} · machine not reporting
        </div>
      )}
    </>
  );
}

/**
 * CPU / memory / disk as three small vertical gauges in one cell.
 * Machines that stopped reporting keep their colours (last known load), dimmed, never grey.
 */
export type AgentBadgeState = "current" | "outdated" | "updating" | "failed" | "none";

export interface AgentBadgeInfo {
  version: string | null;
  state: AgentBadgeState;
  /** Tooltip line, e.g. "Latest is 0.6.0". */
  hint?: string;
}

const AGENT_TONE: Record<AgentBadgeState, { bar: string; text: string; label: string }> = {
  current: { bar: "bg-success", text: "text-success", label: "Up to date" },
  outdated: { bar: "bg-warning", text: "text-warning", label: "Outdated" },
  updating: { bar: "bg-info animate-pulse", text: "text-info", label: "Updating" },
  failed: { bar: "bg-destructive", text: "text-destructive", label: "Update failed" },
  none: { bar: "bg-info/40", text: "text-muted-foreground", label: "Not enrolled" },
};

/** Agent version as a vertical badge matching the gauges. */
function AgentBadge({ agent }: { agent: AgentBadgeInfo }) {
  const t = AGENT_TONE[agent.state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-end gap-1 border-l border-border pl-2.5">
          <div className={cn("h-5 w-1.5 rounded-full", t.bar)} />
          <div className="flex flex-col leading-none">
            <span className="text-[9.5px] font-medium tracking-wide text-muted-foreground uppercase">Agent</span>
            <span className={cn("font-data text-[12px] tabular-nums", t.text)}>{agent.version ?? "—"}</span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        <span className="font-medium">{t.label}</span>
        {agent.version && <span className="font-data"> · v{agent.version}</span>}
        {agent.hint && <div className="text-muted-foreground">{agent.hint}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

export function LoadCell({
  items,
  stale,
  lastSeen,
  agent,
}: {
  items: ResourceProps[];
  stale?: boolean;
  lastSeen?: string | null;
  agent?: AgentBadgeInfo;
}) {
  const gauges = items.every((i) => i.value == null) ? (
    <span className="text-xs text-muted-foreground">—</span>
  ) : (
    <LoadGauges items={items} stale={stale} lastSeen={lastSeen} />
  );
  if (!agent) return gauges;
  return (
    <div className="flex items-end gap-2.5">
      {gauges}
      <AgentBadge agent={agent} />
    </div>
  );
}

function LoadGauges({ items, stale, lastSeen }: { items: ResourceProps[]; stale?: boolean; lastSeen?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-end gap-2.5", stale && "opacity-70")}>
          {items.map((i) => {
            const tone = usageTone(i.value);
            return (
              <div key={i.label} className="flex items-end gap-1">
                <div className={cn("relative h-5 w-1.5 overflow-hidden rounded-full", toneTrack[tone])}>
                  {i.value != null && (
                    <div
                      className={cn("absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-500", toneFill[tone])}
                      style={{ height: `${Math.max(8, Math.min(100, i.value))}%` }}
                    />
                  )}
                </div>
                <div className="flex flex-col leading-none">
                  <span className="text-[9.5px] font-medium tracking-wide text-muted-foreground uppercase">{SHORT[i.label] ?? i.label}</span>
                  <span className={cn("font-data text-[12px] tabular-nums", toneValue[tone])}>
                    {i.value == null ? "—" : Math.round(i.value)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-data space-y-0.5 text-[11px]">
        {items.map((i) => (
          <div key={i.label}>
            <ResourceTooltip {...i} stale={false} />
          </div>
        ))}
        {stale && (
          <div className="font-sans text-muted-foreground">
            Last reported {lastSeen ? new Date(lastSeen).toLocaleString() : "unknown"} · machine not reporting
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

const SHORT: Record<string, string> = { CPU: "CPU", Memory: "MEM", Disk: "DSK" };

// Coloured track + fill per load level (no neutral greys).
const toneTrack: Record<UsageTone, string> = {
  success: "bg-success/15",
  warning: "bg-warning/15",
  destructive: "bg-destructive/15",
  muted: "bg-info/12",
};
const toneFill: Record<UsageTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-info",
};
const toneValue: Record<UsageTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-info",
};
