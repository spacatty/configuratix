"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Copy, KeyRound, MoreHorizontal, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, type EnrollmentToken, type Machine } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, FillPage, PageHeader, RelativeTime, Spinner, StatCard, StatStrip, StatusText, useConfirm, usePolling } from "@/components/app";
import { AddMachineDialog, installCommand } from "@/components/machines/add-machine-dialog";

type TokenState = "active" | "used" | "expired";

function tokenState(t: EnrollmentToken): TokenState {
  if (t.used_at) return "used";
  if (new Date(t.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}
const STATE_STATUS: Record<TokenState, string> = { active: "pending", used: "completed", expired: "expired" };

export default function EnrollmentTokensPage() {
  const confirm = useConfirm();
  const tokensQ = usePolling(() => api.listEnrollmentTokens(), 15000);
  const machinesQ = usePolling<Machine[]>(() => api.listMachines(), 0);
  const tokens = React.useMemo(() => tokensQ.data ?? [], [tokensQ.data]);
  const [addOpen, setAddOpen] = React.useState(false);

  const counts = React.useMemo(() => {
    const c = { active: 0, used: 0, expired: 0 };
    for (const t of tokens) c[tokenState(t)]++;
    return c;
  }, [tokens]);

  const remove = React.useCallback(
    async (t: EnrollmentToken) => {
      const ok = await confirm({
        title: `Delete token “${t.name || "Unnamed"}”?`,
        description: tokenState(t) === "active" ? "Servers that haven't run the install command yet won't be able to enroll with it." : "Removes it from the list. Enrolled machines are not affected.",
        destructive: true,
        confirmText: "Delete token",
        icon: Trash2,
        onConfirm: () => api.deleteEnrollmentToken(t.id),
      });
      if (ok) {
        toast.success("Token deleted");
        void tokensQ.refresh();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm]
  );

  const columns: ColumnDef<EnrollmentToken>[] = React.useMemo(
    () => [
      {
        id: "name",
        accessorFn: (t) => t.name || "Unnamed token",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Token" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <KeyRound className="size-3.5 text-subtle-foreground" />
            <span className="font-medium">{row.original.name || <span className="text-muted-foreground">Unnamed token</span>}</span>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (t) => tokenState(t),
        header: "Status",
        cell: ({ row }) => {
          const s = tokenState(row.original);
          return <StatusText status={STATE_STATUS[s]} label={s === "active" ? "Unused" : s === "used" ? "Used" : "Expired"} />;
        },
      },
      {
        id: "created",
        accessorFn: (t) => new Date(t.created_at).getTime(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" align="right" />,
        meta: { align: "right" },
        cell: ({ row }) => <RelativeTime date={row.original.created_at} className="text-xs text-muted-foreground" />,
      },
      {
        id: "used",
        accessorFn: (t) => (t.used_at ? new Date(t.used_at).getTime() : 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Used" align="right" />,
        meta: { align: "right" },
        cell: ({ row }) => <RelativeTime date={row.original.used_at} className="text-xs text-muted-foreground" />,
      },
      {
        id: "expires",
        accessorFn: (t) => new Date(t.expires_at).getTime(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expires" align="right" />,
        meta: { align: "right" },
        cell: ({ row }) => (row.original.used_at ? <span className="text-xs text-subtle-foreground">—</span> : <RelativeTime date={row.original.expires_at} className="text-xs text-muted-foreground" />),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { align: "right", className: "w-10" },
        cell: ({ row }) => {
          const t = row.original;
          const canCopy = tokenState(t) === "active" && !!t.token;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Token actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canCopy && (
                  <>
                    <DropdownMenuItem
                      onSelect={async () => {
                        if (await copyToClipboard(installCommand(t.token!))) toast.success("Install command copied");
                      }}
                    >
                      <Copy />
                      Copy install command
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem variant="destructive" onSelect={() => remove(t)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [remove]
  );

  return (
    <FillPage>
      <PageHeader
        title="Enrollment tokens"
        stats={
          <StatStrip>
            <StatCard label="Unused" value={counts.active} loading={tokensQ.loading} tone={counts.active > 0 ? "info" : "default"} sub="expire after 24h" />
            <StatCard label="Used" value={counts.used} loading={tokensQ.loading} />
            <StatCard label="Expired" value={counts.expired} loading={tokensQ.loading} sub={counts.expired ? "safe to delete" : undefined} />
          </StatStrip>
        }
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            New token
          </Button>
        }
      />

      {tokensQ.error && !tokensQ.data ? (
        <ErrorState error={tokensQ.error} onRetry={tokensQ.refresh} title="Couldn't load tokens" />
      ) : (
        <DataTable
          fill
          columns={columns}
          data={tokens}
          loading={tokensQ.loading}
          getRowId={(t) => t.id}
          searchKeys={["name"]}
          searchPlaceholder="Search tokens…"
          facets={[
            {
              columnId: "status",
              title: "Status",
              options: [
                { value: "active", label: "Unused" },
                { value: "used", label: "Used" },
                { value: "expired", label: "Expired" },
              ],
            },
          ]}
          initialState={{ sorting: [{ id: "created", desc: true }] }}
          toolbarActions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" onClick={() => tokensQ.refresh()} aria-label="Refresh">
                  {tokensQ.refreshing ? <Spinner /> : <RefreshCw />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          }
          enableRowSelection
          bulkActions={(rows, clear) => (
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ${rows.length} token${rows.length === 1 ? "" : "s"}?`,
                  destructive: true,
                  confirmText: "Delete",
                  icon: Trash2,
                  onConfirm: () => Promise.all(rows.map((t) => api.deleteEnrollmentToken(t.id))),
                });
                if (ok) {
                  clear();
                  toast.success("Tokens deleted");
                  void tokensQ.refresh();
                }
              }}
            >
              <Trash2 />
              Delete
            </Button>
          )}
          emptyState={
            <EmptyState
              icon={KeyRound}
              title="No enrollment tokens"
              description="Create one to get a one-line install command for a new server."
              action={
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus />
                  New token
                </Button>
              }
            />
          }
        />
      )}

      <AddMachineDialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) void tokensQ.refresh();
        }}
        knownMachineIds={(machinesQ.data ?? []).map((m) => m.id)}
        onEnrolled={() => tokensQ.refresh()}
      />
    </FillPage>
  );
}
