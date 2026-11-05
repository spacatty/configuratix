"use client";

import * as React from "react";
import { use } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Link2, MoreHorizontal, Pencil, Server, Share2, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ErrorState,
  Mono,
  PageHeader,
  PageSkeleton,
  RelativeTime,
  StatCard,
  StatStrip,
  invalidatePickerCache,
  useBreadcrumbLabel,
  useConfirm,
  usePolling,
} from "@/components/app";
import { ProjectNameDialog, ShareProjectDialog } from "@/components/projects/project-dialogs";
import { ProjectMachinesTab } from "@/components/projects/project-machines-tab";
import { ProjectMembersTab } from "@/components/projects/project-members-tab";
import { ProjectNotesTab } from "@/components/projects/project-notes-tab";
import { ProjectRoleBadge, inviteLink, type ProjectRole } from "@/components/projects/project-shared";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { machineLiveness } from "@/lib/jobs";

const TABS = ["machines", "members", "notes"] as const;
type Tab = (typeof TABS)[number];

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const confirm = useConfirm();

  const rawTab = search.get("tab");
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "machines";
  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    if (t === "machines") sp.delete("tab");
    else sp.set("tab", t);
    const q = sp.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const { data: me } = usePolling(() => api.getMe(), 0);
  const project = usePolling(() => api.getProject(id), 30000, { deps: [id] });
  const members = usePolling(() => api.listProjectMembers(id), 30000, { deps: [id] });
  const machines = usePolling(() => api.listMachines(undefined, id), 20000, { deps: [id] });

  const [renameOpen, setRenameOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);

  const p = project.data;
  useBreadcrumbLabel(p?.name ?? null);

  const myRole: ProjectRole = React.useMemo(() => {
    if (!p || !me) return "member";
    if (p.owner_id === me.id) return "owner";
    const row = members.data?.find((m) => m.user_id === me.id && m.status === "approved");
    if (row?.role === "manager") return "manager";
    if (me.role === "superadmin") return "admin";
    return "member";
  }, [p, me, members.data]);

  const isSuper = me?.role === "superadmin";
  const isOwner = myRole === "owner" || isSuper; // owner-only backend actions: rename, notes, sharing, members, delete
  const canLinkMachines = isOwner || myRole === "manager";

  if (project.loading) return <PageSkeleton />;
  if (!p) {
    return (
      <ErrorState title="Couldn't load this project" error={project.error} onRetry={project.refresh} />
    );
  }

  const pending = (members.data ?? []).filter((m) => m.status === "pending").length;
  const approved = (members.data ?? []).filter((m) => m.status === "approved").length;
  const live = (machines.data ?? []).map((m) => machineLiveness(m));
  const online = machines.data ? live.filter((l) => l === "online").length : p.online_machines;
  const total = machines.data ? machines.data.length : p.machine_count;

  const refreshAll = () => {
    project.refresh();
    members.refresh();
    machines.refresh();
  };

  const copyInvite = async () => {
    if (!p.invite_token) return;
    if (await copyToClipboard(inviteLink(p.invite_token))) toast.success("Invite link copied");
    else toast.error("Couldn't access the clipboard");
  };

  const deleteProject = async () => {
    const ok = await confirm({
      title: `Delete project “${p.name}”?`,
      description: "Members lose access. Machines are unlinked from the project but keep running.",
      destructive: true,
      typeToConfirm: p.name,
      confirmText: "Delete project",
      onConfirm: () => api.deleteProject(p.id),
    });
    if (ok) {
      toast.success("Project deleted");
      invalidatePickerCache("machines");
      router.push("/projects");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.name}
        badge={<ProjectRoleBadge role={myRole} />}
        stats={
          <StatStrip>
            <StatCard
              label="Online"
              value={online}
              suffix={`/ ${total}`}
              progress={total ? (online / total) * 100 : undefined}
              progressTone="success"
            />
            <StatCard label="Offline" value={total - online} tone={total - online > 0 ? "warning" : "default"} />
            <StatCard label="Members" value={members.data ? approved + 1 : p.member_count + 1} loading={members.loading} />
            <StatCard
              label="Pending"
              value={pending}
              tone={pending > 0 && isOwner ? "warning" : "default"}
              loading={members.loading}
            />
          </StatStrip>
        }
        meta={
          <>
            <span>
              Owner <span className="text-foreground">{p.owner_name || p.owner_email}</span>
            </span>
            <span>
              Created <RelativeTime date={p.created_at} />
            </span>
            {p.sharing_enabled ? (
              <Badge variant="success">
                <Share2 />
                Invite link on
              </Badge>
            ) : (
              <span>Private</span>
            )}
          </>
        }
        actions={
          isOwner ? (
            <>
              {p.sharing_enabled && p.invite_token && (
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={copyInvite}>
                  <Link2 />
                  Copy invite
                </Button>
              )}
              <Button size="sm" onClick={() => setShareOpen(true)}>
                <Share2 />
                Share
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="More project actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                    <Pencil />
                    Rename…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={deleteProject}>
                    <Trash2 />
                    Delete project…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="machines">
            <Server />
            Machines
            <Mono muted className="text-[11px]">{total}</Mono>
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users />
            Members
            {pending > 0 && isOwner ? (
              <Badge variant="warning" className="h-4 px-1">
                {pending}
              </Badge>
            ) : (
              <Mono muted className="text-[11px]">{members.data ? approved + 1 : p.member_count + 1}</Mono>
            )}
          </TabsTrigger>
          <TabsTrigger value="notes">
            <FileText />
            Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="machines">
          <ProjectMachinesTab
            projectId={p.id}
            projectName={p.name}
            machines={machines.data}
            loading={machines.loading}
            error={machines.error}
            onRetry={machines.refresh}
            canManage={canLinkMachines}
            onChanged={() => {
              machines.refresh();
              project.refresh();
            }}
          />
        </TabsContent>

        <TabsContent value="members">
          <ProjectMembersTab
            project={p}
            members={members.data}
            loading={members.loading}
            error={members.error}
            onRetry={members.refresh}
            canManage={isOwner}
            currentUserId={me?.id}
            onChanged={() => {
              members.refresh();
              project.refresh();
            }}
            setMembers={(fn) => members.setData((prev) => fn(prev ?? null) ?? prev)}
            onOpenSharing={() => setShareOpen(true)}
          />
        </TabsContent>

        <TabsContent value="notes">
          <ProjectNotesTab
            projectId={p.id}
            notes={p.notes_md || ""}
            canEdit={isOwner}
            onSaved={(notes) => project.setData((prev) => (prev ? { ...prev, notes_md: notes } : prev))}
          />
        </TabsContent>
      </Tabs>

      <ProjectNameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        mode="rename"
        initialName={p.name}
        onSubmit={async (name) => {
          await api.updateProject(p.id, { name });
          project.setData((prev) => (prev ? { ...prev, name } : prev));
          toast.success("Project renamed");
          refreshAll();
        }}
      />
      <ShareProjectDialog
        project={p}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onChanged={(u) =>
          project.setData((prev) => (prev ? { ...prev, sharing_enabled: u.sharing_enabled, invite_token: u.invite_token, invite_expires_at: u.invite_expires_at } : prev))
        }
      />
    </div>
  );
}
