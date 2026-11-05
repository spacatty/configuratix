"use client";

import * as React from "react";
import { CircleDollarSign, Copy, ExternalLink, History, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { api, type TrackerItemWithCategory, type TrackerRenewal } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KeyValueList, RelativeTime, StatusBadge } from "@/components/app";
import { formatDate, formatDateTime } from "@/lib/format";
import { CategoryGlyph, Markdown, TagChip } from "./bits";
import { EXPIRY_LABEL, EXPIRY_STATUS, expiryState, formatCurrency, monthlyCost, recurringLabel } from "./utils";

export function ItemDetailSheet({
  item,
  notifyDays,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onPaid,
  onOpenResource,
}: {
  item: TrackerItemWithCategory | null;
  notifyDays: number;
  onClose: () => void;
  onEdit: (i: TrackerItemWithCategory) => void;
  onDuplicate: (i: TrackerItemWithCategory) => void;
  onDelete: (i: TrackerItemWithCategory) => void;
  onPaid: (i: TrackerItemWithCategory) => void;
  onOpenResource: (resourceId: string) => void;
}) {
  const [renewals, setRenewals] = React.useState<TrackerRenewal[] | null>(null);
  const itemId = item?.id;
  const updatedAt = item?.updated_at;

  React.useEffect(() => {
    if (!itemId) return;
    let alive = true;
    setRenewals(null);
    api
      .listTrackerRenewals(itemId)
      .then((r) => alive && setRenewals(r ?? []))
      .catch(() => alive && setRenewals([]));
    return () => {
      alive = false;
    };
  }, [itemId, updatedAt]);

  const state = item ? expiryState(item.expiry_at, notifyDays) : "no_expiry";
  const perMonth = item ? monthlyCost(item) : null;

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl">
        {item && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <CategoryGlyph icon={item.category_icon} color={item.category_color} size="md" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{item.name}</SheetTitle>
                  <SheetDescription className="flex items-center gap-2">
                    <span>{item.category_name ?? "Uncategorized"}</span>
                    <StatusBadge status={EXPIRY_STATUS[state]} label={EXPIRY_LABEL[state]} size="sm" />
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
              <KeyValueList
                items={[
                  {
                    label: item.category_identifier_label || "Identifier",
                    value: item.identifier_value || null,
                    mono: true,
                    copy: item.identifier_value || null,
                  },
                  {
                    label: "Resource",
                    value: item.resource_id ? (
                      <span className="flex items-center gap-2">
                        <button type="button" className="hover:text-primary hover:underline underline-offset-2" onClick={() => onOpenResource(item.resource_id!)}>
                          {item.resource_name ?? "Resource"}
                        </button>
                        {item.resource_url && (
                          <a href={item.resource_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open resource URL">
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </span>
                    ) : null,
                  },
                  {
                    label: "Expires",
                    value: item.expiry_at ? (
                      <span className="flex items-center gap-2">
                        <span className="font-data">{formatDate(item.expiry_at)}</span>
                        <RelativeTime date={item.expiry_at} className="text-muted-foreground" />
                      </span>
                    ) : null,
                  },
                  { label: "Renews", value: recurringLabel(item.recurring_period_type, item.recurring_period_days) ?? "One-off" },
                  {
                    label: "Price",
                    value:
                      item.price_usd != null ? (
                        <span className="font-data">
                          {formatCurrency(item.price_usd)}
                          {perMonth != null && item.recurring_period_type !== "1m" && (
                            <span className="text-muted-foreground"> · ≈ {formatCurrency(perMonth)}/mo</span>
                          )}
                        </span>
                      ) : null,
                  },
                  { label: "Billing start", value: item.order_date ? formatDate(item.order_date) : null, mono: true },
                  {
                    label: "Next reminder",
                    value: item.next_notification_at ? <RelativeTime date={item.next_notification_at} /> : null,
                    hidden: !item.next_notification_at,
                  },
                  {
                    label: "Tags",
                    value: item.tags?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {item.tags.map((t) => (
                          <TagChip key={t.id} name={t.name} color={t.color} />
                        ))}
                      </span>
                    ) : null,
                  },
                ]}
              />

              {item.notes_md?.trim() && (
                <section className="space-y-2">
                  <h3 className="text-[13px] font-medium">Notes</h3>
                  <div className="rounded-md border border-border bg-surface-2/30 p-3">
                    <Markdown>{item.notes_md}</Markdown>
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-[13px] font-medium">
                  <History className="size-3.5 text-muted-foreground" />
                  Payment history
                </h3>
                {renewals === null ? (
                  <div className="space-y-1.5">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : renewals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No payments recorded yet.</p>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-[13px]">
                      <thead className="bg-surface-2/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-medium">Paid</th>
                          <th className="px-3 py-1.5 text-left font-medium">Extended to</th>
                          <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {renewals.map((r) => (
                          <tr key={r.id}>
                            <td className="font-data px-3 py-1.5" title={formatDateTime(r.renewed_at)}>{formatDate(r.renewed_at)}</td>
                            <td className="font-data px-3 py-1.5 text-muted-foreground">
                              {r.expiry_before ? `${formatDate(r.expiry_before)} → ` : ""}
                              <span className="text-foreground">{formatDate(r.expiry_after)}</span>
                            </td>
                            <td className="font-data px-3 py-1.5 text-right">{formatCurrency(r.amount_usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="text-xs text-subtle-foreground">
                Created <span className="font-data">{formatDateTime(item.created_at, false)}</span> · updated{" "}
                <RelativeTime date={item.updated_at} className="text-xs" />
              </p>
            </div>

            <SheetFooter className="sm:justify-between">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => onDuplicate(item)}>
                    <Copy />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(item)}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onEdit(item)}>
                  <Pencil />
                  Edit
                </Button>
                <Button onClick={() => onPaid(item)}>
                  <CircleDollarSign />
                  Record payment
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
