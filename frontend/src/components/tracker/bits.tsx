"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_COLOR, PALETTE } from "./utils";

/** Category emoji on a soft tint of its colour. User-chosen colours are data, so inline styles are fine here. */
export function CategoryGlyph({
  icon,
  color,
  size = "sm",
  className,
}: {
  icon?: string | null;
  color?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const c = color || DEFAULT_COLOR;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border",
        size === "sm" ? "size-6 text-xs" : "size-8 text-base",
        className
      )}
      style={{ backgroundColor: `${c}1f`, borderColor: `${c}40` }}
    >
      {icon || "📋"}
    </span>
  );
}

export function TagChip({
  name,
  color,
  onRemove,
  className,
  children,
}: {
  name: string;
  color?: string | null;
  onRemove?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const c = color || DEFAULT_COLOR;
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none font-medium",
        className
      )}
      style={{ backgroundColor: `${c}1a`, borderColor: `${c}40`, color: c }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: c }} />
      <span className="truncate">{name}</span>
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 rounded-full p-0.5 opacity-70 hover:bg-foreground/10 hover:opacity-100"
          aria-label={`Remove ${name}`}
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}

export function ColorSwatches({
  value,
  onChange,
  size = "md",
  colors = PALETTE,
}: {
  value: string;
  onChange: (c: string) => void;
  size?: "sm" | "md";
  colors?: string[];
}) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
      {colors.map((c) => {
        const on = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c}
            onClick={() => onChange(c)}
            className={cn(
              "flex items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-popover transition-transform focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "size-4" : "size-6",
              on ? "ring-2 ring-foreground/70" : "hover:scale-110"
            )}
            style={{ backgroundColor: c }}
          >
            {on && size === "md" && <Check className="size-3 text-white" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

/** Markdown with design-system styling (no typography plugin in this app). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "space-y-2 text-[13px] leading-relaxed break-words",
        "[&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline",
        "[&_code]:font-data [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:text-[12px]",
        "[&_pre]:font-data [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-2 [&_pre]:p-2 [&_pre]:text-[12px]",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-medium",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        className
      )}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
