"use client";

import * as React from "react";
import { CircleSlash, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { api, type JobCreated } from "@/lib/api";
import { emitJobsChanged, jobTitle } from "@/lib/jobs";
import { useConfirm } from "@/components/app/confirm";
import { errorMessage } from "@/components/app/states";

type ActionableJob = { id: string; status: string; type: string; title?: string | null; cancel_requested?: boolean };

/**
 * Cancel / retry with confirmation + toasts. Callers decide what to do with a
 * retried job (usually `trackJob(created)` and/or open its logs).
 * Fires the JOBS_CHANGED_EVENT window event after every successful action.
 */
export function useJobActions(opts: { onRetried?: (created: JobCreated, original: ActionableJob) => void; onChanged?: () => void } = {}) {
  const confirm = useConfirm();
  const optsRef = React.useRef(opts);
  React.useEffect(() => {
    optsRef.current = opts;
  });
  const [busy, setBusy] = React.useState<string | null>(null);

  const cancel = React.useCallback(
    async (job: ActionableJob) => {
      const running = job.status === "running";
      let result: Awaited<ReturnType<typeof api.cancelJob>> | null = null;
      const ok = await confirm({
        title: `Cancel “${jobTitle(job)}”?`,
        description: running
          ? "The agent is asked to stop. Transactional jobs roll back to the previous state; others stop after the current step."
          : "The job hasn't started yet. It is removed from the agent's queue.",
        confirmText: running ? "Request cancel" : "Cancel job",
        cancelText: "Keep running",
        destructive: true,
        icon: CircleSlash,
        onConfirm: async () => {
          result = await api.cancelJob(job.id);
        },
      });
      if (!ok) return false;
      const r = result as Awaited<ReturnType<typeof api.cancelJob>> | null;
      if (r?.status === "cancelled") toast.success("Job cancelled");
      else toast.info("Cancel requested", { description: "The agent stops the job at the next safe point." });
      emitJobsChanged();
      optsRef.current.onChanged?.();
      return true;
    },
    [confirm]
  );

  const retry = React.useCallback(async (job: ActionableJob) => {
    setBusy(job.id);
    try {
      const created = await api.retryJob(job.id);
      emitJobsChanged();
      optsRef.current.onRetried?.(created, job);
      optsRef.current.onChanged?.();
      return created;
    } catch (e) {
      toast.error("Couldn't retry job", { description: errorMessage(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  return { cancel, retry, retrying: busy };
}

export const RetryIcon = RotateCcw;
