"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Label + control + hint / inline error. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  warning,
  className,
  children,
  optional,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  warning?: string;
  className?: string;
  children: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
        {optional && <span className="ml-1 font-normal text-subtle-foreground">optional</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : warning ? (
        <p className="text-xs text-warning">{warning}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Flat toggle row: title + description on the left, Switch on the right.
 * Children (shown when on) sit underneath, indented to the title, with no box
 * around them. Stack rows inside <SwitchList> to get dividers between them.
 */
export function SwitchRow({
  id,
  title,
  description,
  checked,
  onCheckedChange,
  children,
  icon: Icon,
  className,
  disabled,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0 transition-colors", checked ? "text-foreground" : "text-subtle-foreground")} />}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-5 font-medium">{title}</span>
          {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>}
        </span>
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
      </label>
      {checked && children && <div className={cn("mt-3 space-y-4 border-l border-border-strong pl-4", Icon ? "ml-[7px]" : "ml-0")}>{children}</div>}
    </div>
  );
}

/** Vertical stack of SwitchRows separated by hairlines. */
export function SwitchList({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("divide-y divide-border [&>*]:py-3.5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0", className)}>{children}</div>;
}

/**
 * Segmented single-choice control with the selected option's description
 * underneath. Replaces a grid of radio cards for short option sets.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: LucideIcon; description?: React.ReactNode }[];
  label?: string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className={cn("space-y-2", className)}>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onValueChange(v as T)}
        aria-label={label}
        className="flex max-w-full flex-wrap"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className="px-3">
            {o.icon && <o.icon className="size-3.5" />}
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {current?.description && <p className="text-xs leading-relaxed text-muted-foreground">{current.description}</p>}
    </div>
  );
}

/**
 * One editor section: a block inside the editor panel, separated from its
 * neighbours by a rule. Anchor id is used by the section bar.
 */
export function EditorSection({
  id,
  title,
  description,
  actions,
  children,
  flush,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Body runs edge-to-edge (tables). */
  flush?: boolean;
}) {
  return (
    <section
      id={`section-${id}`}
      data-section={id}
      className={cn("scroll-mt-28 border-t border-border pt-6 first:border-t-0 first:pt-5", flush ? "pb-1" : "pb-6")}
    >
      <header className="flex items-start justify-between gap-4 px-5">
        <div className="min-w-0">
          <h2 className="text-sm leading-5 font-semibold tracking-[-0.01em]">{title}</h2>
          {description && <p className="mt-1 max-w-[62ch] text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("mt-5 space-y-5", !flush && "px-5")}>{children}</div>
    </section>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-data rounded bg-muted px-1 py-px text-[11.5px] text-foreground/90">{children}</code>;
}
