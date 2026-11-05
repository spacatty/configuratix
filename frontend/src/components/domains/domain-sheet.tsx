"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import {
  ExternalLink,
  FileText,
  FolderOpen,
  HeartPulse,
  Link2,
  RotateCw,
  ScrollText,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Unlink,
} from "lucide-react";

import type { Domain, DomainGroup } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CopyButton, KeyValueList, RelativeTime, SectionCard, openJobLogs } from "@/components/app";
import { formatDateTime } from "@/lib/format";

import type { DomainRowActions } from "./domain-columns";
import { DomainApplyCell, DomainHealthCell } from "./domain-status";
import { GroupChip } from "./group-chip";
import { domainApplyState, isApplyActive } from "./domain-utils";

export function DomainSheet({
  domain,
  open,
  onOpenChange,
  groups,
  actions,
}: {
  domain: Domain | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DomainGroup[];
  actions: DomainRowActions;
}) {
  const d = domain;
  const assigned = !!d?.assigned_machine_id;
  const busy = d ? isApplyActive(d) : false;
  const failed = d ? domainApplyState(d) === "failed" : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        {d && (
          <>
            <SheetHeader className="border-b border-border">
              <SheetTitle className="flex items-center gap-1.5">
                <span className="font-data truncate">{d.fqdn}</span>
                <CopyButton value={d.fqdn} size="sm" label="Copy domain" />
                <a
                  href={`https://${d.fqdn}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label="Open in new tab"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </SheetTitle>
              <SheetDescription>
                Added <RelativeTime date={d.created_at} />
              </SheetDescription>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" onClick={() => actions.assign(d)}>
                  <Link2 />
                  {assigned ? "Reassign" : "Assign"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!assigned || !d.config_id || busy}
                  onClick={() => actions.reapply(d)}
                >
                  <RotateCw />
                  Re-apply
                </Button>
                <Button size="sm" variant="outline" disabled={!assigned} onClick={() => actions.checkHealth(d)}>
                  <HeartPulse />
                  Check health
                </Button>
                {assigned && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.unassign(d)}>
                    <Unlink />
                    Unassign
                  </Button>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {failed && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>Last apply failed — previous config restored</AlertTitle>
                  <AlertDescription>
                    {d.last_apply_error && (
                      <pre className="font-data mt-1 max-h-40 overflow-auto text-[11px] whitespace-pre-wrap">
                        {d.last_apply_error}
                      </pre>
                    )}
                    <div className="mt-2 flex gap-2">
                      {d.last_job_id && (
                        <Button size="xs" variant="outline" onClick={() => openJobLogs(d.last_job_id!)}>
                          <ScrollText />
                          View logs
                        </Button>
                      )}
                      <Button size="xs" variant="outline" onClick={() => actions.reapply(d)}>
                        <RotateCw />
                        Retry
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              <SectionCard title="Deployment">
                <KeyValueList
                  labelWidth={120}
                  items={[
                    {
                      label: "Machine",
                      value: assigned ? (
                        <Link href={`/machines/${d.assigned_machine_id}`} className="hover:underline">
                          {d.machine_name ?? "Machine"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      ),
                    },
                    { label: "IP", value: d.machine_ip, mono: true, copy: d.machine_ip, hidden: !d.machine_ip },
                    { label: "Nginx config", value: d.config_name ?? "—" },
                    { label: "Apply", value: <DomainApplyCell domain={d} onRetry={actions.reapply} /> },
                    {
                      label: "Last applied",
                      value: d.last_applied_at ? (
                        <span title={formatDateTime(d.last_applied_at)}>
                          <RelativeTime date={d.last_applied_at} />
                        </span>
                      ) : (
                        "—"
                      ),
                    },
                    {
                      label: "Last job",
                      hidden: !d.last_job_id,
                      value: d.last_job_id ? (
                        <button
                          type="button"
                          onClick={() => openJobLogs(d.last_job_id!)}
                          className="font-data inline-flex items-center gap-1 text-[12px] hover:underline"
                        >
                          <ScrollText className="size-3.5 text-muted-foreground" />
                          {d.last_job_id.slice(0, 8)}
                        </button>
                      ) : null,
                    },
                  ]}
                />
              </SectionCard>

              <SectionCard
                title="Health"
                actions={
                  <Button size="xs" variant="ghost" onClick={() => actions.healthSettings(d)}>
                    <SlidersHorizontal />
                    Settings
                  </Button>
                }
              >
                <KeyValueList
                  labelWidth={120}
                  items={[
                    { label: "Status", value: <DomainHealthCell domain={d} /> },
                    { label: "Expected status", value: String(d.health_check_expected_status ?? 200), mono: true },
                  ]}
                />
              </SectionCard>

              <SectionCard
                title="Groups"
                actions={
                  <Button size="xs" variant="ghost" onClick={() => actions.groups(d)}>
                    <FolderOpen />
                    Edit
                  </Button>
                }
              >
                {groups.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((g) => (
                      <GroupChip key={g.id} group={g} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Not in any group.</p>
                )}
              </SectionCard>

              <SectionCard
                title="Notes"
                actions={
                  <Button size="xs" variant="ghost" onClick={() => actions.notes(d)}>
                    <FileText />
                    Edit
                  </Button>
                }
              >
                {d.notes_md?.trim() ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown>{d.notes_md}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No notes.</p>
                )}
              </SectionCard>

              <div className="flex justify-end pt-2">
                <Button size="sm" variant="destructive" onClick={() => actions.remove(d)}>
                  <Trash2 />
                  Delete domain
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
