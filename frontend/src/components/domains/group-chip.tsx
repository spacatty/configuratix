"use client";

import type { DomainGroup } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Compact group label: colour swatch + emoji + name. Colour is user data, not status. */
export function GroupChip({
  group,
  className,
  compact,
}: {
  group: Pick<DomainGroup, "name" | "emoji" | "color">;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-[140px] shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2/60 px-1.5 text-[11px] text-foreground",
        className
      )}
      title={group.name}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
      {!compact && group.emoji && <span className="leading-none">{group.emoji}</span>}
      <span className="truncate">{group.name}</span>
    </span>
  );
}

/** Up to `max` chips, then "+N". */
export function GroupChips({
  groups,
  max = 2,
}: {
  groups: Pick<DomainGroup, "id" | "name" | "emoji" | "color">[];
  max?: number;
}) {
  if (!groups.length) return <span className="text-muted-foreground">—</span>;
  const shown = groups.slice(0, max);
  const rest = groups.length - shown.length;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.map((g) => (
        <GroupChip key={g.id} group={g} compact />
      ))}
      {rest > 0 && (
        <span className="font-data text-[11px] text-muted-foreground" title={groups.slice(max).map((g) => g.name).join(", ")}>
          +{rest}
        </span>
      )}
    </span>
  );
}
