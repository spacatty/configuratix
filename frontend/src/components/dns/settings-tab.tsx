"use client";

import * as React from "react";
import { KeyRound, Route } from "lucide-react";
import { toast } from "sonner";

import { api, type DNSAccount, type DNSManagedDomain } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CopyButton, CopyableMono, SectionCard, Spinner, errorMessage, useConfirm, usePolling } from "@/components/app";

import { DNSAccountPicker } from "./dns-account-picker";
import { PROXY_MODE, providerMeta, proxyModeMeta } from "./dns-utils";

type Listener = "http_and_https" | "https_only" | "http_only";

export function SettingsTab({
  zone,
  accounts,
  onSaved,
}: {
  zone: DNSManagedDomain;
  accounts: DNSAccount[];
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  const [accountId, setAccountId] = React.useState<string | null>(zone.dns_account_id);
  const [mode, setMode] = React.useState(zone.proxy_mode || "static");
  const [listener, setListener] = React.useState<Listener>((zone.listener_protocol as Listener) || "http_and_https");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setAccountId(zone.dns_account_id);
    setMode(zone.proxy_mode || "static");
    setListener((zone.listener_protocol as Listener) || "http_and_https");
  }, [zone]);

  const nsQ = usePolling(
    () => (accountId ? api.getExpectedNameservers(accountId, zone.fqdn) : Promise.resolve(null)),
    0,
    { deps: [accountId, zone.fqdn] }
  );
  const expected = nsQ.data;

  const dirty =
    accountId !== zone.dns_account_id ||
    mode !== (zone.proxy_mode || "static") ||
    listener !== ((zone.listener_protocol as Listener) || "http_and_https");

  const save = async () => {
    const modeChanged = mode !== (zone.proxy_mode || "static");
    if (modeChanged) {
      const ok = await confirm({
        title: `Switch to ${proxyModeMeta(mode).label}?`,
        description:
          mode === "static"
            ? "Proxy pools stop rotating. Records are managed directly at the provider again."
            : "Traffic for this zone is routed through proxy machines once you configure pools on the Routing tab.",
        confirmText: "Switch mode",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await api.updateDNSManagedDomain(zone.id, { dns_account_id: accountId, listener_protocol: listener });
      if (modeChanged) await api.setDomainProxyMode(zone.id, mode);
      toast.success("Zone settings saved");
      onSaved();
    } catch (e) {
      toast.error("Couldn't save settings", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setAccountId(zone.dns_account_id);
    setMode(zone.proxy_mode || "static");
    setListener((zone.listener_protocol as Listener) || "http_and_https");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Provider" description="Account used to read and write this zone." icon={KeyRound}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="zone-account">Account</Label>
            <DNSAccountPicker id="zone-account" accounts={accounts} value={accountId} onValueChange={(id) => setAccountId(id)} className="w-full" />
            {accounts.length === 0 && (
              <p className="text-xs text-muted-foreground">No provider accounts yet — connect one on the DNS page.</p>
            )}
          </div>

          {accountId && (
            <div className="space-y-2 rounded-md border border-border bg-surface-2/40 p-3">
              {nsQ.loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner /> Looking up nameservers at {providerMeta(accounts.find((a) => a.id === accountId)?.provider)?.label ?? "provider"}…
                </div>
              ) : expected ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{expected.message}</span>
                    {expected.found && expected.nameservers.length > 0 && (
                      <CopyButton value={expected.nameservers.join("\n")} label="Copy all" toastMessage="Nameservers copied" />
                    )}
                  </div>
                  {expected.found && expected.nameservers.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="text-xs">Set these at your registrar:</div>
                      {expected.nameservers.map((ns) => (
                        <CopyableMono key={ns} value={ns} />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Nameservers unavailable.</span>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Routing"
        description="How traffic for this zone reaches your servers."
        icon={Route}
        footer={
          <div className="flex items-center justify-end gap-2">
            {dirty && (
              <Button variant="ghost" onClick={reset} disabled={saving}>
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty || saving}>
              {saving && <Spinner />}
              Save settings
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <RadioGroup value={mode} onValueChange={setMode} className="grid gap-2" disabled={!accountId}>
            {(["static", "layer7", "separate", "wildcard"] as const).map((m) => (
              <RadioCard key={m} value={m} title={PROXY_MODE[m].label} description={PROXY_MODE[m].description} />
            ))}
          </RadioGroup>
          {!accountId && (
            <Alert variant="warning">
              <KeyRound />
              <AlertTitle>No provider account</AlertTitle>
              <AlertDescription>Records and proxy rotation need a provider account to update DNS.</AlertDescription>
            </Alert>
          )}
          {mode !== "static" && (
            <div className="space-y-1.5">
              <Label>Listener ports</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={listener}
                onValueChange={(v) => v && setListener(v as Listener)}
              >
                <ToggleGroupItem value="http_and_https" className="font-data px-3">80 + 443</ToggleGroupItem>
                <ToggleGroupItem value="https_only" className="font-data px-3">443 only</ToggleGroupItem>
                <ToggleGroupItem value="http_only" className="font-data px-3">80 only</ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {listener === "https_only"
                  ? "No port-80 listener (hardened TLS; helps certificate issuance on some setups)."
                  : listener === "http_only"
                    ? "Plain HTTP only — no TLS listener."
                    : "Both plain HTTP and TLS listeners on the proxies."}
              </p>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
