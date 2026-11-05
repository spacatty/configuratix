"use client";

import * as React from "react";

import type { HealthCheckRules } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { pathError, statusSpecError } from "./domain-utils";

const QUICK_STATUSES = ["200", "2xx", "204", "301", "302", "401", "403", "404"];

function specTokens(spec: string): string[] {
  return spec.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/**
 * Path, accepted statuses, body match and timeout. `host` is shown before the path
 * (a domain for one domain, a placeholder for presets and bulk edits).
 */
export function HealthCheckRulesFields({
  value,
  onChange,
  host,
  idPrefix = "hc",
  disabled,
}: {
  value: HealthCheckRules;
  onChange: (next: HealthCheckRules) => void;
  host?: string;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const set = <K extends keyof HealthCheckRules>(k: K, v: HealthCheckRules[K]) => onChange({ ...value, [k]: v });
  const pErr = pathError(value.path);
  const sErr = statusSpecError(value.expected);
  const tokens = specTokens(value.expected);

  const toggleStatus = (code: string) => {
    const next = tokens.includes(code) ? tokens.filter((t) => t !== code) : [...tokens, code];
    set("expected", next.join(","));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-path`}>Path</Label>
        <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring/40">
          <span className="font-data max-w-[50%] shrink-0 truncate pl-3 text-[12px] text-subtle-foreground">
            https://{host ?? "<domain>"}
          </span>
          <Input
            id={`${idPrefix}-path`}
            className="font-data border-0 pl-0.5 focus-visible:ring-0"
            value={value.path}
            aria-invalid={!!pErr}
            placeholder="/"
            disabled={disabled}
            onChange={(e) => set("path", e.target.value.trim() || "/")}
          />
        </div>
        {pErr && <p className="text-xs text-destructive">{pErr}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-expected`}>Accepted status</Label>
        <Input
          id={`${idPrefix}-expected`}
          className="font-data"
          value={value.expected}
          aria-invalid={!!sErr}
          placeholder="200"
          disabled={disabled}
          onChange={(e) => set("expected", e.target.value.replace(/[^\dxX,\-\s]/g, ""))}
        />
        <div className="flex flex-wrap gap-1">
          {QUICK_STATUSES.map((c) => {
            const on = tokens.includes(c);
            return (
              <button
                key={c}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => toggleStatus(c)}
                className={cn(
                  "font-data rounded-md border px-2 py-0.5 text-[12px] transition-colors",
                  on
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {c}
              </button>
            );
          })}
        </div>
        <p className={cn("text-xs", sErr ? "text-destructive" : "text-muted-foreground")}>
          {sErr ?? "Comma-separated codes, ranges (200-299) or classes (2xx). 401/403 for protected apps, 301/302 when the root redirects."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-body`}>
            Body contains <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`${idPrefix}-body`}
            className="font-data"
            value={value.body_contains}
            placeholder={'"status":"ok"'}
            maxLength={512}
            disabled={disabled}
            onChange={(e) => set("body_contains", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-timeout`}>Timeout</Label>
          <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring/40">
            <Input
              id={`${idPrefix}-timeout`}
              inputMode="numeric"
              className="font-data border-0 focus-visible:ring-0"
              value={String(value.timeout_seconds || "")}
              aria-invalid={value.timeout_seconds < 1 || value.timeout_seconds > 60}
              disabled={disabled}
              onChange={(e) => set("timeout_seconds", Number(e.target.value.replace(/\D/g, "").slice(0, 2)) || 0)}
            />
            <span className="pr-3 text-[12px] text-subtle-foreground">sec</span>
          </div>
        </div>
      </div>
    </div>
  );
}
