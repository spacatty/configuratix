"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { api, type DomainCheckResponse } from "@/lib/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopyButton, Spinner, errorMessage } from "@/components/app";
import { cn } from "@/lib/utils";

/** Pretty-prints JSON bodies; anything else is shown as-is. */
function displayBody(body: string, headers: string | null): string {
  const json = /content-type:\s*[^\n]*json/i.test(headers ?? "") || /^\s*[{[]/.test(body);
  if (!json) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function headerValue(headers: string | null, name: string): string | null {
  const m = new RegExp(`^${name}:\\s*(.*)$`, "im").exec(headers ?? "");
  return m ? m[1].trim() : null;
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Collapsible view of what the last failed check got back: body (JSON pretty-printed) and
 * headers, in a scrollable box. Fetched when first opened, and again after a new check.
 */
export function CheckResponseDetails({
  domainId,
  checkedAt,
  defaultOpen = false,
  className,
}: {
  domainId: string;
  /** Refetches when this changes (the domain's last_check_at). */
  checkedAt?: string | null;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [tab, setTab] = React.useState<"body" | "headers">("body");
  const [data, setData] = React.useState<DomainCheckResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDomainCheckResponse(domainId)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, domainId, checkedAt]);

  const body = data?.body ?? "";
  const headers = data?.headers ?? "";
  const shown = tab === "body" ? displayBody(body, data?.headers ?? null) : headers;
  const contentType = headerValue(data?.headers ?? null, "content-type")?.split(";")[0];
  const location = headerValue(data?.headers ?? null, "location");

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-md border border-border", className)}>
      <CollapsibleTrigger className="group/resp flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-accent/50">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/resp:rotate-90" />
        <span className="font-medium">Response</span>
        {data && (
          <span className="font-data min-w-0 truncate text-[11.5px] text-muted-foreground">
            {[
              typeof data.status_code === "number" ? `HTTP ${data.status_code}` : null,
              contentType,
              data.body != null ? formatSize(new Blob([data.body]).size) + (data.truncated ? "+" : "") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {loading && <Spinner className="ml-auto size-3.5" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">
        {error ? (
          <p className="px-3 py-2.5 text-xs text-destructive">{error}</p>
        ) : !data ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">Loading…</p>
        ) : data.body == null && data.headers == null ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">
            {typeof data.status_code === "number"
              ? "The last check passed, so its response wasn't kept."
              : "No HTTP response was received, so there's nothing to show."}
          </p>
        ) : (
          <div className="space-y-2 p-2.5">
            {location && (
              <div className="font-data truncate px-0.5 text-[11.5px] text-muted-foreground">
                Redirects to <span className="text-foreground">{location}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-0.5 rounded-md bg-surface-2/60 p-0.5" role="tablist">
                {(["body", "headers"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[12px] capitalize transition-colors",
                      tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <CopyButton value={shown} label={`Copy ${tab}`} toastMessage={`Response ${tab} copied`} />
            </div>
            {shown ? (
              <pre className="font-data max-h-72 overflow-auto rounded-md border border-border bg-surface-2/40 p-3 text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-foreground/90">
                {shown}
              </pre>
            ) : (
              <p className="px-0.5 text-xs text-muted-foreground">Empty {tab === "body" ? "body" : "headers"}.</p>
            )}
            {tab === "body" && data.truncated && (
              <p className="px-0.5 text-[11.5px] text-muted-foreground">Only the first 32 KB of the body is kept.</p>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
