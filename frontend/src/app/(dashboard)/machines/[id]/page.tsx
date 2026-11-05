"use client";

import * as React from "react";
import { use } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Server } from "lucide-react";

import { api, type MachineGroupWithCount, type SecurityMachineSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardSkeleton, EmptyState, ErrorState, PageSkeleton, StatusDot, machineDisplayName, useBreadcrumbLabel, usePolling } from "@/components/app";
import { AssignGroupsDialog } from "@/components/machines/assign-groups-dialog";
import { GroupsSheet } from "@/components/machines/groups-sheet";
import { useMachineActions } from "@/components/machines/machine-actions";
import { MachineHero } from "@/components/machines/detail/machine-hero";
import { RenameDialog } from "@/components/machines/detail/rename-dialog";
import { OverviewTab } from "@/components/machines/detail/overview-tab";
import { SecurityTab } from "@/components/machines/detail/security-tab";
import { TerminalTab } from "@/components/machines/detail/terminal-tab";
import { LogsTab } from "@/components/machines/detail/logs-tab";
import { JobsTab } from "@/components/machines/detail/jobs-tab";
import { ToolsTab } from "@/components/machines/detail/tools-tab";
import { isAgentUpdating, liveness, type FleetMachine } from "@/components/machines/utils";

const NginxTab = dynamic(() => import("@/components/machines/nginx/nginx-tab").then((m) => m.NginxTab), {
  ssr: false,
  loading: () => <CardSkeleton lines={10} />,
});
const PHPRuntimeTab = dynamic(() => import("@/components/php-runtime-tab").then((m) => m.PHPRuntimeTab), {
  ssr: false,
  loading: () => <CardSkeleton lines={6} />,
});

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "nginx", label: "Nginx & configs" },
  { value: "security", label: "Security" },
  { value: "terminal", label: "Terminal" },
  { value: "logs", label: "Logs" },
  { value: "jobs", label: "Jobs" },
  { value: "runtimes", label: "Runtimes" },
  { value: "tools", label: "Tools" },
] as const;
type TabValue = (typeof TABS)[number]["value"];
const LEGACY_TAB: Record<string, TabValue> = { configs: "nginx" };

export default function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <React.Suspense fallback={<PageSkeleton stats={false} />}>
      <MachineDetail id={id} />
    </React.Suspense>
  );
}

function MachineDetail({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  /* ---------- data ---------- */
  const machineQ = usePolling(() => api.getMachine(id) as Promise<FleetMachine>, 5000, { deps: [id] });
  const machine = machineQ.data;
  const setMachine = machineQ.setData;
  const securityQ = usePolling<SecurityMachineSettings | null>(() => api.getMachineSecuritySettings(id).catch(() => null), 30000, { deps: [id] });
  const versionQ = usePolling(() => api.getAgentVersion().catch(() => null), 0);
  const groupsQ = usePolling<MachineGroupWithCount[]>(() => api.listMachineGroups(), 0);
  const refresh = machineQ.refresh;

  useBreadcrumbLabel(machine ? machineDisplayName(machine) : null);

  /* ---------- tabs (?tab=) ---------- */
  const rawTab = search.get("tab") ?? "overview";
  const tab: TabValue = (LEGACY_TAB[rawTab] ?? (TABS.some((t) => t.value === rawTab) ? rawTab : "overview")) as TabValue;
  const setTab = React.useCallback(
    (v: string) => {
      const next = new URLSearchParams(search.toString());
      if (v === "overview") next.delete("tab");
      else next.set("tab", v);
      if (v !== "nginx") next.delete("file");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [search, pathname, router]
  );
  // Mount heavy tabs lazily but keep them mounted afterwards (terminal session, editor state).
  const [visited, setVisited] = React.useState<Set<TabValue>>(() => new Set([tab]));
  React.useEffect(() => {
    setVisited((s) => (s.has(tab) ? s : new Set(s).add(tab)));
  }, [tab]);

  /* ---------- actions ---------- */
  const actions = useMachineActions(refresh);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [groupsOpen, setGroupsOpen] = React.useState(false);
  const [manageGroupsOpen, setManageGroupsOpen] = React.useState(false);
  const [updateStarted, setUpdateStarted] = React.useState(false);
  React.useEffect(() => {
    if (updateStarted && machine && !isAgentUpdating(machine) && machine.agent_update_state) {
      // backend reports a terminal state; stop our local spinner
      const t = setTimeout(() => setUpdateStarted(false), 3000);
      return () => clearTimeout(t);
    }
  }, [machine, updateStarted]);

  if (machineQ.loading && !machine) return <PageSkeleton stats={false} />;
  if (!machine) {
    const notFound = /not found|404/i.test(machineQ.error?.message ?? "");
    return notFound ? (
      <EmptyState
        icon={Server}
        title="Machine not found"
        description="It may have been deleted, or you no longer have access."
        action={
          <Button size="sm" onClick={() => router.push("/machines")}>
            Back to machines
          </Button>
        }
      />
    ) : (
      <ErrorState error={machineQ.error} onRetry={refresh} title="Couldn't load machine" />
    );
  }

  const name = machineDisplayName(machine);
  const live = liveness(machine);

  return (
    <div className="space-y-6">
      <MachineHero
        machine={machine}
        latestAgent={versionQ.data?.version ?? null}
        updating={updateStarted}
        onRename={() => setRenameOpen(true)}
        onAssignGroups={() => setGroupsOpen(true)}
        onDelete={async () => {
          if (await actions.deleteMachine(machine)) router.push("/machines");
        }}
        onUpdateAgent={async () => {
          setUpdateStarted(true);
          await actions.updateAgent(machine);
        }}
        onOpenTerminal={() => setTab("terminal")}
        onChanged={(patch) => setMachine((m) => (m ? { ...m, ...patch } : m))}
      />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-3">
                {t.label}
                {t.value === "terminal" && live === "online" && <StatusDot status="online" size="xs" pulse={false} />}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview">
          <OverviewTab
            machine={machine}
            security={securityQ.data ?? null}
            active={tab === "overview"}
            onNavigate={setTab}
            onNotesSaved={(notes) => setMachine((m) => (m ? { ...m, notes_md: notes } : m))}
            updatedAt={machineQ.updatedAt}
          />
        </TabsContent>

        <TabsContent value="nginx" forceMount={visited.has("nginx") ? true : undefined} hidden={tab !== "nginx"}>
          {visited.has("nginx") && <NginxTab machineId={machine.id} machineName={name} active={tab === "nginx"} />}
        </TabsContent>

        <TabsContent value="security">
          <SecurityTab machine={machine} security={securityQ.data ?? null} onSecurityChange={(s) => securityQ.setData(s)} refresh={refresh} />
        </TabsContent>

        <TabsContent value="terminal" forceMount={visited.has("terminal") ? true : undefined} hidden={tab !== "terminal"}>
          {visited.has("terminal") && <TerminalTab machineId={machine.id} machineName={name} active={tab === "terminal"} />}
        </TabsContent>

        <TabsContent value="logs">
          <LogsTab machineId={machine.id} machineName={name} active={tab === "logs"} />
        </TabsContent>

        <TabsContent value="jobs">
          <JobsTab machineId={machine.id} machineName={name} active={tab === "jobs"} />
        </TabsContent>

        <TabsContent value="runtimes">
          <PHPRuntimeTab machineId={machine.id} machineName={name} />
        </TabsContent>

        <TabsContent value="tools">
          <ToolsTab machine={machine} />
        </TabsContent>
      </Tabs>

      <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} machine={machine} onRenamed={(title) => setMachine((m) => (m ? { ...m, title } : m))} />
      <AssignGroupsDialog
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        machines={[machine]}
        groups={groupsQ.data ?? []}
        onDone={() => {
          void refresh();
          void groupsQ.refresh();
        }}
        onManageGroups={() => setManageGroupsOpen(true)}
      />
      <GroupsSheet
        open={manageGroupsOpen}
        onOpenChange={setManageGroupsOpen}
        groups={groupsQ.data ?? []}
        onChanged={() => {
          void groupsQ.refresh();
          void refresh();
        }}
      />
    </div>
  );
}
