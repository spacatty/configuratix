"use client";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MachineGroupRef } from "./utils";

export function GroupChip({ group, className }: { group: MachineGroupRef; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-[140px] items-center gap-1 rounded-[4px] border border-border bg-surface-2/60 px-1.5 text-[11px] text-muted-foreground",
        className
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: group.color || "var(--muted-foreground)" }}
        aria-hidden
      />
      {group.emoji && <span className="text-[10px] leading-none">{group.emoji}</span>}
      <span className="truncate">{group.name}</span>
    </span>
  );
}

/** Compact chip list: first `max` chips, then a "+N" chip with a tooltip of the rest. */
export function GroupChips({ groups, max = 2, className }: { groups: MachineGroupRef[]; max?: number; className?: string }) {
  if (groups.length === 0) return <span className="text-xs text-subtle-foreground">—</span>;
  const shown = groups.slice(0, max);
  const rest = groups.slice(max);
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.map((g) => (
        <GroupChip key={g.id} group={g} />
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex h-5 items-center rounded-[4px] border border-border px-1.5 text-[11px] text-muted-foreground">
              +{rest.length}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{rest.map((g) => g.name).join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
