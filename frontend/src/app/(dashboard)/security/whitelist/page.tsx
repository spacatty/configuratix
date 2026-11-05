"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Info, MoreHorizontal, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api, type SecurityIPWhitelist } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CopyableMono,
  EmptyState,
  ErrorState,
  PageHeader,
  RelativeTime,
  Spinner,
  errorMessage,
  useConfirm,
  usePolling,
} from "@/components/app";
import { formatNumber } from "@/lib/format";
import { SecurityNav, isValidIpOrCidr } from "@/components/security/shared";
import { FormField } from "@/components/security/form-field";

function rangeInfo(ipCidr: string): { kind: "ip" | "range"; size?: string } {
  const [ip, bits] = ipCidr.split("/");
  if (bits === undefined) return { kind: "ip" };
  const n = Number(bits);
  const v6 = ip.includes(":");
  const max = v6 ? 128 : 32;
  if (n === max) return { kind: "ip" };
  const hostBits = max - n;
  if (hostBits > 40) return { kind: "range", size: `2^${hostBits}` };
  return { kind: "range", size: formatNumber(2 ** hostBits) };
}

export default function WhitelistPage() {
  const confirm = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const { data, loading, error, refresh } = usePolling(() => api.listSecurityWhitelist(), 60000);
  const entries = data ?? [];

  const remove = async (rows: SecurityIPWhitelist[], clear?: () => void) => {
    const one = rows.length === 1;
    const ok = await confirm({
      title: one ? `Remove ${rows[0].ip_cidr} from the whitelist?` : `Remove ${rows.length} entries?`,
      description: "These addresses can be banned again by UA and endpoint rules.",
      destructive: true,
      confirmText: "Remove",
      onConfirm: async () => {
        for (const r of rows) await api.deleteSecurityWhitelistEntry(r.id);
      },
    });
    if (ok) {
      toast.success(one ? "Removed from whitelist" : `${rows.length} entries removed`);
      clear?.();
      refresh();
    }
  };

  const columns = useMemo<ColumnDef<SecurityIPWhitelist>[]>(
    () => [
      {
        accessorKey: "ip_cidr",
        header: "IP / CIDR",
        cell: ({ row }) => <CopyableMono value={row.original.ip_cidr} monoClassName="font-medium" />,
      },
      {
        id: "kind",
        accessorFn: (r) => (rangeInfo(r.ip_cidr).kind === "range" ? "Range" : "Single IP"),
        header: "Type",
        cell: ({ row }) => {
          const info = rangeInfo(row.original.ip_cidr);
          return info.kind === "range" ? (
            <span className="flex items-center gap-2">
              <Badge variant="info">Range</Badge>
              <span className="font-data text-xs text-muted-foreground">{info.size} addresses</span>
            </span>
          ) : (
            <Badge variant="muted">Single IP</Badge>
          );
        },
        filterFn: (row, id, value: string[]) => !value?.length || value.includes(row.getValue(id)),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) =>
          row.original.description ? (
            <span className="block max-w-[420px] truncate text-[13px]" title={row.original.description}>
              {row.original.description}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Added" />,
        cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
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
              <DropdownMenuItem variant="destructive" onClick={() => remove([row.original])}>
                <Trash2 />
                Remove
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
        icon={ShieldCheck}
        title="Whitelist"
        description="Addresses that are never banned, on any machine."
        badge={data ? <Badge variant="muted" className="font-data">{formatNumber(entries.length)}</Badge> : undefined}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus />
            Add entry
          </Button>
        }
      />

      <SecurityNav />

      <Alert variant="info">
        <Info />
        <AlertTitle>How the whitelist works</AlertTitle>
        <AlertDescription>
          Whitelisted IPs and CIDR ranges can never be banned; adding one lifts any existing ban automatically. The list is
          shared by all machines and agents.
        </AlertDescription>
      </Alert>

      {error && !data ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : (
        <DataTable
          columns={columns}
          data={entries}
          loading={loading}
          getRowId={(r) => r.id}
          searchKeys={["ip_cidr", "description"]}
          searchPlaceholder="Search IP or description…"
          facets={[{ columnId: "kind", title: "Type" }]}
          initialState={{ sorting: [{ id: "created_at", desc: true }] }}
          enableRowSelection
          bulkActions={(rows, clear) => (
            <Button size="sm" variant="destructive" onClick={() => remove(rows, clear)}>
              <Trash2 />
              Remove {rows.length}
            </Button>
          )}
          emptyState={
            <EmptyState
              icon={ShieldCheck}
              title="Whitelist is empty"
              description="Add your office, monitoring and CI addresses so they're never locked out."
              action={
                <Button onClick={() => setAddOpen(true)}>
                  <Plus />
                  Add entry
                </Button>
              }
            />
          }
        />
      )}

      <AddWhitelistDialog open={addOpen} onOpenChange={setAddOpen} onAdded={refresh} existing={entries} />
    </div>
  );
}

function AddWhitelistDialog({
  open,
  onOpenChange,
  onAdded,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: () => void;
  existing: SecurityIPWhitelist[];
}) {
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
      setDescription("");
      setTouched(false);
    }
  }, [open]);

  const v = value.trim();
  const valid = isValidIpOrCidr(v);
  const duplicate = existing.some((e) => e.ip_cidr === v);
  const info = valid ? rangeInfo(v) : null;
  const err = touched && !valid ? "Enter an IP (203.0.113.7) or CIDR range (10.0.0.0/8)" : duplicate ? "Already whitelisted" : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || duplicate) return;
    setSubmitting(true);
    try {
      await api.createSecurityWhitelistEntry({ ip_cidr: v, description: description.trim() });
      toast.success(`${v} whitelisted`);
      onOpenChange(false);
      onAdded();
    } catch (error) {
      toast.error("Couldn't add entry", { description: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to whitelist</DialogTitle>
          <DialogDescription>Any active ban matching this address or range is lifted.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <FormField
            label="IP or CIDR"
            htmlFor="wl-ip"
            required
            error={err}
            hint={info?.kind === "range" ? `Range of ${info.size} addresses` : "Single address or a range like 192.168.1.0/24"}
          >
            <Input
              id="wl-ip"
              autoFocus
              className="font-data"
              placeholder="192.168.1.0/24"
              value={value}
              aria-invalid={!!err}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => value && setTouched(true)}
            />
          </FormField>
          <FormField label="Description" htmlFor="wl-desc" hint="Who or what this is — e.g. “Office VPN”, “Uptime monitor”.">
            <Input id="wl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || duplicate || (touched && !valid)}>
              {submitting ? <Spinner /> : <ShieldCheck />}
              Add to whitelist
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
