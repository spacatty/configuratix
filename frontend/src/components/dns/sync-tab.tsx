"use client";

import * as React from "react";
import { ArrowDownToLine, ArrowUpFromLine, CircleCheck, GitCompareArrows, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { api, type DNSManagedDomain, type DNSSyncRecord, type DNSSyncResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState, SectionCard, Spinner, StatCard, StatStrip, errorMessage, useConfirm } from "@/components/app";
import { cn } from "@/lib/utils";

import { formatTtl } from "./dns-utils";

type Line =
  | { kind: "add"; rec: DNSSyncRecord }
  | { kind: "remove"; rec: DNSSyncRecord }
  | { kind: "change"; name: string; type: string; local: string; remote: string };

const KIND = {
  add: { sign: "+", row: "bg-success/[0.06]", sign_cls: "text-success", label: "Create at provider" },
  change: { sign: "~", row: "bg-warning/[0.06]", sign_cls: "text-warning", label: "Overwrite at provider" },
  remove: { sign: "−", row: "bg-destructive/[0.06]", sign_cls: "text-destructive", label: "Delete at provider" },
} as const;

function DiffLine({ line }: { line: Line }) {
  const k = KIND[line.kind];
  if (line.kind === "change") {
    return (
      <li className={cn("grid grid-cols-[20px_minmax(0,1fr)] gap-x-2 px-3 py-1.5", k.row)}>
        <span className={cn("font-data text-[13px] font-semibold", k.sign_cls)}>{k.sign}</span>
        <div className="min-w-0 space-y-0.5">
          <div className="font-data text-[12px]">
            <span className="font-medium">{line.name}</span> <span className="text-muted-foreground">{line.type}</span>
          </div>
          <div className="font-data truncate text-[11.5px] text-destructive/90 line-through decoration-destructive/40">
            remote&nbsp; {line.remote}
          </div>
          <div className="font-data truncate text-[11.5px] text-success">local&nbsp;&nbsp; {line.local}</div>
        </div>
      </li>
    );
  }
  const r = line.rec;
  return (
    <li className={cn("grid grid-cols-[20px_minmax(0,1fr)_auto] items-baseline gap-x-2 px-3 py-1.5", k.row)}>
      <span className={cn("font-data text-[13px] font-semibold", k.sign_cls)}>{k.sign}</span>
      <span className="font-data min-w-0 truncate text-[12px]">
        <span className="font-medium">{r.name}</span> <span className="text-muted-foreground">{r.type}</span>{" "}
        <span className={line.kind === "remove" ? "text-muted-foreground line-through" : undefined}>{r.value}</span>
      </span>
      <span className="font-data text-[11px] text-muted-foreground">{formatTtl(r.ttl)}</span>
    </li>
  );
}

export function SyncTab({ zone, onChanged }: { zone: DNSManagedDomain; onChanged: () => void }) {
  const confirm = useConfirm();
  const [result, setResult] = React.useState<DNSSyncResult | null>(null);
  const [comparing, setComparing] = React.useState(false);
  const [applyResult, setApplyResult] = React.useState<DNSSyncResult | null>(null);

  const compare = React.useCallback(async () => {
    setComparing(true);
    try {
      setResult(await api.compareDNSRecords(zone.id));
    } catch (e) {
      toast.error("Couldn't compare with provider", { description: errorMessage(e) });
    } finally {
      setComparing(false);
    }
  }, [zone.id]);

  React.useEffect(() => {
    void compare();
  }, [compare]);

  const created = result?.created ?? [];
  const deleted = result?.deleted ?? [];
  const conflicts = result?.conflicts ?? [];

  const lines: Line[] = [
    ...created.map((rec) => ({ kind: "add" as const, rec })),
    ...conflicts.map((c) => ({
      kind: "change" as const,
      name: c.record_name,
      type: c.record_type,
      local: c.local_value,
      remote: c.remote_value,
    })),
    ...deleted.map((rec) => ({ kind: "remove" as const, rec })),
  ];

  const push = async () => {
    let res: DNSSyncResult | null = null;
    const ok = await confirm({
      title: "Push local records to the provider?",
      description: "The provider zone is made to match the local records exactly.",
      details: (
        <ul className="font-data space-y-0.5 text-[12px]">
          <li className="text-success">+ {created.length} created</li>
          <li className="text-warning">~ {conflicts.length} overwritten</li>
          <li className="text-destructive">− {deleted.length} deleted (remote-only records)</li>
        </ul>
      ),
      destructive: deleted.length > 0,
      confirmText: "Push to provider",
      onConfirm: async () => {
        res = await api.applyDNSToRemote(zone.id);
      },
    });
    if (!ok) return;
    const r = res as DNSSyncResult | null;
    setApplyResult(r);
    if (r?.errors?.length) toast.warning(`Pushed with ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}`);
    else toast.success("Provider zone updated");
    onChanged();
    void compare();
  };

  const pull = async () => {
    let imported = 0;
    const ok = await confirm({
      title: "Import records from the provider?",
      description:
        "Every local record for this zone is deleted and replaced with the provider's current records. This can't be undone.",
      typeToConfirm: zone.fqdn,
      destructive: true,
      confirmText: "Replace local records",
      onConfirm: async () => {
        imported = (await api.importDNSFromRemote(zone.id)).imported;
      },
    });
    if (!ok) return;
    toast.success(`Imported ${imported} record${imported === 1 ? "" : "s"}`);
    setApplyResult(null);
    onChanged();
    void compare();
  };

  return (
    <div className="space-y-4">
      <StatStrip>
        <StatCard label="To create" value={created.length} loading={comparing && !result} tone={created.length ? "success" : "default"} />
        <StatCard label="To overwrite" value={conflicts.length} loading={comparing && !result} tone={conflicts.length ? "warning" : "default"} />
        <StatCard label="Remote only" value={deleted.length} loading={comparing && !result} tone={deleted.length ? "destructive" : "default"} />
      </StatStrip>

      {applyResult?.errors?.length ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Some changes failed at the provider</AlertTitle>
          <AlertDescription>
            <ul className="font-data mt-1 space-y-0.5 text-[11.5px]">
              {applyResult.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <SectionCard
        title="Local vs provider"
        description="What a push would change at the provider. Pull does the opposite: replaces local records with the provider's."
        icon={GitCompareArrows}
        flush
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={compare} disabled={comparing}>
              {comparing ? <Spinner /> : <GitCompareArrows />}
              Compare
            </Button>
            <Button size="sm" variant="outline" onClick={pull} disabled={comparing || !result}>
              <ArrowDownToLine />
              Pull from provider
            </Button>
            <Button size="sm" onClick={push} disabled={comparing || !result || result.in_sync}>
              <ArrowUpFromLine />
              Push to provider
            </Button>
          </>
        }
      >
        {!result ? (
          <div className="p-6">{comparing ? <Spinner /> : <p className="text-xs text-muted-foreground">Not compared yet.</p>}</div>
        ) : result.in_sync || lines.length === 0 ? (
          <EmptyState
            size="compact"
            bordered={false}
            icon={CircleCheck}
            title="In sync"
            description="Local records match the provider zone."
          />
        ) : (
          <div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              {(["add", "change", "remove"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className={cn("font-data font-semibold", KIND[k].sign_cls)}>{KIND[k].sign}</span>
                  {KIND[k].label}
                </span>
              ))}
            </div>
            <ul className="max-h-[480px] divide-y divide-border/60 overflow-y-auto">
              {lines.map((l, i) => (
                <DiffLine key={i} line={l} />
              ))}
            </ul>
            {result.errors?.length ? (
              <div className="border-t border-border px-3 py-2 text-xs text-destructive">{result.errors.join(" · ")}</div>
            ) : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
