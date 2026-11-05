"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileCode2, Globe, KeyRound, ListChecks, LogOut, Search, Server, Terminal, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { api, type Domain, type Machine } from "@/lib/api";
import { fuzzyFilter } from "@/lib/fuzzy";
import { machineDisplayName, machineIp, machineLiveness } from "@/lib/jobs";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/app/status";
import { visibleSections } from "@/components/app/nav";
import { AddMachineDialog } from "@/components/machines/add-machine-dialog";

type PaletteApi = {
  open: (initialSearch?: string) => void;
  /** Run a quick action by its slash (e.g. "/new") without opening the palette. */
  runQuickAction: (slash: string) => void;
};

const PaletteCtx = React.createContext<PaletteApi | null>(null);

type QuickAction = {
  slash: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  keywords: string[];
  /** "create" actions also appear in the sidebar "+" menu. */
  kind: "create" | "navigate";
  run: (ctx: { go: (href: string) => void; newToken: () => void }) => void;
};

/** Public metadata of a quick action (no runner). */
export type QuickActionInfo = Pick<QuickAction, "slash" | "title" | "hint" | "icon" | "kind">;

/** Slash commands: type "/new" (or press "/" anywhere) and hit Enter. */
const QUICK_ACTIONS: QuickAction[] = [
  {
    slash: "/new",
    kind: "create",
    title: "New enrollment token",
    hint: "Add a machine with a one-line install command",
    icon: KeyRound,
    keywords: ["token", "enroll", "enrollment", "add machine", "install", "agent", "server"],
    run: ({ newToken }) => newToken(),
  },
  {
    slash: "/domain",
    kind: "create",
    title: "Add domains",
    hint: "Paste one or many hostnames",
    icon: Globe,
    keywords: ["domain", "add", "create", "hostname"],
    run: ({ go }) => go("/domains?new=1"),
  },
  {
    slash: "/config",
    kind: "create",
    title: "New nginx config",
    hint: "Open the config editor",
    icon: FileCode2,
    keywords: ["nginx", "config", "create"],
    run: ({ go }) => go("/configs/nginx/new"),
  },
  {
    slash: "/run",
    kind: "create",
    title: "Run a command",
    hint: "Execute a template on a machine",
    icon: Terminal,
    keywords: ["command", "exec", "execute", "run"],
    run: ({ go }) => go("/commands"),
  },
  {
    slash: "/jobs",
    kind: "navigate",
    title: "Open jobs",
    hint: "Live activity across the fleet",
    icon: ListChecks,
    keywords: ["jobs", "activity", "logs"],
    run: ({ go }) => go("/jobs"),
  },
];

const QUICK_ACTION_INFO: QuickActionInfo[] = QUICK_ACTIONS.map(({ slash, title, hint, icon, kind }) => ({ slash, title, hint, icon, kind }));

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.(".monaco-editor, .xterm");
}

const NOOP_PALETTE: PaletteApi = { open: () => {}, runQuickAction: () => {} };

/** Open the ⌘K palette programmatically. */
export function useCommandPalette() {
  const ctx = React.useContext(PaletteCtx);
  return ctx ?? NOOP_PALETTE;
}

/**
 * Quick actions (the palette's slash commands) runnable directly, e.g. from a "+" menu:
 *
 *   const { actions, run } = useQuickActions();
 *   actions.filter((a) => a.kind === "create").map((a) => <Item onSelect={() => run(a.slash)} />)
 */
export function useQuickActions(): { actions: QuickActionInfo[]; run: (slash: string) => void } {
  const { runQuickAction } = useCommandPalette();
  return React.useMemo(() => ({ actions: QUICK_ACTION_INFO, run: runQuickAction }), [runQuickAction]);
}

export function CommandPaletteProvider({
  children,
  role,
  onLogout,
}: {
  children: React.ReactNode;
  role?: string | null;
  onLogout?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [initialSearch, setInitialSearch] = React.useState("");
  const [tokenOpen, setTokenOpen] = React.useState(false);
  const [knownIds, setKnownIds] = React.useState<string[]>([]);

  // The dialog detects enrollment by diffing against the machines that existed when it opened.
  const newToken = React.useCallback(() => {
    api
      .listMachines()
      .then((ms) => setKnownIds(ms.map((m) => m.id)))
      .catch(() => setKnownIds([]))
      .finally(() => setTokenOpen(true));
  }, []);

  const value = React.useMemo<PaletteApi>(
    () => ({
      open: (s?: string) => {
        setInitialSearch(s ?? "");
        setOpen(true);
      },
      runQuickAction: (slash: string) => {
        const a = QUICK_ACTIONS.find((x) => x.slash === slash);
        a?.run({ go: (href) => router.push(href), newToken });
      },
    }),
    [router, newToken]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setInitialSearch("");
        setOpen((o) => !o);
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setInitialSearch("/");
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PaletteCtx.Provider value={value}>
      {children}
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        initialSearch={initialSearch}
        role={role}
        onLogout={onLogout}
        onNewToken={newToken}
      />
      <AddMachineDialog
        open={tokenOpen}
        onOpenChange={setTokenOpen}
        knownMachineIds={knownIds}
        onEnrolled={(m) => router.push(`/machines/${m.id}`)}
      />
    </PaletteCtx.Provider>
  );
}

function CommandPalette({
  open,
  onOpenChange,
  initialSearch,
  role,
  onLogout,
  onNewToken,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialSearch: string;
  role?: string | null;
  onLogout?: () => void;
  onNewToken: () => void;
}) {
  const router = useRouter();
  const [machines, setMachines] = React.useState<Machine[] | null>(null);
  const [domains, setDomains] = React.useState<Domain[] | null>(null);
  const [search, setSearch] = React.useState("");
  const loadedAt = React.useRef(0);

  // Lazy-load entities when opened (refresh at most every 60s)
  React.useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    setSearch(initialSearch);
    if (Date.now() - loadedAt.current < 60_000 && machines && domains) return;
    loadedAt.current = Date.now();
    api.listMachines().then(setMachines).catch(() => setMachines([]));
    api.listDomains().then(setDomains).catch(() => setDomains([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const sections = visibleSections(role);
  const q = search.trim();
  // "/..." switches the palette into command mode: only quick actions, matched by slash prefix.
  const slashMode = q.startsWith("/");
  const slashWord = q.toLowerCase().split(/\s+/)[0];
  const actions = slashMode ? QUICK_ACTIONS.filter((a) => a.slash.startsWith(slashWord)) : QUICK_ACTIONS;
  const runAction = (a: QuickAction) => {
    onOpenChange(false);
    a.run({ go: (href) => router.push(href), newToken: onNewToken });
  };
  // Keep entity groups small until the user types
  const machineLimit = q ? 30 : 5;
  const domainLimit = q ? 30 : 5;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to pages, machines and domains"
      commandProps={{ filter: slashMode ? () => 1 : fuzzyFilter, loop: true }}
    >
      <CommandInput
        placeholder="Search pages, machines, domains, IPs… or type / for actions"
        value={search}
        onValueChange={setSearch}
        wrapperClassName="h-12"
        className="h-12 text-sm"
      />
      <CommandList className="max-h-[min(460px,60vh)] p-1">
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            No results for “{q}”
          </div>
        </CommandEmpty>

        {actions.length > 0 && (
          <CommandGroup heading="Quick actions">
            {actions.map((a) => (
              <CommandItem
                key={a.slash}
                value={`action:${a.slash}`}
                keywords={[a.slash, a.title, ...a.keywords]}
                onSelect={() => runAction(a)}
              >
                <a.icon />
                <span>{a.title}</span>
                <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{a.hint}</span>
                <CommandShortcut className="font-data tracking-normal text-primary/90">{a.slash}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!slashMode && sections.map((s) => (
          <CommandGroup key={s.title} heading={s.title}>
            {s.items.flatMap((item) => {
              const rows = item.children?.length ? item.children.map((c) => ({ ...c, parent: item.title })) : [{ ...item, parent: undefined as string | undefined }];
              return rows.map((r) => (
                <CommandItem
                  key={r.href + r.title}
                  value={`nav:${r.href}:${r.title}`}
                  keywords={[r.title, r.parent ?? "", s.title, ...(r.keywords ?? []), ...(item.keywords ?? [])]}
                  onSelect={() => go(r.href)}
                >
                  <r.icon />
                  <span>{r.parent && r.title !== r.parent ? `${r.parent} › ${r.title}` : r.title}</span>
                  <CommandShortcut className="tracking-normal">{r.href}</CommandShortcut>
                </CommandItem>
              ));
            })}
          </CommandGroup>
        ))}

        {!slashMode && (
        <>
        <CommandSeparator className="my-1" />
        <CommandGroup heading="Machines">
          {machines === null ? (
            <div className="space-y-1 px-2 py-1">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-4/5" />
            </div>
          ) : (
            machines.slice(0, q ? machines.length : machineLimit).map((m) => {
              const ip = machineIp(m);
              return (
                <CommandItem
                  key={m.id}
                  value={`machine:${m.id}`}
                  keywords={[
                    machineDisplayName(m),
                    m.hostname ?? "",
                    m.title ?? "",
                    ip ?? "",
                    m.ip_address ?? "",
                    ...(m.detected_ips ?? []).map((d) => d.ip),
                    m.project_name ?? "",
                    "machine",
                    "server",
                  ]}
                  onSelect={() => go(`/machines/${m.id}`)}
                >
                  <Server />
                  <StatusDot status={machineLiveness(m)} pulse={false} size="xs" />
                  <span className="truncate">{machineDisplayName(m)}</span>
                  {m.hostname && m.hostname !== machineDisplayName(m) && (
                    <span className="font-data truncate text-[11px] text-muted-foreground">{m.hostname}</span>
                  )}
                  {ip && <CommandShortcut className="tracking-normal">{ip}</CommandShortcut>}
                </CommandItem>
              );
            })
          )}
        </CommandGroup>

        <CommandGroup heading="Domains">
          {domains === null ? (
            <div className="space-y-1 px-2 py-1">
              <Skeleton className="h-7 w-full" />
            </div>
          ) : (
            domains.slice(0, q ? domains.length : domainLimit).map((d) => (
              <CommandItem
                key={d.id}
                value={`domain:${d.id}`}
                keywords={[d.fqdn, d.machine_name ?? "", d.machine_ip ?? "", d.config_name ?? "", "domain"]}
                onSelect={() => go(`/domains?q=${encodeURIComponent(d.fqdn)}`)}
              >
                <Globe />
                <StatusDot status={d.status || "unknown"} pulse={false} size="xs" />
                <span className="font-data truncate text-[12.5px]">{d.fqdn}</span>
                {d.machine_name && <CommandShortcut className="tracking-normal">{d.machine_name}</CommandShortcut>}
              </CommandItem>
            ))
          )}
        </CommandGroup>

        </>
        )}

        {onLogout && !slashMode && (
          <CommandGroup heading="Session">
            <CommandItem
              value="action:logout"
              keywords={["sign out", "logout", "log out"]}
              onSelect={() => {
                onOpenChange(false);
                onLogout();
              }}
            >
              <LogOut />
              Sign out
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Kbd>/</Kbd> actions
        </span>
      </div>
    </CommandDialog>
  );
}

/** Top-bar search button that opens the palette. */
export function CommandPaletteTrigger({ className }: { className?: string }) {
  const { open } = useCommandPalette();
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  return (
    <button
      type="button"
      onClick={() => open()}
      className={cn(
        "group inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card/60 pr-1.5 pl-2.5 text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 outline-none",
        className
      )}
    >
      <Search className="size-3.5" />
      <span className="hidden flex-1 text-left lg:inline">Search or jump to…</span>
      <span className="ml-auto hidden items-center gap-0.5 sm:inline-flex">
        <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}
