"use client";

import * as React from "react";
import { toast } from "sonner";
import { Trash2, RefreshCw } from "lucide-react";
import { api, type Machine } from "@/lib/api";
import { errorMessage, invalidatePickerCache, machineDisplayName, trackJob, useConfirm } from "@/components/app";

/** Shared machine mutations (list + detail) with confirm dialogs and job tracking. */
export function useMachineActions(onChanged?: () => void) {
  const confirm = useConfirm();
  const changed = React.useRef(onChanged);
  React.useEffect(() => {
    changed.current = onChanged;
  });

  const updateAgent = React.useCallback(async (m: Machine) => {
    try {
      const res = await api.triggerMachineUpdate(m.id);
      changed.current?.();
      if (res?.job_id) {
        trackJob(res.job_id, {
          title: "Update agent",
          description: machineDisplayName(m),
          onDone: () => changed.current?.(),
        });
      } else {
        toast.info("Agent update requested", { description: machineDisplayName(m) });
      }
    } catch (e) {
      toast.error("Couldn't start agent update", { description: errorMessage(e) });
    }
  }, []);

  const updateAgents = React.useCallback(
    async (machines: Machine[]) => {
      if (machines.length === 0) return;
      const ok = await confirm({
        title: `Update agent on ${machines.length} machine${machines.length === 1 ? "" : "s"}?`,
        description: "Each agent downloads the latest build, verifies it and restarts. Running jobs finish first.",
        confirmText: "Update agents",
        icon: RefreshCw,
      });
      if (!ok) return;
      let started = 0;
      for (const m of machines) {
        try {
          const res = await api.triggerMachineUpdate(m.id);
          started++;
          if (res?.job_id) trackJob(res.job_id, { title: "Update agent", description: machineDisplayName(m), quietSuccess: machines.length > 3 });
        } catch (e) {
          toast.error(`Couldn't update ${machineDisplayName(m)}`, { description: errorMessage(e) });
        }
      }
      if (started > 0) toast.success(`Agent update started on ${started} machine${started === 1 ? "" : "s"}`);
      changed.current?.();
    },
    [confirm]
  );

  const deleteMachine = React.useCallback(
    async (m: Machine): Promise<boolean> => {
      const name = machineDisplayName(m);
      const ok = await confirm({
        title: `Delete ${name}?`,
        description:
          "The machine is removed from Configuratix and its agent can no longer authenticate. Nothing is uninstalled from the server itself.",
        destructive: true,
        confirmText: "Delete machine",
        typeToConfirm: name,
        icon: Trash2,
        onConfirm: () => api.deleteMachine(m.id),
      });
      if (ok) {
        toast.success(`${name} deleted`);
        invalidatePickerCache("machines");
        changed.current?.();
      }
      return ok;
    },
    [confirm]
  );

  const deleteMachines = React.useCallback(
    async (machines: Machine[]): Promise<boolean> => {
      if (machines.length === 0) return false;
      if (machines.length === 1) return deleteMachine(machines[0]);
      const word = `${machines.length} machines`;
      const ok = await confirm({
        title: `Delete ${word}?`,
        description: "Their agents can no longer authenticate. Nothing is uninstalled from the servers.",
        details: (
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
            {machines.map((m) => (
              <li key={m.id} className="font-data truncate">
                {machineDisplayName(m)}
              </li>
            ))}
          </ul>
        ),
        destructive: true,
        confirmText: `Delete ${word}`,
        typeToConfirm: `delete ${machines.length}`,
        icon: Trash2,
        onConfirm: async () => {
          const results = await Promise.allSettled(machines.map((m) => api.deleteMachine(m.id)));
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed === machines.length) throw new Error("No machines could be deleted");
          if (failed > 0) toast.warning(`${failed} of ${machines.length} could not be deleted`);
        },
      });
      if (ok) {
        toast.success(`Deleted ${word}`);
        invalidatePickerCache("machines");
        changed.current?.();
      }
      return ok;
    },
    [confirm, deleteMachine]
  );

  return React.useMemo(
    () => ({ updateAgent, updateAgents, deleteMachine, deleteMachines }),
    [updateAgent, updateAgents, deleteMachine, deleteMachines]
  );
}
