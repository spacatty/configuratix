"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api, TrackerCategoryWithCount, TrackerItemWithCategory, TrackerNotificationWithItem, TrackerDashboardSummary, TrackerTag, TrackerItemTagRef, TrackerResource } from "@/lib/api";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  DollarSign,
  CalendarClock,
  Bell,
  ExternalLink,
  Wallet,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Lock,
  Unlock,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const RECURRING_OPTIONS = [
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "1 year" },
  { value: "custom", label: "Custom (days)" },
];

const CATEGORY_EMOJIS = ["📁", "🖥️", "🌐", "📋", "🔧", "🚀", "⭐", "🔒", "📦", "💻", "🛠️", "📡", "🔥", "💎", "🎯"];
const CATEGORY_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#64748b"];

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(s: string): string | null {
  if (!s) return null;
  return new Date(s).toISOString();
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateOnly(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}

function playNotificationSound() {
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

function showDesktopNotification(title: string, body?: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

export default function TrackerPage() {
  const [summary, setSummary] = useState<TrackerDashboardSummary | null>(null);
  const [categories, setCategories] = useState<TrackerCategoryWithCount[]>([]);
  const [items, setItems] = useState<TrackerItemWithCategory[]>([]);
  const [notifications, setNotifications] = useState<TrackerNotificationWithItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateItem, setShowCreateItem] = useState(false);
  const [showEditItem, setShowEditItem] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showEditCategory, setShowEditCategory] = useState(false);
  const [showPaid, setShowPaid] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TrackerItemWithCategory | null>(null);
  const [detailItem, setDetailItem] = useState<TrackerItemWithCategory | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<TrackerItemWithCategory | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TrackerCategoryWithCount | null>(null);
  const [resources, setResources] = useState<TrackerResource[]>([]);
  const [selectedResource, setSelectedResource] = useState<TrackerResource | null>(null);
  const [showCreateResource, setShowCreateResource] = useState(false);
  const [showEditResource, setShowEditResource] = useState(false);
  const [resourceDetailItem, setResourceDetailItem] = useState<TrackerResource | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [itemsPage, setItemsPage] = useState(1);

  const ITEMS_PER_PAGE = 20;

  const loadData = useCallback(async () => {
    try {
      const [sum, cats, its, notifs, resList] = await Promise.all([
        api.getTrackerDashboard(),
        api.listTrackerCategories(),
        api.listTrackerItems(),
        api.listTrackerNotifications(),
        api.listTrackerResources(),
      ]);
      setSummary(sum);
      setCategories(cats);
      setItems(its);
      setNotifications(notifs);
      setResources(resList);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load tracker data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const prevUnreadIdsRef = useRef<Set<string>>(new Set());
  const hasInitialLoadRef = useRef(false);
  useEffect(() => {
    const unread = notifications.filter((n) => !n.read_at);
    const unreadIds = new Set(unread.map((n) => n.id));
    const prev = prevUnreadIdsRef.current;
    if (!hasInitialLoadRef.current) {
      hasInitialLoadRef.current = true;
      prevUnreadIdsRef.current = unreadIds;
      return;
    }
    const newUnread = unread.filter((n) => !prev.has(n.id));
    if (newUnread.length > 0) {
      newUnread.forEach((n) => {
        toast(n.title, { description: n.body ?? undefined });
        playNotificationSound();
        showDesktopNotification(n.title, n.body ?? undefined);
      });
    }
    prevUnreadIdsRef.current = unreadIds;
  }, [notifications]);

  useEffect(() => {
    const poll = () => {
      api.listTrackerNotifications().then(setNotifications).catch(() => {});
    };
    const id = setInterval(poll, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const categoryScopedItems = categoryFilter
    ? items.filter((i) => i.category_id === categoryFilter)
    : items;

  const searchLower = searchQuery.trim().toLowerCase();
  const searchedItems = searchLower
    ? categoryScopedItems.filter((i) => {
        const name = (i.name ?? "").toLowerCase();
        const resource = (i.resource_name ?? i.resource_url ?? "").toLowerCase();
        const identifier = (i.identifier_value ?? "").toLowerCase();
        const tagNames = (Array.isArray(i.tags) ? i.tags : []).map((t: TrackerItemTagRef) => (t.name ?? "").toLowerCase()).join(" ");
        return name.includes(searchLower) || resource.includes(searchLower) || identifier.includes(searchLower) || tagNames.includes(searchLower);
      })
    : categoryScopedItems;

  const filteredItems = [...searchedItems].sort((a, b) => {
    const ae = a.expiry_at ? new Date(a.expiry_at).getTime() : Infinity;
    const be = b.expiry_at ? new Date(b.expiry_at).getTime() : Infinity;
    return ae - be;
  });

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const paginatedItems = filteredItems.slice((itemsPage - 1) * ITEMS_PER_PAGE, itemsPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setItemsPage(1);
  }, [categoryFilter, searchQuery]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-pulse text-muted-foreground">Loading tracker...</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {summary && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><TrendingUp className="h-3 w-3 opacity-60" />MRE <span className="font-semibold text-foreground">{formatCurrency(summary.monthly_recurring_expense)}</span></span>
          <span className="opacity-40">·</span>
          <span className="flex items-center gap-1.5"><Wallet className="h-3 w-3 opacity-60" />Spent <span className="font-semibold text-foreground">{formatCurrency(summary.total_spent)}</span></span>
          <span className="opacity-40">·</span>
          <span className="flex items-center gap-1.5"><CalendarClock className="h-3 w-3 text-amber-500/70" />Due soon <span className={`font-semibold ${summary.due_soon_count > 0 ? "text-amber-600" : "text-foreground"}`}>{summary.due_soon_count}</span></span>
          <span className="opacity-40">·</span>
          <span className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 text-destructive/70" />Overdue <span className={`font-semibold ${summary.overdue_count > 0 ? "text-destructive" : "text-foreground"}`}>{summary.overdue_count}</span></span>
        </div>
      )}

      <Tabs defaultValue="items" className="space-y-3">
        <div className="flex items-center gap-3">
          <TabsList className="rounded-xl bg-muted/40 p-1 border-0 shadow-none shrink-0">
            <TabsTrigger value="items" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">Items</TabsTrigger>
            <TabsTrigger value="resources" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">Resources</TabsTrigger>
            <TabsTrigger value="categories" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">Categories</TabsTrigger>
            <TabsTrigger value="notifications" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">Inbox</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, tag, category, identifier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 w-96 bg-muted/30 border-0 rounded-lg text-xs placeholder:text-[11px]"
              />
            </div>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg cursor-pointer relative" onClick={() => setShowNotifications(true)}>
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Notifications</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg cursor-pointer text-green-600 hover:text-green-500 hover:bg-green-500/10" onClick={() => { setSelectedItem(null); setShowCreateItem(true); }}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add item</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <TabsContent value="items" className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter(null)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${categoryFilter === null ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"}`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryFilter(categoryFilter === c.id ? null : c.id)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${categoryFilter === c.id ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"}`}
              >
                <span>{c.icon}</span>
                <span>{c.name}</span>
                <span className="opacity-70">({c.item_count})</span>
              </button>
            ))}
          </div>
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground rounded-2xl bg-muted/20">
              <CalendarClock className="h-12 w-12 mb-3 opacity-50" />
              <p className="font-medium">No items yet</p>
              <p className="text-sm mt-0.5">Add a subscription, server or domain to track.</p>
              <Button variant="outline" size="sm" className="mt-4 rounded-xl" onClick={() => setShowCreateItem(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add item
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-xl overflow-hidden border border-border/40">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border/40">
                      <TableHead className="w-[22%]">Name</TableHead>
                      <TableHead className="w-[18%]">Identifier</TableHead>
                      <TableHead className="w-[22%]">Resource</TableHead>
                      <TableHead className="w-[14%]">Expiry</TableHead>
                      <TableHead className="w-[12%] text-right">Price</TableHead>
                      <TableHead className="w-[12%] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedItems.map((item) => {
                      const expiry = item.expiry_at ? new Date(item.expiry_at) : null;
                      const now = new Date();
                      const isOverdue = expiry && expiry < now;
                      const isDueSoon = expiry && expiry >= now && (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24) <= 3;
                      const categoryColor = item.category_color || "#6366f1";
                      return (
                        <TableRow
                          key={item.id}
                          className="hover:bg-muted/30 border-border/40"
                        >
                          <TableCell className="align-top py-2.5">
                            <button
                              type="button"
                              className="text-left w-full flex items-center gap-2 min-w-0 group/name"
                              onClick={() => setDetailItem(item)}
                            >
                              <span
                                className="inline-flex items-center justify-center h-6 w-6 rounded-md text-xs shrink-0"
                                style={{ backgroundColor: `${categoryColor}15`, color: categoryColor }}
                              >
                                {item.category_icon || "📋"}
                              </span>
                              <span className="font-medium text-foreground truncate cursor-pointer hover:text-primary">
                                {item.name}
                              </span>
                            </button>
                            {item.tags && item.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1 pl-8">
                                {item.tags.map((t: TrackerItemTagRef) => (
                                  <span
                                    key={t.id}
                                    className="text-[10px] font-medium leading-none px-1.5 py-0.5 rounded-full"
                                    style={{ backgroundColor: `${t.color}18`, color: t.color }}
                                  >
                                    {t.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell
                            className="text-sm text-muted-foreground align-top py-2.5 cursor-copy hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              const val = item.identifier_value?.trim();
                              if (val) {
                                navigator.clipboard.writeText(val);
                                toast.success("Copied");
                              }
                            }}
                            title={item.identifier_value ? "Click to copy" : undefined}
                          >
                            {item.identifier_value ? (
                              <>
                                {item.category_identifier_label && (
                                  <span className="opacity-60">{item.category_identifier_label}: </span>
                                )}
                                <span className="font-mono">{item.identifier_value}</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell
                            className="text-sm align-top py-2.5 truncate max-w-[200px]"
                          >
                            {item.resource_id ? (
                              <button
                                type="button"
                                className="font-medium text-foreground cursor-pointer hover:text-primary text-left w-full truncate"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const res = await api.getTrackerResource(item.resource_id!);
                                    setResourceDetailItem(res);
                                  } catch {
                                    toast.error("Failed to load resource");
                                  }
                                }}
                                title="View resource"
                              >
                                {item.resource_name ?? item.resource_url ?? "—"}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm align-top py-2.5 tabular-nums font-medium">
                            {expiry ? (
                              <span
                                className={isOverdue ? "text-destructive" : isDueSoon ? "text-amber-600" : "text-foreground"}
                              >
                                {formatDateOnly(item.expiry_at)}
                              </span>
                            ) : (
                              <span className="text-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-right align-top py-2.5 tabular-nums font-medium">
                            {item.price_usd != null ? formatCurrency(item.price_usd) : "—"}
                          </TableCell>
                          <TableCell className="align-top py-2.5 text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded"
                                onClick={(e) => { e.stopPropagation(); setSelectedItem(item); setShowPaid(true); }}
                                title="Mark paid"
                              >
                                <DollarSign className="h-3.5 w-3.5 text-green-600" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded" onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="rounded-xl">
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedItem(item); setShowEditItem(true); }} className="rounded-lg">
                                    <Pencil className="h-4 w-4 mr-2" />Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setDuplicateSource(item); setSelectedItem(null); setShowCreateItem(true); }} className="rounded-lg">
                                    <Copy className="h-4 w-4 mr-2" />Duplicate
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive rounded-lg"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (!confirm("Delete this item?")) return;
                                      try {
                                        await api.deleteTrackerItem(item.id);
                                        toast.success("Item deleted");
                                        loadData();
                                      } catch {
                                        toast.error("Failed to delete");
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    disabled={itemsPage <= 1}
                    onClick={() => setItemsPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground px-2">
                    Page {itemsPage} of {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    disabled={itemsPage >= totalPages}
                    onClick={() => setItemsPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="resources" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" className="rounded-xl" onClick={() => { setSelectedResource(null); setShowCreateResource(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add resource
            </Button>
          </div>
          {resources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground rounded-2xl bg-muted/20">
              <p className="font-medium">No resources yet</p>
              <p className="text-sm mt-0.5">Create resources and link them to items when adding or editing items.</p>
              <Button variant="outline" size="sm" className="mt-4 rounded-xl" onClick={() => setShowCreateResource(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add resource
              </Button>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border border-border/40">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/40">
                    <TableHead>Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-[80px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resources.map((res) => (
                    <TableRow key={res.id} className="hover:bg-muted/30 border-border/40">
                      <TableCell className="font-medium">{res.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm truncate max-w-[200px]">
                        {res.url || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[240px] truncate">
                        {res.notes_md?.trim() || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded" onClick={(e) => e.stopPropagation()}>
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-xl">
                            <DropdownMenuItem className="rounded-lg" onClick={(e) => { e.stopPropagation(); setSelectedResource(res); setShowEditResource(true); }}>
                              <Pencil className="h-4 w-4 mr-2" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive rounded-lg"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm("Delete this resource? Items linking to it will have no resource.")) return;
                                try {
                                  await api.deleteTrackerResource(res.id);
                                  toast.success("Resource deleted");
                                  loadData();
                                } catch {
                                  toast.error("Failed to delete");
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="categories" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setSelectedCategory(null); setShowCreateCategory(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              New category
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <Card key={cat.id} className="overflow-hidden rounded-2xl border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{cat.icon}</span>
                      <CardTitle className="text-base">{cat.name}</CardTitle>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setSelectedCategory(cat); setShowEditCategory(true); }}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={async () => {
                            if (!confirm("Delete this category? Items will be uncategorized.")) return;
                            try {
                              await api.deleteTrackerCategory(cat.id);
                              toast.success("Category deleted");
                              loadData();
                            } catch {
                              toast.error("Failed to delete");
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span>{cat.item_count} items</span>
                    <span>·</span>
                    <span>Notify {cat.notify_days_before} days before</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="notifications" className="space-y-4">
          <NotificationInbox
            notifications={notifications}
            onMarkRead={async (id) => {
              await api.markTrackerNotificationRead(id);
              loadData();
            }}
            onMarkAllRead={async () => {
              await api.markAllTrackerNotificationsRead();
              toast.success("All marked as read");
              loadData();
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Create / Edit Item dialog */}
      <ItemFormDialog
        open={showCreateItem || showEditItem}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItem(null);
            setDuplicateSource(null);
          }
          setShowCreateItem(open && !selectedItem);
          setShowEditItem(open && !!selectedItem);
        }}
        item={selectedItem}
        duplicateFrom={duplicateSource}
        categories={categories}
        submitting={submitting}
        onSave={async (data) => {
          setSubmitting(true);
          try {
            if (selectedItem) {
              await api.updateTrackerItem(selectedItem.id, data);
              toast.success("Item updated");
            } else {
              await api.createTrackerItem(data);
              toast.success("Item created");
            }
            setShowCreateItem(false);
            setShowEditItem(false);
            setSelectedItem(null);
            loadData();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSubmitting(false);
          }
        }}
      />

      {/* Create / Edit Category dialog */}
      <CategoryFormDialog
        open={showCreateCategory || showEditCategory}
        onOpenChange={(open) => {
          if (!open) setSelectedCategory(null);
          setShowCreateCategory(open && !selectedCategory);
          setShowEditCategory(open && !!selectedCategory);
        }}
        category={selectedCategory}
        submitting={submitting}
        onSave={async (data, stagedTags) => {
          setSubmitting(true);
          try {
            if (selectedCategory) {
              await api.updateTrackerCategory(selectedCategory.id, data);
              toast.success("Category updated");
            } else {
              const created = await api.createTrackerCategory(data);
              if (stagedTags?.length) {
                for (const t of stagedTags) {
                  await api.createTrackerCategoryTag(created.id, { name: t.name, color: t.color });
                }
              }
              toast.success("Category created");
            }
            setShowCreateCategory(false);
            setShowEditCategory(false);
            setSelectedCategory(null);
            loadData();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSubmitting(false);
          }
        }}
      />

      {/* Create / Edit Resource dialog */}
      <ResourceFormDialog
        open={showCreateResource || showEditResource}
        onOpenChange={(open) => {
          if (!open) setSelectedResource(null);
          setShowCreateResource(open && !selectedResource);
          setShowEditResource(open && !!selectedResource);
        }}
        resource={selectedResource}
        submitting={submitting}
        onSave={async (data) => {
          setSubmitting(true);
          try {
            if (selectedResource) {
              await api.updateTrackerResource(selectedResource.id, data);
              toast.success("Resource updated");
            } else {
              await api.createTrackerResource(data);
              toast.success("Resource created");
            }
            setShowCreateResource(false);
            setShowEditResource(false);
            setSelectedResource(null);
            loadData();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSubmitting(false);
          }
        }}
      />

      {/* Paid dialog */}
      <PaidDialog
        open={showPaid}
        onOpenChange={setShowPaid}
        item={selectedItem}
        submitting={submitting}
        onPaid={async (data) => {
          if (!selectedItem) return;
          setSubmitting(true);
          try {
            await api.recordTrackerPaid(selectedItem.id, data);
            toast.success("Renewal recorded");
            setShowPaid(false);
            setSelectedItem(null);
            loadData();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to record");
          } finally {
            setSubmitting(false);
          }
        }}
      />

      {/* Detail dialog (read-only view) */}
      <Dialog open={detailItem !== null} onOpenChange={(open) => !open && setDetailItem(null)}>
        <DialogContent className="max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailItem && (
                <>
                  <span
                    className="inline-flex items-center justify-center h-7 w-7 rounded-md text-sm shrink-0"
                    style={{ backgroundColor: `${detailItem.category_color || "#6366f1"}18`, color: detailItem.category_color || "#6366f1" }}
                  >
                    {detailItem.category_icon || "📋"}
                  </span>
                  {detailItem.name}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-4 py-2">
              <DetailRow label="Category" value={detailItem.category_name ?? "—"} />
              <DetailRow label="Identifier" value={detailItem.identifier_value?.trim() ? (detailItem.category_identifier_label ? `${detailItem.category_identifier_label}: ${detailItem.identifier_value}` : detailItem.identifier_value) : "—"} />
              <DetailRow label="Resource" value={detailItem.resource_name ?? detailItem.resource_url ?? "—"} />
              <DetailRow label="Billing start" value={detailItem.order_date ? formatDate(detailItem.order_date) : "—"} />
              <DetailRow label="Expiry" value={detailItem.expiry_at ? formatDate(detailItem.expiry_at) : "—"} />
              <DetailRow
                label="Recurring"
                value={
                  detailItem.recurring_period_type
                    ? `${detailItem.recurring_period_type}${detailItem.recurring_period_days != null ? ` (${detailItem.recurring_period_days} days)` : ""}`
                    : "—"
                }
              />
              <DetailRow label="Price" value={detailItem.price_usd != null ? formatCurrency(detailItem.price_usd) : "—"} />
              {detailItem.notes_md?.trim() ? (
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs font-medium">Notes</Label>
                  <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-sm prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{detailItem.notes_md}</ReactMarkdown>
                  </div>
                </div>
              ) : null}
              {detailItem.tags && detailItem.tags.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs font-medium">Tags</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {detailItem.tags.map((t: TrackerItemTagRef) => (
                      <span
                        key={t.id}
                        className="text-xs font-medium leading-none px-2 py-1 rounded-full"
                        style={{ backgroundColor: `${t.color}18`, color: t.color }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <DetailRow label="Created" value={formatDate(detailItem.created_at)} />
              <DetailRow label="Updated" value={formatDate(detailItem.updated_at)} />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setDetailItem(null)}
            >
              Close
            </Button>
            {detailItem && (
              <Button
                className="rounded-xl"
                onClick={() => {
                  setSelectedItem(detailItem);
                  setDetailItem(null);
                  setShowEditItem(true);
                }}
              >
                <Pencil className="h-4 w-4 mr-2" />Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resource detail dialog (read-only by default; lock icon toggles edit, Save to commit) */}
      <ResourceDetailDialog
        resource={resourceDetailItem}
        onClose={() => setResourceDetailItem(null)}
        onSave={async (data) => {
          if (!resourceDetailItem) return;
          await api.updateTrackerResource(resourceDetailItem.id, data);
          toast.success("Resource updated");
          const updated = await api.getTrackerResource(resourceDetailItem.id);
          setResourceDetailItem(updated);
          loadData();
        }}
      />

      {/* Notifications sheet/dialog */}
      <NotificationsDialog
        open={showNotifications}
        onOpenChange={setShowNotifications}
        notifications={notifications}
        onMarkRead={async (id) => {
          await api.markTrackerNotificationRead(id);
          loadData();
        }}
        onMarkAllRead={async () => {
          await api.markAllTrackerNotificationsRead();
          loadData();
        }}
      />
    </div>
  );
}

function ItemFormDialog({
  open,
  onOpenChange,
  item,
  duplicateFrom,
  categories,
  submitting,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TrackerItemWithCategory | null;
  duplicateFrom?: TrackerItemWithCategory | null;
  categories: TrackerCategoryWithCount[];
  submitting: boolean;
  onSave: (data: Parameters<typeof api.createTrackerItem>[0]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [identifierValue, setIdentifierValue] = useState("");
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceInputValue, setResourceInputValue] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [categoryTags, setCategoryTags] = useState<TrackerTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [tagCreating, setTagCreating] = useState(false);
  const [orderDate, setOrderDate] = useState("");
  const [expiryAt, setExpiryAt] = useState("");
  const [recurringType, setRecurringType] = useState<string>("1m");
  const [recurringDays, setRecurringDays] = useState<string>("");
  const [priceUsd, setPriceUsd] = useState("");
  const [notesMd, setNotesMd] = useState("");
  const [tagsAddOpen, setTagsAddOpen] = useState(false);
  const [resourceSuggestions, setResourceSuggestions] = useState<TrackerResource[]>([]);
  const [resourceSuggestionsOpen, setResourceSuggestionsOpen] = useState(false);
  const resourceSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resourceJustSelectedRef = useRef(false);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const identifierLabel = selectedCategory?.identifier_label || "Identifier";

  useEffect(() => {
    if (open) {
      if (item) {
        setName(item.name);
        setIdentifierValue(item.identifier_value ?? "");
        setResourceId(item.resource_id ?? null);
        setResourceInputValue(item.resource_name ?? item.resource_url ?? "");
        setCategoryId(item.category_id || null);
        setTagIds(item.tags?.map((t) => t.id) ?? []);
        setOrderDate(toDatetimeLocal(item.order_date));
        setExpiryAt(toDatetimeLocal(item.expiry_at));
        setRecurringType(item.recurring_period_type || "1m");
        setRecurringDays(item.recurring_period_days?.toString() ?? "");
        setPriceUsd(item.price_usd != null ? item.price_usd.toString() : "");
        setNotesMd(item.notes_md ?? "");
        setResourceSuggestions([]);
        setResourceSuggestionsOpen(false);
      } else if (duplicateFrom) {
        setName(duplicateFrom.name);
        setIdentifierValue(duplicateFrom.identifier_value ?? "");
        setResourceId(duplicateFrom.resource_id ?? null);
        setResourceInputValue(duplicateFrom.resource_name ?? duplicateFrom.resource_url ?? "");
        setCategoryId(duplicateFrom.category_id || null);
        setTagIds(duplicateFrom.tags?.map((t) => t.id) ?? []);
        setOrderDate(toDatetimeLocal(duplicateFrom.order_date));
        setExpiryAt(toDatetimeLocal(duplicateFrom.expiry_at));
        setRecurringType(duplicateFrom.recurring_period_type || "1m");
        setRecurringDays(duplicateFrom.recurring_period_days?.toString() ?? "");
        setPriceUsd(duplicateFrom.price_usd != null ? duplicateFrom.price_usd.toString() : "");
        setNotesMd(duplicateFrom.notes_md ?? "");
        setResourceSuggestions([]);
        setResourceSuggestionsOpen(false);
      } else {
        setName("");
        setIdentifierValue("");
        setResourceId(null);
        setResourceInputValue("");
        setCategoryId(null);
        setResourceSuggestions([]);
        setResourceSuggestionsOpen(false);
        setTagIds([]);
        setOrderDate("");
        setExpiryAt("");
        setRecurringType("1m");
        setRecurringDays("");
        setPriceUsd("");
        setNotesMd("");
      }
    }
  }, [open, item, duplicateFrom]);

  useEffect(() => {
    if (!categoryId) {
      setCategoryTags([]);
      setTagIds([]);
      return;
    }
    api.listTrackerCategoryTags(categoryId).then(setCategoryTags).catch(() => setCategoryTags([]));
  }, [categoryId, open]);

  useEffect(() => {
    if (!open) return;
    const q = resourceInputValue.trim();
    if (q.length < 1) {
      setResourceSuggestions([]);
      setResourceSuggestionsOpen(false);
      return;
    }
    if (resourceSearchDebounceRef.current) clearTimeout(resourceSearchDebounceRef.current);
    resourceSearchDebounceRef.current = setTimeout(() => {
      api.listTrackerResources(resourceInputValue).then((sugs) => {
        setResourceSuggestions(sugs);
        if (!resourceJustSelectedRef.current) setResourceSuggestionsOpen(true);
        resourceJustSelectedRef.current = false;
      }).catch((err) => {
        console.warn("Resource search failed:", err);
        setResourceSuggestions([]);
        setResourceSuggestionsOpen(false);
      });
    }, 200);
    return () => {
      if (resourceSearchDebounceRef.current) {
        clearTimeout(resourceSearchDebounceRef.current);
        resourceSearchDebounceRef.current = null;
      }
    };
  }, [resourceInputValue, open]);

  const onCategoryChange = (v: string) => {
    setCategoryId(v || null);
    setTagIds([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hasResource = resourceId || resourceInputValue.trim();
    if (!name.trim() || !hasResource) {
      toast.error("Name and resource are required");
      return;
    }
    onSave({
      name: name.trim(),
      resource_id: resourceId || undefined,
      resource_name: !resourceId && resourceInputValue.trim() ? resourceInputValue.trim() : undefined,
      identifier_value: identifierValue.trim() || undefined,
      category_id: categoryId || undefined,
      tag_ids: categoryId ? tagIds : undefined,
      order_date: fromDatetimeLocal(orderDate) ?? undefined,
      expiry_at: fromDatetimeLocal(expiryAt) ?? undefined,
      recurring_period_type: recurringType || undefined,
      recurring_period_days: recurringType === "custom" && recurringDays ? parseInt(recurringDays, 10) : undefined,
      price_usd: priceUsd ? parseFloat(priceUsd) : undefined,
      notes_md: notesMd || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-[800px] overflow-hidden p-0 rounded-2xl border-0 shadow-xl">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-base">{item ? "Edit item" : "Add item"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex max-h-[85vh] min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {/* 1. Category — full width */}
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Category</Label>
              <Select value={categoryId ?? ""} onValueChange={onCategoryChange}>
                <SelectTrigger className="rounded-lg h-9 w-full"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}><span className="mr-1">{c.icon}</span>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 2. Tags — only when category selected: label, assigned tags, accordion (Add tag + New tag) */}
            {categoryId && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Tags</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tagIds.map((tid) => {
                    const t = categoryTags.find((x) => x.id === tid) ?? item?.tags?.find((x) => x.id === tid);
                    const label = t ? ("name" in t ? t.name : (t as TrackerItemTagRef).name) : tid.slice(0, 8);
                    const color = t ? ("color" in t ? t.color : (t as TrackerItemTagRef).color) : "#6366f1";
                    return (
                      <Badge key={tid} variant="secondary" className="text-[11px] font-normal pl-2 pr-1 py-0.5 gap-1 rounded-md" style={{ backgroundColor: `${color}22`, color }}>
                        {label}
                        <button type="button" onClick={() => setTagIds((prev) => prev.filter((id) => id !== tid))} className="rounded-full hover:bg-black/10 p-0.5" aria-label="Remove tag"><span className="text-[10px] leading-none">×</span></button>
                      </Badge>
                    );
                  })}
                </div>
                <Collapsible open={tagsAddOpen} onOpenChange={setTagsAddOpen} className="w-full">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <span className="opacity-70">+</span> Add tag
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${tagsAddOpen ? "rotate-180" : ""}`} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                    <div className="space-y-3 pt-1">
                      <Select value="" onValueChange={(v) => { if (v && !tagIds.includes(v)) setTagIds((prev) => [...prev, v]); }}>
                        <SelectTrigger className="w-full h-8 text-xs rounded-lg bg-muted/30 border-0">
                          <SelectValue placeholder="Add existing tag…" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryTags.filter((t) => !tagIds.includes(t.id)).length === 0 ? (
                            <div className="py-2 px-2 text-xs text-muted-foreground">No more tags</div>
                          ) : (
                            categoryTags.filter((t) => !tagIds.includes(t.id)).map((t) => (
                              <SelectItem key={t.id} value={t.id}><span className="inline-block w-2 h-2 rounded-full mr-1.5 shrink-0" style={{ backgroundColor: t.color }} />{t.name}</SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <div className="w-full flex flex-wrap items-center gap-2 pl-0.5">
                        <span className="text-[11px] text-muted-foreground">New tag:</span>
                        <Input placeholder="Tag name" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} className="h-8 flex-1 min-w-[120px] text-sm rounded-lg" />
                        <div className="flex gap-0.5">
                          {CATEGORY_COLORS.slice(0, 8).map((c) => (
                            <button key={c} type="button" onClick={() => setNewTagColor(c)} className={`h-4 w-4 rounded-full border-2 ${newTagColor === c ? "border-foreground scale-110" : "border-transparent"}`} style={{ backgroundColor: c }} title={c} />
                          ))}
                        </div>
                        <Button type="button" size="sm" variant="secondary" className="h-8 text-xs rounded-lg px-3" disabled={!newTagName.trim() || tagCreating}
                          onClick={async () => {
                            const n = newTagName.trim();
                            if (!n || !categoryId) return;
                            setTagCreating(true);
                            try {
                              const created = await api.createTrackerCategoryTag(categoryId, { name: n, color: newTagColor });
                              setCategoryTags((prev) => [...prev, created]);
                              setTagIds((prev) => [...prev, created.id]);
                              setNewTagName("");
                              setNewTagColor("#6366f1");
                              toast.success("Tag added");
                            } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to add tag"); } finally { setTagCreating(false); }
                          }}>Create tag</Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}

            {/* 4. Name, Identifier, Resource */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Name <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BTHost VPS" className="rounded-lg h-9" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">{identifierLabel || "Identifier"}</Label>
                <Input value={identifierValue} onChange={(e) => setIdentifierValue(e.target.value)} placeholder={identifierLabel === "IP" ? "192.168.1.1" : identifierLabel === "Domain" ? "example.com" : "Optional"} className="rounded-lg h-9" />
              </div>
              <div className="space-y-1 sm:col-span-1 relative">
                <Label className="text-xs font-medium text-muted-foreground">Resource <span className="text-destructive">*</span></Label>
                <Input
                  value={resourceInputValue}
                  onChange={(e) => {
                    setResourceInputValue(e.target.value);
                    setResourceId(null);
                  }}
                  onBlur={() => setTimeout(() => setResourceSuggestionsOpen(false), 150)}
                  onFocus={() => resourceSuggestions.length > 0 && setResourceSuggestionsOpen(true)}
                  placeholder="Search or type to create..."
                  className="rounded-lg h-9"
                  required
                  autoComplete="off"
                />
                {resourceSuggestionsOpen && (resourceSuggestions.length > 0 || resourceInputValue.trim()) && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-0.5 rounded-lg border border-border bg-popover shadow-lg py-1 max-h-48 overflow-auto">
                    {resourceSuggestions.map((res) => (
                      <button
                        key={res.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted focus:bg-muted outline-none"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          resourceJustSelectedRef.current = true;
                          setResourceId(res.id);
                          setResourceInputValue(res.name);
                          setResourceSuggestionsOpen(false);
                        }}
                      >
                        {res.name}
                        {res.url && <span className="text-muted-foreground text-xs ml-1 truncate">— {res.url}</span>}
                      </button>
                    ))}
                    {resourceInputValue.trim() && !resourceSuggestions.some((r) => r.name.toLowerCase() === resourceInputValue.trim().toLowerCase()) && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted focus:bg-muted outline-none text-primary font-medium"
                        onMouseDown={async (e) => {
                          e.preventDefault();
                          resourceJustSelectedRef.current = true;
                          const newName = resourceInputValue.trim();
                          try {
                            const created = await api.createTrackerResource({ name: newName });
                            setResourceId(created.id);
                            setResourceInputValue(created.name);
                            setResourceSuggestionsOpen(false);
                            toast.success("Resource created");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed to create resource");
                          }
                        }}
                      >
                        <Plus className="h-3.5 w-3.5 inline mr-2" />
                        Create &quot;{resourceInputValue.trim()}&quot;
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 5. Billing Start, Expiry */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Billing start</Label>
                <DateTimePicker value={orderDate} onChange={setOrderDate} placeholder="Optional" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Expiry</Label>
                <DateTimePicker value={expiryAt} onChange={setExpiryAt} placeholder="Set expiry" />
              </div>
            </div>

            {/* 6. Recurring period, Price */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Recurring period</Label>
                <div className="flex gap-2">
                  <Select value={recurringType} onValueChange={setRecurringType}>
                    <SelectTrigger className="flex-1 rounded-lg h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RECURRING_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {recurringType === "custom" && (
                    <Input type="number" min={1} className="w-20 rounded-lg h-9" value={recurringDays} onChange={(e) => setRecurringDays(e.target.value)} placeholder="days" />
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Price (USD)</Label>
                <Input type="number" step={0.01} min={0} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="0.00" className="rounded-lg h-9" />
              </div>
            </div>

            {/* 7. Notes */}
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
              <Textarea value={notesMd} onChange={(e) => setNotesMd(e.target.value)} rows={3} className="resize-y text-sm rounded-lg" placeholder="Optional markdown notes..." />
              {notesMd && (
                <div className="rounded-lg bg-muted/30 p-3 prose prose-sm max-w-none text-sm dark:prose-invert">
                  <ReactMarkdown>{notesMd}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="px-6 py-3 bg-muted/15">
            <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting} size="sm" className="rounded-lg">{item ? "Update" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResourceDetailDialog({
  resource,
  onClose,
  onSave,
}: {
  resource: TrackerResource | null;
  onClose: () => void;
  onSave: (data: { name: string; url: string | null; notes_md: string | null }) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notesMd, setNotesMd] = useState("");

  useEffect(() => {
    if (resource) {
      setName(resource.name);
      setUrl(resource.url ?? "");
      setNotesMd(resource.notes_md ?? "");
      setIsEditing(false);
    }
  }, [resource]);

  if (!resource) return null;

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await onSave({ name: name.trim(), url: url.trim() || null, notes_md: notesMd.trim() || null });
      setIsEditing(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={resource !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="truncate pr-8">{resource.name}</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-lg"
              onClick={() => setIsEditing((e) => !e)}
              title={isEditing ? "Lock (read-only)" : "Unlock to edit"}
            >
              {isEditing ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </Button>
          </div>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isEditing ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg h-9" required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">URL</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" className="rounded-lg h-9" placeholder="https://..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
                <Textarea value={notesMd} onChange={(e) => setNotesMd(e.target.value)} rows={4} className="resize-y text-sm rounded-lg" placeholder="Optional notes..." />
              </div>
            </>
          ) : (
            <>
              <DetailRow label="Name" value={resource.name} />
              <DetailRow label="URL" value={resource.url ?? "—"} />
              {resource.notes_md?.trim() ? (
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs font-medium">Notes</Label>
                  <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-sm prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{resource.notes_md}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <DetailRow label="Notes" value="—" />
              )}
            </>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="rounded-xl" onClick={onClose}>
            Close
          </Button>
          {isEditing && (
            <Button className="rounded-xl" disabled={submitting || !name.trim()} onClick={handleSave}>
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResourceFormDialog({
  open,
  onOpenChange,
  resource,
  submitting,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: TrackerResource | null;
  submitting: boolean;
  onSave: (data: { name: string; url?: string | null; notes_md?: string | null }) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        {open ? (
          <ResourceFormDialogInner
            key={resource?.id ?? "new"}
            resource={resource}
            submitting={submitting}
            onSave={onSave}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResourceFormDialogInner({
  resource,
  submitting,
  onSave,
  onOpenChange,
}: {
  resource: TrackerResource | null;
  submitting: boolean;
  onSave: (data: { name: string; url?: string | null; notes_md?: string | null }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(() => resource?.name ?? "");
  const [url, setUrl] = useState(() => resource?.url ?? "");
  const [notesMd, setNotesMd] = useState(() => resource?.notes_md ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    onSave({ name: name.trim(), url: url.trim() || null, notes_md: notesMd.trim() || null });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{resource ? "Edit resource" : "New resource"}</DialogTitle>
        <DialogDescription>Name is required. URL and notes are optional.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg h-9" placeholder="Resource name" required />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">URL</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" className="rounded-lg h-9" placeholder="https://..." />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
          <Textarea value={notesMd} onChange={(e) => setNotesMd(e.target.value)} rows={3} className="resize-y text-sm rounded-lg" placeholder="Optional notes..." />
        </div>
        <DialogFooter className="px-6 py-3 bg-muted/15">
          <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={submitting} size="sm" className="rounded-lg">{resource ? "Update" : "Create"}</Button>
        </DialogFooter>
      </form>
    </>
  );
}

type StagedTag = { name: string; color: string };

function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  submitting,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: TrackerCategoryWithCount | null;
  submitting: boolean;
  onSave: (data: { name: string; icon: string; color: string; notify_days_before?: number; identifier_label?: string }, stagedTags?: StagedTag[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📁");
  const [color, setColor] = useState("#6366f1");
  const [notifyDays, setNotifyDays] = useState("3");
  const [identifierLabel, setIdentifierLabel] = useState("");
  const [categoryTags, setCategoryTags] = useState<TrackerTag[]>([]);
  const [stagedTags, setStagedTags] = useState<StagedTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [tagSaving, setTagSaving] = useState(false);
  const [editingTag, setEditingTag] = useState<TrackerTag | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagColor, setEditTagColor] = useState("#6366f1");

  useEffect(() => {
    if (open) {
      if (category) {
        setName(category.name);
        setIcon(category.icon);
        setColor(category.color);
        setNotifyDays(category.notify_days_before.toString());
        setIdentifierLabel(category.identifier_label ?? "");
        setStagedTags([]);
        api.listTrackerCategoryTags(category.id).then(setCategoryTags).catch(() => setCategoryTags([]));
      } else {
        setName("");
        setIcon("📁");
        setColor("#6366f1");
        setNotifyDays("3");
        setIdentifierLabel("");
        setCategoryTags([]);
        setStagedTags([]);
      }
      setNewTagName("");
      setNewTagColor("#6366f1");
    }
  }, [open, category]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: name.trim(),
      icon,
      color,
      notify_days_before: parseInt(notifyDays, 10) || 3,
      identifier_label: identifierLabel.trim() || undefined,
    };
    if (category) {
      onSave(payload);
    } else {
      onSave(payload, stagedTags.length ? stagedTags : undefined);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>Set name, icon and color. Notify days before expiry (default 3).</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Servers" required />
          </div>
          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setIcon(em)}
                  className={`text-xl p-1.5 rounded-md border-2 transition-colors ${icon === em ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Identifier label (optional)</Label>
            <Input value={identifierLabel} onChange={(e) => setIdentifierLabel(e.target.value)} placeholder="e.g. IP, Domain" className="rounded-xl" />
            <p className="text-xs text-muted-foreground">Label for the optional identifier field on items in this category.</p>
          </div>
          <div className="space-y-2">
            <Label>Notify (days before expiry)</Label>
            <Input type="number" min={0} value={notifyDays} onChange={(e) => setNotifyDays(e.target.value)} className="rounded-xl" />
          </div>

          {!category && (
            <div className="space-y-2">
              <Label>Tags (optional)</Label>
              <p className="text-xs text-muted-foreground">Add tags to create with the category. You can add more later in edit.</p>
              <div className="flex flex-wrap gap-2">
                {stagedTags.map((t, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="text-xs font-normal pl-2 pr-1 py-0.5 gap-1"
                    style={{ backgroundColor: `${t.color}22`, color: t.color }}
                  >
                    {t.name}
                    <button
                      type="button"
                      onClick={() => setStagedTags((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded-full hover:bg-black/10 p-0.5"
                      aria-label="Remove tag"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap items-end">
                <Input
                  placeholder="Tag name"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="flex-1 min-w-[120px]"
                />
                <div className="flex gap-1 flex-wrap">
                  {CATEGORY_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewTagColor(c)}
                      className={`h-6 w-6 rounded-full border-2 transition-transform ${newTagColor === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!newTagName.trim()}
                  onClick={() => {
                    const n = newTagName.trim();
                    if (!n) return;
                    setStagedTags((prev) => [...prev, { name: n, color: newTagColor }]);
                    setNewTagName("");
                    setNewTagColor("#6366f1");
                  }}
                >
                  Add tag
                </Button>
              </div>
            </div>
          )}

          {category && (
            <>
              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-2">
                  {categoryTags.map((t) => (
                    <Badge
                      key={t.id}
                      variant="secondary"
                      className="text-xs font-normal pl-2 pr-1 py-0.5 gap-1"
                      style={{ backgroundColor: `${t.color}22`, color: t.color }}
                    >
                      {t.name}
                      <Popover open={editingTag?.id === t.id} onOpenChange={(open) => { if (!open) setEditingTag(null); }}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            onClick={() => { setEditingTag(t); setEditTagName(t.name); setEditTagColor(t.color); }}
                            className="rounded-full hover:bg-black/10 p-0.5"
                            aria-label="Edit tag"
                            disabled={tagSaving}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-3" align="start">
                          <div className="space-y-2">
                            <Input
                              value={editTagName}
                              onChange={(e) => setEditTagName(e.target.value)}
                              placeholder="Tag name"
                              className="h-8"
                            />
                            <div className="flex gap-1 flex-wrap">
                              {CATEGORY_COLORS.map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => setEditTagColor(c)}
                                  className={`h-5 w-5 rounded-full border-2 ${editTagColor === c ? "border-foreground" : "border-transparent"}`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="w-full"
                              disabled={!editTagName.trim() || tagSaving}
                              onClick={async () => {
                                if (!editTagName.trim() || !editingTag) return;
                                setTagSaving(true);
                                try {
                                  const updated = await api.updateTrackerTag(editingTag.id, { name: editTagName.trim(), color: editTagColor });
                                  setCategoryTags((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                                  setEditingTag(null);
                                  toast.success("Tag updated");
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Failed to update tag");
                                } finally {
                                  setTagSaving(false);
                                }
                              }}
                            >
                              Update
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm("Remove this tag from the category?")) return;
                          setTagSaving(true);
                          try {
                            await api.deleteTrackerTag(t.id);
                            setCategoryTags((prev) => prev.filter((x) => x.id !== t.id));
                            setEditingTag((prev) => (prev?.id === t.id ? null : prev));
                            toast.success("Tag removed");
                          } catch {
                            toast.error("Failed to remove tag");
                          } finally {
                            setTagSaving(false);
                          }
                        }}
                        className="rounded-full hover:bg-black/10 p-0.5"
                        aria-label="Delete tag"
                        disabled={tagSaving}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap items-end">
                  <Input
                    placeholder="New tag name"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    className="flex-1 min-w-[120px]"
                  />
                  <div className="flex gap-1 flex-wrap">
                    {CATEGORY_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewTagColor(c)}
                        className={`h-6 w-6 rounded-full border-2 transition-transform ${newTagColor === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!newTagName.trim() || tagSaving}
                    onClick={async () => {
                      const n = newTagName.trim();
                      if (!n || !category) return;
                      setTagSaving(true);
                      try {
                        const created = await api.createTrackerCategoryTag(category.id, { name: n, color: newTagColor });
                        setCategoryTags((prev) => [...prev, created]);
                        setNewTagName("");
                        setNewTagColor("#6366f1");
                        toast.success("Tag added");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed to add tag");
                      } finally {
                        setTagSaving(false);
                      }
                    }}
                  >
                    Add tag
                  </Button>
                </div>
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{category ? "Update" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaidDialog({
  open,
  onOpenChange,
  item,
  submitting,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TrackerItemWithCategory | null;
  submitting: boolean;
  onPaid: (data: { expiry_at?: string | null; recurring_period_type?: string; recurring_period_days?: number; amount_usd?: number }) => Promise<void>;
}) {
  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <PaidDialogInner key={item.id} item={item} submitting={submitting} onPaid={onPaid} onOpenChange={onOpenChange} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PaidDialogInner({
  item,
  submitting,
  onPaid,
  onOpenChange,
}: {
  item: TrackerItemWithCategory;
  submitting: boolean;
  onPaid: (data: { expiry_at?: string | null; recurring_period_type?: string; recurring_period_days?: number; amount_usd?: number }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [recurringType, setRecurringType] = useState(() => item.recurring_period_type || "1m");
  const [recurringDays, setRecurringDays] = useState(() => item.recurring_period_days?.toString() ?? "");
  const [expiryOverride, setExpiryOverride] = useState("");
  const [amountUsd, setAmountUsd] = useState(() => item.price_usd?.toString() ?? "");

  const now = new Date();
  const baseExpiry = item.expiry_at && new Date(item.expiry_at) > now ? new Date(item.expiry_at) : now;
  const addPeriod = (d: Date, type: string, days: number) => {
    const next = new Date(d);
    if (type === "1m") next.setMonth(next.getMonth() + 1);
    else if (type === "3m") next.setMonth(next.getMonth() + 3);
    else if (type === "6m") next.setMonth(next.getMonth() + 6);
    else if (type === "12m") next.setFullYear(next.getFullYear() + 1);
    else if (type === "custom" && days) next.setDate(next.getDate() + days);
    return next;
  };
  const computedExpiry = addPeriod(baseExpiry, recurringType, parseInt(recurringDays, 10) || 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onPaid({
      expiry_at: expiryOverride ? new Date(expiryOverride).toISOString() : computedExpiry.toISOString(),
      recurring_period_type: recurringType,
      recurring_period_days: recurringType === "custom" && recurringDays ? parseInt(recurringDays, 10) : undefined,
      amount_usd: amountUsd ? parseFloat(amountUsd) : undefined,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Mark as paid</DialogTitle>
        <DialogDescription>Record renewal for &quot;{item.name}&quot;. New expiry is computed from the selected period; you can override it.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Renewal period</Label>
          <div className="flex gap-2 items-center">
            <Select value={recurringType} onValueChange={setRecurringType}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRING_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recurringType === "custom" && (
              <Input type="number" min={1} className="w-20" value={recurringDays} onChange={(e) => setRecurringDays(e.target.value)} placeholder="30" />
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label>New expiry (computed)</Label>
          <p className="text-sm text-muted-foreground">{computedExpiry.toLocaleString()}</p>
        </div>
        <div className="space-y-2">
          <Label>Override expiry (optional)</Label>
          <DateTimePicker value={expiryOverride} onChange={setExpiryOverride} placeholder="Override expiry date" />
        </div>
        <div className="space-y-2">
          <Label>Amount paid (USD, optional)</Label>
          <Input type="number" step={0.01} value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder={item.price_usd?.toString() ?? ""} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Record paid
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function NotificationInbox({
  notifications,
  onMarkRead,
  onMarkAllRead,
}: {
  notifications: TrackerNotificationWithItem[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
}) {
  const unread = notifications.filter((n) => !n.read_at);
  if (notifications.length === 0) {
    return (
      <div className="rounded-2xl bg-card shadow-sm border-0 p-8">
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Bell className="h-10 w-10 mb-2 opacity-50" />
          <p>No notifications yet.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-card shadow-sm border-0 overflow-hidden">
      <div className="flex flex-row items-center justify-between px-5 py-4">
        <h3 className="font-semibold text-lg">Inbox</h3>
        {unread.length > 0 && (
          <Button variant="outline" size="sm" className="rounded-xl" onClick={onMarkAllRead}>
            Mark all read
          </Button>
        )}
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        <div className="flex flex-col gap-1 px-4 pb-4">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-4 py-3 rounded-xl ${!n.read_at ? "bg-muted/40" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">{n.title}</div>
                {n.body && <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>}
                {n.item_name && <p className="text-xs text-muted-foreground mt-1">Item: {n.item_name}</p>}
                <p className="text-xs text-muted-foreground mt-1">{formatDate(n.created_at)}</p>
              </div>
              {!n.read_at && (
                <Button variant="ghost" size="sm" onClick={() => onMarkRead(n.id)}>
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotificationsDialog({
  open,
  onOpenChange,
  notifications,
  onMarkRead,
  onMarkAllRead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: TrackerNotificationWithItem[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
}) {
  const unread = notifications.filter((n) => !n.read_at);
  const [permTick, setPermTick] = useState(0);
  const permState = useMemo((): NotificationPermission => {
    if (typeof window === "undefined" || !("Notification" in window)) return "default";
    return Notification.permission;
  }, [open, permTick]);
  const requestPermission = () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      Notification.requestPermission().then(() => setPermTick((t) => t + 1));
    }
  };
  const showEnableDesktop = typeof window !== "undefined" && "Notification" in window && permState === "default";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0">
          <DialogTitle>Notifications</DialogTitle>
          <div className="flex items-center gap-2">
            {showEnableDesktop && (
              <Button variant="outline" size="sm" onClick={requestPermission}>
                Enable desktop notifications
              </Button>
            )}
            {unread.length > 0 && (
              <Button variant="outline" size="sm" onClick={onMarkAllRead}>
                Mark all read
              </Button>
            )}
          </div>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 -mx-6 px-6 divide-y">
          {notifications.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">No notifications.</p>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className={`py-3 ${!n.read_at ? "bg-muted/30 -mx-2 px-2 rounded" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{n.title}</p>
                    {n.body && <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(n.created_at)}</p>
                  </div>
                  {!n.read_at && (
                    <Button variant="ghost" size="sm" onClick={() => onMarkRead(n.id)}>
                      Mark read
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
