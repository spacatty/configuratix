"use client";

import * as React from "react";
import { Check, Eye, EyeOff, Wand2, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Label + control + hint / inline error. Wires aria-describedby / aria-invalid onto the child. */
export function FormField({
  id,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = React.cloneElement(children, {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  });
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        {optional && <span className="text-xs font-normal text-subtle-foreground">optional</span>}
      </Label>
      {control}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Password input with reveal toggle and optional "generate" button. */
export function PasswordInput({
  onGenerate,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & { onGenerate?: (pw: string) => void }) {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        className={cn(shown && "font-data", onGenerate ? "pr-16" : "pr-9", className)}
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {onGenerate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Generate password"
                onClick={() => {
                  onGenerate(generatePassword());
                  setShown(true);
                }}
              >
                <Wand2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Generate a strong password</TooltipContent>
          </Tooltip>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    </div>
  );
}

const PW_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_!@#%";

export function generatePassword(length = 20): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PW_ALPHABET[b % PW_ALPHABET.length]).join("");
}

export const MIN_PASSWORD_LENGTH = 8;

/** Compact live checklist of password rules. */
export function PasswordRules({ rules }: { rules: { label: string; ok: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {rules.map((r) => (
        <li key={r.label} className={cn("flex items-center gap-1", r.ok ? "text-success" : "text-muted-foreground")}>
          {r.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          {r.label}
        </li>
      ))}
    </ul>
  );
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Two-letter initials avatar (neutral). */
export function InitialsAvatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-medium text-muted-foreground",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-7 text-[11px]",
        size === "lg" && "size-12 text-base",
        className
      )}
    >
      {initials}
    </span>
  );
}
