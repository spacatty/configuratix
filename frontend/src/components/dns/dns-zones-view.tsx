"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, Globe, MoreHorizontal, Network, Plus, RefreshCw, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, type DNSAccount, type DNSManagedDomain } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CopyButton,
  EmptyState,
  ErrorState,
  PageHeader,
  RelativeTime,
  Spinner,
  StatCard,
  StatStrip,
  errorMessage,
  useConfirm,
  usePolling,
} from "@/components/app";

import { AddDNSZoneDialog } from "./add-dns-zone-dialog";
import { DNSAccountDialog } from "./dns-account-dialog";
import { DNSAccountsCard } from "./dns-accounts-card";
import { nsMeta, providerMeta, proxyModeMeta } from "./dns-utils";
import { NSBadge, ProviderLabel } from "./provider-badge";

export function DNSZonesView() {
  const router = useRouter();
  const confirm = useConfirm();

  const zonesQ = usePolling(() => api.listDNSManagedDomains(), 30000);
  const accountsQ = usePolling(() => api.listDNSAccounts(), 0);
  const zones = React.useMemo(() => zonesQ.data ?? [], [zonesQ.data]);
  const accounts = React.useMemo(() => accountsQ.data ?? [], [accountsQ.data]);

  // Record counts (best effort, one request per zone)
  const zoneKey = zones.map((z) => z.id).join(",");
  const countsQ = usePolling(
    async () => {
      const entries = await Promise.all(
        zones.map(async (z) => {
          try {
            const r = await api.listDNSRecords(z.id);
            return [z.id, r.length] as const;
          } catch {
            return [z.id, null] as const;
          }
        })
      );
      return Object.fromEntries(entries) as Record<string, number | null>;
    },
    0,
    { enabled: zones.length > 0, deps: [zoneKey] }
  );
  const counts = React.useMemo(() => countsQ.data ?? {}, [countsQ.data]);

  const [addOpen, setAddOpen] = React.useState(false);
  const [accountDialog, setAccountDialog] = React.useState<{ open: boolean; account: DNSAccount | null }>({ open: false, account: null });
  const [checking, setChecking] = React.useState<Set<string>>(new Set());

  const zoneCounts = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const z of zones) if (z.dns_account_id) out[z.dns_account_id] = (out[z.dns_account_id] ?? 0) + 1;
    return out;
  }, [zones]);

  const checkNS = React.useCallback(
    async (z: DNSManagedDomain) => {
      setChecking((s) => new Set(s).add(z.id));
      try {
        const r = await api.checkDNSDomainNS(z.id);
        if (r.valid) toast.success(`${z.fqdn}: nameservers OK`);
        else toast.warning(`${z.fqdn}: ${nsMeta(r.status).label}`, { description: r.message });
        void zonesQ.refresh();
      } catch (e) {
        toast.error(`NS check failed for ${z.fqdn}`, { description: errorMessage(e) });
      } finally {
        setChecking((s) => {
          const n = new Set(s);
          n.delete(z.id);
          return n;
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zonesQ.refresh]
  );

  const remove = React.useCallback(
    async (z: DNSManagedDomain) => {
      const ok = await confirm({
        title: `Remove ${z.fqdn} from DNS management?`,
        description: "Local records, pools and history are deleted. Records at the provider are NOT changed.",
        destructive: true,
        confirmText: "Remove zone",
        typeToConfirm: z.fqdn,
        onConfirm: () => api.deleteDNSManagedDomain(z.id),
      });
      if (ok) {
        toast.success(`${z.fqdn} removed`);
        void zonesQ.refresh();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, zonesQ.refresh]
  );

  const columns = React.useMemo<ColumnDef<DNSManagedDomain>[]>(
    () => [
      {
        accessorKey: "fqdn",
        header: "Zone",
        cell: ({ row }) => (
          <div className="group/z flex items-center gap-1.5">
            <Link href={`/domains/dns/${row.original.id}`} className="font-data text-[12.5px] font-medium hover:underline">
              {row.original.fqdn}
            </Link>
            <span className="opacity-0 transition-opacity group-hover/z:opacity-100">
              <CopyButton value={row.original.fqdn} label="Copy zone" />
            </span>
          </div>
        ),
      },
      {
        id: "provider",
        accessorFn: (z) => providerMeta(z.dns_account_provider)?.label ?? "Manual",
        header: "Provider",
        cell: ({ row }) => (
          <ProviderLabel provider={row.original.dns_account_provider} account={row.original.dns_account_name} />
        ),
      },
      {
        id: "ns",
        accessorFn: (z) => nsMeta(z.ns_status).label,
        header: "Nameservers",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <NSBadge status={row.original.ns_status} />
            {row.original.ns_last_check && (
              <RelativeTime date={row.original.ns_last_check} className="text-[11px] text-subtle-foreground" />
            )}
          </span>
        ),
      },
      {
        id: "mode",
        accessorFn: (z) => proxyModeMeta(z.proxy_mode).short,
        header: "Routing",
        cell: ({ row }) => {
          const m = row.original.proxy_mode || "static";
          return <Badge variant={m === "static" ? "secondary" : "info"}>{proxyModeMeta(m).short}</Badge>;
        },
      },
      {
        id: "records",
        accessorFn: (z) => counts[z.id] ?? -1,
        header: "Records",
        meta: { align: "right" },
        cell: ({ row }) => {
          const n = counts[row.original.id];
          if (countsQ.loading && n === undefined) return <span className="text-muted-foreground">…</span>;
          return <span className="font-data">{n ?? "—"}</span>;
        },
      },
      {
        id: "actions",
        enableHiding: false,
        meta: { align: "right", className: "w-10" },
        cell: ({ row }) => {
          const z = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${z.fqdn}`}>
                  {checking.has(z.id) ? <Spinner /> : <MoreHorizontal />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push(`/domains/dns/${z.id}`)}>
                  <Settings2 />
                  Open zone
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => checkNS(z)}>
                  <ShieldCheck />
                  Check nameservers
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`https://${z.fqdn}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    Open site
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => remove(z)}>
                  <Trash2 />
                  Remove zone…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [counts, countsQ.loading, checking, router, checkNS, remove]
  );

  const stats = React.useMemo(() => {
    let ok = 0,
      bad = 0,
      proxied = 0;
    for (const z of zones) {
      if (z.ns_status === "valid") ok++;
      else if (z.ns_status === "invalid" || z.ns_status === "pending") bad++;
      if (z.proxy_mode && z.proxy_mode !== "static") proxied++;
    }
    return { ok, bad, proxied };
  }, [zones]);

  if (zonesQ.error && !zonesQ.data) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Network} title="DNS" back={{ href: "/domains", label: "Domains" }} />
        <ErrorState error={zonesQ.error} onRetry={zonesQ.refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Network}
        title="DNS"
        description="Zones, provider accounts, nameserver health and proxy routing."
        back={{ href: "/domains", label: "Domains" }}
        actions={
          <>
            <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => { void zonesQ.refresh(); void accountsQ.refresh(); void countsQ.refresh(); }}>
              {zonesQ.refreshing ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button variant="outline" onClick={() => setAccountDialog({ open: true, account: null })}>
              <Plus />
              Connect provider
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus />
              Add zone
            </Button>
          </>
        }
      />

      <StatStrip>
        <StatCard label="Zones" value={zones.length} loading={zonesQ.loading} />
        <StatCard label="Nameservers OK" value={stats.ok} loading={zonesQ.loading} />
        <StatCard label="NS issues" value={stats.bad} loading={zonesQ.loading} tone={stats.bad ? "warning" : "default"} />
        <StatCard label="Proxied zones" value={stats.proxied} loading={zonesQ.loading} />
        <StatCard label="Provider accounts" value={accounts.length} loading={accountsQ.loading} />
      </StatStrip>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable
            columns={columns}
            data={zones}
            loading={zonesQ.loading}
            getRowId={(z) => z.id}
            searchKeys={["fqdn", "dns_account_name", "dns_account_provider", "proxy_mode"]}
            searchPlaceholder="Search zones…"
            facets={[
              { columnId: "provider", title: "Provider" },
              { columnId: "ns", title: "Nameservers" },
              { columnId: "mode", title: "Routing" },
            ]}
            onRowClick={(z) => router.push(`/domains/dns/${z.id}`)}
            emptyState={
              <EmptyState
                icon={Globe}
                title="No DNS zones"
                description={
                  accounts.length
                    ? "Add a zone to manage its records and routing."
                    : "Connect a provider account first, then add zones."
                }
                action={
                  accounts.length ? (
                    <Button onClick={() => setAddOpen(true)}>
                      <Plus />
                      Add zone
                    </Button>
                  ) : (
                    <Button onClick={() => setAccountDialog({ open: true, account: null })}>
                      <Plus />
                      Connect provider
                    </Button>
                  )
                }
              />
            }
          />
        </div>
        <div>
          <DNSAccountsCard
            accounts={accounts}
            zoneCounts={zoneCounts}
            onAdd={() => setAccountDialog({ open: true, account: null })}
            onEdit={(a) => setAccountDialog({ open: true, account: a })}
            onChanged={() => {
              void accountsQ.refresh();
              void zonesQ.refresh();
            }}
          />
        </div>
      </div>

      <AddDNSZoneDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={accounts}
        existing={zones}
        onCreated={(z) => {
          void zonesQ.refresh();
          router.push(`/domains/dns/${z.id}`);
        }}
      />
      <DNSAccountDialog
        open={accountDialog.open}
        account={accountDialog.account}
        onOpenChange={(o) => setAccountDialog((s) => ({ ...s, open: o }))}
        onSaved={() => void accountsQ.refresh()}
      />
    </div>
  );
}
