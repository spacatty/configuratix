"use client";

import * as React from "react";
import { Eye, Save } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { api, type Landing, type NginxConfig, type SecurityEndpointRule } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
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
    if (!structured) out.push({ id: "raw", label: "Raw config" });
    else if (f.isPassthrough) out.push({ id: "passthrough", label: "L4 passthrough" });
    else
      out.push(
        { id: "ssl", label: "SSL / TLS" },
        { id: "proxy", label: "Proxy / real IP" },
        { id: "php", label: "PHP" },
        { id: "security", label: "Security" },
        { id: "endpoints", label: "Endpoint rules", count: rules.length },
        { id: "locations", label: "Locations", count: f.locations.length }
      );
    out.push({ id: "domains", label: "Domains", count: liveConfig?.domains_count ?? config?.domains_count });
    return out;
  }, [structured, f.isPassthrough, rules.length, f.locations.length, liveConfig?.domains_count, config?.domains_count]);

  const errorSections = React.useMemo(() => new Set(Object.keys(errors).map(sectionOfField)), [errors]);

  const [active, setActive] = React.useState("basics");
  React.useEffect(() => {
    const els = sections.map((s) => document.getElementById(`section-${s.id}`)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.section ?? "basics");
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);
  const jump = (id: string) => {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
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

  return (
    <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_minmax(0,440px)]">
      {/* Section nav */}
      <nav aria-label="Config sections" className="hidden lg:block">
        <div className="sticky top-16 space-y-0.5">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jump(s.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                active === s.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <span className={cn("h-3.5 w-0.5 rounded-full", active === s.id ? "bg-primary" : "bg-transparent")} />
              <span className="flex-1 truncate">{s.label}</span>
              {showErrors && errorSections.has(s.id) ? (
                <span className="size-1.5 rounded-full bg-destructive" aria-label="Has errors" />
              ) : s.count !== undefined ? (
                <span className="font-data text-[11px] text-subtle-foreground">{s.count}</span>
              ) : null}
            </button>
          ))}
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <Button className="w-full" size="sm" onClick={() => void save()} disabled={saving || (!dirty && !!config)}>
              {saving ? <Spinner /> : <Save />}
              {config ? "Save" : "Create"}
            </Button>
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              {dirty ? (
                <>
                  <span className="size-1.5 rounded-full bg-warning" />
                  Unsaved changes
                </>
              ) : (
                <>
                  <Kbd>Ctrl</Kbd>
                  <Kbd>S</Kbd>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Form */}
      <div className="min-w-0 space-y-4">
        <BasicsSection {...sp} />
        {!structured ? (
          <RawSection {...sp} />
        ) : f.isPassthrough ? (
          <PassthroughSection {...sp} />
        ) : (
          <>
            <SslSection {...sp} />
            <ProxySection {...sp} />
            <PhpSection {...sp} />
            <SecuritySection {...sp} />
            <EndpointRulesSection enabled={f.endpointBlocking} rules={rules} onAdd={addRule} onDelete={deleteRule} pendingCreate={pendingRules} />
            <LocationsSection {...sp} landings={landings} />
          </>
        )}
        <ConfigDomainsSection config={liveConfig ?? config} onApplied={onDomainsChanged} />

        {/* Mobile / lg preview */}
        {structured && (
          <div className="xl:hidden">
            <PreviewPanel preview={preview} lines={previewLines} domain={sampleDomain} previewDomain={previewDomain} setPreviewDomain={setPreviewDomain} passthrough={f.isPassthrough} height={420} />
          </div>
        )}
      </div>

      {/* Preview (xl) */}
      <aside className="hidden xl:block">
        <div className="sticky top-16">
          {structured ? (
            <PreviewPanel
              preview={preview}
              lines={previewLines}
              domain={sampleDomain}
              previewDomain={previewDomain}
              setPreviewDomain={setPreviewDomain}
              passthrough={f.isPassthrough}
              height="calc(100vh - 170px)"
            />
          ) : (
            <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
              Raw mode: the editor on the left is exactly what gets written for each domain. Use <span className="font-data">$host</span> or hardcode the
              server_name.
            </div>
          )}
        </div>
      </aside>
    </div>
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
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card" style={{ height }}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Eye className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium">Generated config</span>
        <Badge variant="muted" className="font-data">
          {lines} lines
        </Badge>
        {passthrough && <Badge variant="warning">approx.</Badge>}
        <div className="ml-auto">
          <CopyButton value={preview} label="Copy config" />
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="shrink-0 text-[11px] text-muted-foreground">server_name</span>
        <Input
          value={previewDomain}
          onChange={(e) => setPreviewDomain(e.target.value)}
          placeholder={domain}
          className="font-data h-6 border-transparent bg-transparent px-1 text-xs shadow-none focus-visible:border-border"
          aria-label="Preview domain"
        />
      </div>
      <div className="min-h-0 flex-1">
        <NginxMonaco value={preview} readOnly />
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-subtle-foreground">Live preview · rendered on the server per domain at apply time</div>
    </div>
  );
}
