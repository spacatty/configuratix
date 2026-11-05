"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { EM_DASH, formatDateTime, formatRelative, toDate } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/* -------------------------------------------------------------------------- */
/* Mono                                                                       */
/* -------------------------------------------------------------------------- */

export interface MonoProps extends React.ComponentProps<"span"> {
  /** Dim the text (secondary data). */
  muted?: boolean;
  /** Truncate with ellipsis (set a max-w via className). */
  truncate?: boolean;
  /** Rendered when children is null/undefined/"" (default "—"). */
  fallback?: React.ReactNode;
}

/** Monospace + tabular figures for IPs, hostnames, IDs, versions, durations. */
export function Mono({ muted, truncate, fallback = EM_DASH, className, children, ...props }: MonoProps) {
  const empty = children === null || children === undefined || children === "";
  return (
    <span
      data-slot="mono"
      className={cn(
        "font-data text-[12.5px]",
        muted || empty ? "text-muted-foreground" : "text-foreground",
        truncate && "inline-block max-w-full truncate align-bottom",
        className
      )}
      {...props}
    >
      {empty ? fallback : children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* CopyButton                                                                 */
/* -------------------------------------------------------------------------- */

export interface CopyButtonProps extends Omit<React.ComponentProps<"button">, "value" | "onCopy"> {
  value: string | null | undefined;
  /** Toast text on success; false to suppress toast. Default: "Copied to clipboard". */
  toastMessage?: string | false;
  /** Tooltip label. Default "Copy". */
  label?: string;
  size?: "xs" | "sm" | "md";
  onCopied?: () => void;
}

/** Icon button that copies `value`; shows a check for 1.5s. */
export function CopyButton({
  value,
  toastMessage = "Copied to clipboard",
  label = "Copy",
  size = "xs",
  className,
  onCopied,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const dim = size === "xs" ? "size-5 [&_svg]:size-3" : size === "sm" ? "size-6 [&_svg]:size-3.5" : "size-7 [&_svg]:size-4";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={!value}
          onClick={async (e) => {
            e.stopPropagation();
            if (!value) return;
            const ok = await copyToClipboard(value);
            if (ok) {
              setCopied(true);
              onCopied?.();
              if (toastMessage) toast.success(toastMessage);
            } else {
              toast.error("Could not copy to clipboard");
            }
          }}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 outline-none disabled:opacity-40",
            dim,
            className
          )}
          {...props}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}

/** Mono value followed by a copy button — the standard way to show an IP/ID. */
export function CopyableMono({
  value,
  display,
  className,
  monoClassName,
  copyLabel,
}: {
  value: string | null | undefined;
  /** What to render (defaults to value). E.g. shortId(id). */
  display?: React.ReactNode;
  className?: string;
  monoClassName?: string;
  copyLabel?: string;
}) {
  return (
    <span className={cn("group/copy inline-flex min-w-0 items-center gap-1", className)}>
      <Mono truncate className={monoClassName}>
        {display ?? value}
      </Mono>
      {value ? (
        <CopyButton
          value={value}
          label={copyLabel}
          className="opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-60"
        />
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* RelativeTime                                                               */
/* -------------------------------------------------------------------------- */

// One shared ticker for every <RelativeTime/> on the page.
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;
function subscribeTick(cb: () => void) {
  listeners.add(cb);
  if (!ticker) ticker = setInterval(() => listeners.forEach((l) => l()), 15_000);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}
function useNow() {
  return React.useSyncExternalStore(
    subscribeTick,
    () => Math.floor(Date.now() / 15_000),
    () => 0
  );
}

export interface RelativeTimeProps extends Omit<React.ComponentProps<"time">, "dateTime"> {
  date: string | number | Date | null | undefined;
  /** Shown when date is missing. Default "—"; e.g. "Never". */
  fallback?: React.ReactNode;
  /** Hide tooltip with the absolute timestamp. */
  noTooltip?: boolean;
  /** Render as mono data text (default true). */
  mono?: boolean;
}

/** "3m ago" with an absolute-time tooltip; re-renders every 15s. */
export function RelativeTime({ date, fallback = EM_DASH, noTooltip, mono = true, className, ...props }: RelativeTimeProps) {
  const tick = useNow();
  const d = toDate(date);
  if (!d) return <span className={cn("text-muted-foreground", className)}>{fallback}</span>;
  // tick === 0 during SSR + hydration (absolute time, deterministic); relative afterwards
  const text = tick === 0 ? formatDateTime(d, false) : formatRelative(d);
  const node = (
    <time
      dateTime={d.toISOString()}
      className={cn(mono && "font-data text-[12.5px]", "whitespace-nowrap", className)}
      suppressHydrationWarning
      {...props}
    >
      {text}
    </time>
  );
  if (noTooltip) return node;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent>
        <span className="font-data">{formatDateTime(d)}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/* KeyValue                                                                   */
/* -------------------------------------------------------------------------- */

export interface KeyValueItem {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Render value in mono. */
  mono?: boolean;
  /** Copy button next to value (string to copy). */
  copy?: string | null;
  /** Hint under the label/value. */
  hint?: React.ReactNode;
  /** Span full width in a multi-column grid. */
  full?: boolean;
  hidden?: boolean;
}

export interface KeyValueListProps extends React.ComponentProps<"dl"> {
  items: KeyValueItem[];
  /** 1 (default) = label left / value right rows; 2|3 = stacked label-over-value grid. */
  columns?: 1 | 2 | 3;
  /** Label column width for columns=1. Default 140px. */
  labelWidth?: number;
}

/** Description list for detail panels. */
export function KeyValueList({ items, columns = 1, labelWidth = 140, className, ...props }: KeyValueListProps) {
  const visible = items.filter((i) => !i.hidden);
  if (columns === 1) {
    return (
      <dl data-slot="key-value" className={cn("divide-y divide-border/70 text-[13px]", className)} {...props}>
        {visible.map((it, i) => (
          <div
            key={i}
            className="grid items-start gap-3 py-2 first:pt-0 last:pb-0"
            style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}
          >
            <dt className="pt-px text-muted-foreground">{it.label}</dt>
            <dd className="min-w-0">
              <KeyValueValue item={it} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl
      data-slot="key-value"
      className={cn(
        "grid gap-x-6 gap-y-4 text-[13px]",
        columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
      {...props}
    >
      {visible.map((it, i) => (
        <div key={i} className={cn("min-w-0 space-y-1", it.full && "col-span-full")}>
          <dt className="text-xs text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0">
            <KeyValueValue item={it} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function KeyValueValue({ item }: { item: KeyValueItem }) {
  const empty = item.value === null || item.value === undefined || item.value === "";
  const content = empty ? (
    <span className="text-muted-foreground">{EM_DASH}</span>
  ) : item.mono ? (
    <Mono className="break-all">{item.value}</Mono>
  ) : (
    item.value
  );
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="group/copy flex min-w-0 items-center gap-1">
        <div className="min-w-0 break-words">{content}</div>
        {item.copy ? <CopyButton value={item.copy} className="opacity-60 group-hover/copy:opacity-100" /> : null}
      </div>
      {item.hint ? <div className="text-xs text-muted-foreground">{item.hint}</div> : null}
    </div>
  );
}
