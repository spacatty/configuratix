"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, Info, MoreHorizontal, Plus, Server, Unlink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  EmptyState,
  ErrorState,
  MachinePicker,
  Mono,
  RelativeTime,
  Spinner,
  StatusText,
  errorMessage,
  invalidatePickerCache,
  machineDisplayName,
  machineIp,
  machineLiveness,
  useConfirm,
} from "@/components/app";
import { api, type Machine } from "@/lib/api";

type Row = Machine & { live: string };

async function setProjectFor(ids: string[], projectId: string | null) {
  const results = await Promise.allSettled(ids.map((id) => api.updateMachine(id, { project_id: projectId })));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  return { ok: ids.length - failed.length, failed };
}

export function ProjectMachinesTab({
  projectId,
  projectName,
  machines,
  loading,
  error,
  onRetry,
  canManage,
  onChanged,
}: {
  projectId: string;
  projectName: string;
  machines: Machine[] | null | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  canManage: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [addOpen, setAddOpen] = React.useState(false);

  const rows: Row[] = React.useMemo(() => (machines ?? []).map((m) => ({ ...m, live: machineLiveness(m) })), [machines]);

  const unlink = React.useCallback(
    async (list: Machine[], clear?: () => void) => {
      const one = list.length === 1;
      const ok = await confirm({
        title: one ? `Remove ${machineDisplayName(list[0])} from project?` : `Remove ${list.length} machines from project?`,
        description: `They stay enrolled and keep running; members of “${projectName}” just lose access through this project.`,
        confirmText: one ? "Remove machine" : `Remove ${list.length} machines`,
        destructive: true,
        icon: Unlink,
      });
      if (!ok) return;
      const { ok: n, failed } = await setProjectFor(
        list.map((m) => m.id),
        null
      );
      if (n) toast.success(`Removed ${n} machine${n === 1 ? "" : "s"} from project`);
      if (failed.length) toast.error(`Couldn't remove ${failed.length} machine${failed.length === 1 ? "" : "s"}`, { description: errorMessage(failed[0].reason) });
      invalidatePickerCache("machines");
      clear?.();
      onChanged();
    },
    [confirm, onChanged, projectName]
  );

  const columns: ColumnDef<Row>[] = React.useMemo(() => {
    const cols: ColumnDef<Row>[] = [
      {
        accessorKey: "live",
        header: "Status",
        cell: ({ row }) => <StatusText status={row.original.live} />,
        meta: { className: "w-[110px]" },
      },
      {
        id: "name",
        accessorFn: (m) => machineDisplayName(m),
        header: "Machine",
        cell: ({ row }) => {
          const m = row.original;
          const name = machineDisplayName(m);
          return (
            <div className="min-w-0">
              <Link href={`/machines/${m.id}`} className="font-medium hover:text-primary">
                {name}
              </Link>
              {m.hostname && m.hostname !== name && <div className="font-data truncate text-[11.5px] text-muted-foreground">{m.hostname}</div>}
            </div>
          );
        },
      },
      {
        id: "ip",
        accessorFn: (m) => machineIp(m) ?? "",
        header: "IP",
        cell: ({ row }) => <Mono>{machineIp(row.original)}</Mono>,
      },
      {
        accessorKey: "agent_version",
        header: "Agent",
        cell: ({ row }) => <Mono muted>{row.original.agent_version}</Mono>,
      },
      {
        accessorKey: "last_seen",
        header: "Last seen",
        cell: ({ row }) => <RelativeTime date={row.original.last_seen} className="text-muted-foreground" />,
        meta: { align: "right" },
      },
    ];
    cols.push({
      id: "actions",
      enableHiding: false,
      meta: { align: "right" },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Machine actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push(`/machines/${row.original.id}`)}>
              <ExternalLink />
              Open machine
            </DropdownMenuItem>
            {canManage && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => unlink([row.original])}>
                  <Unlink />
                  Remove from project
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    });
    return cols;
  }, [canManage, router, unlink]);

  if (error && !machines) return <ErrorState title="Couldn't load machines" error={error} onRetry={onRetry} />;

  const addButton = canManage ? (
    <Button size="sm" onClick={() => setAddOpen(true)}>
      <Plus />
      Add machines
    </Button>
  ) : null;

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(m) => m.id}
        searchKeys={["title", "hostname", "ip_address", "primary_ip", "agent_version"]}
        searchPlaceholder="Search name, hostname, IP…"
        facets={[
          {
            columnId: "live",
            title: "Status",
            options: [
              { label: "Online", value: "online" },
              { label: "Stale", value: "stale" },
              { label: "Offline", value: "offline" },
            ],
          },
        ]}
        toolbarActions={addButton}
        onRowClick={(m) => router.push(`/machines/${m.id}`)}
        enableRowSelection={canManage}
        bulkActions={
          canManage
            ? (selected, clear) => (
                <Button size="sm" variant="destructive" onClick={() => unlink(selected, clear)}>
                  <Unlink />
                  Remove from project
                </Button>
              )
            : undefined
        }
        emptyState={
          <EmptyState
            icon={Server}
            title="No machines in this project"
            description={canManage ? "Link enrolled machines so project members can see and manage them." : "The project owner hasn't linked any machines yet."}
            action={addButton}
          />
        }
      />
      <AddMachinesDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={projectId}
        projectName={projectName}
        onDone={() => {
          invalidatePickerCache("machines");
          onChanged();
        }}
      />
    </>
  );
}

function AddMachinesDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  projectName: string;
  onDone: () => void;
}) {
  const [all, setAll] = React.useState<Machine[] | null>(null);
  const [ids, setIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setIds([]);
    let alive = true;
    api
      .listMachines()
      .then((m) => alive && setAll(m))
      .catch((e) => {
        toast.error("Couldn't load machines", { description: errorMessage(e) });
        if (alive) setAll([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const candidates = React.useMemo(() => (all ?? []).filter((m) => m.project_id !== projectId), [all, projectId]);
  const moving = React.useMemo(() => candidates.filter((m) => ids.includes(m.id) && m.project_id), [candidates, ids]);

  const submit = async () => {
    setBusy(true);
    const { ok, failed } = await setProjectFor(ids, projectId);
    setBusy(false);
    if (ok) toast.success(`Added ${ok} machine${ok === 1 ? "" : "s"} to ${projectName}`);
    if (failed.length) toast.error(`Couldn't add ${failed.length} machine${failed.length === 1 ? "" : "s"}`, { description: errorMessage(failed[0].reason) });
    onDone();
    if (!failed.length) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add machines to {projectName}</DialogTitle>
          <DialogDescription>Linked machines become visible to every member of this project.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <MachinePicker
            multiple
            machines={candidates}
            value={ids}
            onValueChange={(next) => setIds(next)}
            groupBy="project"
            disabled={!all}
            placeholder={!all ? "Loading machines…" : candidates.length ? "Select machines…" : "All your machines are already here"}
            className="w-full"
          />
          {moving.length > 0 && (
            <Alert variant="info">
              <Info />
              <AlertDescription>
                {moving.length === 1 ? (
                  <>
                    <span className="font-medium">{machineDisplayName(moving[0])}</span> is currently in <span className="font-medium">{moving[0].project_name}</span> and will be moved.
                  </>
                ) : (
                  <>{moving.length} selected machines are in other projects and will be moved — a machine belongs to one project at a time.</>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || ids.length === 0}>
            {busy && <Spinner />}
            {ids.length > 1 ? `Add ${ids.length} machines` : "Add machine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
