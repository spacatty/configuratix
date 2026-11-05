"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";

const WIDTH_KEY = "cfx.sidebar.width";
const OPEN_KEY = "cfx.sidebar.open";
export const SIDEBAR_MIN_WIDTH = 208;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 248;

const clamp = (w: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)));

function read(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the preference just won't persist
  }
}

/**
 * Persisted sidebar width + collapsed state. Spread the result onto SidebarProvider.
 * Read lazily on the client; the dashboard layout only renders the sidebar after the
 * auth check, so there is no SSR markup for these values to mismatch.
 */
export function useSidebarPrefs() {
  const [width] = React.useState(() => {
    const n = Number(read(WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? clamp(n) : SIDEBAR_DEFAULT_WIDTH;
  });
  const [open, setOpen] = React.useState(() => read(OPEN_KEY) !== "false");
  const onOpenChange = React.useCallback((o: boolean) => {
    setOpen(o);
    write(OPEN_KEY, String(o));
  }, []);
  const style = React.useMemo(() => ({ "--sidebar-width": `${width}px` }) as React.CSSProperties, [width]);
  return { open, onOpenChange, style };
}

function currentWidth(wrapper: HTMLElement): number {
  const raw = getComputedStyle(wrapper).getPropertyValue("--sidebar-width").trim();
  const n = parseFloat(raw);
  if (raw.endsWith("rem")) return n * parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
  return Number.isFinite(n) ? n : SIDEBAR_DEFAULT_WIDTH;
}

/**
 * Edge handle: drag to resize (persisted), click to collapse/expand.
 * Replaces shadcn's SidebarRail. While dragging, the width is written straight to the
 * wrapper's CSS variable (no React re-render per pixel) and transitions are disabled.
 */
export function SidebarResizeRail({ className }: { className?: string }) {
  const { state, toggleSidebar } = useSidebar();
  const drag = React.useRef<{ x: number; w: number; moved: boolean; wrapper: HTMLElement } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const wrapper = e.currentTarget.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');
    if (!wrapper) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: currentWidth(wrapper), moved: false, wrapper };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    if (state === "collapsed") return; // collapsed: the handle only toggles
    d.moved = true;
    d.wrapper.dataset.resizing = "true";
    d.wrapper.style.setProperty("--sidebar-width", `${clamp(d.w + dx)}px`);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    delete d.wrapper.dataset.resizing;
    if (d.moved) write(WIDTH_KEY, String(currentWidth(d.wrapper)));
    else toggleSidebar();
  };

  const onDoubleClick = () => {
    const wrapper = document.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]');
    if (!wrapper || state === "collapsed") return;
    wrapper.style.setProperty("--sidebar-width", `${SIDEBAR_DEFAULT_WIDTH}px`);
    write(WIDTH_KEY, String(SIDEBAR_DEFAULT_WIDTH));
  };

  return (
    <button
      type="button"
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Resize or toggle sidebar"
      title={state === "collapsed" ? "Expand sidebar" : "Drag to resize · click to collapse · double-click to reset"}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      className={cn(
        "absolute inset-y-0 -right-2 z-20 hidden w-4 touch-none sm:flex",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors",
        "hover:after:bg-primary/50 in-data-[state=expanded]:cursor-col-resize in-data-[state=collapsed]:cursor-e-resize",
        className
      )}
    />
  );
}

const GROUPS_KEY = "cfx.sidebar.groups";

function readGroups(): Record<string, boolean> {
  try {
    const v = JSON.parse(read(GROUPS_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Open/closed state of a collapsible nav group, persisted per group id. */
export function usePersistedGroupOpen(id: string, fallback: boolean) {
  const [open, setOpenState] = React.useState(() => readGroups()[id] ?? fallback);
  const setOpen = React.useCallback(
    (o: boolean) => {
      setOpenState(o);
      write(GROUPS_KEY, JSON.stringify({ ...readGroups(), [id]: o }));
    },
    [id]
  );
  return [open, setOpen] as const;
}
