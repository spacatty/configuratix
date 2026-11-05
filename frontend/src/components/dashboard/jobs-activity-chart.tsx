"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { JobStatsBucket } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

/** Stack order bottom → top. Colours come from status tokens only. */
const SERIES = [
  { key: "completed", label: "Completed", cls: "bg-success/75", dot: "bg-success" },
  { key: "failed", label: "Failed", cls: "bg-destructive/85", dot: "bg-destructive" },
  { key: "cancelled", label: "Cancelled", cls: "bg-subtle-foreground/60", dot: "bg-subtle-foreground" },
  { key: "running", label: "Running", cls: "bg-info/85", dot: "bg-info" },
  { key: "pending", label: "Pending", cls: "bg-muted-foreground/40", dot: "bg-muted-foreground" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function hourLabel(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

/**
 * Stacked bars per hour (pure CSS). Each column is focusable and announces its
 * counts; hover/focus shows a tooltip. Height ~160px.
 */
export function JobsActivityChart({ buckets, loading, className, onSelectHour }: { buckets: JobStatsBucket[] | undefined; loading?: boolean; className?: string; onSelectHour?: (b: JobStatsBucket) => void }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const data = buckets ?? [];
  const totals = data.map((b) => SERIES.reduce((a, s) => a + (b[s.key as SeriesKey] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));

  if (loading && !buckets) {
    return (
      <div className={cn("flex h-[180px] items-end gap-1", className)}>
        {Array.from({ length: 24 }).map((_, i) => (
          <Skeleton key={i} className="flex-1" style={{ height: `${20 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
    );
  }

  const h = hover !== null ? data[hover] : null;

  return (
    <div className={cn("relative", className)}>
      <div className="flex gap-2">
        {/* y axis */}
        <div className="font-data flex h-[160px] flex-col justify-between py-0 text-right text-[10.5px] text-subtle-foreground">
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          {/* grid */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[160px]">
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/50" />
            <div className="absolute inset-x-0 bottom-0 border-t border-border" />
          </div>
          <div className="relative flex h-[160px] items-end gap-[3px]" role="list" aria-label="Jobs per hour, last 24 hours" onMouseLeave={() => setHover(null)}>
            {data.map((b, i) => {
              const total = totals[i];
              const label = `${hourLabel(b.hour)} — ${total} jobs: ${SERIES.filter((s) => b[s.key as SeriesKey]).map((s) => `${b[s.key as SeriesKey]} ${s.label.toLowerCase()}`).join(", ") || "none"}`;
              return (
                <div
                  key={b.hour}
                  role="listitem"
                  tabIndex={0}
                  aria-label={label}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelectHour?.(b)}
                  className={cn(
                    "group relative flex h-full flex-1 cursor-default flex-col justify-end rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    onSelectHour && "cursor-pointer",
                    hover === i && "bg-accent/40"
                  )}
                >
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-[3px]" style={{ height: `${(total / max) * 100}%` }}>
                    {SERIES.map((s) => {
                      const v = b[s.key as SeriesKey] ?? 0;
                      if (!v) return null;
                      return <div key={s.key} className={cn("w-full transition-opacity", s.cls, hover !== null && hover !== i && "opacity-55")} style={{ height: `${(v / total) * 100}%` }} />;
                    })}
                  </div>
                  {total === 0 && <div className="h-px w-full bg-border-strong/60" />}
                </div>
              );
            })}
          </div>
          {/* x axis */}
          <div className="font-data mt-1.5 flex text-[10.5px] text-subtle-foreground">
            {data.map((b, i) => (
              <span key={b.hour} className="flex-1 text-center">
                {i % 6 === 0 || i === data.length - 1 ? hourLabel(b.hour) : ""}
              </span>
            ))}
          </div>
          {/* tooltip */}
          {h && hover !== null && (
            <div
              role="tooltip"
              className={cn(
                "shadow-elevated pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-md border border-border bg-popover/95 px-2.5 py-2 text-xs backdrop-blur",
                hover < 4 ? "translate-x-2" : hover > data.length - 5 ? "-translate-x-[calc(100%+8px)]" : "-translate-x-1/2"
              )}
              style={{ left: `${((hover + (hover < 4 ? 1 : hover > data.length - 5 ? 0 : 0.5)) / data.length) * 100}%` }}
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="font-data text-muted-foreground">
                  {hourLabel(h.hour)}–{hourLabel(new Date(new Date(h.hour).getTime() + 3600_000).toISOString())}
                </span>
                <span className="font-data font-medium">{totals[hover]}</span>
              </div>
              {SERIES.map((s) =>
                h[s.key as SeriesKey] ? (
                  <div key={s.key} className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <span className={cn("size-2 rounded-[2px]", s.dot)} />
                      {s.label}
                    </span>
                    <span className="font-data">{h[s.key as SeriesKey]}</span>
                  </div>
                ) : null
              )}
              {totals[hover] === 0 && <div className="text-muted-foreground">No jobs</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChartLegend({ counts }: { counts: Partial<Record<SeriesKey, number>> | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-[2px]", s.dot)} />
          {s.label}
          <span className="font-data text-foreground">{counts?.[s.key] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}
