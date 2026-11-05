"use client";

import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";

export interface AuthCardProps extends Omit<React.ComponentProps<"div">, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small icon tile above the title (e.g. ShieldCheck for 2FA). */
  icon?: LucideIcon;
  /** Muted row under the card body (links like "Sign up"). */
  footer?: React.ReactNode;
}

/** Card used by every (auth) page. The (auth) layout supplies background + centering. */
export function AuthCard({ title, description, icon: Icon, footer, className, children, ...props }: AuthCardProps) {
  return (
    <div className={cn("w-full max-w-[400px] animate-fade-in-up", className)} {...props}>
      <Link href="/" className="mb-8 flex justify-center outline-none">
        <Logo size="md" glow />
      </Link>
      <div className="overflow-hidden rounded-xl border border-border-strong bg-card/90 shadow-elevated">
        <div aria-hidden className="h-px bg-[linear-gradient(90deg,transparent,var(--primary-glow),transparent)]" />
        <div className="px-6 pt-6 pb-6">
          <div className="mb-6 space-y-1.5">
            {Icon && (
              <div className="mb-4 flex size-9 items-center justify-center rounded-lg border border-border-strong bg-surface-2 text-foreground">
                <Icon className="size-4" />
              </div>
            )}
            <h1 className="text-lg leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
            {description && <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {children}
        </div>
        {footer && (
          <div className="border-t border-border bg-white/[0.015] px-6 py-3.5 text-center text-[13px] text-muted-foreground">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Label + control + hint/error, vertically stacked. */
export function AuthField({
  label,
  htmlFor,
  hint,
  aside,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-[13px] font-medium">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-[13px] text-destructive">
      {children}
    </div>
  );
}
