"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { api, type Landing, type NginxConfig, type SecurityEndpointRule } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/app/data-display";
import { Spinner, errorMessage } from "@/components/app/states";
import { invalidatePickerCache } from "@/components/app/pickers";
import {
  BasicsSection,
  EndpointRulesSection,
  LocationsSection,
  PassthroughSection,
  PhpSection,
  ProxySection,
  RawSection,
  SecuritySection,
  SslSection,
} from "@/components/nginx/editor-sections";
import { ConfigDomainsSection } from "@/components/nginx/config-domains";
import {
  type NginxFormState,
  defaultFormState,
  payloadFromState,
  sectionOfField,
  stateFromConfig,
  validateForm,
} from "@/components/nginx/form-state";
import { generatePreview } from "@/components/nginx/preview";
import { NginxMonaco } from "@/components/nginx/nginx-monaco";

export interface NginxConfigEditorProps {
  /** Null for "new". */
  config: NginxConfig | null;
  /** Latest server copy (domains + sync state), refreshed by the page. */
  liveConfig?: NginxConfig | null;
  initialRules?: SecurityEndpointRule[];
  /** Security flags from the security API (used when structured_json has none). */
  securityOverride?: { ua: boolean; endpoint: boolean } | null;
  landings: Landing[];
  onSaved: (saved: NginxConfig, created: boolean) => void;
  onDomainsChanged?: () => void;
  /** Registers the save handler so the page header can trigger it. */
  saveRef?: React.MutableRefObject<(() => void) | null>;
  onStateChange?: (s: { dirty: boolean; saving: boolean; valid: boolean }) => void;
}

interface NavItem {
  id: string;
  label: string;
  count?: number;
}

export function NginxConfigEditor({
  config,
  liveConfig,
  initialRules,
  securityOverride,
  landings,
  onSaved,
  onDomainsChanged,
  saveRef,
  onStateChange,
}: NginxConfigEditorProps) {
  const initial = React.useMemo(() => {
    const s = config ? stateFromConfig(config) : defaultFormState();
    if (config && securityOverride) {
      s.uaBlocking = securityOverride.ua;
      s.endpointBlocking = securityOverride.endpoint;
    }
    return s;
  }, [config, securityOverride]);

  const [f, setF] = React.useState<NginxFormState>(initial);
  const [baseline, setBaseline] = React.useState(() => JSON.stringify(initial));
  React.useEffect(() => {
    setF(initial);
    setBaseline(JSON.stringify(initial));
  }, [initial]);

  const set = React.useCallback(<K extends keyof NginxFormState>(key: K, value: NginxFormState[K]) => setF((p) => ({ ...p, [key]: value })), []);

  const [rules, setRules] = React.useState<SecurityEndpointRule[]>(initialRules ?? []);
  React.useEffect(() => setRules(initialRules ?? []), [initialRules]);
  const pendingRules = !config;

  const { errors, warnings } = React.useMemo(() => validateForm(f), [f]);
  const errorCount = Object.keys(errors).length;
  const dirty = JSON.stringify(f) !== baseline || (pendingRules && rules.length > 0);
  const [saving, setSaving] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);

  /* ------------------------------------------------------------ sections */
  const structured = f.mode === "auto";
  const sections: NavItem[] = React.useMemo(() => {
    const out: NavItem[] = [{ id: "basics", label: "Basics" }];
    if (structured && f.isPassthrough) out.push({ id: "passthrough", label: "L4 passthrough" });
    else if (structured)
      out.push(
        { id: "ssl", label: "SSL / TLS" },
        { id: "proxy", label: "Real IP" },
        { id: "php", label: "PHP" },
        { id: "security", label: "Security" },
        { id: "endpoints", label: "Endpoints", count: rules.length },
        { id: "locations", label: "Locations", count: f.locations.length }
      );
    out.push({ id: "domains", label: "Domains", count: liveConfig?.domains_count ?? config?.domains_count });
    out.push({ id: "editor", label: "Editor" });
    return out;
  }, [structured, f.isPassthrough, rules.length, f.locations.length, liveConfig?.domains_count, config?.domains_count]);

  const errorSections = React.useMemo(() => new Set(Object.keys(errors).map(sectionOfField)), [errors]);

  const [active, setActive] = React.useState("basics");
  const activeTab = sections.some((section) => section.id === active) ? active : "basics";
  const jump = (id: string) => {
    setActive(id === "raw" ? "editor" : id);
  };

  /* ------------------------------------------------------------- preview */
  const [previewDomain, setPreviewDomain] = React.useState("");
  const sampleDomain = previewDomain.trim() || liveConfig?.domains?.[0]?.fqdn || config?.domains?.[0]?.fqdn || "example.com";
  const deferred = React.useDeferredValue(f);
  const preview = React.useMemo(
    () => generatePreview(deferred, sampleDomain, deferred.endpointBlocking ? rules.map((r) => r.pattern) : []),
    [deferred, sampleDomain, rules]
  );
  const previewLines = preview.split("\n").length;

  /* ---------------------------------------------------------------- save */
  const save = React.useCallback(async () => {
    setShowErrors(true);
    if (errorCount > 0) {
      const first = Object.keys(errors)[0];
      jump(sectionOfField(first));
      toast.error("Fix the highlighted fields first", { description: errors[first] });
      return;
    }
    setSaving(true);
    try {
      const payload = payloadFromState(f);
      let saved: NginxConfig;
      if (config) {
        saved = await api.updateNginxConfig(config.id, payload);
        try {
          await api.updateSecuritySettings(config.id, { ua_blocking_enabled: f.uaBlocking, endpoint_blocking_enabled: f.endpointBlocking });
        } catch (e) {
          console.error("Failed to save security settings:", e);
        }
      } else {
        saved = await api.createNginxConfig(payload);
        if (f.uaBlocking || f.endpointBlocking) {
          try {
            await api.updateSecuritySettings(saved.id, { ua_blocking_enabled: f.uaBlocking, endpoint_blocking_enabled: f.endpointBlocking });
          } catch (e) {
            console.error("Failed to save security settings:", e);
          }
        }
        const failed: string[] = [];
        for (const r of rules) {
          try {
            await api.createSecurityEndpointRule(saved.id, { pattern: r.pattern, description: r.description });
          } catch {
            failed.push(r.pattern);
          }
        }
        if (failed.length) toast.warning("Some endpoint rules weren't created", { description: failed.join(", ") });
      }
      invalidatePickerCache("nginx-configs");
      setBaseline(JSON.stringify(f));
      setShowErrors(false);
      const n = saved.out_of_sync_count ?? 0;
      toast.success(config ? "Configuration saved" : "Configuration created", {
        description: n > 0 ? `${n} domain${n === 1 ? "" : "s"} now out of sync — apply to roll it out.` : undefined,
      });
      onSaved(saved, !config);
    } catch (e) {
      toast.error(config ? "Couldn't save configuration" : "Couldn't create configuration", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, config, rules, errorCount, errors, onSaved]);

  React.useEffect(() => {
    if (saveRef) saveRef.current = () => void save();
  }, [save, saveRef]);
  React.useEffect(() => {
    onStateChange?.({ dirty, saving, valid: errorCount === 0 });
  }, [dirty, saving, errorCount, onStateChange]);

  // Ctrl/Cmd+S
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save]);

  // Warn before leaving with unsaved changes
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /* --------------------------------------------------------------- rules */
  const addRule = async (pattern: string, description: string) => {
    if (!config) {
      setRules((r) => [
        ...r,
        { id: `pending-${Date.now()}`, nginx_config_id: "", pattern, description, priority: 0, is_active: true, created_at: new Date().toISOString() },
      ]);
      return;
    }
    try {
      const rule = await api.createSecurityEndpointRule(config.id, { pattern, description });
      setRules((r) => [...r, rule]);
      toast.success("Endpoint rule added");
    } catch (e) {
      toast.error("Couldn't add rule", { description: errorMessage(e) });
      throw e;
    }
  };
  const deleteRule = async (rule: SecurityEndpointRule) => {
    if (!config || rule.id.startsWith("pending-")) {
      setRules((r) => r.filter((x) => x.id !== rule.id));
      return;
    }
    try {
      await api.deleteSecurityEndpointRule(config.id, rule.id);
      setRules((r) => r.filter((x) => x.id !== rule.id));
      toast.success("Rule deleted");
    } catch (e) {
      toast.error("Couldn't delete rule", { description: errorMessage(e) });
    }
  };

  const shownErrors = showErrors ? errors : Object.fromEntries(Object.entries(errors).filter(([k]) => k !== "name"));
  const sp = { f, set, errors: shownErrors, warnings };

  const previewProps = { preview, lines: previewLines, domain: sampleDomain, previewDomain, setPreviewDomain, passthrough: f.isPassthrough };

  return (
    <Tabs value={activeTab} onValueChange={setActive} className="min-w-0 gap-4">
        {/* Section bar */}
        <div className="sticky top-12 z-20 flex min-w-0 items-center gap-3 border-b border-border bg-background">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <TabsList aria-label="Config sections" className="h-11 justify-start gap-1 rounded-none border-0 bg-transparent p-0">
            {sections.map((s) => (
              <TabsTrigger
                key={s.id}
                value={s.id}
                className={cn(
                  "relative h-11 shrink-0 flex-none gap-2 rounded-none border-0 px-3 text-[13px]",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-transparent",
                  "data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:after:bg-foreground"
                )}
              >
                {s.label}
                {showErrors && errorSections.has(s.id === "editor" ? "raw" : s.id) ? (
                  <span className="size-1.5 rounded-full bg-destructive" aria-label="Has errors" />
                ) : s.count !== undefined ? (
                  <span className="font-data text-[11px] text-subtle-foreground tabular-nums">{s.count}</span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          </div>
          <div className="flex h-11 shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {dirty ? (
              <>
                <span className="hidden items-center gap-1.5 sm:inline-flex">
                  <span className="size-1.5 rounded-full bg-warning" />
                  Unsaved
                </span>
                <Button size="xs" onClick={() => void save()} disabled={saving}>
                  {saving ? <Spinner /> : <Save />}
                  {config ? "Save" : "Create"}
                </Button>
              </>
            ) : (
              <span className="hidden items-center gap-1 2xl:inline-flex" title="Save with Ctrl+S">
                <Kbd>Ctrl</Kbd>
                <Kbd>S</Kbd>
              </span>
            )}
          </div>
        </div>

      <TabsContent value="basics" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <BasicsSection {...sp} />
      </TabsContent>
      {structured && f.isPassthrough && (
      <TabsContent value="passthrough" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <PassthroughSection {...sp} />
      </TabsContent>
      )}
      {structured && !f.isPassthrough && (
      <TabsContent value="ssl" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <SslSection {...sp} />
      </TabsContent>
      )}
      {structured && !f.isPassthrough && (
      <TabsContent value="proxy" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <ProxySection {...sp} />
      </TabsContent>
      )}
      {structured && !f.isPassthrough && (
      <TabsContent value="php" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <PhpSection {...sp} />
      </TabsContent>
      )}
      {structured && !f.isPassthrough && (
      <TabsContent value="security" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <SecuritySection {...sp} />
      </TabsContent>
      )}
      {structured && !f.isPassthrough && (
      <TabsContent value="endpoints" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <EndpointRulesSection enabled={f.endpointBlocking} rules={rules} onAdd={addRule} onDelete={deleteRule} pendingCreate={pendingRules} />
      </TabsContent>
      )}
      {structured && !f.isPassthrough && (
      <TabsContent value="locations" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <LocationsSection {...sp} landings={landings} />
      </TabsContent>
      )}
      <TabsContent value="domains" forceMount className="@container rounded-lg border border-border bg-card data-[state=inactive]:hidden">
        <ConfigDomainsSection config={liveConfig ?? config} onApplied={onDomainsChanged} />
      </TabsContent>
      <TabsContent value="editor">
        {structured ? (
          <PreviewPanel {...previewProps} height="max(480px, calc(100svh - 240px))" />
        ) : (
          <div className="@container rounded-lg border border-border bg-card">
            <RawSection {...sp} />
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function PreviewPanel({
  preview,
  lines,
  domain,
  previewDomain,
  setPreviewDomain,
  passthrough,
  height,
}: {
  preview: string;
  lines: number;
  domain: string;
  previewDomain: string;
  setPreviewDomain: (v: string) => void;
  passthrough: boolean;
  height: string | number;
}) {
  return (
    <section aria-label="Generated config" className="flex flex-col overflow-hidden rounded-lg border border-border bg-card" style={{ height }}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Generated config</h2>
        <span className="font-data text-[11px] text-subtle-foreground tabular-nums">{lines} lines</span>
        {passthrough && (
          <Badge variant="warning" className="ml-1">
            approx.
          </Badge>
        )}
        <div className="ml-auto">
          <CopyButton value={preview} label="Copy config" size="sm" />
        </div>
      </header>
      <label className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-2/40 pr-2 pl-4">
        <span className="font-data shrink-0 text-[11.5px] text-subtle-foreground">server_name</span>
        <Input
          value={previewDomain}
          onChange={(e) => setPreviewDomain(e.target.value)}
          placeholder={domain}
          className="font-data h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border focus-visible:border-border dark:bg-transparent"
          aria-label="Preview domain"
          spellCheck={false}
        />
      </label>
      <div className="min-h-0 flex-1">
        <NginxMonaco value={preview} readOnly />
      </div>
      <footer className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-subtle-foreground">
        Live preview. The server renders it per domain at apply time.
      </footer>
    </section>
  );
}
