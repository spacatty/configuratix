"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Cpu, MoreHorizontal, Pencil, RefreshCw, Tags, TerminalSquare, Trash2 } from "lucide-react";
import { api, type InterfaceIP } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader, RelativeTime, Spinner, StatusBadge, errorMessage, machineDisplayName, machineIp } from "@/components/app";
import { GroupChips } from "../group-chips";
import { groupRefs, isAgentOutdated, isAgentUpdating, liveness, type FleetMachine } from "../utils";

export function PrimaryIpPicker({
  machine,
  onChanged,
  className,
}: {
  machine: FleetMachine;
  onChanged: (ip: string) => void;
  className?: string;
}) {
  const [saving, setSaving] = React.useState(false);
  const ips: InterfaceIP[] = React.useMemo(() => {
    const list = machine.detected_ips ?? [];
    if (list.length) return list;
    return machine.ip_address ? [{ ip: machine.ip_address, interface: "", is_public: true, is_ipv6: machine.ip_address.includes(":") }] : [];
  }, [machine.detected_ips, machine.ip_address]);
  const value = machine.primary_ip || machine.ip_address || null;

  return (
    <Combobox
      size="sm"
      className={className ?? "w-56"}
      items={ips}
      value={value}
      disabled={saving || ips.length === 0}
      onValueChange={async (ip) => {
        if (!ip || ip === value) return;
        setSaving(true);
        try {
          await api.updateMachine(machine.id, { primary_ip: ip });
          onChanged(ip);
          toast.success("Primary IP updated", { description: `${ip} is now used for passthrough and DNS targets.` });
        } catch (e) {
          toast.error("Couldn't change primary IP", { description: errorMessage(e) });
        } finally {
          setSaving(false);
        }
      }}
      getValue={(i) => i.ip}
      getLabel={(i) => i.ip}
      getKeywords={(i) => [i.interface, i.is_public ? "public" : "private", i.is_ipv6 ? "ipv6" : "ipv4"]}
      getGroup={(i) => (i.is_public ? "Public" : "Private")}
      groupOrder={["Public", "Private"]}
      renderItem={(i) => (
        <div className="flex w-full items-center gap-2">
          <span className="font-data truncate">{i.ip}</span>
          {i.interface && <span className="font-data text-[11px] text-muted-foreground">{i.interface}</span>}
          {i.is_ipv6 && <Badge variant="muted">v6</Badge>}
        </div>
      )}
      renderValue={(i) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {saving && <Spinner className="size-3" />}
          <span className="font-data truncate">{i.ip}</span>
          <span className="text-[11px] text-muted-foreground">{i.is_public ? "public" : "private"}</span>
        </span>
      )}
      placeholder="No IP reported"
      searchPlaceholder="Search IP or interface…"
      contentClassName="min-w-[300px]"
    />
  );
}

export function MachineHero({
  machine,
  latestAgent,
  onRename,
  onAssignGroups,
  onDelete,
  onUpdateAgent,
  onOpenTerminal,
  onChanged,
  updating,
}: {
  machine: FleetMachine;
  latestAgent?: string | null;
  onRename: () => void;
  onAssignGroups: () => void;
  onDelete: () => void;
  onUpdateAgent: () => void;
  onOpenTerminal: () => void;
  onChanged: (patch: Partial<FleetMachine>) => void;
  updating?: boolean;
}) {
  const live = liveness(machine);
  const name = machineDisplayName(machine);
  const ip = machineIp(machine);
  const agentUpdating = updating || isAgentUpdating(machine);
  const outdated = !agentUpdating && isAgentOutdated(machine, latestAgent);
  const groups = groupRefs(machine);

  return (
    <PageHeader
      back={{ href: "/machines", label: "Machines" }}
      title={
        <button type="button" onClick={onRename} className="group inline-flex items-center gap-2 text-left" title="Rename">
          {name}
          <Pencil className="size-3.5 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      }
      badge={
        <>
          <StatusBadge status={live} />
          {agentUpdating && (
            <Badge variant="info" className="gap-1">
              <RefreshCw className="size-3 animate-spin" />
              agent {machine.agent_update_state ?? "updating"}
            </Badge>
          )}
          {groups.length > 0 && <GroupChips groups={groups} max={3} className="ml-1" />}
        </>
      }
      meta={
        <>
          {machine.hostname && machine.hostname !== name && <span className="font-data">{machine.hostname}</span>}
          <span className="inline-flex items-center gap-1.5">
            <span>Primary IP</span>
            <PrimaryIpPicker machine={machine} onChanged={(ip) => onChanged({ primary_ip: ip })} />
            {ip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Copy IP"
                    onClick={async () => {
                      if (await copyToClipboard(ip)) toast.success("IP copied", { description: ip });
                    }}
                  >
                    <Copy />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy {ip}</TooltipContent>
              </Tooltip>
            )}
          </span>
          {machine.ubuntu_version && <span>{machine.ubuntu_version}</span>}
          {machine.agent_arch && (
            <span className="inline-flex items-center gap-1">
              <Cpu className="size-3" />
              <span className="font-data">{machine.agent_arch}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            Agent <span className="font-data text-foreground">{machine.agent_version ?? "—"}</span>
            {outdated && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="warning">outdated</Badge>
                </TooltipTrigger>
                <TooltipContent>{latestAgent ? `Latest is ${latestAgent}` : "A newer agent is available"}</TooltipContent>
              </Tooltip>
            )}
          </span>
          <span>
            {live === "online" ? "Heartbeat" : "Last seen"} <RelativeTime date={machine.last_seen} fallback="never" />
          </span>
        </>
      }
      actions={
        <>
          <Button variant="outline" onClick={onOpenTerminal} disabled={live === "offline"}>
            <TerminalSquare />
            Terminal
          </Button>
          {(outdated || agentUpdating) && (
            <Button onClick={onUpdateAgent} disabled={agentUpdating || !machine.agent_id || live === "offline"}>
              {agentUpdating ? <Spinner /> : <RefreshCw />}
              {agentUpdating ? "Updating agent…" : `Update agent${latestAgent ? ` → ${latestAgent}` : ""}`}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onRename}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              {!outdated && (
                <DropdownMenuItem onSelect={onUpdateAgent} disabled={agentUpdating || !machine.agent_id || live === "offline"}>
                  <RefreshCw />
                  Update agent
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onAssignGroups}>
                <Tags />
                Groups…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  if (await copyToClipboard(machine.id)) toast.success("Machine ID copied");
                }}
              >
                <Copy />
                Copy machine ID
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 />
                Delete machine
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}
