"use client";

import * as React from "react";
import { ArrowRight, History } from "lucide-react";

import { api, type RotationHistory } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState, LoadingState, RelativeTime, usePolling } from "@/components/app";
import { formatDateTime } from "@/lib/format";

const TRIGGER_VARIANT: Record<string, "secondary" | "info" | "warning"> = {
  scheduled: "secondary",
  manual: "info",
  health: "warning",
};

export function RotationHistorySheet({
  target,
  onOpenChange,
}: {
  /** null = closed */
  target: { poolId: string; wildcard: boolean; label: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const q = usePolling(
    () =>
      target
        ? target.wildcard
          ? api.getWildcardPoolHistory(target.poolId)
          : api.getRecordPoolHistory(target.poolId)
        : Promise.resolve([] as RotationHistory[]),
    0,
    { enabled: !!target, deps: [target?.poolId] }
  );
  const items = q.data ?? [];

  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            Rotation history
          </SheetTitle>
          <SheetDescription className="font-data">{target?.label}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {q.loading ? (
            <LoadingState />
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={q.refresh} />
          ) : items.length === 0 ? (
            <EmptyState size="compact" icon={History} title="No rotations yet" description="Rotations appear here as they happen." />
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {items.map((h, i) => (
                <li key={h.id} className="relative">
                  <span
                    aria-hidden
                    className={
                      "absolute top-1.5 -left-[24.5px] size-2 rounded-full ring-4 ring-background " +
                      (i === 0 ? "bg-primary" : "bg-border-strong")
                    }
                  />
                  <div className="flex items-center gap-2">
                    <Badge variant={TRIGGER_VARIANT[h.trigger] ?? "secondary"}>{h.trigger}</Badge>
                    <span title={formatDateTime(h.rotated_at)}>
                      <RelativeTime date={h.rotated_at} className="text-xs text-muted-foreground" />
                    </span>
                    {h.record_name && <span className="font-data ml-auto text-[11px] text-subtle-foreground">{h.record_name}</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="min-w-0 text-muted-foreground">
                      {h.from_machine_name || "—"} <span className="font-data text-[11.5px]">{h.from_ip}</span>
                    </span>
                    <ArrowRight className="size-3.5 text-subtle-foreground" />
                    <span className="min-w-0 font-medium">
                      {h.to_machine_name || "—"} <span className="font-data text-[11.5px] font-normal text-muted-foreground">{h.to_ip}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
