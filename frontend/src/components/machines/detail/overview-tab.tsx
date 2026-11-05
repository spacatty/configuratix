"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Ban, Gauge, Globe, ListChecks, Lock, Package, Shield, ShieldCheck, Terminal } from "lucide-react";
import { api, type JobListItem, type SecurityMachineSettings } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  EmptyState,
  KeyValueList,
  RelativeTime,
  SectionCard,
  StatusBadge,
  StatusDot,
  jobTitle,
  openJobLogs,
  usePolling,
} from "@/components/app";
import { RingGauge } from "../resource-meter";
import { cpuPct, diskPct, memPct, type FleetMachine } from "../utils";
import { NotesCard } from "./notes-card";

function PostureTile({
  icon: Icon,
  label,
  value,
  ok,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  ok: boolean | null;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2/50"
    >
      <Icon className="size-4 text-subtle-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium">
          {ok !== null && <StatusDot tone={ok ? "success" : "warning"} pulse={false} />}
          {value}
        </div>
      </div>
      <ArrowRight className="size-3.5 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export function OverviewTab({
  machine,
  security,
  active,
  onNavigate,
  onNotesSaved,
  updatedAt,
}: {
  machine: FleetMachine;
  security: SecurityMachineSettings | null;
  active: boolean;
  onNavigate: (tab: string) => void;
  onNotesSaved: (notes: string) => void;
  updatedAt: number | null;
}) {
  const cpu = cpuPct(machine);
  const mem = memPct(machine);
  const disk = diskPct(machine);

  const jobsQ = usePolling(() => api.listJobsPage({ machine_id: machine.id, limit: 6 }), 10000, { enabled: active, deps: [machine.id] });
  const jobs: JobListItem[] = jobsQ.data?.jobs ?? [];

  const summary = machine.assigned_domains_summary;
  const domainsQ = usePolling(
    async () => (await api.listDomains()).filter((d) => d.assigned_machine_id === machine.id).map((d) => ({ fqdn: d.fqdn, status: d.status })),
    0,
    { enabled: active && !Array.isArray(summary), deps: [machine.id] }
  );
  const domains = Array.isArray(summary) ? summary : (domainsQ.data ?? []);
  const unhealthy = domains.filter((d) => ["unhealthy", "failed", "error", "down"].includes(d.status)).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          icon={Gauge}
          title="Resources"
          actions={
            updatedAt ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot status="online" size="xs" />
                live · <RelativeTime date={new Date(updatedAt).toISOString()} />
              </span>
            ) : undefined
          }
        >
          <div className="grid gap-6 sm:grid-cols-3">
            <RingGauge label="CPU" value={cpu} sub={cpu != null ? `${cpu.toFixed(1)}% busy` : "no data"} />
            <RingGauge label="Memory" value={mem} sub={mem != null ? `${formatBytes(machine.memory_used)} / ${formatBytes(machine.memory_total)}` : "no data"} />
            <RingGauge label="Disk" value={disk} sub={disk != null ? `${formatBytes(machine.disk_used)} / ${formatBytes(machine.disk_total)}` : "no data"} />
          </div>
        </SectionCard>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
          <PostureTile icon={Shield} label="Firewall" value={machine.ufw_enabled ? "UFW active" : "UFW off"} ok={machine.ufw_enabled} onClick={() => onNavigate("security")} />
          <PostureTile icon={ShieldCheck} label="Fail2ban" value={machine.fail2ban_enabled ? "Active" : "Off"} ok={machine.fail2ban_enabled} onClick={() => onNavigate("security")} />
          <PostureTile icon={Lock} label="SSH port" value={<span className="font-data">{machine.ssh_port || 22}</span>} ok={(machine.ssh_port || 22) !== 22} onClick={() => onNavigate("security")} />
          <PostureTile
            icon={Ban}
            label="IP bans"
            value={security ? (security.nftables_enabled ? <span className="font-data">{security.ban_count}</span> : "Off") : "—"}
            ok={security ? security.nftables_enabled : null}
            onClick={() => onNavigate("security")}
          />
          <PostureTile
            icon={Package}
            label="PHP"
            value={machine.php_version ? <span className="font-data">{machine.php_version}</span> : machine.php_installed ? "Installed" : "None"}
            ok={null}
            onClick={() => onNavigate("runtimes")}
          />
          <PostureTile icon={Terminal} label="Shell" value="Open terminal" ok={null} onClick={() => onNavigate("terminal")} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard
            icon={Globe}
            title="Domains"
            description={domains.length ? `${domains.length} assigned${unhealthy ? ` · ${unhealthy} unhealthy` : ""}` : undefined}
            flush
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/domains?q=${encodeURIComponent(machine.title || machine.hostname || "")}`}>
                  All domains
                  <ArrowRight />
                </Link>
              </Button>
            }
          >
            {domains.length === 0 ? (
              <EmptyState icon={Globe} title="No domains on this machine" description="Assign a domain from the Domains page to serve it here." size="compact" bordered={false} />
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {domains.map((d) => (
                  <li key={d.fqdn}>
                    <Link href={`/domains?q=${encodeURIComponent(d.fqdn)}`} className="flex items-center gap-3 px-4 py-2 text-[13px] transition-colors hover:bg-surface-2/50">
                      <StatusDot status={d.status} pulse={false} />
                      <span className="font-data min-w-0 flex-1 truncate">{d.fqdn}</span>
                      <StatusBadge status={d.status} size="sm" indicator="none" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            icon={ListChecks}
            title="Recent jobs"
            flush
            actions={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("jobs")}>
                All jobs
                <ArrowRight />
              </Button>
            }
          >
            {jobsQ.loading && !jobsQ.data ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton-shimmer h-5 rounded" />
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <EmptyState icon={ListChecks} title="No jobs yet" size="compact" bordered={false} />
            ) : (
              <ul className="divide-y divide-border">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => openJobLogs(j.id)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors hover:bg-surface-2/50"
                    >
                      <StatusDot status={j.status} />
                      <span className="min-w-0 flex-1 truncate">{jobTitle(j)}</span>
                      {j.status === "failed" && j.error_message && (
                        <span className="hidden max-w-[220px] truncate text-xs text-destructive md:inline">{j.error_message}</span>
                      )}
                      <span className="font-data w-14 text-right text-xs text-muted-foreground">{j.duration_ms != null ? formatDuration(j.duration_ms) : "—"}</span>
                      <span className="w-16 text-right text-xs text-muted-foreground">
                        <RelativeTime date={j.created_at} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="System">
            <KeyValueList
              labelWidth={104}
              items={[
                { label: "Hostname", value: machine.hostname, mono: true, copy: machine.hostname },
                { label: "OS", value: machine.ubuntu_version },
                {
                  label: "Addresses",
                  value:
                    (machine.detected_ips ?? []).length > 0 ? (
                      <div className="space-y-0.5">
                        {(machine.detected_ips ?? []).map((i) => (
                          <div key={i.ip} className="flex items-center gap-1.5">
                            <span className={cn("font-data text-[12px]", i.ip === (machine.primary_ip || machine.ip_address) && "text-foreground")}>{i.ip}</span>
                            <span className="font-data text-[10.5px] text-subtle-foreground">{i.interface}</span>
                            {i.ip === (machine.primary_ip || machine.ip_address) && <Badge variant="muted">primary</Badge>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      machine.ip_address
                    ),
                },
                { label: "Agent", value: machine.agent_version, mono: true },
                { label: "Arch", value: machine.agent_arch, mono: true, hidden: !machine.agent_arch },
                {
                  label: "Capabilities",
                  hidden: !machine.agent_capabilities?.length,
                  value: (
                    <HoverCard openDelay={150}>
                      <HoverCardTrigger asChild>
                        <span className="cursor-default text-muted-foreground underline decoration-dotted underline-offset-4">
                          {machine.agent_capabilities?.length} features
                        </span>
                      </HoverCardTrigger>
                      <HoverCardContent align="start" className="w-80">
                        <div className="flex flex-wrap gap-1">
                          {(machine.agent_capabilities ?? []).map((c) => (
                            <Badge key={c} variant="outline" className="font-data">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  ),
                },
                { label: "Project", value: machine.project_name },
                { label: "Owner", value: machine.owner_name || machine.owner_email },
                { label: "Enrolled", value: <RelativeTime date={machine.created_at} /> },
                { label: "Machine ID", value: machine.id.slice(0, 8), mono: true, copy: machine.id },
              ]}
            />
          </SectionCard>
          <NotesCard machineId={machine.id} notes={machine.notes_md} onSaved={onNotesSaved} />
        </div>
      </div>
    </div>
  );
}
