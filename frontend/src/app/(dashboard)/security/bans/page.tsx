"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Ban, Download, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { api, type SecurityIPBan } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CopyableMono,
  EmptyState,
  ErrorState,
  KeyValueList,
  Mono,
  PageHeader,
  RelativeTime,
  Spinner,
  StatusText,
  useConfirm,
  usePolling,
} from "@/components/app";
import { formatDateTime, formatNumber } from "@/lib/format";
import { BAN_REASONS, BanReasonBadge, SecurityNav, banReasonLabel, fetchBans } from "@/components/security/shared";
import { AddBanDialog, ExportBansDialog, ImportBansDialog } from "@/components/security/ban-dialogs";

const PAGE_LIMIT = 1000;
const NEVER_MS = 10 * 365 * 24 * 3600 * 1000;

function banStatus(b: SecurityIPBan): "active" | "expired" | "inactive" {
  if (!b.is_active) return b.unbanned_at ? "inactive" : "expired";
  if (new Date(b.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

function banDetail(b: SecurityIPBan): string {
  return String(b.details?.user_agent || b.details?.path || "");
}

function Expiry({ date }: { date: string }) {
  const t = new Date(date).getTime();
  if (Number.isFinite(t) && t - Date.now() > NEVER_MS) return <span className="text-[12.5px] text-muted-foreground">Never</span>;
  return <RelativeTime date={date} />;
}

export default function BansPage() {
  return (
    <Suspense>
      <BansPageInner />
    </Suspense>
  );
}

function BansPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const confirm = useConfirm();

  const [activeOnly, setActiveOnly] = useState(true);
  const [reason, setReason] = useState<string | null>(params.get("reason"));
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [addOpen, setAddOpen] = useState(params.get("add") === "1");
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [detail, setDetail] = useState<SecurityIPBan | null>(null);

  // Debounce the server-side search so typing doesn't spam the API.
  useEffect(() => {
    const t = setTimeout(() => setServerSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, error, refresh, refreshing } = usePolling(
    () =>
      fetchBans(
        { active_only: activeOnly, search: serverSearch || undefined, reason: reason || undefined },
        PAGE_LIMIT
      ),
    60000,
    { deps: [activeOnly, serverSearch, reason] }
  );

  const bans = data?.bans ?? [];
  const truncated = data ? data.total > bans.length : false;

  const reasonOptions = useMemo(() => {
    const set = new Set([...Object.keys(BAN_REASONS), ...bans.map((b) => b.reason)]);
    return [...set].map((r) => ({ value: r, label: banReasonLabel(r) }));
  }, [bans]);

  const unban = async (rows: SecurityIPBan[], clear?: () => void) => {
    const one = rows.length === 1;
    const ok = await confirm({
      title: one ? `Unban ${rows[0].ip_address}?` : `Unban ${rows.length} IPs?`,
      description: "The IPs are removed from the blacklist and from nftables on the next agent sync.",
      details: one ? undefined : (
        <div className="font-data max-h-32 overflow-auto rounded-md border border-border bg-surface-2/40 p-2 text-xs text-muted-foreground">
          {rows.map((r) => r.ip_address).join("  ")}
        </div>
      ),
      destructive: true,
      confirmText: one ? "Unban" : `Unban ${rows.length}`,
      onConfirm: async () => {
        const results = await Promise.allSettled(rows.map((r) => api.deleteSecurityBan(r.id)));
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed === rows.length) throw (results[0] as PromiseRejectedResult).reason;
        if (failed) toast.warning(`${failed} of ${rows.length} couldn't be unbanned`);
      },
    });
    if (ok) {
      toast.success(one ? `${rows[0].ip_address} unbanned` : `${rows.length} IPs unbanned`);
      clear?.();
      setDetail(null);
      refresh();
    }
  };

  const whitelist = async (rows: SecurityIPBan[], clear?: () => void) => {
    const one = rows.length === 1;
    const ok = await confirm({
      title: one ? `Whitelist ${rows[0].ip_address}?` : `Whitelist ${rows.length} IPs?`,
      description: "Whitelisted IPs are unbanned and can never be banned again until removed from the whitelist.",
      confirmText: "Add to whitelist",
      icon: ShieldCheck,
      onConfirm: async () => {
        for (const b of rows) {
          await api.createSecurityWhitelistEntry({
            ip_cidr: b.ip_address,
            description: `Whitelisted from ban (reason: ${banReasonLabel(b.reason)})`,
          });
          await api.deleteSecurityBan(b.id).catch(() => undefined);
        }
      },
    });
    if (ok) {
      toast.success(one ? `${rows[0].ip_address} whitelisted` : `${rows.length} IPs whitelisted`);
      clear?.();
      setDetail(null);
      refresh();
    }
  };

  const unbanAll = async () => {
    const ok = await confirm({
      title: "Unban every IP?",
      description: `All ${formatNumber(data?.total ?? 0)} bans are lifted on every machine. This can't be undone.`,
      destructive: true,
      typeToConfirm: "unban all",
      confirmText: "Unban all",
      onConfirm: async () => {
        const r = await api.deleteAllSecurityBans();
        toast.success(`Unbanned ${formatNumber(r.unbanned)} IPs`);
      },
    });
    if (ok) refresh();
  };

  const columns = useMemo<ColumnDef<SecurityIPBan>[]>(
    () => [
      {
        accessorKey: "ip_address",
        header: "IP address",
        cell: ({ row }) => <CopyableMono value={row.original.ip_address} monoClassName="font-medium" />,
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: ({ row }) => <BanReasonBadge reason={row.original.reason} />,
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
      },
      {
        id: "details",
        accessorFn: banDetail,
        header: "Details",
        enableSorting: false,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          return v ? (
            <Mono muted truncate className="block max-w-[340px] text-xs" title={v}>
              {v}
            </Mono>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "source",
        accessorFn: (b) => b.source_machine_name || "Manual / API",
        header: "Source",
        cell: ({ row }) =>
          row.original.source_machine_id ? (
            <Link
              href={`/machines/${row.original.source_machine_id}`}
              className="truncate text-[13px] hover:text-primary hover:underline underline-offset-2"
            >
              {row.original.source_machine_name || "Machine"}
            </Link>
          ) : (
            <span className="text-[13px] text-muted-foreground">{row.original.created_by_email || "Manual / API"}</span>
          ),
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
      },
      {
        id: "status",
        accessorFn: banStatus,
        header: "Status",
        cell: ({ getValue }) => <StatusText status={getValue() as string} />,
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
      },
      {
        accessorKey: "banned_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Banned" />,
        cell: ({ row }) => <RelativeTime date={row.original.banned_at} />,
        sortingFn: "datetime",
      },
      {
        accessorKey: "expires_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expires" />,
        cell: ({ row }) => <Expiry date={row.original.expires_at} />,
        sortingFn: "datetime",
      },
      {
        id: "actions",
        enableHiding: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => whitelist([row.original])}>
                <ShieldCheck />
                Add to whitelist
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => unban([row.original])}>
                <Trash2 />
                Unban
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Ban}
        title="IP bans"
        description="Addresses blocked at the firewall on every agent with nftables enabled."
        badge={data ? <Badge variant="muted" className="font-data">{formatNumber(data.total)}</Badge> : undefined}
        actions={
          <>
            <Button variant="outline" size="icon" onClick={() => refresh()} disabled={refreshing} aria-label="Refresh">
              {refreshing ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <Download />
              Export
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload />
              Import
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus />
              Ban IP
            </Button>
          </>
        }
      />

      <SecurityNav />

      {truncated && (
        <Alert variant="info">
          <AlertDescription>
            Showing the newest <span className="font-data">{formatNumber(bans.length)}</span> of{" "}
            <span className="font-data">{formatNumber(data!.total)}</span> bans. Search narrows the result on the server.
          </AlertDescription>
        </Alert>
      )}

      {error && !data ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : (
        <DataTable
          columns={columns}
          data={bans}
          loading={loading}
          getRowId={(b) => b.id}
          search={search}
          onSearchChange={setSearch}
          searchKeys={["ip_address", "reason", (b) => b.source_machine_name, banDetail]}
          searchPlaceholder="Search IP, user agent, path…"
          facets={[
            { columnId: "reason", title: "Reason", options: reasonOptions },
            { columnId: "source", title: "Source" },
            ...(activeOnly ? [] : [{ columnId: "status", title: "Status" }]),
          ]}
          toolbar={
            <>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={activeOnly ? "active" : "all"}
                onValueChange={(v) => v && setActiveOnly(v === "active")}
              >
                <ToggleGroupItem value="active">Active</ToggleGroupItem>
                <ToggleGroupItem value="all">All</ToggleGroupItem>
              </ToggleGroup>
              {reason && (
                <Badge variant="outline" className="h-7 gap-1.5 px-2 text-xs">
                  Reason: {banReasonLabel(reason)}
                  <button
                    type="button"
                    aria-label="Clear reason filter"
                    onClick={() => {
                      setReason(null);
                      router.replace("/security/bans");
                    }}
                    className="rounded-sm text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              )}
            </>
          }
          toolbarActions={
            <Button variant="destructive" size="sm" onClick={unbanAll} disabled={!data?.total}>
              <Trash2 />
              Unban all
            </Button>
          }
          initialState={{ sorting: [{ id: "banned_at", desc: true }] }}
          onRowClick={(b) => setDetail(b)}
          getRowClassName={(b) => (banStatus(b) !== "active" ? "opacity-60" : undefined)}
          enableRowSelection
          bulkActions={(rows, clear) => (
            <>
              <Button size="sm" variant="outline" onClick={() => whitelist(rows, clear)}>
                <ShieldCheck />
                Whitelist
              </Button>
              <Button size="sm" variant="destructive" onClick={() => unban(rows, clear)}>
                <Trash2 />
                Unban {rows.length}
              </Button>
            </>
          )}
          emptyState={
            <EmptyState
              icon={Ban}
              title={serverSearch || reason ? "No bans match" : activeOnly ? "No active bans" : "No bans yet"}
              description="IPs are banned automatically when they hit a blocked user agent or an invalid endpoint, or manually here."
              action={
                <Button onClick={() => setAddOpen(true)}>
                  <Plus />
                  Ban IP
                </Button>
              }
              secondaryAction={
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload />
                  Import list
                </Button>
              }
            />
          }
        />
      )}

      <BanDetailSheet ban={detail} onClose={() => setDetail(null)} onUnban={(b) => unban([b])} onWhitelist={(b) => whitelist([b])} />
      <AddBanDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refresh} />
      <ImportBansDialog open={importOpen} onOpenChange={setImportOpen} onImported={refresh} />
      <ExportBansDialog open={exportOpen} onOpenChange={setExportOpen} activeOnly={activeOnly} />
    </div>
  );
}

function BanDetailSheet({
  ban,
  onClose,
  onUnban,
  onWhitelist,
}: {
  ban: SecurityIPBan | null;
  onClose: () => void;
  onUnban: (b: SecurityIPBan) => void;
  onWhitelist: (b: SecurityIPBan) => void;
}) {
  const extra = ban
    ? Object.entries(ban.details ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];
  return (
    <Sheet open={!!ban} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-xl">
        {ban && (
          <>
            <SheetHeader>
              <SheetTitle className="font-data">{ban.ip_address}</SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                <BanReasonBadge reason={ban.reason} />
                <StatusText status={banStatus(ban)} />
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-6 overflow-y-auto px-4">
              <KeyValueList
                items={[
                  { label: "IP address", value: ban.ip_address, mono: true, copy: ban.ip_address },
                  { label: "Reason", value: banReasonLabel(ban.reason) },
                  {
                    label: "Source",
                    value: ban.source_machine_id ? (
                      <Link href={`/machines/${ban.source_machine_id}`} className="hover:text-primary hover:underline">
                        {ban.source_machine_name || ban.source_machine_id}
                      </Link>
                    ) : (
                      ban.created_by_email || "Manual / API"
                    ),
                  },
                  { label: "Banned", value: formatDateTime(ban.banned_at), mono: true },
                  { label: "Expires", value: <Expiry date={ban.expires_at} /> },
                  { label: "Unbanned", value: ban.unbanned_at ? formatDateTime(ban.unbanned_at) : null, mono: true, hidden: !ban.unbanned_at },
                ]}
              />
              {extra.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[13px] font-medium">Request details</h3>
                  <KeyValueList
                    items={extra.map(([k, v]) => {
                      const s = typeof v === "string" ? v : JSON.stringify(v);
                      return { label: k.replace(/_/g, " "), value: s, mono: true, copy: s, full: s.length > 60 };
                    })}
                  />
                </div>
              )}
            </div>
            <SheetFooter>
              <Button variant="outline" onClick={() => onWhitelist(ban)}>
                <ShieldCheck />
                Add to whitelist
              </Button>
              {ban.is_active && (
                <Button variant="destructive" onClick={() => onUnban(ban)}>
                  <Trash2 />
                  Unban
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

