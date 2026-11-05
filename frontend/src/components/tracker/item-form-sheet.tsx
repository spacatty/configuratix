"use client";

import * as React from "react";
import { Save } from "lucide-react";
import {
  api,
  type TrackerCategoryWithCount,
  type TrackerItemWithCategory,
  type TrackerResource,
  type TrackerTag,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/app";
import { FormField } from "@/components/security/form-field";
import { Markdown } from "./bits";
import { CategoryPicker, ResourcePicker, TagPicker } from "./pickers";
import { RECURRING_OPTIONS, addPeriod, formatCurrency, fromDatetimeLocal, monthlyCost, toDatetimeLocal } from "./utils";

export type ItemPayload = Parameters<typeof api.createTrackerItem>[0];

export function ItemFormSheet({
  open,
  onOpenChange,
  item,
  duplicateFrom,
  defaultCategoryId,
  categories,
  resources,
  onResourceCreated,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: TrackerItemWithCategory | null;
  duplicateFrom?: TrackerItemWithCategory | null;
  defaultCategoryId?: string | null;
  categories: TrackerCategoryWithCount[];
  resources: TrackerResource[];
  onResourceCreated: (r: TrackerResource) => void;
  onSave: (data: ItemPayload) => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [identifier, setIdentifier] = React.useState("");
  const [resourceId, setResourceId] = React.useState<string | null>(null);
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [tagIds, setTagIds] = React.useState<string[]>([]);
  const [tags, setTags] = React.useState<TrackerTag[]>([]);
  const [orderDate, setOrderDate] = React.useState("");
  const [expiryAt, setExpiryAt] = React.useState("");
  const [recurring, setRecurring] = React.useState<string>("1m");
  const [recurringDays, setRecurringDays] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const src = item ?? duplicateFrom ?? null;
    setName(src ? (item ? src.name : `${src.name} (copy)`) : "");
    setIdentifier(src?.identifier_value ?? "");
    setResourceId(src?.resource_id ?? null);
    setCategoryId(src?.category_id ?? defaultCategoryId ?? null);
    setTagIds(src?.tags?.map((t) => t.id) ?? []);
    setOrderDate(toDatetimeLocal(src?.order_date));
    setExpiryAt(toDatetimeLocal(src?.expiry_at));
    setRecurring(src?.recurring_period_type || (src ? "" : "1m"));
    setRecurringDays(src?.recurring_period_days?.toString() ?? "");
    setPrice(src?.price_usd != null ? String(src.price_usd) : "");
    setNotes(src?.notes_md ?? "");
    setSubmitted(false);
  }, [open, item, duplicateFrom, defaultCategoryId]);

  React.useEffect(() => {
    if (!open || !categoryId) {
      setTags([]);
      return;
    }
    let alive = true;
    api
      .listTrackerCategoryTags(categoryId)
      .then((t) => alive && setTags(t))
      .catch(() => alive && setTags([]));
    return () => {
      alive = false;
    };
  }, [open, categoryId]);

  const category = categories.find((c) => c.id === categoryId);
  const idLabel = category?.identifier_label || "Identifier";
  const priceNum = price ? Number(price) : null;
  const priceInvalid = price !== "" && (!Number.isFinite(priceNum) || (priceNum ?? 0) < 0);
  const daysInvalid = recurring === "custom" && !(Number(recurringDays) >= 1);
  const errors = {
    name: !name.trim() ? "Name is required" : null,
    resource: !resourceId ? "Pick or create a resource" : null,
  };
  const valid = !errors.name && !errors.resource && !priceInvalid && !daysInvalid;
  const perMonth = monthlyCost({
    price_usd: priceNum,
    recurring_period_type: recurring || null,
    recurring_period_days: Number(recurringDays) || null,
  });

  const suggestExpiry = () => {
    const base = orderDate ? new Date(orderDate) : new Date();
    const next = addPeriod(base, recurring, Number(recurringDays) || 0);
    setExpiryAt(toDatetimeLocal(next.toISOString()));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        resource_id: resourceId,
        identifier_value: identifier.trim(),
        category_id: categoryId,
        tag_ids: categoryId ? tagIds : [],
        order_date: fromDatetimeLocal(orderDate),
        expiry_at: fromDatetimeLocal(expiryAt),
        recurring_period_type: recurring || null,
        recurring_period_days: recurring === "custom" ? Number(recurringDays) : null,
        price_usd: priceNum,
        notes_md: notes.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{item ? `Edit ${item.name}` : duplicateFrom ? "Duplicate item" : "New item"}</SheetTitle>
          <SheetDescription>Subscriptions, servers, domains — anything that renews and costs money.</SheetDescription>
        </SheetHeader>
        <form id="tracker-item-form" onSubmit={submit} className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
          <section className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="ti-name" required error={submitted ? errors.name : undefined} className="sm:col-span-2">
              <Input id="ti-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hetzner AX41 — fra-1" aria-invalid={submitted && !!errors.name} />
            </FormField>
            <FormField label="Category">
              <CategoryPicker
                categories={categories}
                value={categoryId}
                onValueChange={(id) => {
                  setCategoryId(id);
                  setTagIds([]);
                }}
              />
            </FormField>
            <FormField label="Resource" required error={submitted ? errors.resource : undefined} hint="Provider or account it's billed through">
              <ResourcePicker
                resources={resources}
                value={resourceId}
                onValueChange={setResourceId}
                onCreated={onResourceCreated}
                invalid={submitted && !!errors.resource}
              />
            </FormField>
            <FormField label={idLabel} htmlFor="ti-ident">
              <Input
                id="ti-ident"
                className="font-data"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={/ip/i.test(idLabel) ? "203.0.113.10" : /domain/i.test(idLabel) ? "example.com" : "Optional"}
              />
            </FormField>
            <FormField label="Tags" hint={!categoryId ? "Choose a category to tag this item" : undefined}>
              {categoryId ? (
                <TagPicker
                  categoryId={categoryId}
                  tags={tags}
                  value={tagIds}
                  onValueChange={setTagIds}
                  onCreated={(t) => setTags((p) => [...p, t])}
                />
              ) : (
                <Input disabled placeholder="—" />
              )}
            </FormField>
          </section>

          <section className="space-y-4">
            <h3 className="text-[13px] font-medium">Billing</h3>
            <FormField
              label="Renews"
              error={daysInvalid && submitted ? "Enter the number of days" : undefined}
            >
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup type="single" variant="outline" value={recurring} onValueChange={(v) => setRecurring(v)}>
                  {RECURRING_OPTIONS.map((o) => (
                    <ToggleGroupItem key={o.value} value={o.value}>
                      {o.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {recurring === "custom" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">every</span>
                    <Input type="number" min={1} className="font-data h-8 w-20" value={recurringDays} onChange={(e) => setRecurringDays(e.target.value)} placeholder="30" />
                    <span className="text-xs text-muted-foreground">days</span>
                  </div>
                )}
                {!recurring && <span className="text-xs text-muted-foreground">One-off (no renewal)</span>}
              </div>
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Price (USD)" htmlFor="ti-price" error={priceInvalid ? "Invalid amount" : undefined} hint={perMonth != null ? `≈ ${formatCurrency(perMonth)} / month` : undefined}>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input id="ti-price" inputMode="decimal" className="font-data pl-6" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" aria-invalid={priceInvalid} />
                </div>
              </FormField>
              <FormField label="Billing start">
                <DateTimePicker value={orderDate} onChange={setOrderDate} placeholder="Optional" />
              </FormField>
              <FormField
                label="Expires"
                aside={
                  recurring ? (
                    <button type="button" onClick={suggestExpiry} className="text-[11px] text-primary hover:underline">
                      +1 period
                    </button>
                  ) : null
                }
              >
                <DateTimePicker value={expiryAt} onChange={setExpiryAt} placeholder="Set expiry" />
              </FormField>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[13px] font-medium">Notes</h3>
            <Tabs defaultValue="write">
              <TabsList>
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview" disabled={!notes.trim()}>
                  Preview
                </TabsTrigger>
              </TabsList>
              <TabsContent value="write">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} className="resize-y text-[13px]" placeholder="Markdown supported — login hints, contract terms, links…" />
              </TabsContent>
              <TabsContent value="preview">
                <div className="min-h-[140px] rounded-md border border-border bg-surface-2/30 p-3">
                  <Markdown>{notes}</Markdown>
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </form>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="tracker-item-form" disabled={saving || (submitted && !valid)}>
            {saving ? <Spinner /> : <Save />}
            {item ? "Save changes" : "Create item"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
