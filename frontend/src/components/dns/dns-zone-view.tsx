"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Globe, RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, PageHeader, PageSkeleton, Spinner, useBreadcrumbLabel, usePolling } from "@/components/app";

import { DebugTab } from "./debug-tab";
import { proxyModeMeta } from "./dns-utils";
import { NSBadge, ProviderLabel } from "./provider-badge";
import { RecordsTab } from "./records-tab";
import { RoutingTab } from "./routing-tab";
import { SettingsTab } from "./settings-tab";
import { SyncTab } from "./sync-tab";

type TabId = "records" | "routing" | "sync" | "settings" | "debug";

export function DNSZoneView({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const zoneQ = usePolling(() => api.getDNSManagedDomain(id), 60000, { deps: [id] });
  const accountsQ = usePolling(() => api.listDNSAccounts(), 0);
  const recordsQ = usePolling(() => api.listDNSRecords(id), 30000, { deps: [id] });
  const machinesQ = usePolling(() => api.listMachines(), 60000);
  const groupsQ = usePolling(() => api.listMachineGroups().catch(() => []), 0);

  const zone = zoneQ.data;
  const accounts = React.useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const account = accounts.find((a) => a.id === zone?.dns_account_id) ?? null;
  const records = React.useMemo(() => recordsQ.data ?? [], [recordsQ.data]);
  useBreadcrumbLabel(zone?.fqdn ?? null);

  const groupsByMachine = React.useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const m of machinesQ.data ?? []) {
      const names = (m.group_names ?? []).map((g) => g?.name).filter(Boolean) as string[];
      if (names.length) out[m.id] = names;
    }
    return out;
  }, [machinesQ.data]);

  const mode = zone?.proxy_mode || "static";
  const hasAccount = !!zone?.dns_account_id;
  const available: TabId[] = React.useMemo(() => {
    const t: TabId[] = [];
    if (mode === "static") {
      if (hasAccount) t.push("records", "sync");
    } else t.push("routing");
    t.push("settings", "debug");
    return t;
  }, [mode, hasAccount]);

  const requested = searchParams.get("tab") as TabId | null;
  const tab: TabId = requested && available.includes(requested) ? requested : available[0];
  const setTab = (t: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", t);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  if (zoneQ.loading) return <PageSkeleton stats={false} />;
  if (!zone) {
    return (
      <div className="space-y-6">
        <PageHeader back={{ href: "/domains/dns", label: "DNS" }} title="Zone" />
        <ErrorState title="Couldn't load this zone" error={zoneQ.error} onRetry={zoneQ.refresh} />
      </div>
    );
  }

  const staticCount = records.filter((r) => r.mode !== "dynamic").length;
  const dynamicCount = records.filter((r) => r.mode === "dynamic").length;
  const refresh = () => {
    void zoneQ.refresh();
    void recordsQ.refresh();
  };

  const LABEL: Record<TabId, React.ReactNode> = {
    records: (
      <>
        Records <span className="font-data text-[11px] text-muted-foreground">{staticCount}</span>
      </>
    ),
    routing: (
      <>
        {mode === "layer7" ? "Layer 7" : mode === "wildcard" ? "Wildcard pool" : "Passthrough"}
        {mode !== "wildcard" && <span className="font-data text-[11px] text-muted-foreground">{dynamicCount}</span>}
      </>
    ),
    sync: "Sync",
    settings: "Settings",
    debug: "Diagnostics",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/domains/dns", label: "DNS" }}
        icon={Globe}
        title={<span className="font-data">{zone.fqdn}</span>}
        badge={<NSBadge status={zone.ns_status} />}
        meta={
          <>
            <ProviderLabel provider={zone.dns_account_provider} account={zone.dns_account_name} />
            <Badge variant={mode === "static" ? "secondary" : "info"}>{proxyModeMeta(mode).short}</Badge>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="Refresh" onClick={refresh}>
              {zoneQ.refreshing || recordsQ.refreshing ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" asChild>
              <a href={`https://${zone.fqdn}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Open site
              </a>
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          {available.map((t) => (
            <TabsTrigger key={t} value={t} className="gap-1.5">
              {LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        {available.includes("records") && (
          <TabsContent value="records">
            <RecordsTab zone={zone} account={account} records={records} loading={recordsQ.loading} onChanged={() => void recordsQ.refresh()} />
          </TabsContent>
        )}
        {available.includes("routing") && (
          <TabsContent value="routing">
            <RoutingTab
              zone={zone}
              records={records}
              machines={machinesQ.data}
              groups={groupsQ.data ?? []}
              groupsByMachine={groupsByMachine}
              onRecordsChanged={() => void recordsQ.refresh()}
            />
          </TabsContent>
        )}
        {available.includes("sync") && (
          <TabsContent value="sync">
            <SyncTab zone={zone} onChanged={() => void recordsQ.refresh()} />
          </TabsContent>
        )}
        <TabsContent value="settings">
          <SettingsTab zone={zone} accounts={accounts} onSaved={refresh} />
        </TabsContent>
        <TabsContent value="debug">
          <DebugTab zone={zone} hasAccount={hasAccount} onNsChecked={() => void zoneQ.refresh()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
