"use client";

import * as React from "react";
import { ArrowRight, FileCog, Link2, ShieldCheck, Sparkles, Undo2, Workflow } from "lucide-react";
import { toast } from "sonner";

import { api, type Domain, type Machine, type NginxConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MachinePicker, NginxConfigPicker, Spinner, errorMessage, machineDisplayName, trackJob } from "@/components/app";

import { extractJobs, suggestConfigFor } from "./domain-utils";

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

export function AssignDomainDialog({
  open,
  onOpenChange,
  domains,
  machines,
  configs,
  groupsByMachine,
  onChanged,
}: AssignDomainDialogProps) {
  const single = domains.length === 1 ? domains[0] : null;
  const [machineId, setMachineId] = React.useState<string | null>(null);
  const [machine, setMachine] = React.useState<Machine | null>(null);
  const [configId, setConfigId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset when (re)opened
  React.useEffect(() => {
    if (!open) return;
    const sameMachine = domains.every((d) => d.assigned_machine_id === domains[0]?.assigned_machine_id);
    const sameConfig = domains.every((d) => d.config_id === domains[0]?.config_id);
    const mid = sameMachine ? (domains[0]?.assigned_machine_id ?? null) : null;
    setMachineId(mid);
    setMachine(mid ? (machines?.find((m) => m.id === mid) ?? null) : null);
    setConfigId(sameConfig ? (domains[0]?.config_id ?? null) : null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const configList = React.useMemo(() => configs ?? [], [configs]);
  const config = configList.find((c) => c.id === configId) ?? null;
  const suggestion = React.useMemo(() => {
    if (configId || !single || !configList.length) return null;
    return suggestConfigFor(single.fqdn, configList);
  }, [configId, single, configList]);

  const previousMachines = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const d of domains) {
      if (d.assigned_machine_id && d.assigned_machine_id !== machineId) {
        names.set(d.assigned_machine_id, d.machine_name ?? d.machine_ip ?? "previous machine");
      }
    }
    return [...names.values()];
  }, [domains, machineId]);

  const isPassthrough = !!config?.structured_json?.is_passthrough;
  const targetLabel = single ? single.fqdn : `${domains.length} domains`;
  const machineLabel = machine ? machineDisplayName(machine) : "the machine";

  const submit = async () => {
    if (!machineId || submitting) return;
    setSubmitting(true);
    try {
      let jobs: { id: string; title: string | null }[] = [];
      let failed = 0;
      if (single) {
        const res = await api.assignDomain(single.id, machineId, configId);
        jobs = extractJobs(res);
      } else {
        const res = await api.bulkAssignDomains(
          domains.map((d) => d.id),
          machineId,
          configId
        );
        jobs = extractJobs(res);
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
      jobs.forEach(({ id, title }) => {
        trackJob(id, {
          title: title ?? (single ? `Apply ${single.fqdn} → ${machineLabel}` : `Apply domains → ${machineLabel}`),
          description: machineLabel,
          onDone: () => onChanged(),
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
                        Removes the config from <span className="font-medium">{previousMachines.join(", ")}</span>
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
