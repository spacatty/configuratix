"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ExternalLink,
  FolderKanban,
  Link2,
  LogIn,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EmptyState,
  ErrorState,
  Mono,
  PageHeader,
  RelativeTime,
  StatCard,
  StatStrip,
  invalidatePickerCache,
  useConfirm,
  usePolling,
} from "@/components/app";
import { JoinProjectDialog, ProjectNameDialog, ShareProjectDialog } from "@/components/projects/project-dialogs";
import { ProjectRoleBadge, baseProjectRole, inviteLink } from "@/components/projects/project-shared";
import { api, type ProjectWithStats } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";

type Row = ProjectWithStats & { access: string; sharing: string };

export default function ProjectsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { data: me } = usePolling(() => api.getMe(), 0);
  const { data, loading, error, refresh, refreshing, setData } = usePolling(() => api.listProjects(), 30000);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState<ProjectWithStats | null>(null);
  const [sharing, setSharing] = React.useState<ProjectWithStats | null>(null);

  const rows: Row[] = React.useMemo(
    () =>
      (data ?? []).map((p) => {
        const role = baseProjectRole(p, me);
        return {
          ...p,
          access: role === "owner" ? "Owned by me" : role === "admin" ? "Admin access" : "Shared with me",
          sharing: p.sharing_enabled ? "Sharing on" : "Private",
        };
      }),
    [data, me]
  );

  const isSuper = me?.role === "superadmin";
  const canManage = React.useCallback((p: ProjectWithStats) => !!me && (p.owner_id === me.id || isSuper), [me, isSuper]);

  const totals = React.useMemo(() => {
    const list = data ?? [];
    const machines = list.reduce((a, p) => a + p.machine_count, 0);
    const online = list.reduce((a, p) => a + p.online_machines, 0);
    return {
      projects: list.length,
      owned: me ? list.filter((p) => p.owner_id === me.id).length : 0,
      machines,
      online,
      shared: list.filter((p) => p.sharing_enabled).length,
    };
  }, [data, me]);

  const copyInvite = React.useCallback(async (token: string) => {
    if (await copyToClipboard(inviteLink(token))) toast.success("Invite link copied");
    else toast.error("Couldn't access the clipboard");
  }, []);

  const deleteProject = React.useCallback(
    async (p: ProjectWithStats) => {
      const ok = await confirm({
        title: `Delete project “${p.name}”?`,
        description: "Members lose access. Machines are unlinked from the project but not deleted.",
        details:
          p.machine_count > 0 ? (
            <p className="text-xs text-muted-foreground">
              <Mono>{p.machine_count}</Mono> machine{p.machine_count === 1 ? "" : "s"} will become unassigned.
            </p>
          ) : undefined,
        destructive: true,
        typeToConfirm: p.name,
        confirmText: "Delete project",
        onConfirm: () => api.deleteProject(p.id),
      });
      if (ok) {
        toast.success("Project deleted");
        setData((prev) => prev?.filter((x) => x.id !== p.id) ?? prev);
        invalidatePickerCache("machines");
        refresh();
      }
    },
    [confirm, refresh, setData]
  );

  const columns: ColumnDef<Row>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Project",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">{p.owner_name || p.owner_email}</div>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        accessorFn: (p) => p.access,
        header: "Your access",
        cell: ({ row }) => <ProjectRoleBadge role={baseProjectRole(row.original, me)} />,
        meta: { label: "Access" },
      },
      {
        accessorKey: "machine_count",
        header: "Machines",
        cell: ({ row }) => {
          const p = row.original;
          if (p.machine_count === 0) return <span className="text-muted-foreground">0</span>;
          const pct = (p.online_machines / p.machine_count) * 100;
          return (
            <div className="flex items-center gap-2.5">
              <span className="font-data w-14 text-right">
                {p.online_machines}
                <span className="text-muted-foreground">/{p.machine_count}</span>
              </span>
              <Progress value={pct} size="sm" tone={pct === 100 ? "success" : pct === 0 ? "destructive" : "warning"} className="w-16" />
            </div>
          );
        },
        meta: { label: "Machines (online/total)" },
      },
      {
        accessorKey: "member_count",
        header: "Members",
        cell: ({ row }) => <span className="font-data">{row.original.member_count + 1}</span>,
        meta: { align: "right" },
      },
      {
        id: "sharing",
        accessorFn: (p) => p.sharing,
        header: "Sharing",
        cell: ({ row }) =>
          row.original.sharing_enabled ? (
            <Badge variant="success">
              <Share2 />
              Invite link on
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Private</span>
          ),
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => <RelativeTime date={row.original.created_at} className="text-muted-foreground" />,
        meta: { align: "right" },
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const p = row.original;
          const manage = canManage(p);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => router.push(`/projects/${p.id}`)}>
                  <ExternalLink />
                  Open
                </DropdownMenuItem>
                {p.sharing_enabled && p.invite_token && (
                  <DropdownMenuItem onClick={() => copyInvite(p.invite_token!)}>
                    <Link2 />
                    Copy invite link
                  </DropdownMenuItem>
                )}
                {manage && (
                  <>
                    <DropdownMenuItem onClick={() => setSharing(p)}>
                      <Share2 />
                      Sharing…
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setRenaming(p)}>
                      <Pencil />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => deleteProject(p)}>
                      <Trash2 />
                      Delete…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        meta: { align: "right" },
      },
    ],
    [me, canManage, router, copyInvite, deleteProject]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        description="Group machines into projects and share access with your team."
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={refresh} disabled={refreshing} aria-label="Refresh">
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            </Button>
            <Button variant="outline" onClick={() => setJoinOpen(true)}>
              <LogIn />
              Join with invite
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              New project
            </Button>
          </>
        }
      />

      {error && !data ? (
        <ErrorState title="Couldn't load projects" error={error} onRetry={refresh} />
      ) : (
        <>
          <StatStrip>
            <StatCard label="Projects" value={totals.projects} sub={`${totals.owned} owned by you`} loading={loading} />
            <StatCard
              label="Machines online"
              value={totals.online}
              suffix={`/ ${totals.machines}`}
              progress={totals.machines ? (totals.online / totals.machines) * 100 : undefined}
              progressTone="success"
              loading={loading}
            />
            <StatCard label="Offline" value={totals.machines - totals.online} tone={totals.machines - totals.online > 0 ? "warning" : "default"} loading={loading} />
            <StatCard label="Sharing enabled" value={totals.shared} sub="Projects with an active invite link" loading={loading} />
          </StatStrip>

          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            getRowId={(p) => p.id}
            searchKeys={["name", "owner_name", "owner_email"]}
            searchPlaceholder="Search projects or owners…"
            facets={[
              { columnId: "role", title: "Access" },
              { columnId: "sharing", title: "Sharing" },
            ]}
            onRowClick={(p) => router.push(`/projects/${p.id}`)}
            initialState={{ sorting: [{ id: "created_at", desc: true }] }}
            emptyState={
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="Create a project to group machines, or join one with an invite link from a teammate."
                action={
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus />
                    New project
                  </Button>
                }
                secondaryAction={
                  <Button variant="outline" onClick={() => setJoinOpen(true)}>
                    <LogIn />
                    Join with invite
                  </Button>
                }
              />
            }
          />
        </>
      )}

      <ProjectNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={async (name) => {
          const p = await api.createProject(name);
          toast.success(`Project “${name}” created`);
          router.push(`/projects/${p.id}`);
        }}
      />
      <ProjectNameDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        mode="rename"
        initialName={renaming?.name ?? ""}
        onSubmit={async (name) => {
          if (!renaming) return;
          await api.updateProject(renaming.id, { name });
          toast.success("Project renamed");
          refresh();
        }}
      />
      <JoinProjectDialog open={joinOpen} onOpenChange={setJoinOpen} />
      <ShareProjectDialog
        project={sharing}
        open={!!sharing}
        onOpenChange={(o) => !o && setSharing(null)}
        onChanged={(u) =>
          setData((prev) => prev?.map((x) => (x.id === u.id ? { ...x, sharing_enabled: u.sharing_enabled, invite_token: u.invite_token, invite_expires_at: u.invite_expires_at } : x)) ?? prev)
        }
      />
    </div>
  );
}

