"use client";

import * as React from "react";

export interface UsePollingOptions {
  /** Poll only while true (default true). When false nothing is fetched. */
  enabled?: boolean;
  /** Fetch immediately on mount / when deps change (default true). */
  immediate?: boolean;
  /** Pause the timer while document is hidden and refetch on return (default true). */
  pauseWhenHidden?: boolean;
  /** Changing any dep resets state (loading=true) and refetches. */
  deps?: React.DependencyList;
}

export interface UsePollingResult<T> {
  data: T | undefined;
  error: Error | null;
  /** True only until the first fetch settles (or after deps change). */
  loading: boolean;
  /** True while a background refresh is in flight (never flips `loading`). */
  refreshing: boolean;
  /** Timestamp (ms) of the last successful fetch. */
  updatedAt: number | null;
  /** Trigger a fetch now. Resolves when done. */
  refresh: () => Promise<void>;
  /** Optimistically replace data (e.g. after a mutation). */
  setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}

/**
 * Poll an async function on an interval.
 *
 *   const { data: jobs, loading, refresh } = usePolling(() => api.listJobs(), 5000);
 *
 * - The first fetch sets `loading`; later ones only set `refreshing`, so tables
 *   don't flash skeletons every tick.
 * - Pauses while the tab is hidden; refreshes as soon as it is visible again.
 * - Overlapping calls are skipped (a slow request never stacks up).
 * - `fn` can change every render; the latest one is always called.
 */
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  options: UsePollingOptions = {}
): UsePollingResult<T> {
  const { enabled = true, immediate = true, pauseWhenHidden = true, deps = [] } = options;

  const fnRef = React.useRef(fn);
  React.useEffect(() => {
    fnRef.current = fn;
  });

  const [data, setData] = React.useState<T | undefined>(undefined);
  const [error, setError] = React.useState<Error | null>(null);
  const [loading, setLoading] = React.useState<boolean>(enabled && immediate);
  const [refreshing, setRefreshing] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);

  const inFlight = React.useRef(false);
  const queued = React.useRef(false);
  const generation = React.useRef(0);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = React.useCallback(async () => {
    if (inFlight.current) {
      // a manual refresh during a poll: run once more right after
      queued.current = true;
      return;
    }
    inFlight.current = true;
    const gen = generation.current;
    setRefreshing(true);
    try {
      const result = await fnRef.current();
      if (!mounted.current || gen !== generation.current) return;
      setData(result);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (!mounted.current || gen !== generation.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      inFlight.current = false;
      if (mounted.current && gen === generation.current) {
        setRefreshing(false);
        setLoading(false);
      }
      if (queued.current && mounted.current) {
        queued.current = false;
        void runRef.current();
      }
    }
  }, []);
  const runRef = React.useRef(run);
  React.useEffect(() => {
    runRef.current = run;
  }, [run]);

  // Reset + initial fetch when deps change
  React.useEffect(() => {
    generation.current++;
    inFlight.current = false;
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (immediate) {
      setLoading(true);
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, immediate, run, ...deps]);

  // Interval + visibility handling
  React.useEffect(() => {
    if (!enabled || !intervalMs || intervalMs <= 0) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (pauseWhenHidden && typeof document !== "undefined" && document.hidden) return;
        void run();
      }, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (!pauseWhenHidden) return;
      if (document.hidden) stop();
      else {
        void run();
        start();
      }
    };
    if (!(pauseWhenHidden && typeof document !== "undefined" && document.hidden)) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, pauseWhenHidden, run]);

  return { data, error, loading, refreshing, updatedAt, refresh: run, setData };
}
