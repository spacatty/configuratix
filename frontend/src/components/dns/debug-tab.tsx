"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CloudDownload, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { api, type DNSManagedDomain, type NSStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DataTable } from "@/components/ui/data-table";
import { CopyableMono, EmptyState, KeyValueList, SectionCard, Spinner, errorMessage } from "@/components/app";

import { formatTtl, nsMeta, recordTypeVariant } from "./dns-utils";
import { NSBadge } from "./provider-badge";

type Lookup = Awaited<ReturnType<typeof api.lookupDNS>>;
type RemoteRecord = Awaited<ReturnType<typeof api.listRemoteRecords>>["records"][number];

const remoteColumns: ColumnDef<RemoteRecord>[] = [
  { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-data text-[12.5px]">{row.original.name}</span> },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant={recordTypeVariant(row.original.type)} className="font-data">
        {row.original.type}
      </Badge>
    ),
  },
  {
    accessorKey: "value",
    header: "Value",
    cell: ({ row }) => <CopyableMono value={row.original.value} className="max-w-[420px]" />,
  },
  {
    accessorKey: "ttl",
    header: "TTL",
    meta: { align: "right" },
    cell: ({ row }) => <span className="font-data text-[12px] text-muted-foreground">{formatTtl(row.original.ttl)}</span>,
  },
  {
    id: "proxied",
    accessorFn: (r) => (r.proxied ? "yes" : "no"),
    header: "Proxied",
    cell: ({ row }) => (row.original.proxied ? <Badge variant="info">Proxied</Badge> : <span className="text-muted-foreground">—</span>),
  },
];

export function DebugTab({ zone, hasAccount, onNsChecked }: { zone: DNSManagedDomain; hasAccount: boolean; onNsChecked: () => void }) {
  const [ns, setNs] = React.useState<NSStatus | null>(null);
  const [checkingNs, setCheckingNs] = React.useState(false);
  const [sub, setSub] = React.useState("@");
  const [lookup, setLookup] = React.useState<Lookup | null>(null);
  const [looking, setLooking] = React.useState(false);
  const [remote, setRemote] = React.useState<RemoteRecord[] | null>(null);
  const [fetching, setFetching] = React.useState(false);

  const checkNs = async () => {
    setCheckingNs(true);
    try {
      setNs(await api.checkDNSDomainNS(zone.id));
      onNsChecked();
    } catch (e) {
      toast.error("NS check failed", { description: errorMessage(e) });
    } finally {
      setCheckingNs(false);
    }
  };

  const runLookup = async () => {
    setLooking(true);
    try {
      setLookup(await api.lookupDNS(zone.id, sub === "@" ? "" : sub.trim()));
    } catch (e) {
      toast.error("Lookup failed", { description: errorMessage(e) });
    } finally {
      setLooking(false);
    }
  };

  const fetchRemote = async () => {
    setFetching(true);
    try {
      setRemote((await api.listRemoteRecords(zone.id)).records);
    } catch (e) {
      toast.error("Couldn't fetch provider records", { description: errorMessage(e) });
    } finally {
      setFetching(false);
    }
  };

  const nsStatus = ns?.status ?? zone.ns_status;
  const expected = ns?.expected ?? zone.ns_expected ?? [];
  const actual = ns?.actual ?? zone.ns_actual ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Nameservers"
          description="Is the registrar delegating to the expected nameservers?"
          icon={ShieldCheck}
          actions={
            <Button size="sm" variant="outline" onClick={checkNs} disabled={checkingNs}>
              {checkingNs ? <Spinner /> : <ShieldCheck />}
              Check now
            </Button>
          }
        >
          <div className="space-y-3">
            {ns && (
              <Alert variant={ns.valid ? "success" : nsMeta(ns.status).tone === "destructive" ? "destructive" : "warning"}>
                <ShieldCheck />
                <AlertTitle>{nsMeta(ns.status).label}</AlertTitle>
                <AlertDescription>{ns.message}</AlertDescription>
              </Alert>
            )}
            <KeyValueList
              labelWidth={90}
              items={[
                { label: "Status", value: <NSBadge status={nsStatus} /> },
                {
                  label: "Expected",
                  value: expected.length ? (
                    <div className="space-y-0.5">
                      {expected.map((n) => (
                        <CopyableMono key={n} value={n} />
                      ))}
                    </div>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Actual",
                  value: actual.length ? (
                    <div className="space-y-0.5">
                      {actual.map((n) => (
                        <span key={n} className={"font-data block text-[12px] " + (expected.includes(n) ? "" : "text-warning")}>
                          {n}
                        </span>
                      ))}
                    </div>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
          </div>
        </SectionCard>

        <SectionCard title="Public lookup" description="Resolve the host through public resolvers." icon={Search}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runLookup();
            }}
          >
            <div className="flex flex-1 items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring/40">
              <Input
                className="font-data h-8 border-0 text-[12.5px] focus-visible:ring-0"
                value={sub}
                placeholder="@"
                onChange={(e) => setSub(e.target.value)}
                aria-label="Subdomain"
              />
              <span className="font-data shrink-0 pr-2 text-[11.5px] text-subtle-foreground">.{zone.fqdn}</span>
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={looking}>
              {looking ? <Spinner /> : <Search />}
              Lookup
            </Button>
          </form>
          {lookup && (
            <div className="mt-3 overflow-hidden rounded-md border border-border">
              <div className="font-data border-b border-border bg-surface-2/40 px-3 py-1.5 text-[12px]">{lookup.lookup}</div>
              <dl className="divide-y divide-border">
                {Object.entries(lookup.results).map(([type, data]) => (
                  <div key={type} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 px-3 py-1.5">
                    <dt>
                      <Badge variant={recordTypeVariant(type)} className="font-data">
                        {type}
                      </Badge>
                    </dt>
                    <dd className="font-data min-w-0 text-[12px]">
                      {data.error ? (
                        <span className="text-muted-foreground">{data.error}</span>
                      ) : (data.records ?? []).length ? (
                        (data.records ?? []).map((r) => (
                          <div key={r} className="truncate">
                            {r}
                          </div>
                        ))
                      ) : (
                        <span className="text-muted-foreground">no records</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Provider records"
        description="Raw zone as the provider returns it."
        icon={CloudDownload}
        flush={!!remote}
        actions={
          <Button size="sm" variant="outline" onClick={fetchRemote} disabled={fetching || !hasAccount}>
            {fetching ? <Spinner /> : <CloudDownload />}
            {remote ? "Refetch" : "Fetch"}
          </Button>
        }
      >
        {!hasAccount ? (
          <p className="text-xs text-muted-foreground">Link a provider account in Settings to read the remote zone.</p>
        ) : remote ? (
          <DataTable
            columns={remoteColumns}
            data={remote}
            bordered={false}
            searchKeys={["name", "type", "value"]}
            searchPlaceholder="Filter provider records…"
            facets={[{ columnId: "type", title: "Type" }]}
            showColumnToggle={false}
            maxHeight="420px"
            className="p-3"
            emptyState={<EmptyState size="compact" bordered={false} title="Zone is empty" />}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Not fetched yet.</p>
        )}
      </SectionCard>
    </div>
  );
}
