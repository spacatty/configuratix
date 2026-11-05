"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Cpu, Info, KeyRound, RefreshCw, Server, Settings2, Terminal, UserRound, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CardSkeleton,
  CopyableMono,
  ErrorState,
  KeyValueList,
  Mono,
  PageHeader,
  RelativeTime,
  SectionCard,
  StatCard,
  StatStrip,
  StatusBadge,
  usePolling,
} from "@/components/app";
import { API_URL, BACKEND_URL, api } from "@/lib/api";
import { formatBytes, formatNumber } from "@/lib/format";

/**
 * There is no settings API on the backend: everything server-side is configured via
 * environment variables read at startup (see backend/cmd/server/main.go, .env.example).
 * This page is therefore read-only and honest about where each value comes from.
 */
const SERVER_ENV: { name: string; purpose: string; fallback: string; secret?: boolean }[] = [
  { name: "DATABASE_URL", purpose: "PostgreSQL connection string", fallback: "required", secret: true },
  { name: "JWT_SECRET", purpose: "Signs session tokens — change in production", fallback: "required", secret: true },
  { name: "BACKEND_PORT / PORT", purpose: "HTTP listen port", fallback: "8080" },
  { name: "CHECK_INTERVAL_HOURS", purpose: "Domain health-check interval", fallback: "1" },
  { name: "AGENT_VERSION", purpose: "Overrides the advertised agent version", fallback: "agent-binaries/version.json" },
  { name: "MIGRATION_TIMEOUT_SECONDS", purpose: "DB migration timeout at startup", fallback: "180" },
  { name: "MIGRATION_RETRY_DELAY_MS", purpose: "Delay between migration retries", fallback: "1000" },
];

export default function SettingsPage() {
  const { data: me } = usePolling(() => api.getMe(), 0);
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  // Agent binary metadata doubles as a reachability + latency probe for the control plane.
  const agent = usePolling(async () => {
    const t0 = performance.now();
    const v = await api.getAgentVersion();
    return { ...v, latency: Math.round(performance.now() - t0) };
  }, 30000);

  const stats = usePolling(() => api.getAdminStats(), 60000, { enabled: isAdmin, deps: [isAdmin] });

  const reachable = !!agent.data && !agent.error;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Settings2}
        title="Settings"
        description="Instance information for this Configuratix deployment. Server options are set via environment variables."
        actions={
          <Button variant="outline" onClick={() => {
              agent.refresh();
              if (isAdmin) stats.refresh();
            }} disabled={agent.refreshing}>
            <RefreshCw className={agent.refreshing ? "animate-spin" : undefined} />
            Refresh
          </Button>
        }
      />

      {isAdmin && (
        <StatStrip>
          <StatCard label="Users" value={formatNumber(stats.data?.total_users)} loading={stats.loading} href="/admin/users" />
          <StatCard
            label="Machines online"
            value={formatNumber(stats.data?.online_machines)}
            suffix={stats.data ? `/ ${formatNumber(stats.data.total_machines)}` : undefined}
            progress={stats.data?.total_machines ? (stats.data.online_machines / stats.data.total_machines) * 100 : undefined}
            progressTone="success"
            loading={stats.loading}
            href="/machines"
          />
          <StatCard label="Projects" value={formatNumber(stats.data?.total_projects)} loading={stats.loading} href="/projects" />
          <StatCard label="Domains" value={formatNumber(stats.data?.total_domains)} loading={stats.loading} href="/domains" />
        </StatStrip>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard
            icon={Server}
            title="Control plane"
            description="Where this browser sends API calls."
            actions={
              agent.loading ? null : reachable ? (
                <StatusBadge status="online" label="Reachable" />
              ) : (
                <StatusBadge status="offline" label="Unreachable" />
              )
            }
          >
            <KeyValueList
              items={[
                { label: "API URL", value: <CopyableMono value={API_URL} /> },
                { label: "Backend origin", value: <CopyableMono value={BACKEND_URL} />, hidden: BACKEND_URL === API_URL },
                {
                  label: "Round-trip",
                  value: agent.data ? <Mono>{agent.data.latency} ms</Mono> : <Mono muted>—</Mono>,
                  hint: agent.updatedAt ? (
                    <>
                      Checked <RelativeTime date={agent.updatedAt} />
                    </>
                  ) : undefined,
                },
                { label: "Source", value: <span className="text-muted-foreground">NEXT_PUBLIC_API_URL (build time)</span> },
              ]}
            />
            {agent.error && !agent.data ? <ErrorState className="mt-4" size="compact" title="Control plane didn't respond" error={agent.error} onRetry={agent.refresh} /> : null}
          </SectionCard>

          <SectionCard icon={Cpu} title="Agent binary" description="The version new and updating agents receive.">
            {agent.loading ? (
              <CardSkeleton lines={3} header={false} />
            ) : agent.data ? (
              <KeyValueList
                items={[
                  { label: "Version", value: <Mono>{agent.data.version}</Mono> },
                  { label: "Size", value: <Mono>{formatBytes(agent.data.size)}</Mono> },
                  {
                    label: "SHA-256",
                    value: agent.data.checksum ? <CopyableMono value={agent.data.checksum} display={`${agent.data.checksum.slice(0, 16)}…`} /> : <Mono muted>—</Mono>,
                  },
                  { label: "Published", value: <RelativeTime date={agent.data.updated_at} /> },
                ]}
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">Agent metadata unavailable.</p>
            )}
          </SectionCard>

          <SectionCard
            icon={Terminal}
            title="Server configuration"
            description="Read at backend startup. Edit the backend .env (see .env.example) and restart to change."
            flush
          >
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Variable</th>
                  <th className="px-4 py-2 font-medium">Purpose</th>
                  <th className="px-4 py-2 text-right font-medium">Default</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SERVER_ENV.map((e) => (
                  <tr key={e.name}>
                    <td className="px-4 py-2">
                      <Mono>{e.name}</Mono>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{e.purpose}</td>
                    <td className="px-4 py-2 text-right">
                      <Mono muted>{e.fallback}</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Account">
            <nav className="-mx-2 space-y-0.5">
              <SettingsLink href="/profile" icon={UserRound} label="Profile" sub="Display name, email" />
              <SettingsLink href="/profile#password" icon={KeyRound} label="Password & 2FA" sub="Sign-in security" />
              {isAdmin && <SettingsLink href="/admin/users" icon={Users} label="Users" sub="Roles, passwords, 2FA resets" />}
              <SettingsLink href="/machines/tokens" icon={Cpu} label="Enrollment tokens" sub="Install agents on new machines" />
            </nav>
          </SectionCard>
          <Alert variant="info">
            <Info />
            <AlertDescription>
              Settings are not editable from the UI yet — the backend has no settings API. Values here are live, read-only.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}

function SettingsLink({ href, icon: Icon, label, sub }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; sub: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2">
      <Icon className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <ArrowUpRight className="size-3.5 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
