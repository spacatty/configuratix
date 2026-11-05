/**
 * Formatting helpers shared by primitives and pages.
 * All functions are pure and safe with null/undefined input (they return "—").
 */

export const EM_DASH = "—";

type DateInput = string | number | Date | null | undefined;

export function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "just now", "42s ago", "3m ago", "5h ago", "2d ago", "in 4m", or a date for > 30d. */
export function formatRelative(input: DateInput, now: number = Date.now()): string {
  const d = toDate(input);
  if (!d) return EM_DASH;
  const diff = now - d.getTime();
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const wrap = (v: string) => (future ? `in ${v}` : `${v} ago`);
  if (s < 10) return future ? "in a moment" : "just now";
  if (s < 60) return wrap(`${Math.floor(s)}s`);
  const m = s / 60;
  if (m < 60) return wrap(`${Math.floor(m)}m`);
  const h = m / 60;
  if (h < 24) return wrap(`${Math.floor(h)}h`);
  const days = h / 24;
  if (days < 30) return wrap(`${Math.floor(days)}d`);
  return formatDate(d);
}

/** "2026-11-05" */
export function formatDate(input: DateInput): string {
  const d = toDate(input);
  if (!d) return EM_DASH;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-11-05 14:03:22" (local time) */
export function formatDateTime(input: DateInput, withSeconds = true): string {
  const d = toDate(input);
  if (!d) return EM_DASH;
  const p = (n: number) => String(n).padStart(2, "0");
  const t = `${p(d.getHours())}:${p(d.getMinutes())}${withSeconds ? `:${p(d.getSeconds())}` : ""}`;
  return `${formatDate(d)} ${t}`;
}

/** Duration in ms → "320ms", "4.2s", "3m 12s", "2h 05m", "3d 4h". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return EM_DASH;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.floor(s % 60);
  if (m < 60) return `${m}m ${String(rs).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h ${String(rm).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Duration between two timestamps (end defaults to now). */
export function durationBetween(start: DateInput, end?: DateInput): number | null {
  const a = toDate(start);
  if (!a) return null;
  const b = toDate(end) ?? new Date();
  return Math.max(0, b.getTime() - a.getTime());
}

/** Bytes → "512 B", "1.4 KB", "23.1 MB", "1.02 GB" (base 1024). */
export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return EM_DASH;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : decimals)} ${units[i]}`;
}

/** 0..100 → "42.0%" */
export function formatPercent(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  return `${v.toFixed(decimals)}%`;
}

/** 12345 → "12,345" */
export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  return v.toLocaleString("en-US");
}

/** Short id: first 8 chars. */
export function shortId(id: string | null | undefined, len = 8): string {
  if (!id) return EM_DASH;
  return id.length > len ? id.slice(0, len) : id;
}
