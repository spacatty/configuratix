"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toneBg, toneText, usageTone } from "./utils";

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

/**
 * One table cell per resource: value · slim bar · used/total.
 * `stale` (machine not reporting) greys everything out: last known values, not live load.
 */
export function UsageCell({
  value,
  used,
  total,
  label,
  stale,
  lastSeen,
}: {
  value: number | null;
  used?: number | null;
  total?: number | null;
  label: string;
  stale?: boolean;
  lastSeen?: string | null;
}) {
  if (value == null) return <span className="text-xs text-subtle-foreground">—</span>;
  const tone = stale ? "muted" : usageTone(value);
  const amount = usedOfTotal(used, total);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1.5 whitespace-nowrap", stale && "opacity-55")}>
          <span className={cn("font-data w-9 shrink-0 text-right text-[12.5px] tabular-nums", stale ? "text-muted-foreground" : toneText[tone])}>
            {Math.round(value)}%
          </span>
          <div className="relative h-1 w-10 shrink-0 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", stale ? "bg-muted-foreground/50" : toneBg[tone])}
              style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
            />
          </div>
          {amount && <span className="font-data hidden text-[11px] text-subtle-foreground 2xl:inline">{amount}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-data text-[11px]">
        {label} {value.toFixed(1)}%{amount ? ` · ${amount}` : ""}
        {stale && <div className="font-sans text-muted-foreground">Last reported {lastSeen ? new Date(lastSeen).toLocaleString() : "unknown"} · machine not reporting</div>}
      </TooltipContent>
    </Tooltip>
  );
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

/* -------------------------------------------------------------------------- */
/* Resource display variants (machines table). Pick one, then delete the rest. */
/* -------------------------------------------------------------------------- */

export type ResourceStyle = "compact" | "numbers" | "meters" | "load";

export const RESOURCE_STYLES: { value: ResourceStyle; label: string; hint: string }[] = [
  { value: "compact", label: "Compact", hint: "Value, slim bar, used/total on wide screens" },
  { value: "numbers", label: "Numbers", hint: "Plain percentages, colour only when high" },
  { value: "meters", label: "Meters", hint: "Wide labelled bars with used/total" },
  { value: "load", label: "Load", hint: "One column of three small gauges" },
];

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

/** Variant "numbers": just the percentage; neutral unless it needs attention. */
export function NumberCell(p: ResourceProps) {
  if (p.value == null) return <span className="text-xs text-subtle-foreground">—</span>;
  const tone = usageTone(p.value);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "font-data text-[13px] tabular-nums",
            p.stale ? "text-subtle-foreground" : tone === "warning" || tone === "destructive" ? cn(toneText[tone], "font-semibold") : "text-foreground"
          )}
        >
          {Math.round(p.value)}
          <span className="text-[11px] text-subtle-foreground">%</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-data text-[11px]">
        <ResourceTooltip {...p} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Variant "meters": wide bar, value on the bar's right, used/total underneath. */
export function MeterCell(p: ResourceProps) {
  if (p.value == null) return <span className="text-xs text-subtle-foreground">—</span>;
  const tone = p.stale ? "muted" : usageTone(p.value);
  const amount = usedOfTotal(p.used, p.total);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("w-[120px] space-y-1", p.stale && "opacity-55")}>
          <div className="flex items-center gap-2">
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", p.stale ? "bg-muted-foreground/50" : toneBg[tone])}
                style={{ width: `${Math.max(2, Math.min(100, p.value))}%` }}
              />
            </div>
            <span className={cn("font-data w-8 text-right text-[12px] tabular-nums", p.stale ? "text-muted-foreground" : toneText[tone])}>
              {Math.round(p.value)}%
            </span>
          </div>
          {amount && <div className="font-data text-[10.5px] leading-none text-subtle-foreground">{amount}</div>}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-data text-[11px]">
        <ResourceTooltip {...p} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Variant "load": CPU / memory / disk as three small vertical gauges in one cell. */
export function LoadCell({ items, stale, lastSeen }: { items: ResourceProps[]; stale?: boolean; lastSeen?: string | null }) {
  if (items.every((i) => i.value == null)) return <span className="text-xs text-subtle-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-end gap-2.5", stale && "opacity-55")}>
          {items.map((i) => {
            const tone = stale ? "muted" : usageTone(i.value);
            return (
              <div key={i.label} className="flex items-end gap-1">
                <div className="relative h-5 w-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  {i.value != null && (
                    <div
                      className={cn("absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-500", stale ? "bg-muted-foreground/50" : toneBg[tone])}
                      style={{ height: `${Math.max(6, Math.min(100, i.value))}%` }}
                    />
                  )}
                </div>
                <div className="flex flex-col leading-none">
                  <span className="text-[9.5px] text-subtle-foreground uppercase">{i.label.slice(0, 3)}</span>
                  <span className={cn("font-data text-[11.5px] tabular-nums", stale ? "text-muted-foreground" : toneText[tone])}>
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
