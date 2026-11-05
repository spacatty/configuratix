"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import type { Machine } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cpuPct, diskPct, memPct, toneBg, toneText, usageTone } from "./utils";

/** Tiny inline usage bar for dense table cells: label · bar · % */
export function MiniMeter({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: number | null;
  detail?: React.ReactNode;
  className?: string;
}) {
  const tone = usageTone(value);
  const body = (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="w-7 shrink-0 text-[10.5px] text-subtle-foreground">{label}</span>
      <div className="relative h-1 w-12 overflow-hidden rounded-full bg-white/[0.07]">
        {value != null && (
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", toneBg[tone])}
            style={{ width: `${Math.max(2, value)}%` }}
          />
        )}
      </div>
      <span className={cn("font-data w-8 text-right text-[11px]", toneText[tone])}>
        {value == null ? "—" : `${Math.round(value)}%`}
      </span>
    </div>
  );
  if (!detail) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="top" className="font-data text-[11px]">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}

/** Stack of CPU / RAM / Disk mini meters for a machine row. */
export function MachineMeters({ machine, className }: { machine: Machine; className?: string }) {
  const cpu = cpuPct(machine);
  const mem = memPct(machine);
  const disk = diskPct(machine);
  return (
    <div className={cn("flex flex-col gap-[3px] py-0.5", className)}>
      <MiniMeter label="CPU" value={cpu} detail={cpu != null ? `CPU ${cpu.toFixed(1)}%` : undefined} />
      <MiniMeter
        label="RAM"
        value={mem}
        detail={mem != null ? `RAM ${formatBytes(machine.memory_used)} / ${formatBytes(machine.memory_total)}` : undefined}
      />
      <MiniMeter
        label="Disk"
        value={disk}
        detail={disk != null ? `Disk ${formatBytes(machine.disk_used)} / ${formatBytes(machine.disk_total)}` : undefined}
      />
    </div>
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
