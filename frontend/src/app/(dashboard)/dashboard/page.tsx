"use client";

import { useEffect, useState } from "react";
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Overview of your proxy infrastructure
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Machines
            </CardTitle>
            <svg
              className="h-4 w-4 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{machines.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {getOnlineMachines()} online
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Domains
            </CardTitle>
            <svg
              className="h-4 w-4 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{domains.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {domains.filter(d => d.assigned_machine_id).length} assigned
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Nginx Configs
            </CardTitle>
            <svg
              className="h-4 w-4 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{configs.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {configs.filter(c => c.mode === "auto").length} auto, {configs.filter(c => c.mode === "manual").length} manual
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Health Status
            </CardTitle>
            <svg
              className="h-4 w-4 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {domains.length > 0 ? `${Math.round(getHealthyCount() / domains.length * 100)}%` : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {getHealthyCount()} healthy domains
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
          <CardDescription>
            Follow these steps to set up your first proxy server
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-3 text-sm text-muted-foreground">
            <li className={machines.length > 0 ? "line-through opacity-50" : ""}>
              Go to <a href="/machines" className="text-primary hover:underline">Machines</a> and create an enrollment token
            </li>
            <li className={machines.length > 0 ? "line-through opacity-50" : ""}>
              Run the install command on your Ubuntu 22.04/24.04 server
            </li>
            <li className={domains.length > 0 ? "line-through opacity-50" : ""}>
              Create a domain in <a href="/domains" className="text-primary hover:underline">Domains</a> section
            </li>
            <li className={configs.length > 0 ? "line-through opacity-50" : ""}>
              Create an nginx configuration in <a href="/configs/nginx" className="text-primary hover:underline">Nginx Configs</a>
            </li>
            <li className={domains.filter(d => d.assigned_machine_id).length > 0 ? "line-through opacity-50" : ""}>
              Link the domain to your machine with a configuration
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
