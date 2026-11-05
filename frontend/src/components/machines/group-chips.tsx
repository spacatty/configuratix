"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
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
export function GroupChips({
  groups,
  max = 2,
  className,
  onEdit,
}: {
  groups: MachineGroupRef[];
  max?: number;
  className?: string;
  /** Makes the cell editable (click to change; "+ Group" when empty). */
  onEdit?: () => void;
}) {
  if (onEdit) {
    return (
      <EditableGroups empty={groups.length === 0} label="Edit groups" onEdit={onEdit}>
        <GroupChips groups={groups} max={max} className={cn("flex-nowrap", className)} />
      </EditableGroups>
    );
  }
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
