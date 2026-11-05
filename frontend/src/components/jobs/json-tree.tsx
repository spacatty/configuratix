"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Compact collapsible JSON viewer (no deps). Objects/arrays fold; long strings
 * (scripts, file contents) are clamped and expand on click.
 */
export function JsonTree({ value, defaultDepth = 2, className }: { value: unknown; defaultDepth?: number; className?: string }) {
  return (
    <div className={cn("font-data overflow-x-auto text-[12px] leading-[1.6]", className)}>
      <JsonNode value={value} depth={0} defaultDepth={defaultDepth} />
    </div>
  );
}

function JsonNode({ name, value, depth, defaultDepth, last = true }: { name?: string; value: unknown; depth: number; defaultDepth: number; last?: boolean }) {
  const isArr = Array.isArray(value);
  const isObj = !!value && typeof value === "object";
  const [open, setOpen] = React.useState(depth < defaultDepth);
  const comma = last ? "" : ",";
  const key =
    name !== undefined ? (
      <span className="text-info/90">
        {/^\d+$/.test(name) ? "" : `"${name}"`}
        {/^\d+$/.test(name) ? "" : ": "}
      </span>
    ) : null;

  if (!isObj) {
    return (
      <div className="pl-4">
        {key}
        <JsonScalar value={value} />
        <span className="text-subtle-foreground">{comma}</span>
      </div>
    );
  }

  const entries = isArr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  const [o, c] = isArr ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) {
    return (
      <div className="pl-4">
        {key}
        <span className="text-muted-foreground">
          {o}
          {c}
        </span>
        {comma}
      </div>
    );
  }
  return (
    <div className={depth === 0 ? "" : "pl-4"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="-ml-4 inline-flex items-center rounded-sm text-left outline-none hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <ChevronRight className={cn("size-3.5 text-subtle-foreground transition-transform", open && "rotate-90")} />
        {key}
        <span className="text-muted-foreground">{o}</span>
        {!open && (
          <span className="text-subtle-foreground">
            {" "}
            {isArr ? `${entries.length} items` : `${entries.length} keys`} {c}
            {comma}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="border-l border-border/60">
            {entries.map(([k, v], i) => (
              <JsonNode key={k} name={k} value={v} depth={depth + 1} defaultDepth={defaultDepth} last={i === entries.length - 1} />
            ))}
          </div>
          <div className="text-muted-foreground">
            {c}
            {comma}
          </div>
        </>
      )}
    </div>
  );
}

function JsonScalar({ value }: { value: unknown }) {
  const [expanded, setExpanded] = React.useState(false);
  if (value === null || value === undefined) return <span className="text-subtle-foreground">null</span>;
  if (typeof value === "boolean") return <span className="text-warning">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-success">{value}</span>;
  const s = String(value);
  const redacted = s === "••••••" || s.startsWith("[redacted");
  const long = s.length > 160 || s.includes("\n");
  if (redacted) return <span className="rounded bg-muted px-1 text-muted-foreground">{s}</span>;
  if (!long) return <span className="break-all text-foreground/90">&quot;{s}&quot;</span>;
  return (
    <span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {expanded ? "collapse" : `${s.split("\n").length} lines · ${s.length} chars`}
      </button>
      {expanded ? (
        <pre className="mt-1 mb-1 max-h-80 overflow-auto rounded border border-border bg-background/60 p-2 whitespace-pre-wrap text-foreground/90">{s}</pre>
      ) : (
        <span className="ml-2 break-all text-foreground/70">&quot;{s.slice(0, 80).replace(/\n/g, "⏎")}…&quot;</span>
      )}
    </span>
  );
}
