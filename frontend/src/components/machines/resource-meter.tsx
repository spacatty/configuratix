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
