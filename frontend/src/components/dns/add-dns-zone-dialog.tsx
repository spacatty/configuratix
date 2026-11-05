"use client";

import * as React from "react";
import { toast } from "sonner";

import { api, type DNSAccount, type DNSManagedDomain } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner, errorMessage } from "@/components/app";
import { normalizeFqdn, parseDomainList } from "@/components/domains/domain-utils";

import { DNSAccountPicker } from "./dns-account-picker";

export function AddDNSZoneDialog({
  open,
  onOpenChange,
  accounts,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: DNSAccount[];
  existing: DNSManagedDomain[];
  onCreated: (zone: DNSManagedDomain) => void;
}) {
  const [fqdn, setFqdn] = React.useState("");
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFqdn("");
    setAccountId(accounts.find((a) => a.is_default)?.id ?? accounts[0]?.id ?? null);
  }, [open, accounts]);

  const parsed = fqdn.trim() ? parseDomainList(fqdn, existing.map((d) => d.fqdn))[0] : null;
  const error = parsed && parsed.status !== "ok" ? parsed.reason : null;

  const submit = async () => {
    if (!parsed || parsed.status !== "ok") return;
    setSaving(true);
    try {
      const zone = await api.createDNSManagedDomain({ fqdn: normalizeFqdn(fqdn), dns_account_id: accountId ?? undefined });
      toast.success(`${zone.fqdn} added`);
      onCreated(zone);
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't add zone", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add DNS zone</DialogTitle>
          <DialogDescription>Manage a domain&apos;s records, nameservers and proxy routing from here.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="zone-fqdn">Domain</Label>
            <Input
              id="zone-fqdn"
              autoFocus
              className="font-data"
              placeholder="example.com"
              value={fqdn}
              aria-invalid={!!error}
              onChange={(e) => setFqdn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zone-account">Provider account</Label>
            <DNSAccountPicker id="zone-account" accounts={accounts} value={accountId} onValueChange={(id) => setAccountId(id)} className="w-full" />
            <p className="text-xs text-muted-foreground">
              Without an account the zone is tracked locally only (nameserver checks and lookups still work).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!parsed || parsed.status !== "ok" || saving}>
            {saving && <Spinner />}
            Add zone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
