"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, CalendarRange, FolderPlus, Plus, TrendingUp, Wallet } from "lucide-react";
import {
  api,
  type TrackerCategoryWithCount,
  type TrackerItemWithCategory,
  type TrackerResource,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ErrorState, PageHeader, StatCard, StatStrip, errorMessage, useConfirm, usePolling } from "@/components/app";
import { formatDate } from "@/lib/format";
import { ItemsTable } from "@/components/tracker/items-table";
import { ItemFormSheet, type ItemPayload } from "@/components/tracker/item-form-sheet";
import { ItemDetailSheet } from "@/components/tracker/item-detail-sheet";
import { PaidDialog, type PaidPayload } from "@/components/tracker/paid-dialog";
import { ResourceSheet, type ResourcePayload } from "@/components/tracker/resource-sheet";
import { CategoryDialog, type CategoryPayload, type StagedTag } from "@/components/tracker/category-dialog";
import { CategoriesGrid, ResourcesTable } from "@/components/tracker/resources-and-categories";
import { InboxPopover } from "@/components/tracker/inbox-popover";
import { daysUntil, formatCurrency, notifyDaysFor, playNotificationSound, showDesktopNotification } from "@/components/tracker/utils";

type Tab = "items" | "resources" | "categories";

async function loadTracker() {
  const [summary, categories, items, notifications, resources] = await Promise.all([
    api.getTrackerDashboard(),
    api.listTrackerCategories(),
    api.listTrackerItems(),
    api.listTrackerNotifications(),
    api.listTrackerResources(),
  ]);
  return { summary, categories, items, notifications, resources };
}

export default function TrackerPage() {
  const confirm = useConfirm();
  const { data, loading, error, refresh, setData } = usePolling(loadTracker, 60000);

  const [tab, setTab] = useState<Tab>("items");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; item: TrackerItemWithCategory | null; duplicate: TrackerItemWithCategory | null }>({
    open: false,
    item: null,
    duplicate: null,
  });
  const [paidItem, setPaidItem] = useState<TrackerItemWithCategory | null>(null);
  const [resSheet, setResSheet] = useState<{ open: boolean; resource: TrackerResource | null; edit: boolean }>({
    open: false,
    resource: null,
    edit: false,
  });
  const [catDialog, setCatDialog] = useState<{ open: boolean; category: TrackerCategoryWithCount | null }>({ open: false, category: null });

  const items = useMemo(() => data?.items ?? [], [data]);
  const categories = useMemo(() => data?.categories ?? [], [data]);
  const resources = useMemo(() => data?.resources ?? [], [data]);
  const notifications = useMemo(() => data?.notifications ?? [], [data]);
  const summary = data?.summary;

  const detailItem = detailId ? items.find((i) => i.id === detailId) ?? null : null;
  const visibleItems = categoryFilter === "all" ? items : items.filter((i) => (i.category_id ?? "none") === categoryFilter);
  const uncategorized = items.filter((i) => !i.category_id).length;

  /* ------------------------------ notifications ----------------------------- */
  const seenUnread = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const unread = data.notifications.filter((n) => !n.read_at);
    const ids = new Set(unread.map((n) => n.id));
    if (seenUnread.current) {
      for (const n of unread) {
        if (seenUnread.current.has(n.id)) continue;
        toast(n.title, { description: n.body ?? undefined });
        playNotificationSound();
        showDesktopNotification(n.title, n.body ?? undefined);
      }
    }
    seenUnread.current = ids;
  }, [data]);

  const markRead = async (id: string) => {
    setData((d) => d && { ...d, notifications: d.notifications.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) });
    try {
      await api.markTrackerNotificationRead(id);
    } catch (e) {
      toast.error("Couldn't mark as read", { description: errorMessage(e) });
      refresh();
    }
  };
  const markAllRead = async () => {
    const now = new Date().toISOString();
    setData((d) => d && { ...d, notifications: d.notifications.map((n) => ({ ...n, read_at: n.read_at ?? now })) });
    try {
      await api.markAllTrackerNotificationsRead();
    } catch (e) {
      toast.error("Couldn't mark all as read", { description: errorMessage(e) });
      refresh();
    }
  };

  /* --------------------------------- items --------------------------------- */
  const openCreate = useCallback(() => setForm({ open: true, item: null, duplicate: null }), []);
  const openEdit = useCallback((i: TrackerItemWithCategory) => setForm({ open: true, item: i, duplicate: null }), []);
  const openDuplicate = useCallback((i: TrackerItemWithCategory) => setForm({ open: true, item: null, duplicate: i }), []);

  const saveItem = async (payload: ItemPayload) => {
    try {
      if (form.item) {
        await api.updateTrackerItem(form.item.id, payload);
        toast.success("Item saved");
      } else {
        const created = await api.createTrackerItem(payload);
        toast.success(`${created.name} added`);
      }
      setForm((f) => ({ ...f, open: false }));
      refresh();
    } catch (e) {
      toast.error("Couldn't save item", { description: errorMessage(e) });
    }
  };

  const deleteItems = useCallback(
    async (rows: TrackerItemWithCategory[], clear?: () => void) => {
      const one = rows.length === 1;
      const ok = await confirm({
        title: one ? `Delete ${rows[0].name}?` : `Delete ${rows.length} items?`,
        description: "Payment history and reminders for these items are removed too.",
        destructive: true,
        confirmText: "Delete",
        onConfirm: async () => {
          for (const r of rows) await api.deleteTrackerItem(r.id);
        },
      });
      if (ok) {
        toast.success(one ? "Item deleted" : `${rows.length} items deleted`);
        const ids = new Set(rows.map((r) => r.id));
        setData((d) => d && { ...d, items: d.items.filter((i) => !ids.has(i.id)) });
        setDetailId((id) => (id && ids.has(id) ? null : id));
        clear?.();
        refresh();
      }
    },
    [confirm, refresh, setData]
  );

  const recordPaid = async (item: TrackerItemWithCategory, payload: PaidPayload) => {
    try {
      await api.recordTrackerPaid(item.id, payload);
      toast.success("Payment recorded", { description: payload.expiry_at ? `${item.name} now expires ${formatDate(payload.expiry_at)}` : item.name });
      setPaidItem(null);
      refresh();
    } catch (e) {
      toast.error("Couldn't record payment", { description: errorMessage(e) });
    }
  };

  /* ------------------------------- resources ------------------------------- */
  const openResource = useCallback(
    async (id: string) => {
      const r = resources.find((x) => x.id === id);
      if (r) return setResSheet({ open: true, resource: r, edit: false });
      try {
        setResSheet({ open: true, resource: await api.getTrackerResource(id), edit: false });
      } catch (e) {
        toast.error("Couldn't load resource", { description: errorMessage(e) });
      }
    },
    [resources]
  );

  const saveResource = async (resource: TrackerResource | null, payload: ResourcePayload) => {
    try {
      if (resource) {
        const u = await api.updateTrackerResource(resource.id, payload);
        setResSheet((s) => ({ ...s, resource: u ?? { ...resource, ...payload }, edit: false }));
        toast.success("Resource saved");
      } else {
        const c = await api.createTrackerResource(payload);
        toast.success(`Resource “${c.name}” created`);
        setResSheet({ open: false, resource: null, edit: false });
      }
      refresh();
    } catch (e) {
      toast.error("Couldn't save resource", { description: errorMessage(e) });
      throw e;
    }
  };

  const deleteResource = useCallback(
    async (r: TrackerResource) => {
      const linked = items.filter((i) => i.resource_id === r.id).length;
      const ok = await confirm({
        title: `Delete ${r.name}?`,
        description: linked
          ? `${linked} ${linked === 1 ? "item is" : "items are"} linked to it and will have no resource.`
          : "No items use this resource.",
        destructive: true,
        confirmText: "Delete resource",
        onConfirm: () => api.deleteTrackerResource(r.id),
      });
      if (ok) {
        toast.success("Resource deleted");
        setResSheet({ open: false, resource: null, edit: false });
        refresh();
      }
    },
    [confirm, items, refresh]
  );

  /* ------------------------------- categories ------------------------------ */
  const saveCategory = async (category: TrackerCategoryWithCount | null, payload: CategoryPayload, staged: StagedTag[]) => {
    try {
      if (category) {
        await api.updateTrackerCategory(category.id, payload);
        toast.success("Category saved");
      } else {
        const created = await api.createTrackerCategory(payload);
        for (const t of staged) await api.createTrackerCategoryTag(created.id, t);
        toast.success(`${created.name} created`);
      }
      setCatDialog({ open: false, category: null });
      refresh();
    } catch (e) {
      toast.error("Couldn't save category", { description: errorMessage(e) });
    }
  };

  const deleteCategory = async (c: TrackerCategoryWithCount) => {
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      description: c.item_count
        ? `${c.item_count} ${c.item_count === 1 ? "item becomes" : "items become"} uncategorized and lose their tags.`
        : "This category has no items.",
      destructive: true,
      confirmText: "Delete category",
      onConfirm: () => api.deleteTrackerCategory(c.id),
    });
    if (ok) {
      toast.success("Category deleted");
      if (categoryFilter === c.id) setCategoryFilter("all");
      refresh();
    }
  };

  /* --------------------------------- render -------------------------------- */
  const closest = summary?.closest_payment;
  const closestDays = closest ? daysUntil(closest.expiry_at) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarClock}
        title="Tracker"
        description="Renewals, spend and reminders for servers, domains and subscriptions."
        actions={
          <>
            <InboxPopover
              notifications={notifications}
              onMarkRead={markRead}
              onMarkAllRead={markAllRead}
              onOpenItem={(id) => {
                setTab("items");
                setDetailId(id);
              }}
            />
            <Button onClick={openCreate}>
              <Plus />
              New item
            </Button>
          </>
        }
      />

      {error && !data ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : (
        <>
          <StatStrip>
            <StatCard label="Monthly recurring" icon={TrendingUp} loading={loading} value={formatCurrency(summary?.monthly_recurring_expense ?? 0)} sub="Normalised to one month" />
            <StatCard label="Total spent" icon={Wallet} loading={loading} value={formatCurrency(summary?.total_spent ?? 0)} sub="All recorded payments" />
            <StatCard
              label="Due soon"
              icon={CalendarRange}
              loading={loading}
              value={summary?.due_soon_count ?? 0}
              tone={(summary?.due_soon_count ?? 0) > 0 ? "warning" : "default"}
              sub={
                closest ? (
                  <button type="button" className="truncate hover:text-foreground" onClick={() => setDetailId(closest.id)}>
                    Next: {closest.name}
                    {closestDays != null && <span className="font-data"> · {closestDays <= 0 ? "today" : `${closestDays}d`}</span>}
                  </button>
                ) : (
                  "Nothing due"
                )
              }
            />
            <StatCard
              label="Overdue"
              icon={AlertTriangle}
              loading={loading}
              value={summary?.overdue_count ?? 0}
              tone={(summary?.overdue_count ?? 0) > 0 ? "destructive" : "default"}
              sub="Past expiry, not renewed"
            />
          </StatStrip>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-4">
            <TabsList>
              <TabsTrigger value="items">
                Items <span className="font-data text-[11px] text-subtle-foreground">{items.length}</span>
              </TabsTrigger>
              <TabsTrigger value="resources">
                Resources <span className="font-data text-[11px] text-subtle-foreground">{resources.length}</span>
              </TabsTrigger>
              <TabsTrigger value="categories">
                Categories <span className="font-data text-[11px] text-subtle-foreground">{categories.length}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="items" className="space-y-3">
              {categories.length > 0 && (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={categoryFilter}
                  onValueChange={(v) => v && setCategoryFilter(v)}
                  className="flex-wrap"
                >
                  <ToggleGroupItem value="all">
                    All <span className="font-data text-[11px] text-subtle-foreground">{items.length}</span>
                  </ToggleGroupItem>
                  {categories.map((c) => (
                    <ToggleGroupItem key={c.id} value={c.id}>
                      <span>{c.icon}</span>
                      {c.name}
                      <span className="font-data text-[11px] text-subtle-foreground">{c.item_count}</span>
                    </ToggleGroupItem>
                  ))}
                  {uncategorized > 0 && (
                    <ToggleGroupItem value="none">
                      Uncategorized <span className="font-data text-[11px] text-subtle-foreground">{uncategorized}</span>
                    </ToggleGroupItem>
                  )}
                </ToggleGroup>
              )}
              <ItemsTable
                items={visibleItems}
                categories={categories}
                loading={loading}
                onOpen={(i) => setDetailId(i.id)}
                onEdit={openEdit}
                onDuplicate={openDuplicate}
                onDelete={deleteItems}
                onPaid={setPaidItem}
                onOpenResource={openResource}
                onCreate={openCreate}
              />
            </TabsContent>

            <TabsContent value="resources">
              <ResourcesTable
                resources={resources}
                items={items}
                loading={loading}
                onOpen={(r) => setResSheet({ open: true, resource: r, edit: false })}
                onEdit={(r) => setResSheet({ open: true, resource: r, edit: true })}
                onDelete={deleteResource}
                onCreate={() => setResSheet({ open: true, resource: null, edit: true })}
              />
            </TabsContent>

            <TabsContent value="categories" className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setCatDialog({ open: true, category: null })}>
                  <FolderPlus />
                  New category
                </Button>
              </div>
              <CategoriesGrid
                categories={categories}
                items={items}
                loading={loading}
                onOpen={(c) => {
                  setCategoryFilter(c.id);
                  setTab("items");
                }}
                onEdit={(c) => setCatDialog({ open: true, category: c })}
                onDelete={deleteCategory}
                onCreate={() => setCatDialog({ open: true, category: null })}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <ItemDetailSheet
        item={detailItem}
        notifyDays={detailItem ? notifyDaysFor(detailItem.category_id, categories) : 3}
        onClose={() => setDetailId(null)}
        onEdit={(i) => {
          setDetailId(null);
          openEdit(i);
        }}
        onDuplicate={(i) => {
          setDetailId(null);
          openDuplicate(i);
        }}
        onDelete={(i) => deleteItems([i])}
        onPaid={setPaidItem}
        onOpenResource={(id) => {
          setDetailId(null);
          openResource(id);
        }}
      />

      <ItemFormSheet
        open={form.open}
        onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))}
        item={form.item}
        duplicateFrom={form.duplicate}
        defaultCategoryId={categoryFilter !== "all" && categoryFilter !== "none" ? categoryFilter : null}
        categories={categories}
        resources={resources}
        onResourceCreated={(r) => setData((d) => d && { ...d, resources: [...d.resources, r] })}
        onSave={saveItem}
      />

      <PaidDialog item={paidItem} onOpenChange={(o) => !o && setPaidItem(null)} onPaid={recordPaid} />

      <ResourceSheet
        open={resSheet.open}
        resource={resSheet.resource}
        startEditing={resSheet.edit}
        items={items}
        onOpenChange={(o) => setResSheet((s) => ({ ...s, open: o }))}
        onSave={saveResource}
        onDelete={deleteResource}
        onOpenItem={(i) => {
          setResSheet((s) => ({ ...s, open: false }));
          setTab("items");
          setDetailId(i.id);
        }}
      />

      <CategoryDialog
        open={catDialog.open}
        category={catDialog.category}
        onOpenChange={(o) => setCatDialog((s) => ({ ...s, open: o }))}
        onSave={saveCategory}
      />
    </div>
  );
}
