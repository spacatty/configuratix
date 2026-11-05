"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe, LogOut, Search, Server } from "lucide-react";

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

const PaletteCtx = React.createContext<{ open: () => void } | null>(null);

/** Open the ⌘K palette programmatically. */
export function useCommandPalette() {
  const ctx = React.useContext(PaletteCtx);
  return ctx ?? { open: () => {} };
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
  const [open, setOpen] = React.useState(false);
  const value = React.useMemo(() => ({ open: () => setOpen(true) }), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PaletteCtx.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} role={role} onLogout={onLogout} />
    </PaletteCtx.Provider>
  );
}

function CommandPalette({
  open,
  onOpenChange,
  role,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role?: string | null;
  onLogout?: () => void;
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
    if (Date.now() - loadedAt.current < 60_000 && machines && domains) return;
    loadedAt.current = Date.now();
    api.listMachines().then(setMachines).catch(() => setMachines([]));
    api.listDomains().then(setDomains).catch(() => setDomains([]));
  }, [open, machines, domains]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const sections = visibleSections(role);
  const q = search.trim();
  // Keep entity groups small until the user types
  const machineLimit = q ? 30 : 5;
  const domainLimit = q ? 30 : 5;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to pages, machines and domains"
      commandProps={{ filter: fuzzyFilter, loop: true }}
    >
      <CommandInput
        placeholder="Search pages, machines, domains, IPs…"
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

        {sections.map((s) => (
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

        {onLogout && (
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
      onClick={open}
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
