"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

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

/** Row with title + description on the left and a Switch on the right; children shown when on. */
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
    <div className={cn("rounded-lg border border-border bg-card/40 transition-colors", checked && children && "border-border-strong", className)}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 px-3.5 py-3">
        {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", checked ? "text-foreground" : "text-muted-foreground")} />}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{title}</span>
          {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
        </span>
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
      </label>
      {checked && children && <div className="space-y-4 border-t border-border px-3.5 py-3.5">{children}</div>}
    </div>
  );
}

/** One editor section with anchor id for the side nav. */
export function EditorSection({
  id,
  title,
  description,
  icon: Icon,
  actions,
  children,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={`section-${id}`} data-section={id} className="scroll-mt-20 rounded-lg border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <h2 className="text-sm font-medium">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-data rounded bg-muted px-1 py-px text-[11.5px] text-foreground/90">{children}</code>;
}
