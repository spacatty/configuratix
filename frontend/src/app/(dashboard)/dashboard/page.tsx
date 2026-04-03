"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, Machine, Domain, NginxConfig } from "@/lib/api";

export default function DashboardPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [configs, setConfigs] = useState<NginxConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [machinesData, domainsData, configsData] = await Promise.all([
          api.listMachines(),
          api.listDomains(),
          api.listNginxConfigs(),
        ]);
        setMachines(machinesData);
        setDomains(domainsData);
        setConfigs(configsData);
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const getHealthyCount = () => {
    return domains.filter(d => d.status === "healthy").length;
  };

  const getOnlineMachines = () => {
    return machines.filter(m => {
      if (!m.last_seen) return false;
      const lastSeen = new Date(m.last_seen);
      const now = new Date();
      const diffMinutes = (now.getTime() - lastSeen.getTime()) / 1000 / 60;
      return diffMinutes < 5;
    }).length;
  };

  const onlineMachines = getOnlineMachines();
  const assignedDomains = domains.filter(d => d.assigned_machine_id).length;
  const healthyDomains = getHealthyCount();
  const autoConfigs = configs.filter(c => c.mode === "auto").length;
  const manualConfigs = configs.filter(c => c.mode === "manual").length;
  const healthyPercent = domains.length > 0 ? Math.round((healthyDomains / domains.length) * 100) : null;
  const completedSteps = [
    machines.length > 0,
    machines.length > 0,
    domains.length > 0,
    configs.length > 0,
    assignedDomains > 0,
  ].filter(Boolean).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Overview of your proxy infrastructure
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto">
          <div className="rounded-xl border border-border/50 bg-card/35 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Machines</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-semibold">{machines.length}</span>
              <span className="text-xs text-muted-foreground">{onlineMachines} online</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/35 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Domains</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-semibold">{domains.length}</span>
              <span className="text-xs text-muted-foreground">{assignedDomains} assigned</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/35 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Configs</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-semibold">{configs.length}</span>
              <span className="text-xs text-muted-foreground">{autoConfigs}/{manualConfigs} auto/manual</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/35 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Health</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-semibold">{healthyPercent !== null ? `${healthyPercent}%` : "—"}</span>
              <span className="text-xs text-muted-foreground">{healthyDomains} healthy</span>
            </div>
          </div>
        </div>
      </div>

      <Card className="border-border/50 bg-card/55 shadow-sm">
        <CardHeader className="space-y-3 pb-4">
          <CardTitle>Getting Started</CardTitle>
          <CardDescription>
            Follow these steps to set up your first proxy server
          </CardDescription>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${(completedSteps / 5) * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {completedSteps}/5 complete
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
            <li className={`rounded-lg border border-border/50 px-3 py-3 ${machines.length > 0 ? "opacity-55" : "bg-muted/20"}`}>
              <span className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${machines.length > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>1</span>
              Go to <Link href="/machines" className="text-primary hover:underline">Machines</Link> and create an enrollment token
            </li>
            <li className={`rounded-lg border border-border/50 px-3 py-3 ${machines.length > 0 ? "opacity-55" : "bg-muted/20"}`}>
              <span className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${machines.length > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>2</span>
              Run the install command on your Ubuntu 22.04/24.04 server
            </li>
            <li className={`rounded-lg border border-border/50 px-3 py-3 ${domains.length > 0 ? "opacity-55" : "bg-muted/20"}`}>
              <span className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${domains.length > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>3</span>
              Create a domain in <a href="/domains" className="text-primary hover:underline">Domains</a> section
            </li>
            <li className={`rounded-lg border border-border/50 px-3 py-3 ${configs.length > 0 ? "opacity-55" : "bg-muted/20"}`}>
              <span className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${configs.length > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>4</span>
              Create an nginx configuration in <a href="/configs/nginx" className="text-primary hover:underline">Nginx Configs</a>
            </li>
            <li className={`rounded-lg border border-border/50 px-3 py-3 md:col-span-2 ${assignedDomains > 0 ? "opacity-55" : "bg-muted/20"}`}>
              <span className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${assignedDomains > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>5</span>
              Link the domain to your machine with a configuration
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
