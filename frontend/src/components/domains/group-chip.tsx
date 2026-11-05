"use client";

import * as React from "react";
import type { DomainGroup } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Compact tag tinted with the group colour; emoji when set, otherwise a colour dot. Colour is user data, not status. */
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
      className={cn("inline-flex h-[18px] max-w-[110px] shrink-0 items-center gap-1 rounded-[3px] px-1 text-[10.5px] leading-none text-foreground/85", className)}
      style={{ backgroundColor: `color-mix(in oklch, ${group.color || "var(--muted-foreground)"} 16%, transparent)` }}
      title={group.name}
    >
      {!compact && group.emoji ? (
        <span className="text-[9.5px] leading-none">{group.emoji}</span>
      ) : (
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: group.color || "var(--muted-foreground)" }} />
      )}
      <span className="truncate">{group.name}</span>
    </span>
  );
}

/** Table group list — same dot + text look as the machines table. */
export { GroupChips } from "@/components/machines/group-chips";
