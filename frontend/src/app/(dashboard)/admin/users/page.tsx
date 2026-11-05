"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, MoreHorizontal, Plus, RefreshCw, Shield, ShieldOff, Trash2, User as UserIcon, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, FillPage, PageHeader, RelativeTime, StatCard, StatStrip, StatusText, useConfirm, usePolling } from "@/components/app";
import { CreateUserDialog, SetPasswordDialog } from "@/components/admin/user-dialogs";
import { USER_ROLES, UserRoleBadge } from "@/components/admin/user-role-badge";
import { InitialsAvatar } from "@/components/profile/form-field";
import { api, type UserWithDetails } from "@/lib/api";

type Row = UserWithDetails & { twofa: string };

export default function AdminUsersPage() {
  const confirm = useConfirm();
  const { data: me } = usePolling(() => api.getMe(), 0);
  const { data, loading, error, refresh, refreshing, setData } = usePolling(() => api.listUsers(), 60000);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [pwUser, setPwUser] = React.useState<UserWithDetails | null>(null);

  const isSuper = me?.role === "superadmin";
  const canModify = React.useCallback(
    (u: UserWithDetails) => !!me && me.id !== u.id && (isSuper ? u.role !== "superadmin" : me.role === "admin" && u.role === "user"),
    [me, isSuper]
  );

  const rows: Row[] = React.useMemo(() => (data ?? []).map((u) => ({ ...u, twofa: u.totp_enabled ? "enabled" : "disabled" })), [data]);

  const stats = React.useMemo(() => {
    const list = data ?? [];
    const withTotp = list.filter((u) => u.totp_enabled).length;
    return {
      total: list.length,
      admins: list.filter((u) => u.role === "admin" || u.role === "superadmin").length,
      withTotp,
      withoutTotp: list.length - withTotp,
      adminsWithoutTotp: list.filter((u) => (u.role === "admin" || u.role === "superadmin") && !u.totp_enabled).length,
    };
  }, [data]);

  const label = (u: UserWithDetails) => u.name || u.email;

  const changeRole = React.useCallback(
    async (u: UserWithDetails, role: string) => {
      const promote = role === "admin";
      const ok = await confirm({
        title: promote ? `Promote ${label(u)} to admin?` : `Demote ${label(u)} to user?`,
        description: promote
          ? "Admins can view all users, reset passwords and 2FA, and delete regular users."
          : "They lose access to user management immediately.",
        confirmText: promote ? "Promote to admin" : "Demote to user",
        icon: Shield,
        onConfirm: () => api.updateUserRole(u.id, role),
      });
      if (ok) {
        toast.success(promote ? `${label(u)} is now an admin` : `${label(u)} is now a user`);
        setData((prev) => prev?.map((x) => (x.id === u.id ? { ...x, role } : x)));
        refresh();
      }
    },
    [confirm, refresh, setData]
  );

  const reset2FA = React.useCallback(
    async (u: UserWithDetails) => {
      const ok = await confirm({
        title: `Reset two-factor for ${label(u)}?`,
        description: "Their authenticator is unlinked. They sign in with password only until they set up 2FA again.",
        confirmText: "Reset 2FA",
        destructive: true,
        icon: ShieldOff,
        onConfirm: () => api.resetUser2FA(u.id),
      });
      if (ok) {
        toast.success("Two-factor reset");
        setData((prev) => prev?.map((x) => (x.id === u.id ? { ...x, totp_enabled: false } : x)));
        refresh();
      }
    },
    [confirm, refresh, setData]
  );

  const deleteUser = React.useCallback(
    async (u: UserWithDetails) => {
      const ok = await confirm({
        title: `Delete ${label(u)}?`,
        description: "The account is removed permanently. This cannot be undone.",
        details:
          u.machine_count || u.project_count ? (
            <p className="text-xs text-muted-foreground">
              Owns <span className="font-data text-foreground">{u.machine_count}</span> machine{u.machine_count === 1 ? "" : "s"} and{" "}
              <span className="font-data text-foreground">{u.project_count}</span> project{u.project_count === 1 ? "" : "s"}.
            </p>
          ) : undefined,
        destructive: true,
        typeToConfirm: u.email,
        confirmText: "Delete user",
        onConfirm: () => api.deleteUser(u.id),
      });
      if (ok) {
        toast.success(`${label(u)} deleted`);
        setData((prev) => prev?.filter((x) => x.id !== u.id));
        refresh();
      }
    },
    [confirm, refresh, setData]
  );

  const columns: ColumnDef<Row>[] = React.useMemo(
    () => [
      {
        id: "user",
        accessorFn: (u) => u.name || u.email,
        header: "User",
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <InitialsAvatar name={u.name || u.email} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{u.name || u.email}</span>
                  {me?.id === u.id && <span className="text-xs text-subtle-foreground">you</span>}
                </div>
                {u.name && <div className="truncate text-xs text-muted-foreground">{u.email}</div>}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => <UserRoleBadge role={row.original.role} />,
      },
      {
        accessorKey: "twofa",
        header: "2FA",
        cell: ({ row }) => <StatusText status={row.original.twofa} label={row.original.totp_enabled ? "Enabled" : "Off"} />,
        meta: { label: "Two-factor" },
      },
      {
        accessorKey: "machine_count",
        header: "Machines",
        cell: ({ row }) => <span className="font-data">{row.original.machine_count}</span>,
        meta: { align: "right" },
      },
      {
        accessorKey: "project_count",
        header: "Projects",
        cell: ({ row }) => <span className="font-data">{row.original.project_count}</span>,
        meta: { align: "right" },
      },
      {
        accessorKey: "password_changed_at",
        header: "Password changed",
        cell: ({ row }) => <RelativeTime date={row.original.password_changed_at} className="text-muted-foreground" fallback="Never" />,
        meta: { align: "right" },
      },
      {
        accessorKey: "created_at",
        header: "Joined",
        cell: ({ row }) => <RelativeTime date={row.original.created_at} className="text-muted-foreground" />,
        meta: { align: "right" },
      },
      {
        id: "actions",
        enableHiding: false,
        meta: { align: "right" },
        cell: ({ row }) => {
          const u = row.original;
          const modifiable = canModify(u);
          const canChangeRole = isSuper && me?.id !== u.id && u.role !== "superadmin";
          if (!modifiable && !canChangeRole) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label(u)}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{u.email}</DropdownMenuLabel>
                {canChangeRole &&
                  (u.role === "admin" ? (
                    <DropdownMenuItem onClick={() => changeRole(u, "user")}>
                      <UserIcon />
                      Demote to user
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => changeRole(u, "admin")}>
                      <Shield />
                      Promote to admin
                    </DropdownMenuItem>
                  ))}
                {modifiable && (
                  <>
                    <DropdownMenuItem onClick={() => setPwUser(u)}>
                      <KeyRound />
                      Set password…
                    </DropdownMenuItem>
                    {u.totp_enabled && (
                      <DropdownMenuItem onClick={() => reset2FA(u)}>
                        <ShieldOff />
                        Reset 2FA…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => deleteUser(u)}>
                      <Trash2 />
                      Delete user…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [me, isSuper, canModify, changeRole, reset2FA, deleteUser]
  );

  return (
    <FillPage>
      <PageHeader
        title="Users"
        stats={
          !(error && !data) && (
            <StatStrip>
              <StatCard label="Users" value={stats.total} loading={loading} />
              <StatCard label="Admins" value={stats.admins} loading={loading} />
              <StatCard
                label="2FA coverage"
                value={stats.total ? Math.round((stats.withTotp / stats.total) * 100) : 0}
                suffix="%"
                sub={`${stats.withTotp} of ${stats.total}`}
                progress={stats.total ? (stats.withTotp / stats.total) * 100 : 0}
                progressTone="success"
                loading={loading}
              />
              <StatCard
                label="Admins without 2FA"
                value={stats.adminsWithoutTotp}
                tone={stats.adminsWithoutTotp > 0 ? "warning" : "default"}
                loading={loading}
              />
            </StatStrip>
          )
        }
        actions={
          <>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={refresh} disabled={refreshing} aria-label="Refresh">
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            </Button>
            {isSuper && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus />
                Add user
              </Button>
            )}
          </>
        }
      />

      {error && !data ? (
        <ErrorState title="Couldn't load users" error={error} onRetry={refresh} />
      ) : (
        <DataTable
          fill
          columns={columns}
          data={rows}
          loading={loading}
          getRowId={(u) => u.id}
          searchKeys={["name", "email"]}
          searchPlaceholder="Search name or email…"
          facets={[
            { columnId: "role", title: "Role", options: USER_ROLES.map((r) => ({ label: r.label, value: r.value, icon: r.icon })) },
            {
              columnId: "twofa",
              title: "2FA",
              options: [
                { label: "Enabled", value: "enabled" },
                { label: "Off", value: "disabled" },
              ],
            },
          ]}
          initialState={{ sorting: [{ id: "created_at", desc: true }] }}
          emptyState={<EmptyState icon={Users} title="No users" description="Accounts appear here once people register or you add them." />}
        />
      )}

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={async (v) => {
          await api.createAdmin(v.email, v.password, v.name, v.role);
          toast.success(`${v.name || v.email} added`, { description: `Role: ${v.role}` });
          refresh();
        }}
      />
      <SetPasswordDialog
        userLabel={pwUser ? label(pwUser) : ""}
        open={!!pwUser}
        onOpenChange={(o) => !o && setPwUser(null)}
        onSubmit={async (pw) => {
          if (!pwUser) return;
          await api.changeUserPassword(pwUser.id, pw);
          toast.success(`Password updated for ${label(pwUser)}`);
          refresh();
        }}
      />
    </FillPage>
  );
}
