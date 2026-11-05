"use client";

import * as React from "react";
import { toast } from "sonner";

import { api, type DNSManagedDomain, type DNSRecord, type Machine, type MachineGroupWithCount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LoadingState, Spinner, errorMessage } from "@/components/app";

import { EMPTY_POOL, PoolFields, draftFromPool, validatePool, type PoolDraft } from "./pool-fields";

export function PoolEditorSheet({
  open,
  onOpenChange,
  zone,
  record,
  records,
  machines,
  groups,
  groupsByMachine,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zone: DNSManagedDomain;
  /** Existing record to edit, or null to create. */
  record: DNSRecord | null;
  records: DNSRecord[];
  machines?: Machine[];
  groups: MachineGroupWithCount[];
  groupsByMachine?: Record<string, string[]>;
  onSaved: () => void;
}) {
  const layer7 = zone.proxy_mode === "layer7";
  const [draft, setDraft] = React.useState<PoolDraft>(EMPTY_POOL);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTouched(false);
    if (!record) {
      setDraft({ ...EMPTY_POOL, proxy_protocol: !layer7 });
      return;
    }
    setLoading(true);
    api
      .getRecordPool(record.id)
      .then((p) => setDraft(draftFromPool(p.pool, p.members.map((m) => m.machine_id), record.name)))
      .catch(() => setDraft({ ...EMPTY_POOL, name: record.name }))
      .finally(() => setLoading(false));
  }, [open, record, layer7]);

  const errors = touched ? validatePool(draft, { requireName: !record, layer7 }) : {};

  const save = async () => {
    setTouched(true);
    const errs = validatePool(draft, { requireName: !record, layer7 });
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      let recordId = record?.id;
      if (!recordId) {
        const existing = records.find((r) => r.name === draft.name && r.record_type === "A");
        recordId =
          existing?.id ??
          (
            await api.createDNSRecord(zone.id, {
              name: draft.name,
              record_type: "A",
              value: "0.0.0.0",
              ttl: 60,
              priority: 0,
              proxied: false,
              http_incoming_port: 80,
              http_outgoing_port: 80,
              https_incoming_port: 443,
              https_outgoing_port: 443,
            })
          ).id;
      }
      await api.createOrUpdateRecordPool(recordId, {
        target_ip: draft.target_ip,
        target_scheme: draft.target_scheme,
        target_port: draft.target_port,
        target_port_http: draft.target_port_http,
        preserve_host: draft.preserve_host,
        tls_verify_upstream: draft.tls_verify_upstream,
        ssl_email: draft.ssl_email || undefined,
        rotation_strategy: draft.rotation_strategy,
        rotation_mode: "interval",
        interval_minutes: draft.interval_minutes,
        health_check_enabled: draft.health_check_enabled,
        proxy_protocol: draft.proxy_protocol,
        machine_ids: draft.machine_ids,
        group_ids: draft.group_ids,
      });
      toast.success(record ? "Pool updated" : "Record created", {
        description: `${draft.name === "@" ? zone.fqdn : `${draft.name}.${zone.fqdn}`} → configs are pushed to the pool machines`,
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't save pool", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>
            {record ? "Edit" : "New"} {layer7 ? "Layer 7" : "passthrough"} record
          </SheetTitle>
          <SheetDescription>
            {layer7
              ? "Proxies terminate TLS with a managed certificate and forward to the upstream."
              : "Proxies route raw TLS by SNI to the upstream; the A record rotates between them."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <LoadingState label="Loading pool…" />
          ) : (
            <PoolFields
              draft={draft}
              onChange={setDraft}
              machines={machines}
              groups={groups}
              groupsByMachine={groupsByMachine}
              variant={layer7 ? "layer7" : "passthrough"}
              showName
              nameLocked={!!record}
              zone={zone.fqdn}
              errors={errors}
            />
          )}
        </div>
        <SheetFooter className="flex-row justify-end border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Spinner />}
            {record ? "Save pool" : "Create record"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
