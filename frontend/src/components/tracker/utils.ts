import type { TrackerCategoryWithCount, TrackerItem } from "@/lib/api";

export const RECURRING_OPTIONS = [
  { value: "1m", label: "Monthly", short: "1 mo" },
  { value: "3m", label: "Quarterly", short: "3 mo" },
  { value: "6m", label: "Half-yearly", short: "6 mo" },
  { value: "12m", label: "Yearly", short: "1 yr" },
  { value: "custom", label: "Custom", short: "Custom" },
];

export const CATEGORY_EMOJIS = ["📁", "🖥️", "🌐", "📋", "🔧", "🚀", "⭐", "🔒", "📦", "💻", "🛠️", "📡", "🔥", "💎", "🎯", "☁️", "📨", "🧾"];
export const PALETTE = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#64748b"];
export const DEFAULT_COLOR = "#6366f1";

export function recurringLabel(type: string | null, days: number | null): string | null {
  if (!type) return null;
  if (type === "custom") return days ? `Every ${days} days` : "Custom";
  return RECURRING_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

/** Monthly-equivalent cost of a recurring item (for MRE-style hints). */
export function monthlyCost(item: Pick<TrackerItem, "price_usd" | "recurring_period_type" | "recurring_period_days">): number | null {
  if (item.price_usd == null || !item.recurring_period_type) return null;
  const months: Record<string, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };
  if (item.recurring_period_type === "custom") {
    return item.recurring_period_days ? (item.price_usd / item.recurring_period_days) * 30.4375 : null;
  }
  const m = months[item.recurring_period_type];
  return m ? item.price_usd / m : null;
}

export function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromDatetimeLocal(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatCurrency(n: number | null | undefined): string {
  return n == null ? "—" : usd.format(n);
}

export function addPeriod(d: Date, type: string, days: number): Date {
  const next = new Date(d);
  if (type === "1m") next.setMonth(next.getMonth() + 1);
  else if (type === "3m") next.setMonth(next.getMonth() + 3);
  else if (type === "6m") next.setMonth(next.getMonth() + 6);
  else if (type === "12m") next.setFullYear(next.getFullYear() + 1);
  else if (type === "custom" && days) next.setDate(next.getDate() + days);
  return next;
}

export type ExpiryState = "overdue" | "due_soon" | "active" | "no_expiry";

export const EXPIRY_LABEL: Record<ExpiryState, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  active: "Active",
  no_expiry: "No expiry",
};

/** Status for StatusText/StatusBadge (maps onto the design system's tones). */
export const EXPIRY_STATUS: Record<ExpiryState, string> = {
  overdue: "expired",
  due_soon: "warning",
  active: "active",
  no_expiry: "unknown",
};

export function expiryState(expiry: string | null, notifyDays = 3, now = Date.now()): ExpiryState {
  if (!expiry) return "no_expiry";
  const t = new Date(expiry).getTime();
  if (Number.isNaN(t)) return "no_expiry";
  if (t < now) return "overdue";
  if ((t - now) / 86400000 <= Math.max(notifyDays, 1)) return "due_soon";
  return "active";
}

export function daysUntil(expiry: string | null, now = Date.now()): number | null {
  if (!expiry) return null;
  const t = new Date(expiry).getTime();
  return Number.isNaN(t) ? null : Math.ceil((t - now) / 86400000);
}

export function notifyDaysFor(categoryId: string | null, categories: TrackerCategoryWithCount[]): number {
  return categories.find((c) => c.id === categoryId)?.notify_days_before ?? 3;
}

/* -------------------------------------------------------------------------- */
/* Browser notifications                                                      */
/* -------------------------------------------------------------------------- */

export function playNotificationSound() {
  try {
    if (typeof window === "undefined") return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    // ignore
  }
}

export function showDesktopNotification(title: string, body?: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") new Notification(title, { body });
}
