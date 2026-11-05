"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, MoreHorizontal, Share2, UserMinus, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/ui/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, RelativeTime, SectionCard, Spinner, errorMessage, useConfirm } from "@/components/app";
import { InitialsAvatar } from "@/components/profile/form-field";
import { api, type ProjectMember, type ProjectWithStats } from "@/lib/api";
import { MEMBER_ROLES, ProjectRoleBadge } from "./project-shared";

type Row = {
  id: string;
  name: string;
  email: string;
  role: string;
  can_view_notes: boolean;
  created_at: string;
  member: ProjectMember | null; // null = owner
};

function UserCell({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <InitialsAvatar name={name || email} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name || email}</div>
        {name && name !== email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
      </div>
    </div>
  );
}

export function ProjectMembersTab({
  project,
  members,
  loading,
  error,
  onRetry,
  canManage,
  currentUserId,
  onChanged,
  setMembers,
  onOpenSharing,
}: {
  project: ProjectWithStats;
  members: ProjectMember[] | null | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  canManage: boolean;
  currentUserId?: string;
  onChanged: () => void;
  setMembers: (fn: (prev: ProjectMember[] | null) => ProjectMember[] | null) => void;
  onOpenSharing: () => void;
}) {
  const confirm = useConfirm();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const pending = React.useMemo(() => (members ?? []).filter((m) => m.status === "pending"), [members]);

  const rows: Row[] = React.useMemo(() => {
    const owner: Row = {
      id: `owner-${project.owner_id}`,
      name: project.owner_name,
      email: project.owner_email,
      role: "owner",
      can_view_notes: true,
      created_at: project.created_at,
      member: null,
    };
    const approved = (members ?? [])
      .filter((m) => m.status === "approved")
      .map<Row>((m) => ({ id: m.id, name: m.user_name, email: m.user_email, role: m.role, can_view_notes: m.can_view_notes, created_at: m.created_at, member: m }));
    return [owner, ...approved];
  }, [members, project]);

  const update = React.useCallback(
    async (m: ProjectMember, patch: { role?: string; can_view_notes?: boolean }) => {
      setBusyId(m.id);
      setMembers((prev) => prev?.map((x) => (x.id === m.id ? { ...x, ...patch } : x)) ?? prev);
      try {
        await api.updateMember(project.id, m.id, patch);
        toast.success(patch.role ? `${m.user_name || m.user_email} is now a ${patch.role}` : patch.can_view_notes ? "Notes access granted" : "Notes access revoked");
      } catch (err) {
        toast.error("Couldn't update member", { description: errorMessage(err) });
      } finally {
        setBusyId(null);
        onChanged();
      }
    },
    [project.id, onChanged, setMembers]
  );

  const remove = React.useCallback(
    async (m: ProjectMember) => {
      const who = m.user_name || m.user_email;
      const ok = await confirm({
        title: `Remove ${who}?`,
        description: `They immediately lose access to “${project.name}” and its machines. They can request access again with a valid invite.`,
        destructive: true,
        icon: UserMinus,
        confirmText: "Remove member",
        onConfirm: () => api.removeMember(project.id, m.id),
      });
      if (ok) {
        toast.success(`${who} removed`);
        setMembers((prev) => prev?.filter((x) => x.id !== m.id) ?? prev);
        onChanged();
      }
    },
    [confirm, project, onChanged, setMembers]
  );

  const columns: ColumnDef<Row>[] = React.useMemo(
    () => [
      {
        id: "user",
        accessorFn: (r) => `${r.name} ${r.email}`,
        header: "User",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <UserCell name={row.original.name} email={row.original.email} />
            {row.original.member?.user_id === currentUserId || (!row.original.member && project.owner_id === currentUserId) ? (
              <span className="text-xs text-subtle-foreground">you</span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => {
          const r = row.original;
          if (!r.member || !canManage) return <ProjectRoleBadge role={r.role} />;
          const m = r.member;
          return (
            <Select value={m.role} onValueChange={(v) => v !== m.role && update(m, { role: v })} disabled={busyId === m.id}>
              <SelectTrigger size="sm" className="w-[120px]" aria-label="Member role" data-no-row-click>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMBER_ROLES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <div className="flex flex-col">
                      <span>{o.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
      {
        id: "notes",
        accessorFn: (r) => (r.can_view_notes ? "yes" : "no"),
        header: () => (
          <Tooltip>
            <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">Machine notes</TooltipTrigger>
            <TooltipContent>Can read the markdown notes attached to project machines</TooltipContent>
          </Tooltip>
        ),
        cell: ({ row }) => {
          const r = row.original;
          if (!r.member) return <span className="text-xs text-muted-foreground">Always</span>;
          if (!canManage) return <span className="text-xs text-muted-foreground">{r.can_view_notes ? "Allowed" : "Hidden"}</span>;
          const m = r.member;
          return (
            <Switch
              checked={m.can_view_notes}
              disabled={busyId === m.id}
              onCheckedChange={(v) => update(m, { can_view_notes: v })}
              aria-label="Can view machine notes"
            />
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Since",
        cell: ({ row }) => <RelativeTime date={row.original.created_at} className="text-muted-foreground" />,
        meta: { align: "right" },
      },
      {
        id: "actions",
        enableHiding: false,
        meta: { align: "right" },
        cell: ({ row }) => {
          const m = row.original.member;
          if (!m || !canManage) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Member actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={() => remove(m)}>
                  <UserMinus />
                  Remove from project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [busyId, canManage, currentUserId, project.owner_id, remove, update]
  );

  if (error && !members) return <ErrorState title="Couldn't load members" error={error} onRetry={onRetry} />;

  return (
    <div className="space-y-4">
      {canManage && pending.length > 0 && (
        <SectionCard
          icon={UserPlus}
          title={`Access requests (${pending.length})`}
          description="Choose a role, then approve. Denied requests can re-apply with a valid invite."
          flush
        >
          <ul className="divide-y divide-border">
            {pending.map((m) => (
              <PendingRow key={m.id} projectId={project.id} member={m} onDone={onChanged} setMembers={setMembers} />
            ))}
          </ul>
        </SectionCard>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => r.id}
        searchKeys={["name", "email"]}
        searchPlaceholder="Search members…"
        showPagination={rows.length > 20}
        toolbarActions={
          canManage ? (
            <Button size="sm" variant="outline" onClick={onOpenSharing}>
              <Share2 />
              Invite people
            </Button>
          ) : null
        }
        emptyState={<EmptyState icon={Users} title="No members" size="compact" />}
      />
    </div>
  );
}

function PendingRow({
  projectId,
  member,
  onDone,
  setMembers,
}: {
  projectId: string;
  member: ProjectMember;
  onDone: () => void;
  setMembers: (fn: (prev: ProjectMember[] | null) => ProjectMember[] | null) => void;
}) {
  const [role, setRole] = React.useState("member");
  const [notes, setNotes] = React.useState(false);
  const [busy, setBusy] = React.useState<"approve" | "deny" | null>(null);
  const who = member.user_name || member.user_email;

  const act = async (kind: "approve" | "deny") => {
    setBusy(kind);
    try {
      if (kind === "approve") await api.approveMember(projectId, member.id, role, notes);
      else await api.denyMember(projectId, member.id);
      toast.success(kind === "approve" ? `${who} approved as ${role}` : `Request from ${who} denied`);
      setMembers((prev) =>
        prev?.flatMap((x) => (x.id !== member.id ? [x] : kind === "approve" ? [{ ...x, status: "approved", role, can_view_notes: notes }] : [])) ?? prev
      );
      onDone();
    } catch (err) {
      toast.error(kind === "approve" ? "Couldn't approve request" : "Couldn't deny request", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="min-w-[200px] flex-1">
        <UserCell name={member.user_name} email={member.user_email} />
      </div>
      <span className="text-xs text-muted-foreground">
        Requested <RelativeTime date={member.created_at} />
      </span>
      <Select value={role} onValueChange={setRole} disabled={!!busy}>
        <SelectTrigger size="sm" className="w-[120px]" aria-label="Role to grant">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MEMBER_ROLES.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={notes} onCheckedChange={setNotes} disabled={!!busy} aria-label="Allow machine notes" />
        Notes
      </label>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => act("deny")}>
          {busy === "deny" ? <Spinner /> : <X />}
          Deny
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => act("approve")}>
          {busy === "approve" ? <Spinner /> : <Check />}
          Approve
        </Button>
      </div>
    </li>
  );
}
