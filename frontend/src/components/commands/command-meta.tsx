"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Cog, Code2, FileCode, FileText, Flame, Shield, Terminal } from "lucide-react";
import type { CommandStep, CommandTemplate, VariableDef } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

export const CATEGORY_META: Record<string, { label: string; icon: LucideIcon; order: number }> = {
  system: { label: "System", icon: Cog, order: 0 },
  security: { label: "Security", icon: Shield, order: 1 },
  firewall: { label: "Firewall", icon: Flame, order: 2 },
  nginx: { label: "Nginx", icon: FileCode, order: 3 },
  php: { label: "PHP", icon: Code2, order: 4 },
  files: { label: "Files", icon: FileText, order: 5 },
};

export function categoryMeta(category: string) {
  return (
    CATEGORY_META[category] ?? {
      label: category ? category[0].toUpperCase() + category.slice(1) : "Other",
      icon: Terminal,
      order: 99,
    }
  );
}

export function OnErrorBadge({ value }: { value: string }) {
  const variant = value === "rollback" ? "warning" : value === "stop" ? "secondary" : "muted";
  const label = value === "rollback" ? "Rolls back on error" : value === "stop" ? "Stops on error" : "Continues on error";
  return (
    <Badge variant={variant} title={label}>
      on error: {value}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* Variable validation                                                        */
/* -------------------------------------------------------------------------- */

export function validateVariable(v: VariableDef, raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return v.required ? "Required" : null;
  if (v.type === "int") {
    if (!/^-?\d+$/.test(value)) return "Must be a whole number";
    const n = Number(value);
    if (/port/i.test(v.name) && (n < 1 || n > 65535)) return "Port must be 1 – 65535";
    const m = v.description.match(/\((\d+)\s*[-–]\s*(\d+)\)/);
    if (m && (n < Number(m[1]) || n > Number(m[2]))) return `Must be ${m[1]} – ${m[2]}`;
  }
  if (v.type === "bool" && value !== "true" && value !== "false") return "true or false";
  if (v.type === "string" && /port/i.test(v.name) && !/^\d{1,5}(:\d{1,5})?$/.test(value)) return "Port number or range (8000:8100)";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Steps preview                                                              */
/* -------------------------------------------------------------------------- */

/** Render a template string with `{{var}}` substituted; unresolved vars are highlighted. */
export function Templated({ text, vars }: { text: string; vars: Record<string, string> }) {
  const parts = text.split(/(\{\{\s*\w+\s*\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*(\w+)\s*\}\}$/);
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
        const val = vars[m[1]];
        return val ? (
          <span key={i} className="rounded-sm bg-info/15 px-0.5 text-info">
            {val.length > 80 ? `${val.slice(0, 80)}…` : val}
          </span>
        ) : (
          <span key={i} className="rounded-sm bg-warning/15 px-0.5 text-warning">
            {`{{${m[1]}}}`}
          </span>
        );
      })}
    </>
  );
}

export function describeStep(s: CommandStep): { kind: string; text: string } {
  switch (s.action) {
    case "exec":
      return { kind: "exec", text: s.command ?? "" };
    case "file":
      return { kind: `file ${s.op ?? ""}`.trim(), text: [s.path, s.mode ? `mode ${s.mode}` : ""].filter(Boolean).join("  ") };
    case "service":
      return { kind: "service", text: `systemctl ${s.op ?? ""} ${s.name ?? ""}`.trim() };
    case "fetch":
      return { kind: "fetch", text: [s.url, s.path ? `→ ${s.path}` : ""].filter(Boolean).join(" ") };
    default:
      return { kind: s.action, text: s.command ?? s.path ?? s.name ?? "" };
  }
}

export function commandKeywords(c: CommandTemplate): string {
  return [c.name, c.description, c.category, c.id, ...c.variables.map((v) => v.name)].join(" ").toLowerCase();
}
