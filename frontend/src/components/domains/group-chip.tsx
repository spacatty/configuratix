"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
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
  onEdit,
}: {
  groups: Pick<DomainGroup, "id" | "name" | "emoji" | "color">[];
  max?: number;
  /** Makes the cell editable (click to change; "+ Group" when empty). */
  onEdit?: () => void;
}) {
  if (onEdit) {
    return (
      <EditableGroups empty={groups.length === 0} label="Edit groups" onEdit={onEdit}>
        <GroupChips groups={groups} max={max} />
      </EditableGroups>
    );
  }
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

/** Makes a groups cell editable: dashed "+ Group" when empty, clickable chips otherwise. */
function EditableGroups({ empty, label, onEdit, children }: { empty: boolean; label: string; onEdit: () => void; children?: React.ReactNode }) {
  if (empty) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-border-strong px-2 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 outline-none"
      >
        <Plus className="size-3" />
        Group
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={label}
      className="group/groups -mx-1 inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {children}
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/groups:opacity-100" />
    </button>
  );
}
