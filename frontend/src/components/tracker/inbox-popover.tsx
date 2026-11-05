"use client";

import * as React from "react";
import { Bell, BellRing, CheckCheck, Inbox } from "lucide-react";
import type { TrackerNotificationWithItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, RelativeTime } from "@/components/app";
import { cn } from "@/lib/utils";

function usePermission(open: boolean) {
  const [perm, setPerm] = React.useState<NotificationPermission | "unsupported">("default");
  React.useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) setPerm("unsupported");
    else setPerm(Notification.permission);
  }, [open]);
  const request = () => {
    if (typeof window !== "undefined" && "Notification" in window) Notification.requestPermission().then(setPerm);
  };
  return [perm, request] as const;
}

export function InboxPopover({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onOpenItem,
}: {
  notifications: TrackerNotificationWithItem[];
  onMarkRead: (id: string) => Promise<void> | void;
  onMarkAllRead: () => Promise<void> | void;
  onOpenItem: (itemId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<"unread" | "all">("unread");
  const [perm, requestPerm] = usePermission(open);
  const unread = notifications.filter((n) => !n.read_at);
  const list = filter === "unread" ? unread : notifications;

  React.useEffect(() => {
    if (open) setFilter(unread.length ? "unread" : "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative text-muted-foreground hover:text-foreground" aria-label={`Inbox, ${unread.length} unread`}>
          {unread.length ? <BellRing /> : <Bell />}
          Inbox
          {unread.length > 0 && (
            <span className="font-data -mr-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none text-primary-foreground">
              {unread.length > 99 ? "99+" : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-[13px] font-medium">Inbox</span>
          <ToggleGroup type="single" size="sm" variant="outline" value={filter} onValueChange={(v) => v && setFilter(v as "unread" | "all")} className="ml-auto">
            <ToggleGroupItem value="unread">
              Unread <span className="font-data text-[11px] text-subtle-foreground">{unread.length}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="ghost" size="icon-sm" aria-label="Mark all read" title="Mark all read" disabled={!unread.length} onClick={() => onMarkAllRead()}>
            <CheckCheck />
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {list.length === 0 ? (
            <EmptyState
              size="compact"
              bordered={false}
              icon={Inbox}
              title={filter === "unread" ? "You're all caught up" : "No notifications yet"}
              description="Renewal reminders appear here before items expire."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read_at) onMarkRead(n.id);
                      if (n.item_id) {
                        onOpenItem(n.item_id);
                        setOpen(false);
                      }
                    }}
                    className="flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2/60"
                  >
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-[13px]", !n.read_at && "font-medium")}>{n.title}</span>
                        <RelativeTime date={n.created_at} className="shrink-0 text-[11px] text-subtle-foreground" />
                      </div>
                      {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                      {n.item_name && <p className="truncate text-[11px] text-subtle-foreground">{n.item_name}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {perm === "default" && (
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Get desktop alerts for new reminders
            <Button size="xs" variant="outline" onClick={requestPerm}>
              Enable
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
