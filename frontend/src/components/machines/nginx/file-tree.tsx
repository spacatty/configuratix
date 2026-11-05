"use client";

import * as React from "react";
import {
  AlertTriangle,
  Archive,
  ChevronRight,
  FileCode2,
  FileMinus2,
  FilePlus2,
  FileX2,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STATE_LABEL, type ExplorerFile, type ExplorerGroup } from "./model";

export interface FileTreeHandlers {
  onAddCategory?: () => void;
  onEditCategory?: (g: ExplorerGroup) => void;
  onDeleteCategory?: (g: ExplorerGroup) => void;
  onAddPath?: (g: ExplorerGroup) => void;
  onEditPath?: (g: ExplorerGroup, f: ExplorerFile) => void;
  onRemovePath?: (g: ExplorerGroup, f: ExplorerFile) => void;
}

function fileIcon(f: ExplorerFile) {
  if (f.state === "missing") return <FileX2 className="size-3.5 text-warning" />;
  if (f.drift) return <AlertTriangle className="size-3.5 text-warning" />;
  if (f.state === "backup") return <Archive className="size-3.5 text-subtle-foreground" />;
  if (f.state === "disabled" || f.state === "inactive") return <FileMinus2 className="size-3.5 text-subtle-foreground" />;
  if (f.linkTarget) return <Link2 className="size-3.5 text-muted-foreground" />;
  return <FileCode2 className="size-3.5 text-muted-foreground" />;
}

function FileRow({
  f,
  selected,
  onSelect,
  menu,
  depth = 0,
}: {
  f: ExplorerFile;
  selected: boolean;
  onSelect: () => void;
  menu?: React.ReactNode;
  depth?: number;
}) {
  const dim = f.state === "backup" || f.state === "disabled" || f.state === "inactive";
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      tabIndex={-1}
      data-key={f.key}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      className={cn(
        "group/file relative flex h-7 cursor-pointer items-center gap-2 rounded-md pr-1 text-[12.5px] transition-colors",
        selected ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-surface-2/70 hover:text-foreground"
      )}
      style={{ paddingLeft: 10 + depth * 12 }}
    >
      {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-[2px] rounded-r bg-primary" />}
      {fileIcon(f)}
      <span className={cn("font-data min-w-0 flex-1 truncate", dim && "text-subtle-foreground", f.state === "missing" && "italic")} title={f.path}>
        {f.name}
      </span>
      {f.managed && f.state !== "missing" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="size-1.5 shrink-0 rounded-full bg-info/80" aria-label="Managed by Configuratix" />
          </TooltipTrigger>
          <TooltipContent side="right">Managed by Configuratix</TooltipContent>
        </Tooltip>
      )}
      {f.state !== "active" && (
        <span
          className={cn(
            "shrink-0 rounded-[3px] px-1 text-[10px] leading-4",
            f.state === "missing" ? "bg-warning/12 text-warning" : "bg-surface-2 text-subtle-foreground"
          )}
        >
          {STATE_LABEL[f.state]}
        </span>
      )}
      {f.drift && f.state !== "missing" && <span className="shrink-0 rounded-[3px] bg-warning/12 px-1 text-[10px] leading-4 text-warning">drift</span>}
      {menu}
    </div>
  );
}

export function FileTree({
  groups,
  selectedKey,
  onSelect,
  filter,
  showBackups,
  handlers,
}: {
  groups: ExplorerGroup[];
  selectedKey: string | null;
  onSelect: (f: ExplorerFile, g: ExplorerGroup) => void;
  filter: string;
  showBackups: boolean;
  handlers: FileTreeHandlers;
}) {
  const q = filter.trim().toLowerCase();
  const match = React.useCallback(
    (f: ExplorerFile) => (showBackups || f.state !== "backup" || f.key === selectedKey) && (!q || f.path.toLowerCase().includes(q) || (f.domainFqdn ?? "").toLowerCase().includes(q)),
    [q, showBackups, selectedKey]
  );
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const nginxGroups = groups.filter((g) => g.kind === "nginx");
  const otherGroups = groups.filter((g) => g.kind !== "nginx");

  const renderGroup = (g: ExplorerGroup) => {
    const files = g.files.filter(match);
    const subs = (g.subgroups ?? []).map((s) => ({ ...s, files: s.files.filter(match) })).filter((s) => s.files.length > 0);
    const total = files.length + subs.reduce((n, s) => n + s.files.length, 0);
    const isCustom = g.kind === "custom";
    if (total === 0 && (q || !isCustom)) return null;
    const open = q ? true : !closed.has(g.id);
    const drift = g.files.filter((f) => f.drift || f.state === "missing").length;

    const pathMenu = (f: ExplorerFile) =>
      isCustom && f.legacy?.pathId ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover/file:opacity-100 data-[state=open]:opacity-100"
              onClick={(e) => e.stopPropagation()}
              aria-label="Path actions"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => handlers.onEditPath?.(g, f)}>
              <Pencil />
              Edit path
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => handlers.onRemovePath?.(g, f)}>
              <Trash2 />
              Remove from category
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null;

    return (
      <Collapsible key={g.id} open={open} onOpenChange={() => toggle(g.id)}>
        <div className="group/grp flex items-center gap-1 pr-1">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] font-medium text-foreground/90 hover:bg-surface-2/50"
              title={g.description}
            >
              <ChevronRight className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")} />
              {g.custom?.emoji && <span className="text-[11px]">{g.custom.emoji}</span>}
              <span className="truncate">{g.label}</span>
              <span className="font-data ml-1 text-[10.5px] font-normal text-subtle-foreground">{total}</span>
              {drift > 0 && (
                <span className="font-data ml-auto inline-flex items-center gap-0.5 text-[10.5px] font-normal text-warning">
                  <AlertTriangle className="size-3" />
                  {drift}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          {isCustom && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover/grp:opacity-100 data-[state=open]:opacity-100" aria-label="Category actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handlers.onAddPath?.(g)}>
                  <FilePlus2 />
                  Add file path
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handlers.onEditCategory?.(g)}>
                  <Pencil />
                  Edit category
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => handlers.onDeleteCategory?.(g)}>
                  <Trash2 />
                  Delete category
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <CollapsibleContent className="space-y-px pb-1">
          {files.map((f) => (
            <FileRow key={f.key} f={f} selected={selectedKey === f.key} onSelect={() => onSelect(f, g)} menu={pathMenu(f)} depth={1} />
          ))}
          {subs.map((s) => (
            <div key={s.id}>
              <div className="flex h-6 items-center pl-[22px] text-[11px] text-subtle-foreground">{s.label}</div>
              {s.files.map((f) => (
                <FileRow key={f.key} f={f} selected={selectedKey === f.key} onSelect={() => onSelect(f, g)} menu={pathMenu(f)} depth={2} />
              ))}
            </div>
          ))}
          {isCustom && total === 0 && (
            <button
              type="button"
              onClick={() => handlers.onAddPath?.(g)}
              className="flex h-7 w-full items-center gap-1.5 pl-[22px] text-[12px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add file path…
            </button>
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const nginxRendered = nginxGroups.map(renderGroup).filter(Boolean);
  const otherRendered = otherGroups.map(renderGroup).filter(Boolean);

  return (
    <div role="tree" className="space-y-3 text-[13px]">
      {nginxRendered.length > 0 && (
        <div className="space-y-0.5">
          <div className="px-2 pb-1 text-[11px] text-subtle-foreground">nginx</div>
          {nginxRendered}
        </div>
      )}
      {(otherRendered.length > 0 || handlers.onAddCategory) && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[11px] text-subtle-foreground">Other configs</span>
            {handlers.onAddCategory && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={handlers.onAddCategory} aria-label="New category">
                    <FolderPlus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New custom category</TooltipContent>
              </Tooltip>
            )}
          </div>
          {otherRendered}
        </div>
      )}
      {nginxRendered.length === 0 && otherRendered.length === 0 && (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">{q ? "No files match." : "No files."}</div>
      )}
    </div>
  );
}
