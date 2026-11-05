"use client";

import type { DNSAccount } from "@/lib/api";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";

import { providerMeta } from "./dns-utils";
import { ProviderLogo } from "./provider-badge";

/** Fuzzy picker for DNS provider accounts. */
export function DNSAccountPicker({
  accounts,
  value,
  onValueChange,
  id,
  placeholder = "Manual (no provider)",
  className,
}: {
  accounts: DNSAccount[];
  value: string | null;
  onValueChange: (id: string | null, account: DNSAccount | null) => void;
  id?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Combobox<DNSAccount>
      id={id}
      items={accounts}
      value={value}
      onValueChange={onValueChange}
      getValue={(a) => a.id}
      getLabel={(a) => a.name}
      getKeywords={(a) => [a.provider, providerMeta(a.provider)?.label]}
      getGroup={(a) => providerMeta(a.provider)?.label ?? a.provider}
      renderItem={(a) => (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ProviderLogo provider={a.provider} size="sm" />
          <span className="min-w-0 flex-1 truncate">{a.name}</span>
          {a.is_default && <Badge variant="secondary">Default</Badge>}
        </span>
      )}
      renderValue={(a) => (
        <span className="flex min-w-0 items-center gap-2">
          <ProviderLogo provider={a.provider} size="sm" />
          <span className="truncate">{a.name}</span>
          <span className="truncate text-xs text-muted-foreground">{providerMeta(a.provider)?.label}</span>
        </span>
      )}
      clearable
      placeholder={placeholder}
      searchPlaceholder="Search accounts…"
      emptyText="No accounts match."
      className={className}
    />
  );
}
