"use client";

import * as React from "react";
import { KeyRound, MoreHorizontal, Pencil, PlugZap, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, type DNSAccount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, SectionCard, Spinner, StatusDot, errorMessage, useConfirm } from "@/components/app";

import { providerMeta } from "./dns-utils";
import { ProviderLogo } from "./provider-badge";

type TestState = { state: "testing" } | { state: "ok" | "fail"; message: string };

export function DNSAccountsCard({
  accounts,
  zoneCounts,
  onAdd,
  onEdit,
  onChanged,
}: {
  accounts: DNSAccount[];
  zoneCounts: Record<string, number>;
  onAdd: () => void;
  onEdit: (a: DNSAccount) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [tests, setTests] = React.useState<Record<string, TestState>>({});

  const test = async (a: DNSAccount) => {
    setTests((t) => ({ ...t, [a.id]: { state: "testing" } }));
    try {
      const r = await api.testDNSAccount(a.id);
      setTests((t) => ({ ...t, [a.id]: { state: r.valid ? "ok" : "fail", message: r.message } }));
      if (r.valid) toast.success(`${a.name}: connection works`, { description: r.message });
      else toast.error(`${a.name}: connection failed`, { description: r.message });
    } catch (e) {
      setTests((t) => ({ ...t, [a.id]: { state: "fail", message: errorMessage(e) } }));
      toast.error(`${a.name}: connection failed`, { description: errorMessage(e) });
    }
  };

  const makeDefault = async (a: DNSAccount) => {
    try {
      await api.updateDNSAccount(a.id, { is_default: true });
      toast.success(`${a.name} is now the default account`);
      onChanged();
    } catch (e) {
      toast.error("Couldn't update account", { description: errorMessage(e) });
    }
  };

  const remove = async (a: DNSAccount) => {
    const zones = zoneCounts[a.id] ?? 0;
    const ok = await confirm({
      title: `Remove ${a.name}?`,
      description:
        zones > 0
          ? `${zones} DNS zone${zones === 1 ? " uses" : "s use"} this account and will fall back to manual. Records at the provider are not touched.`
          : "Stored credentials are deleted. Records at the provider are not touched.",
      destructive: true,
      confirmText: "Remove account",
      onConfirm: () => api.deleteDNSAccount(a.id),
    });
    if (ok) {
      toast.success("Account removed");
      onChanged();
    }
  };

  return (
    <SectionCard
      title="Provider accounts"
      description="API credentials used to manage zones."
      icon={KeyRound}
      flush
      actions={
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus />
          Connect provider
        </Button>
      }
    >
      {accounts.length === 0 ? (
        <EmptyState
          size="compact"
          bordered={false}
          icon={KeyRound}
          title="No provider connected"
          description="Connect Cloudflare, deSEC, Njalla, ClouDNS or DNSPod to manage records from here."
          action={
            <Button size="sm" onClick={onAdd}>
              <Plus />
              Connect provider
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {accounts.map((a) => {
            const meta = providerMeta(a.provider);
            const t = tests[a.id];
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <ProviderLogo provider={a.provider} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{a.name}</span>
                    {a.is_default && <Badge variant="secondary">Default</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {meta?.label ?? a.provider}
                    {t && t.state !== "testing" && (
                      <span className="ml-2 inline-flex items-center gap-1">
                        <StatusDot tone={t.state === "ok" ? "success" : "destructive"} size="xs" />
                        <span className="truncate">{t.state === "ok" ? "Connected" : t.message}</span>
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-data text-xs text-muted-foreground" title="DNS zones using this account">
                  {zoneCounts[a.id] ?? 0} zones
                </span>
                <Button size="xs" variant="ghost" onClick={() => test(a)} disabled={t?.state === "testing"}>
                  {t?.state === "testing" ? <Spinner /> : <PlugZap />}
                  Test
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(a)}>
                      <Pencil />
                      Edit credentials…
                    </DropdownMenuItem>
                    {!a.is_default && (
                      <DropdownMenuItem onClick={() => makeDefault(a)}>
                        <Star />
                        Make default
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => remove(a)}>
                      <Trash2 />
                      Remove…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
