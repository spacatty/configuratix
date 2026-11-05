"use client";

import * as React from "react";
import { ArrowDownToLine, WrapText } from "lucide-react";

import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/app/data-display";
import { Spinner } from "@/components/app/states";

export interface LogViewerProps {
  /** Raw log text (newline separated). */
  logs: string | null | undefined;
  /** Shows a live indicator and keeps auto-scroll pinned while new lines arrive. */
  live?: boolean;
  /** Max height of the scroll area. Default 420px. Use "100%" inside flex layouts. */
  maxHeight?: number | string;
  emptyText?: React.ReactNode;
  className?: string;
  /** Toolbar title on the left. Default "Output". */
  title?: React.ReactNode;
  /** Extra toolbar buttons (right side, before copy). */
  actions?: React.ReactNode;
}

function lineTone(line: string): string | undefined {
  const l = line.toLowerCase();
  if (/(^|\W)(error|fatal|failed|panic|denied|emerg|crit)(\W|$)/.test(l)) return "text-destructive";
  if (/(^|\W)(warn|warning|deprecated)(\W|$)/.test(l)) return "text-warning";
  if (/(^|\W)(success|succeeded|completed|done|ok|syntax is ok|test is successful)(\W|$)/.test(l)) return "text-success";
  if (/^\s*(\$|#|>)\s/.test(line)) return "text-info";
  return undefined;
}

/** Terminal-style log viewer: line numbers, level colouring, sticky auto-scroll, wrap toggle, copy. */
export function LogViewer({
  logs,
  live,
  maxHeight = 420,
  emptyText = "No output yet.",
  className,
  title = "Output",
  actions,
}: LogViewerProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [stick, setStick] = React.useState(true);
  const [wrap, setWrap] = React.useState(true);
  const lines = React.useMemo(() => (logs ? logs.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : []), [logs]);

  React.useEffect(() => {
    const el = ref.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [lines.length, stick, logs]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStick(atBottom);
  };

  const gutter = String(lines.length).length;

  return (
    <div
      data-slot="log-viewer"
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-[oklch(0.115_0.004_20)]", className)}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/90">{title}</span>
        {live && (
          <span className="inline-flex items-center gap-1.5 text-info">
            <Spinner className="size-3" /> live
          </span>
        )}
        <span className="font-data text-subtle-foreground">{lines.length ? `${lines.length} lines` : ""}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {actions}
          {!stick && lines.length > 0 && (
            <button
              type="button"
              onClick={() => setStick(true)}
              className="inline-flex h-5 items-center gap-1 rounded-[5px] px-1.5 hover:bg-accent hover:text-foreground"
            >
              <ArrowDownToLine className="size-3" /> Follow
            </button>
          )}
          <button
            type="button"
            aria-pressed={wrap}
            aria-label="Toggle line wrap"
            onClick={() => setWrap((w) => !w)}
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-[5px] hover:bg-accent hover:text-foreground",
              wrap && "text-foreground"
            )}
          >
            <WrapText className="size-3" />
          </button>
          <CopyButton value={logs ?? ""} label="Copy logs" toastMessage="Logs copied" />
        </div>
      </div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto py-2"
        style={{ maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight }}
      >
        {lines.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyText}</div>
        ) : (
          <pre className={cn("font-data text-[12px] leading-[1.6]", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-white/[0.025]">
                <span
                  aria-hidden
                  className="sticky left-0 shrink-0 bg-[oklch(0.115_0.004_20)] pr-3 pl-3 text-right text-subtle-foreground/70 select-none"
                  style={{ minWidth: `${gutter + 3}ch` }}
                >
                  {i + 1}
                </span>
                <span className={cn("min-w-0 flex-1 pr-3", lineTone(line) ?? "text-foreground/90")}>{line || " "}</span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
