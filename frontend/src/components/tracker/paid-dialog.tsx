"use client";

import * as React from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { TrackerItemWithCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/app";
import { formatDate } from "@/lib/format";
import { FormField } from "@/components/security/form-field";
import { RECURRING_OPTIONS, addPeriod } from "./utils";

export interface PaidPayload {
  expiry_at?: string | null;
  recurring_period_type?: string | null;
  recurring_period_days?: number | null;
  amount_usd?: number | null;
}

export function PaidDialog({
  item,
  onOpenChange,
  onPaid,
}: {
  item: TrackerItemWithCategory | null;
  onOpenChange: (o: boolean) => void;
  onPaid: (item: TrackerItemWithCategory, data: PaidPayload) => Promise<void>;
}) {
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>{item && <PaidForm key={item.id} item={item} onCancel={() => onOpenChange(false)} onPaid={onPaid} />}</DialogContent>
    </Dialog>
  );
}

function PaidForm({
  item,
  onCancel,
  onPaid,
}: {
  item: TrackerItemWithCategory;
  onCancel: () => void;
  onPaid: (item: TrackerItemWithCategory, data: PaidPayload) => Promise<void>;
}) {
  const [period, setPeriod] = React.useState(item.recurring_period_type || "1m");
  const [days, setDays] = React.useState(item.recurring_period_days?.toString() ?? "30");
  const [override, setOverride] = React.useState(false);
  const [expiry, setExpiry] = React.useState("");
  const [amount, setAmount] = React.useState(item.price_usd?.toString() ?? "");
  const [saving, setSaving] = React.useState(false);

  const now = new Date();
  const current = item.expiry_at ? new Date(item.expiry_at) : null;
  // Renewals extend from the current expiry if it's still in the future, else from today.
  const base = current && current > now ? current : now;
  const computed = addPeriod(base, period, Number(days) || 0);
  const finalExpiry = override && expiry ? new Date(expiry) : computed;
  const amountNum = amount ? Number(amount) : null;
  const amountInvalid = amount !== "" && (!Number.isFinite(amountNum) || (amountNum ?? 0) < 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountInvalid) return;
    setSaving(true);
    try {
      await onPaid(item, {
        expiry_at: finalExpiry.toISOString(),
        recurring_period_type: period,
        recurring_period_days: period === "custom" ? Number(days) || null : null,
        amount_usd: amountNum,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record payment</DialogTitle>
        <DialogDescription>
          Renew <span className="font-medium text-foreground">{item.name}</span> and push its expiry forward.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Renewal period">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" variant="outline" value={period} onValueChange={(v) => v && setPeriod(v)}>
              {RECURRING_OPTIONS.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value}>
                  {o.short}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {period === "custom" && (
              <Input type="number" min={1} className="font-data h-8 w-20" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days" />
            )}
          </div>
        </FormField>

        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/30 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Current expiry</div>
            <div className="font-data text-[13px]">{current ? formatDate(current) : "—"}</div>
          </div>
          <ArrowRight className="size-4 text-subtle-foreground" />
          <div className="min-w-0 flex-1 text-right">
            <div className="text-xs text-muted-foreground">New expiry</div>
            <div className="font-data text-[13px] font-medium text-success">{formatDate(finalExpiry)}</div>
          </div>
        </div>

        <FormField
          label="Set a different date"
          aside={<Switch checked={override} onCheckedChange={setOverride} aria-label="Override expiry" />}
        >
          {override && <DateTimePicker value={expiry} onChange={setExpiry} placeholder="Pick the new expiry" />}
        </FormField>

        <FormField label="Amount paid (USD)" htmlFor="paid-amount" error={amountInvalid ? "Invalid amount" : undefined}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">$</span>
            <Input id="paid-amount" inputMode="decimal" className="font-data pl-6" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
        </FormField>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || amountInvalid || (override && !expiry)}>
            {saving ? <Spinner /> : <CheckCircle2 />}
            Record payment
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
