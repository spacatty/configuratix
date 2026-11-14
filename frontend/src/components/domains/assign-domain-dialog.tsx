"use client";

import * as React from "react";
import { ArrowRight, FileCog, Link2, ShieldCheck, Sparkles, TriangleAlert, Undo2, Workflow } from "lucide-react";
import { toast } from "sonner";

import { api, type AssignDomainOptions, type Domain, type Job, type Machine, type NginxConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import {
  MachinePicker,
  NginxConfigPicker,
  Spinner,
  errorMessage,
  machineDisplayName,
  machineLiveness,
  trackJob,
  useConfirm,
} from "@/components/app";

import { extractJobIds, suggestConfigFor } from "./domain-utils";

export interface AssignDomainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One domain (assign / reassign) or many (bulk). */
  domains: Domain[];
  machines?: Machine[];
  configs?: NginxConfig[];
  groupsByMachine?: Record<string, string[]>;
  /** Called right after the request succeeds, and again when tracked jobs finish. */
  onChanged: () => void;
}

type SourceCleanup = NonNullable<AssignDomainOptions["sourceCleanup"]>;

/** What a domain looked like before the migration, so a failed cleanup can be reverted. */
interface MigrationOrigin {
  domain: Domain;
  machineId: string;
  machineLabel: string;
  configId: string | null;
}

/** Created job as returned by the assign endpoints (jobCreatedResponse). */
interface CreatedJobRef {
  id: string;
  title: string | null;
  action: string | null;
  entity_id: string | null;
}

function createdJobs(res: { jobs?: unknown[] | null } | null | undefined): CreatedJobRef[] {
  const out: CreatedJobRef[] = [];
  for (const j of res?.jobs ?? []) {
    const anyJ = j as Partial<CreatedJobRef> & { job_id?: string };
    const id = anyJ.id ?? anyJ.job_id;
    if (!id) continue;
    out.push({ id, title: anyJ.title ?? null, action: anyJ.action ?? null, entity_id: anyJ.entity_id ?? null });
  }
  return out;
}

function originFor(d: Domain, machines: Machine[] | undefined): MigrationOrigin | null {
  if (!d.assigned_machine_id) return null;
  const m = machines?.find((x) => x.id === d.assigned_machine_id);
  return {
    domain: d,
    machineId: d.assigned_machine_id,
    machineLabel: m ? machineDisplayName(m) : (d.machine_name ?? d.machine_ip ?? "previous machine"),
    configId: d.config_id,
  };
}

export function AssignDomainDialog({
  open,
  onOpenChange,
  domains,
  machines,
  configs,
  groupsByMachine,
  onChanged,
}: AssignDomainDialogProps) {
  const confirm = useConfirm();
  const single = domains.length === 1 ? domains[0] : null;
  const [machineId, setMachineId] = React.useState<string | null>(null);
  const [machine, setMachine] = React.useState<Machine | null>(null);
  const [configId, setConfigId] = React.useState<string | null>(null);
  const [sourceCleanup, setSourceCleanup] = React.useState<SourceCleanup>("remove");
  const [submitting, setSubmitting] = React.useState(false);

  const configList = React.useMemo(() => configs ?? [], [configs]);
  const config = configList.find((c) => c.id === configId) ?? null;
  const suggestion = React.useMemo(() => {
    if (configId || !single || !configList.length) return null;
    return suggestConfigFor(single.fqdn, configList);
  }, [configId, single, configList]);

  /** Machines the selected domains move away from, with their liveness. */
  const previousMachines = React.useMemo(() => {
    const byId = new Map<string, { label: string; online: boolean }>();
    for (const d of domains) {
      if (!d.assigned_machine_id || d.assigned_machine_id === machineId || byId.has(d.assigned_machine_id)) continue;
      const m = machines?.find((x) => x.id === d.assigned_machine_id);
      byId.set(d.assigned_machine_id, {
        label: m ? machineDisplayName(m) : (d.machine_name ?? d.machine_ip ?? "previous machine"),
        // A machine missing from the list was deleted (or isn't visible): its agent can't answer.
        online: !!m && machineLiveness(m) === "online",
      });
    }
    return [...byId.values()];
  }, [domains, machineId, machines]);
  const sourceUnreachable = previousMachines.some((m) => !m.online);
  const previousLabel = previousMachines.map((m) => m.label).join(", ");

  // Reset when (re)opened
  React.useEffect(() => {
    if (!open) return;
    const sameMachine = domains.every((d) => d.assigned_machine_id === domains[0]?.assigned_machine_id);
    const sameConfig = domains.every((d) => d.config_id === domains[0]?.config_id);
    const mid = sameMachine ? (domains[0]?.assigned_machine_id ?? null) : null;
    setMachineId(mid);
    setMachine(mid ? (machines?.find((m) => m.id === mid) ?? null) : null);
    setConfigId(sameConfig ? (domains[0]?.config_id ?? null) : null);
    setSourceCleanup("remove");
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default to leaving an unreachable source alone; the user can still insist on a removal attempt.
  React.useEffect(() => {
    if (open && previousMachines.length) setSourceCleanup(sourceUnreachable ? "skip" : "remove");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, machineId, sourceUnreachable]);

  const isPassthrough = !!config?.structured_json?.is_passthrough;
  const targetLabel = single ? single.fqdn : `${domains.length} domains`;
  const machineLabel = machine ? machineDisplayName(machine) : "the machine";

  /* --------------------------- failed source cleanup --------------------------- */

  // Removals that failed are collected briefly so a bulk migration asks once, not per domain.
  const failedCleanups = React.useRef<{ origin: MigrationOrigin; job: Job }[]>([]);
  const failedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (failedTimer.current) clearTimeout(failedTimer.current);
    },
    []
  );

  const revertMigration = React.useCallback(
    async (origins: MigrationOrigin[]) => {
      let failed = 0;
      const jobs: CreatedJobRef[] = [];
      for (const o of origins) {
        try {
          // Back to the old machine, which still has the config (skip apply); clean the new one.
          const res = await api.assignDomain(o.domain.id, o.machineId, o.configId, { sourceCleanup: "remove", skipApply: true });
          jobs.push(...createdJobs(res));
        } catch (e) {
          failed++;
          toast.error(`Couldn't move ${o.domain.fqdn} back`, { description: errorMessage(e) });
        }
      }
      onChanged();
      jobs.forEach((j) => trackJob(j.id, { title: j.title ?? undefined, onDone: () => onChanged() }));
      if (!failed) {
        const back = origins.length === 1 ? origins[0].domain.fqdn : `${origins.length} domains`;
        toast.success(`Migration cancelled — ${back} back on ${origins[0].machineLabel}`, {
          description: jobs.length ? "Removing the config from the new machine in the background." : undefined,
        });
      }
    },
    [onChanged]
  );

  const askAboutFailedCleanup = React.useCallback(async () => {
    const batch = failedCleanups.current;
    failedCleanups.current = [];
    if (!batch.length) return;
    const origins = batch.map((b) => b.origin);
    const sources = [...new Set(origins.map((o) => o.machineLabel))].join(", ");
    const reason = batch[0].job.error_message || "the machine did not respond";
    const what = origins.length === 1 ? origins[0].domain.fqdn : `${origins.length} domains`;
    const keep = await confirm({
      title: `Couldn't remove ${what} from ${sources}`,
      description: `${reason}. The new machine is unaffected. Keep the migration and leave ${sources} as is, or move ${what} back?`,
      details: (
        <ul className="max-h-32 space-y-0.5 overflow-y-auto font-data text-xs text-muted-foreground">
          {origins.slice(0, 12).map((o) => (
            <li key={o.domain.id}>{o.domain.fqdn}</li>
          ))}
          {origins.length > 12 && <li>+{origins.length - 12} more</li>}
        </ul>
      ),
      icon: TriangleAlert,
      confirmText: "Keep migration",
      cancelText: "Cancel migration",
    });
    if (keep) {
      toast.info(`Kept ${what} on the new machine`, {
        description: `${sources} was left untouched. Remove the config there by hand if it ever comes back.`,
      });
      return;
    }
    await revertMigration(origins);
  }, [confirm, revertMigration]);

  const onCleanupFailed = React.useCallback(
    (origin: MigrationOrigin, job: Job) => {
      failedCleanups.current.push({ origin, job });
      if (failedTimer.current) clearTimeout(failedTimer.current);
      failedTimer.current = setTimeout(() => void askAboutFailedCleanup(), 1500);
    },
    [askAboutFailedCleanup]
  );

  /* ---------------------------------- submit ---------------------------------- */

  const submit = async () => {
    if (!machineId || submitting) return;
    setSubmitting(true);
    const opts: AssignDomainOptions = previousMachines.length ? { sourceCleanup } : {};
    const origins = new Map<string, MigrationOrigin>();
    for (const d of domains) {
      if (d.assigned_machine_id === machineId) continue;
      const o = originFor(d, machines);
      if (o) origins.set(d.id, o);
    }
    try {
      let jobs: CreatedJobRef[] = [];
      let failed = 0;
      if (single) {
        const res = await api.assignDomain(single.id, machineId, configId, opts);
        jobs = createdJobs(res);
        if (!jobs.length) jobs = extractJobIds(res).map((id) => ({ id, title: null, action: null, entity_id: null }));
      } else {
        const res = await api.bulkAssignDomains(
          domains.map((d) => d.id),
          machineId,
          configId,
          opts
        );
        jobs = createdJobs(res);
        failed = res.errors?.length ?? 0;
        if (failed) {
          toast.warning(`${res.ok} assigned, ${failed} failed`, {
            description: res.errors
              .slice(0, 3)
              .map((e) => `${domains.find((d) => d.id === e.id)?.fqdn ?? e.id}: ${e.error}`)
              .join("\n"),
          });
        }
      }
      onOpenChange(false);
      onChanged();
      if (jobs.length === 0) {
        if (!failed)
          toast.success(single ? `${single.fqdn} assigned to ${machineLabel}` : `Assigned ${domains.length} domains`, {
            description: configId ? "The apply job runs in the background — status updates in the table." : undefined,
          });
        return;
      }
      jobs.forEach(({ id, title, action, entity_id }) => {
        const origin = action === "remove_domain" && entity_id ? origins.get(entity_id) : undefined;
        trackJob(id, {
          title: title ?? (single ? `Apply ${single.fqdn} → ${machineLabel}` : `Apply domains → ${machineLabel}`),
          description: origin ? `${origin.machineLabel} · gives up after 60 s` : machineLabel,
          onDone: () => onChanged(),
          onFailure: origin ? (job) => onCleanupFailed(origin, job) : undefined,
        });
      });
    } catch (e) {
      toast.error(`Couldn't assign ${targetLabel}`, { description: errorMessage(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{single ? (single.assigned_machine_id ? "Reassign domain" : "Assign domain") : `Assign ${domains.length} domains`}</DialogTitle>
          <DialogDescription>
            {single ? (
              <span className="font-data text-foreground">{single.fqdn}</span>
            ) : (
              <span className="font-data">
                {domains
                  .slice(0, 4)
                  .map((d) => d.fqdn)
                  .join(", ")}
                {domains.length > 4 && ` +${domains.length - 4} more`}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="assign-machine">Machine</Label>
            <MachinePicker
              id="assign-machine"
              machines={machines}
              groupsByMachine={groupsByMachine}
              value={machineId}
              onValueChange={(id, m) => {
                setMachineId(id);
                setMachine(m);
              }}
              groupBy="status"
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="assign-config">Nginx config</Label>
              {suggestion && (
                <button
                  type="button"
                  onClick={() => setConfigId(suggestion.id)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Sparkles className="size-3" />
                  Suggested: <span className="font-medium text-foreground">{suggestion.name}</span>
                </button>
              )}
            </div>
            <NginxConfigPicker
              id="assign-config"
              configs={configs}
              value={configId}
              onValueChange={(id) => setConfigId(id)}
              clearable
              placeholder="No config — link only"
              className="w-full"
            />
          </div>

          {machineId && previousMachines.length > 0 && (
            <div className="space-y-1.5">
              <Label>Previous machine</Label>
              <RadioGroup
                value={sourceCleanup}
                onValueChange={(v) => setSourceCleanup(v as SourceCleanup)}
                className="grid grid-cols-2 gap-2"
              >
                <RadioCard
                  value="remove"
                  title="Remove config there"
                  description={sourceUnreachable ? "Tries for 60 s, then asks what to do" : `Clean up ${previousLabel}`}
                  icon={<Undo2 />}
                />
                <RadioCard
                  value="skip"
                  title="Leave it alone"
                  description={sourceUnreachable ? `${previousLabel} looks offline` : "Nothing is touched there"}
                  icon={<Link2 />}
                />
              </RadioGroup>
              {sourceUnreachable && sourceCleanup === "remove" && (
                <p className="text-xs text-muted-foreground">
                  {previousLabel} hasn&apos;t checked in. If it doesn&apos;t pick up the removal within a minute you&apos;ll be
                  asked to keep or cancel the migration.
                </p>
              )}
            </div>
          )}

          {machineId && (
            <Alert variant={configId ? "info" : "default"} className="animate-fade-in-up">
              <Workflow />
              <AlertTitle>What happens</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-1 text-xs">
                  {previousMachines.length > 0 && (
                    <li className="flex gap-2">
                      <Undo2 className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {sourceCleanup === "skip" ? (
                          <>
                            Leaves the config on <span className="font-medium">{previousLabel}</span> untouched
                          </>
                        ) : (
                          <>
                            Removes the config from <span className="font-medium">{previousLabel}</span>
                          </>
                        )}
                      </span>
                    </li>
                  )}
                  {configId ? (
                    <>
                      <li className="flex gap-2">
                        <FileCog className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          Writes <span className="font-medium">{config?.name ?? "the config"}</span>
                          {isPassthrough ? " as an SNI passthrough route" : " as an nginx server block"} on{" "}
                          <span className="font-medium">{machineLabel}</span>
                        </span>
                      </li>
                      {!isPassthrough && (
                        <li className="flex gap-2">
                          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                          <span>Issues an SSL certificate if one is missing</span>
                        </li>
                      )}
                      <li className="flex gap-2">
                        <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          Runs <span className="font-data">nginx -t</span>, then reloads — on failure the previous config is restored automatically
                        </span>
                      </li>
                    </>
                  ) : (
                    <li className="flex gap-2">
                      <Link2 className="mt-0.5 size-3.5 shrink-0" />
                      <span>Links the domain to {machineLabel}. Nothing is written until a config is chosen.</span>
                    </li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!machineId || submitting}>
            {submitting && <Spinner />}
            {configId ? "Assign & apply" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
