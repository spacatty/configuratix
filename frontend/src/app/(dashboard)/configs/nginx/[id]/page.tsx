"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { FileCode, Save } from "lucide-react";

import { api, type Landing, type NginxConfig, type SecurityEndpointRule } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader, PageSkeleton, RelativeTime, Spinner, useBreadcrumbLabel, usePolling } from "@/components/app";
import { NginxConfigEditor } from "@/components/nginx/config-editor";
import { OutOfSyncBanner } from "@/components/nginx/config-domains";
import { hasStructuredSecurityFlags } from "@/components/nginx/form-state";
import { ConfigKindBadges } from "@/components/nginx/configs-table";

interface Loaded {
  config: NginxConfig | null;
  rules: SecurityEndpointRule[];
  security: { ua: boolean; endpoint: boolean } | null;
  landings: Landing[];
}

async function load(id: string): Promise<Loaded> {
  const landingsP = api.listLandings().catch(() => [] as Landing[]);
  if (id === "new") return { config: null, rules: [], security: null, landings: await landingsP };
  const config = await api.getNginxConfig(id);
  const rules = await api.listSecurityEndpointRules(id).catch(() => [] as SecurityEndpointRule[]);
  let security: Loaded["security"] = null;
  if (!hasStructuredSecurityFlags(config)) {
    try {
      const s = await api.getSecuritySettings(id);
      security = { ua: s.ua_blocking_enabled, endpoint: s.endpoint_blocking_enabled };
    } catch {
      security = { ua: false, endpoint: false };
    }
  }
  return { config, rules, security, landings: await landingsP };
}

export default function NginxConfigEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === "new";
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const reload = React.useCallback(() => {
    setError(null);
    load(id)
      .then(setData)
      .catch(setError);
  }, [id]);
  React.useEffect(() => {
    setData(null);
    reload();
  }, [reload]);

  // Live copy for domain apply status (polls fast while something is applying).
  const [applying, setApplying] = React.useState(false);
  const live = usePolling(() => api.getNginxConfig(id), applying ? 3000 : 20_000, { enabled: !isNew, deps: [id] });
  React.useEffect(() => {
    const ds = live.data?.domains ?? [];
    setApplying(ds.some((d) => d.apply_status === "pending" || d.apply_status === "applying"));
  }, [live.data]);
  const liveConfig = live.data ?? data?.config ?? null;

  const saveRef = React.useRef<(() => void) | null>(null);
  const [state, setState] = React.useState({ dirty: false, saving: false, valid: true });
  const onStateChange = React.useCallback((s: typeof state) => setState(s), []);

  useBreadcrumbLabel(isNew ? "New config" : (data?.config?.name ?? null));

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader back={{ href: "/configs/nginx", label: "Nginx configs" }} title="Nginx config" />
        <ErrorState error={error} onRetry={reload} title="Couldn't load config" />
      </div>
    );
  }
  if (!data) return <PageSkeleton stats={false} />;

  const cfg = data.config;
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/configs/nginx", label: "Nginx configs" }}
        icon={FileCode}
        title={isNew ? "New nginx config" : cfg?.name}
        badge={cfg ? <ConfigKindBadges config={cfg} /> : <Badge variant="muted">Draft</Badge>}
        description={isNew ? "Build a reusable server-block template, then assign it to domains." : undefined}
        meta={
          cfg ? (
            <>
              <span>
                Updated <RelativeTime date={cfg.updated_at} />
              </span>
              <span>
                <span className="font-data text-foreground">{liveConfig?.domains_count ?? 0}</span> domains
              </span>
              {state.dirty && (
                <span className="inline-flex items-center gap-1.5 text-warning">
                  <span className="size-1.5 rounded-full bg-warning" />
                  Unsaved changes
                </span>
              )}
            </>
          ) : null
        }
        actions={
          <>
            <Button variant="outline" onClick={() => router.push("/configs/nginx")}>
              Cancel
            </Button>
            <Button onClick={() => saveRef.current?.()} disabled={state.saving || (!state.dirty && !isNew)}>
              {state.saving ? <Spinner /> : <Save />}
              {isNew ? "Create config" : "Save changes"}
            </Button>
          </>
        }
      />

      {liveConfig && !state.dirty && <OutOfSyncBanner config={liveConfig} onApplied={() => void live.refresh()} />}

      <NginxConfigEditor
        config={cfg}
        liveConfig={liveConfig}
        initialRules={data.rules}
        securityOverride={data.security}
        landings={data.landings}
        saveRef={saveRef}
        onStateChange={onStateChange}
        onDomainsChanged={() => void live.refresh()}
        onSaved={(saved, created) => {
          if (created) {
            router.replace(`/configs/nginx/${saved.id}`);
            return;
          }
          setData((d) => (d ? { ...d, config: saved, security: null } : d));
          live.setData(saved);
          void live.refresh();
        }}
      />
    </div>
  );
}
