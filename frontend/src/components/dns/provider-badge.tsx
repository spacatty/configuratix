"use client";

import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/app";

import { nsMeta, providerMeta } from "./dns-utils";

/** Neutral monogram tile for a DNS provider (no brand colours — calm console). */
export function ProviderLogo({ provider, size = "md", className }: { provider: string | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  const meta = providerMeta(provider);
  const dim = size === "sm" ? "size-5 text-[9px]" : size === "lg" ? "size-9 text-[12px]" : "size-7 text-[10.5px]";
  return (
    <span
      aria-hidden
      className={cn(
        "font-data inline-flex shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-2 font-semibold tracking-tight text-foreground",
        dim,
        className
      )}
    >
      {meta?.mark ?? "··"}
    </span>
  );
}

/** Logo + provider label (+ account name). */
export function ProviderLabel({
  provider,
  account,
  className,
}: {
  provider: string | null | undefined;
  account?: string | null;
  className?: string;
}) {
  const meta = providerMeta(provider);
  if (!provider && !account) return <span className="text-muted-foreground">Manual</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <ProviderLogo provider={provider} size="sm" />
      <span className="min-w-0 truncate text-[13px]">
        {account ?? meta?.label}
        {account && meta && <span className="ml-1.5 text-xs text-muted-foreground">{meta.label}</span>}
      </span>
    </span>
  );
}

export function NSBadge({ status }: { status: string | null | undefined }) {
  const m = nsMeta(status);
  return <StatusBadge status={status ?? "unknown"} tone={m.tone} label={m.label} />;
}
