"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { Crown, Eye, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectWithStats, User } from "@/lib/api";

/* ---------------------------------------------------------------- roles */

export type ProjectRole = "owner" | "manager" | "member" | "admin";

export const MEMBER_ROLES = [
  { value: "member", label: "Member", description: "Read-only access to project machines" },
  { value: "manager", label: "Manager", description: "Can manage machines and link new ones" },
] as const;

export function ProjectRoleBadge({ role }: { role: ProjectRole | string }) {
  switch (role) {
    case "owner":
      return (
        <Badge variant="outline">
          <Crown />
          Owner
        </Badge>
      );
    case "admin":
      return (
        <Badge variant="info">
          <Crown />
          Super admin
        </Badge>
      );
    case "manager":
      return (
        <Badge variant="secondary">
          <Wrench />
          Manager
        </Badge>
      );
    default:
      return (
        <Badge variant="muted">
          <Eye />
          Member
        </Badge>
      );
  }
}

/** Role of `me` in `project` when no member row is known (list view). */
export function baseProjectRole(project: Pick<ProjectWithStats, "owner_id">, me: User | null | undefined): ProjectRole {
  if (!me) return "member";
  if (project.owner_id === me.id) return "owner";
  if (me.role === "superadmin") return "admin";
  return "member";
}

/* ---------------------------------------------------------------- invites */

export function inviteLink(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/join?token=${encodeURIComponent(token)}`;
}

/** Accepts a raw token or a pasted invite link (…/join?token=…). */
export function parseInviteInput(input: string): string {
  const v = input.trim();
  if (!v) return "";
  try {
    if (/^https?:\/\//i.test(v) || v.includes("token=")) {
      const url = new URL(v, "http://x");
      const t = url.searchParams.get("token");
      if (t) return t.trim();
    }
  } catch {
    /* not a URL */
  }
  return v;
}

/* ---------------------------------------------------------------- markdown */

/* eslint-disable @typescript-eslint/no-unused-vars -- `node` is stripped so it never reaches the DOM */
/** Styled markdown (no typography plugin in this app). */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-[13px] leading-relaxed text-foreground/90", className)}>
      <ReactMarkdown
        components={{
          h1: ({ node: _n, ...p }) => <h1 className="mt-5 text-lg font-semibold tracking-tight first:mt-0" {...p} />,
          h2: ({ node: _n, ...p }) => <h2 className="mt-5 border-b border-border pb-1 text-base font-semibold first:mt-0" {...p} />,
          h3: ({ node: _n, ...p }) => <h3 className="mt-4 text-sm font-semibold first:mt-0" {...p} />,
          p: ({ node: _n, ...p }) => <p {...p} />,
          a: ({ node: _n, ...p }) => <a className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer" {...p} />,
          ul: ({ node: _n, ...p }) => <ul className="ml-5 list-disc space-y-1" {...p} />,
          ol: ({ node: _n, ...p }) => <ol className="ml-5 list-decimal space-y-1" {...p} />,
          blockquote: ({ node: _n, ...p }) => <blockquote className="border-l-2 border-border-strong pl-3 text-muted-foreground" {...p} />,
          hr: () => <hr className="border-border" />,
          code: ({ node: _n, className: c, children, ...p }) => {
            const block = /language-/.test(c ?? "") || String(children).includes("\n");
            return block ? (
              <code className={cn("font-data text-xs", c)} {...p}>
                {children}
              </code>
            ) : (
              <code className="font-data rounded border border-border bg-surface-2 px-1 py-px text-[12px]" {...p}>
                {children}
              </code>
            );
          },
          pre: ({ node: _n, ...p }) => <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3" {...p} />,
          table: (p) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...p} />
            </div>
          ),
          th: ({ node: _n, ...p }) => <th className="border border-border px-2 py-1 text-left font-medium" {...p} />,
          td: ({ node: _n, ...p }) => <td className="border border-border px-2 py-1" {...p} />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-unused-vars */
