"use client";

import * as React from "react";
import { CircleCheck, CircleX, ExternalLink, PlugZap } from "lucide-react";
import { toast } from "sonner";

import { api, type DNSAccount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner, errorMessage } from "@/components/app";
import { cn } from "@/lib/utils";

import { DNS_PROVIDERS, providerMeta, type DNSProviderId } from "./dns-utils";
import { ProviderLogo } from "./provider-badge";

export interface DNSAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit an existing account (provider is fixed). */
  account?: DNSAccount | null;
  onSaved: (account: DNSAccount | null) => void;
}

type TestResult = { valid: boolean; message: string } | null;

export function DNSAccountDialog({ open, onOpenChange, account, onSaved }: DNSAccountDialogProps) {
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [provider, setProvider] = React.useState<DNSProviderId>("cloudflare");
  const [name, setName] = React.useState("");
  const [apiId, setApiId] = React.useState("");
  const [token, setToken] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [test, setTest] = React.useState<TestResult>(null);

  React.useEffect(() => {
    if (!open) return;
    setSavedId(account?.id ?? null);
    setProvider((account?.provider as DNSProviderId) ?? "cloudflare");
    setName(account?.name ?? "");
    setApiId("");
    setToken("");
    setIsDefault(account?.is_default ?? false);
    setTest(null);
  }, [open, account]);

  const meta = providerMeta(provider) ?? DNS_PROVIDERS[0];
  const editing = !!savedId;
  const canSave = !!name.trim() && (editing || (!!token.trim() && (!meta.idField || !!apiId.trim())));

  const runTest = async (id: string) => {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.testDNSAccount(id);
      setTest(r);
      return r.valid;
    } catch (e) {
      setTest({ valid: false, message: errorMessage(e) });
      return false;
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      let id = savedId;
      let saved: DNSAccount | null = null;
      if (id) {
        await api.updateDNSAccount(id, {
          name: name.trim(),
          is_default: isDefault,
          ...(apiId.trim() ? { api_id: apiId.trim() } : {}),
          ...(token.trim() ? { api_token: token.trim() } : {}),
        });
      } else {
        saved = await api.createDNSAccount({
          provider,
          name: name.trim(),
          api_id: meta.idField ? apiId.trim() : undefined,
          api_token: token.trim(),
          is_default: isDefault,
        });
        id = saved.id;
        setSavedId(id);
      }
      onSaved(saved);
      setSaving(false);
      const ok = await runTest(id!);
      if (ok) {
        toast.success(editing ? "Account updated" : "Account connected", { description: `${meta.label} · ${name.trim()}` });
        onOpenChange(false);
      }
    } catch (e) {
      toast.error("Couldn't save account", { description: errorMessage(e) });
      setSaving(false);
    }
  };

  const busy = saving || testing;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit DNS account" : "Connect DNS provider"}</DialogTitle>
          <DialogDescription>
            Credentials are stored encrypted on the server and used to read and write zone records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!editing ? (
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <RadioGroup
                value={provider}
                onValueChange={(v) => {
                  setProvider(v as DNSProviderId);
                  setTest(null);
                }}
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                {DNS_PROVIDERS.map((p) => (
                  <label
                    key={p.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 transition-colors",
                      provider === p.id ? "border-primary/60 bg-primary/[0.06]" : "border-border hover:bg-accent/50"
                    )}
                  >
                    <RadioGroupItem value={p.id} className="sr-only" />
                    <ProviderLogo provider={p.id} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{p.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{p.blurb}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-md border border-border bg-surface-2/40 px-3 py-2">
              <ProviderLogo provider={provider} />
              <div className="text-[13px] font-medium">{meta.label}</div>
              <a
                href={meta.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Provider console <ExternalLink className="size-3" />
              </a>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="acc-name">Name</Label>
              <Input
                id="acc-name"
                value={name}
                placeholder={`${meta.label} — production`}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {meta.idField && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="acc-id">{meta.idField.label}</Label>
                <Input
                  id="acc-id"
                  className="font-data"
                  autoComplete="off"
                  value={apiId}
                  placeholder={editing ? "Leave blank to keep" : meta.idField.placeholder}
                  onChange={(e) => setApiId(e.target.value)}
                />
                {meta.idField.hint && <p className="text-xs text-muted-foreground">{meta.idField.hint}</p>}
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="acc-token">{meta.tokenField.label}</Label>
                {!editing && (
                  <a
                    href={meta.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Get one <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <Input
                id="acc-token"
                type="password"
                autoComplete="new-password"
                className="font-data"
                value={token}
                placeholder={editing ? "Leave blank to keep the current secret" : meta.tokenField.placeholder}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{meta.tokenField.hint}</p>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
            <span>
              <span className="block text-[13px] font-medium">Default account</span>
              <span className="block text-xs text-muted-foreground">Pre-selected when adding new DNS zones.</span>
            </span>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </label>

          {(testing || test) && (
            <Alert variant={testing ? "default" : test?.valid ? "success" : "destructive"} className="animate-fade-in-up">
              {testing ? <Spinner /> : test?.valid ? <CircleCheck /> : <CircleX />}
              <AlertTitle>{testing ? "Testing connection…" : test?.valid ? "Connection works" : "Connection failed"}</AlertTitle>
              {!testing && test?.message && <AlertDescription className="font-data text-[12px]">{test.message}</AlertDescription>}
            </Alert>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {editing ? (
            <Button variant="outline" onClick={() => savedId && runTest(savedId)} disabled={busy}>
              {testing ? <Spinner /> : <PlugZap />}
              Test connection
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {test && !test.valid ? "Close" : "Cancel"}
            </Button>
            <Button onClick={save} disabled={!canSave || busy}>
              {saving && <Spinner />}
              {editing ? "Save & test" : "Connect & test"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
