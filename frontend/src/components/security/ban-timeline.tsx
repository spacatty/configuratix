"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface TimelineBucket {
  key: string;
  label: string;
  count: number;
}

/** Bucket timestamps into the last `days` calendar days (oldest first). */
export function bucketByDay(dates: string[], days = 14): TimelineBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets: TimelineBucket[] = [];
  const index = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    index.set(key, buckets.length);
    buckets.push({
      key,
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" }),
      count: 0,
    });
  }
  for (const s of dates) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const i = index.get(key);
    if (i !== undefined) buckets[i].count++;
  }
  return buckets;
}

/** Minimal bar chart (pure CSS). The last bar is "today" and is emphasised. */
export function BanTimeline({ buckets, height = 120 }: { buckets: TimelineBucket[]; height?: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((a, b) => a + b.count, 0);
  const gridLines = [1, 0.5];
  return (
    <div className="space-y-2">
      <div className="relative" style={{ height }}>
        {gridLines.map((g) => (
          <div
            key={g}
            aria-hidden
            className="absolute inset-x-0 border-t border-dashed border-border"
            style={{ bottom: `${g * 100}%` }}
          >
            <span className="font-data absolute -top-2 right-0 bg-card pl-1 text-[10px] text-subtle-foreground">
              {Math.round(max * g)}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 bottom-0 flex items-end gap-1 pr-6">
          {buckets.map((b, i) => {
            const pct = (b.count / max) * 100;
            const isToday = i === buckets.length - 1;
            return (
              <Tooltip key={b.key}>
                <TooltipTrigger asChild>
                  <div className="group flex h-full flex-1 cursor-default items-end" aria-label={`${b.label}: ${b.count} bans`}>
                    <div
                      className={cn(
                        "w-full rounded-t-[3px] transition-colors",
                        b.count === 0 ? "bg-border" : isToday ? "bg-primary/80 group-hover:bg-primary" : "bg-muted-foreground/45 group-hover:bg-foreground/80"
                      )}
                      style={{ height: b.count === 0 ? 2 : `max(3px, ${pct}%)` }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="font-data">{b.count}</span> {b.count === 1 ? "ban" : "bans"} · {b.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between pr-6 text-[11px] text-subtle-foreground">
        <span>{buckets[0]?.label}</span>
        <span className="font-data">{total} in {buckets.length} days</span>
        <span>Today</span>
      </div>
    </div>
  );
}
