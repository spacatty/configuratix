"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowRight, Ban, Flame, KeyRound, Lock, Plus, Settings2, Shield, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { api, type Job, type SecurityMachineSettings, type UFWRule } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/ui/data-table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, RelativeTime, SectionCard, Spinner, StatusBadge, errorMessage, machineDisplayName, trackJob, useConfirm } from "@/components/app";
import type { FleetMachine } from "../utils";
import { AddRuleDialog, Fail2banDialog, PasswordDialog, SshPortDialog } from "./security-dialogs";

const DEFAULT_FAIL2BAN_CONFIG = `[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
`;

type PendingKey = "ufw" | "fail2ban" | "ssh" | "password" | "nft" | `rule:${string}`;

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
  pending,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  pending?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="size-4 shrink-0 text-subtle-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          {title}
          {pending && <StatusBadge status="running" label="applying" size="sm" />}
        </div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function portLabel(port: string, sshPort: number) {
  if (port === String(sshPort)) return "SSH";
  return ({ "22": "SSH", "80": "HTTP", "443": "HTTPS", "3306": "MySQL", "5432": "Postgres", "6379": "Redis", "5201": "iPerf3" } as Record<string, string>)[port] ?? null;
}

export function SecurityTab({
  machine,
  security,
  onSecurityChange,
  refresh,
}: {
  machine: FleetMachine;
  security: SecurityMachineSettings | null;
  onSecurityChange: (s: SecurityMachineSettings) => void;
  refresh: () => void;
}) {
  const confirm = useConfirm();
  const name = machineDisplayName(machine);
  const sshPort = machine.ssh_port || 22;
  const [pending, setPending] = React.useState<Partial<Record<PendingKey, boolean>>>({});
  const [optimistic, setOptimistic] = React.useState<{ ufw?: boolean; fail2ban?: boolean }>({});
  const [dialog, setDialog] = React.useState<null | "ssh" | "password" | "fail2ban" | "rule">(null);

  const ufwOn = optimistic.ufw ?? machine.ufw_enabled;
  const f2bOn = optimistic.fail2ban ?? machine.fail2ban_enabled;

  /** Run a job-returning mutation; tracks it and refreshes the machine when it finishes. */
  const runJob = React.useCallback(
    async (key: PendingKey, title: string, fn: () => Promise<Job>, opts: { onFailure?: () => void; rethrow?: boolean } = {}) => {
      setPending((p) => ({ ...p, [key]: true }));
      try {
        const job = await fn();
        trackJob(job, {
          title,
          description: name,
          onDone: (j) => {
            setPending((p) => ({ ...p, [key]: false }));
            if (j.status !== "completed") opts.onFailure?.();
            refresh();
            // Give the agent a heartbeat to report the new state before dropping optimistic values.
            setTimeout(() => setOptimistic({}), 6000);
          },
        });
      } catch (e) {
        setPending((p) => ({ ...p, [key]: false }));
        opts.onFailure?.();
        toast.error(`Couldn't start: ${title}`, { description: errorMessage(e) });
        if (opts.rethrow) throw e;
      }
    },
    [name, refresh]
  );

  const toggleUfw = async (next: boolean) => {
    const ok = await confirm({
      title: next ? "Enable the firewall?" : "Disable the firewall?",
      description: next
        ? `UFW will deny incoming traffic except the allowed rules. SSH (${sshPort}) stays open.`
        : "All ports become reachable from the internet until UFW is enabled again.",
      destructive: !next,
      confirmText: next ? "Enable UFW" : "Disable UFW",
      icon: next ? Shield : ShieldOff,
    });
    if (!ok) return;
    setOptimistic((o) => ({ ...o, ufw: next }));
    void runJob("ufw", next ? "Enable UFW" : "Disable UFW", () => api.toggleUFW(machine.id, next), { onFailure: () => setOptimistic((o) => ({ ...o, ufw: undefined })) });
  };

  const toggleF2b = async (next: boolean) => {
    const ok = await confirm({
      title: next ? "Enable fail2ban?" : "Disable fail2ban?",
      description: next ? "Bans IPs after repeated failed SSH logins, using the jail configuration." : "SSH brute-force attempts will no longer be blocked.",
      destructive: !next,
      confirmText: next ? "Enable fail2ban" : "Disable fail2ban",
      icon: ShieldCheck,
    });
    if (!ok) return;
    setOptimistic((o) => ({ ...o, fail2ban: next }));
    void runJob("fail2ban", next ? "Enable fail2ban" : "Disable fail2ban", () => api.toggleFail2ban(machine.id, next, machine.fail2ban_config || DEFAULT_FAIL2BAN_CONFIG), {
      onFailure: () => setOptimistic((o) => ({ ...o, fail2ban: undefined })),
    });
  };

  const removeRule = async (r: UFWRule) => {
    const ok = await confirm({
      title: `Remove ${r.port}/${r.protocol}?`,
      description: "Connections to this port will be blocked once the rule is deleted.",
      destructive: true,
      confirmText: "Remove rule",
      icon: Trash2,
    });
    if (!ok) return;
    void runJob(`rule:${r.port}/${r.protocol}`, `Remove ${r.port}/${r.protocol} (UFW)`, () => api.removeUFWRule(machine.id, r.port, r.protocol));
  };

  const toggleNft = async (next: boolean) => {
    if (!next) {
      const ok = await confirm({
        title: "Disable automatic IP banning?",
        description: "Existing bans are flushed from nftables on this machine and new offenders are no longer blocked.",
        destructive: true,
        confirmText: "Disable",
        icon: Ban,
      });
      if (!ok) return;
    }
    setPending((p) => ({ ...p, nft: true }));
    try {
      const updated = await api.updateMachineSecuritySettings(machine.id, { nftables_enabled: next });
      onSecurityChange(updated);
      toast.success(next ? "IP banning enabled" : "IP banning disabled");
    } catch (e) {
      toast.error("Couldn't update IP banning", { description: errorMessage(e) });
    } finally {
      setPending((p) => ({ ...p, nft: false }));
    }
  };

  const rules = machine.ufw_rules ?? [];
  const columns: ColumnDef<UFWRule>[] = React.useMemo(
    () => [
      {
        id: "port",
        accessorFn: (r) => Number(r.port.split(":")[0]) || 0,
        header: "Port",
        cell: ({ row }) => {
          const r = row.original;
          const label = portLabel(r.port, sshPort);
          return (
            <div className="flex items-center gap-2">
              <span className="font-data font-medium">{r.port}</span>
              {label && <span className="text-xs text-muted-foreground">{label}</span>}
            </div>
          );
        },
      },
      {
        accessorKey: "protocol",
        header: "Protocol",
        cell: ({ row }) => (
          <Badge variant="outline" className="font-data lowercase">
            {row.original.protocol || "any"}
          </Badge>
        ),
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => {
          const a = (row.original.action || "").toUpperCase();
          return <Badge variant={a.startsWith("ALLOW") ? "success" : a.startsWith("DENY") || a.startsWith("REJECT") ? "destructive" : "muted"}>{a.toLowerCase() || "—"}</Badge>;
        },
      },
      {
        accessorKey: "from",
        header: "From",
        cell: ({ row }) => <span className="font-data text-xs text-muted-foreground">{row.original.from || "Anywhere"}</span>,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", className: "w-24" },
        cell: ({ row }) => {
          const r = row.original;
          const protectedRule = r.port === String(sshPort) || r.port === "22";
          const key: PendingKey = `rule:${r.port}/${r.protocol}`;
          if (pending[key]) return <Spinner className="ml-auto text-muted-foreground" />;
          if (protectedRule)
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs text-subtle-foreground">
                    <Lock className="size-3" />
                    protected
                  </span>
                </TooltipTrigger>
                <TooltipContent>The SSH port can&apos;t be closed from here</TooltipContent>
              </Tooltip>
            );
          return (
            <Button variant="ghost" size="icon-sm" onClick={() => removeRule(r)} aria-label={`Remove ${r.port}/${r.protocol}`}>
              <Trash2 />
            </Button>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sshPort, pending]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard className="lg:col-span-2" icon={KeyRound} title="Access" description="SSH and root credentials" flush>
          <div className="divide-y divide-border">
            <SettingRow icon={Lock} title="SSH port" pending={pending.ssh} description={<>Listening on <span className="font-data text-foreground">{sshPort}</span>{sshPort === 22 && " — default port, consider moving it"}</>}>
              <Button size="sm" variant="outline" onClick={() => setDialog("ssh")} disabled={pending.ssh}>
                Change
              </Button>
            </SettingRow>
            <SettingRow icon={KeyRound} title="Root password" pending={pending.password} description={machine.root_password_set ? "Changed via Configuratix" : "Never changed from Configuratix"}>
              <Button size="sm" variant="outline" onClick={() => setDialog("password")} disabled={pending.password}>
                Change
              </Button>
            </SettingRow>
            <SettingRow icon={ShieldCheck} title="Fail2ban" pending={pending.fail2ban} description="Blocks SSH brute-force attempts">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" onClick={() => setDialog("fail2ban")} aria-label="Configure fail2ban">
                    <Settings2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit jail configuration</TooltipContent>
              </Tooltip>
              <Switch checked={f2bOn} onCheckedChange={toggleF2b} disabled={pending.fail2ban} aria-label="Fail2ban" />
            </SettingRow>
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-3"
          icon={Ban}
          title="Automatic IP banning"
          description="nftables bans for requests that trip security rules (blocked user agents, probing paths)"
          actions={
            <div className="flex items-center gap-2">
              {pending.nft && <Spinner className="text-muted-foreground" />}
              <Switch checked={security?.nftables_enabled ?? false} onCheckedChange={toggleNft} disabled={!security || pending.nft} aria-label="IP banning" />
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="mt-1">
                <StatusBadge status={security?.nftables_enabled ? "enabled" : "disabled"} />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
              <div className="text-xs text-muted-foreground">Active bans</div>
              <div className="font-data mt-0.5 text-xl">{security?.ban_count ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
              <div className="text-xs text-muted-foreground">Last sync</div>
              <div className="mt-1 text-[13px]">
                <RelativeTime date={security?.last_sync_at} fallback="never" />
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Bans sync across all machines every 2 minutes.</span>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/security/bans">
                View bans
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        icon={Flame}
        title="Firewall (UFW)"
        description={`${rules.length} rule${rules.length === 1 ? "" : "s"} · reported by the agent every heartbeat`}
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {pending.ufw ? <StatusBadge status="running" label="applying" /> : <StatusBadge status={ufwOn ? "active" : "inactive"} />}
              <Switch checked={ufwOn} onCheckedChange={toggleUfw} disabled={pending.ufw} aria-label="UFW" />
            </div>
            <Button size="sm" onClick={() => setDialog("rule")} disabled={!ufwOn}>
              <Plus />
              Allow port
            </Button>
          </div>
        }
        flush
      >
        <DataTable
          columns={columns}
          data={rules}
          bordered={false}
          hideSearch={rules.length < 8}
          searchKeys={["port", "protocol", "action", "from"]}
          searchPlaceholder="Filter rules…"
          showColumnToggle={false}
          pageSize={10}
          showPagination={rules.length > 10}
          maxHeight="none"
          getRowId={(r) => `${r.port}/${r.protocol}/${r.from}/${r.action}`}
          initialState={{ sorting: [{ id: "port", desc: false }] }}
          emptyState={
            <EmptyState
              icon={Flame}
              size="compact"
              bordered={false}
              title={ufwOn ? "No rules reported" : "Firewall is off"}
              description={ufwOn ? "The agent reports rules on its next heartbeat." : "Enable UFW to manage port rules."}
            />
          }
          className="[&_[data-slot=data-table]]:space-y-0"
        />
      </SectionCard>

      <SshPortDialog
        open={dialog === "ssh"}
        onOpenChange={(o) => !o && setDialog(null)}
        current={sshPort}
        onSubmit={(port) => runJob("ssh", `Change SSH port → ${port}`, () => api.changeSSHPort(machine.id, port), { rethrow: true })}
      />
      <PasswordDialog
        open={dialog === "password"}
        onOpenChange={(o) => !o && setDialog(null)}
        onSubmit={(pw) => runJob("password", "Change root password", () => api.changeRootPassword(machine.id, pw), { rethrow: true })}
      />
      <Fail2banDialog
        open={dialog === "fail2ban"}
        onOpenChange={(o) => !o && setDialog(null)}
        initial={machine.fail2ban_config || DEFAULT_FAIL2BAN_CONFIG}
        enabled={f2bOn}
        onSubmit={(cfg) => runJob("fail2ban", "Update fail2ban config", () => api.toggleFail2ban(machine.id, f2bOn, cfg), { rethrow: true })}
      />
      <AddRuleDialog
        open={dialog === "rule"}
        onOpenChange={(o) => !o && setDialog(null)}
        existing={rules}
        onSubmit={(port, protocol) => runJob(`rule:${port}/${protocol}`, `Allow ${port}/${protocol} (UFW)`, () => api.addUFWRule(machine.id, port, protocol), { rethrow: true })}
      />
    </div>
  );
}
