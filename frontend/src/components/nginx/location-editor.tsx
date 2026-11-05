"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Copy, FolderOpen, Network, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Landing, LocationConfig } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Field } from "@/components/nginx/fields";
import type { FieldErrors } from "@/components/nginx/form-state";

const MATCH_LABEL: Record<string, string> = { prefix: "", exact: "=", regex: "~", case_insensitive_regex: "~*" };

export function LocationsEditor({
  locations,
  onChange,
  landings,
  enablePHP,
  errors,
  warnings,
}: {
  locations: LocationConfig[];
  onChange: (next: LocationConfig[]) => void;
  landings: Landing[];
  enablePHP: boolean;
  errors: FieldErrors;
  warnings: FieldErrors;
}) {
  const update = (i: number, patch: Partial<LocationConfig>) => onChange(locations.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= locations.length) return;
    const next = [...locations];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(locations.filter((_, j) => j !== i));
  const duplicate = (i: number) => onChange([...locations.slice(0, i + 1), { ...locations[i] }, ...locations.slice(i + 1)]);
  const add = () => onChange([...locations, { path: "/api", match_type: "prefix", type: "proxy", proxy_url: "" }]);

  return (
    <div className="space-y-3">
      {locations.map((loc, i) => (
        <LocationCard
          key={i}
          index={i}
          count={locations.length}
          loc={loc}
          landings={landings}
          enablePHP={enablePHP}
          errors={errors}
          warnings={warnings}
          onUpdate={(p) => update(i, p)}
          onMove={(d) => move(i, d)}
          onRemove={() => remove(i)}
          onDuplicate={() => duplicate(i)}
        />
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-full border-dashed">
        <Plus />
        Add location
      </Button>
    </div>
  );
}

function LocationCard({
  index: i,
  count,
  loc,
  landings,
  enablePHP,
  errors,
  warnings,
  onUpdate,
  onMove,
  onRemove,
  onDuplicate,
}: {
  index: number;
  count: number;
  loc: LocationConfig;
  landings: Landing[];
  enablePHP: boolean;
  errors: FieldErrors;
  warnings: FieldErrors;
  onUpdate: (p: Partial<LocationConfig>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const match = loc.match_type || "prefix";
  const isStatic = loc.type === "static";
  const source = loc.static_type || "local";
  const pathErr = errors[`loc.${i}.path`];
  return (
    <div className={cn("rounded-lg border bg-card/40", pathErr || errors[`loc.${i}.proxy_url`] ? "border-destructive/40" : "border-border")}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-data text-[11px] text-subtle-foreground">#{i + 1}</span>
        <span className="font-data min-w-0 flex-1 truncate text-[12.5px]">
          location {MATCH_LABEL[match] ? <span className="text-warning">{MATCH_LABEL[match]} </span> : null}
          {loc.path || <span className="text-muted-foreground">…</span>}
          <span className="text-muted-foreground"> → </span>
          {isStatic ? (
            <span className="text-muted-foreground">{source === "landing" ? "static content" : loc.root || "static"}</span>
          ) : (
            <span className="text-muted-foreground">{loc.proxy_url || "proxy"}</span>
          )}
        </span>
        {isStatic && enablePHP && <Badge variant="info">PHP</Badge>}
        <div className="flex items-center">
          <IconBtn label="Move up" disabled={i === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </IconBtn>
          <IconBtn label="Move down" disabled={i === count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </IconBtn>
          <IconBtn label="Duplicate" onClick={onDuplicate}>
            <Copy />
          </IconBtn>
          {count > 1 && (
            <IconBtn label="Remove location" onClick={onRemove} destructive>
              <Trash2 />
            </IconBtn>
          )}
        </div>
      </div>
      <div className="space-y-4 p-3">
        <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
          <Field label="Match">
            <Select value={match} onValueChange={(v) => onUpdate({ match_type: v })}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prefix">Prefix</SelectItem>
                <SelectItem value="exact">Exact =</SelectItem>
                <SelectItem value="regex">Regex ~</SelectItem>
                <SelectItem value="case_insensitive_regex">Regex, case-insensitive ~*</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Path" error={pathErr} warning={warnings[`loc.${i}.path`]}>
            <Input
              value={loc.path}
              onChange={(e) => onUpdate({ path: e.target.value })}
              placeholder="/"
              className="font-data h-8"
              aria-invalid={!!pathErr}
              spellCheck={false}
            />
          </Field>
          <Field label="Serves">
            <ToggleGroup type="single" size="sm" value={loc.type} onValueChange={(v) => v && onUpdate({ type: v })}>
              <ToggleGroupItem value="proxy" className="px-2.5 text-xs">
                <Network />
                Proxy
              </ToggleGroupItem>
              <ToggleGroupItem value="static" className="px-2.5 text-xs">
                <FolderOpen />
                Static
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </div>

        {!isStatic ? (
          <Field
            label="Upstream URL"
            error={errors[`loc.${i}.proxy_url`]}
            warning={warnings[`loc.${i}.proxy_url`]}
            hint="Passed to proxy_pass with Host, X-Real-IP, X-Forwarded-For and X-Forwarded-Proto headers."
          >
            <Input
              value={loc.proxy_url || ""}
              onChange={(e) => onUpdate({ proxy_url: e.target.value })}
              placeholder="http://localhost:3000"
              className="font-data h-8"
              spellCheck={false}
            />
          </Field>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Source">
                <ToggleGroup type="single" size="sm" value={source} onValueChange={(v) => v && onUpdate({ static_type: v })}>
                  <ToggleGroupItem value="local" className="px-2.5 text-xs">
                    Local path
                  </ToggleGroupItem>
                  <ToggleGroupItem value="landing" className="px-2.5 text-xs">
                    Static content
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {source === "landing" && (
                <Field label="Content" warning={warnings[`loc.${i}.landing_id`]}>
                  <Combobox
                    items={landings}
                    getValue={(l) => l.id}
                    getLabel={(l) => l.name}
                    getKeywords={(l) => [l.type, l.file_name]}
                    renderItem={(l) => (
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate">{l.name}</span>
                        <span className="font-data text-[11px] text-subtle-foreground">{l.type.toUpperCase()}</span>
                      </div>
                    )}
                    value={loc.landing_id || null}
                    onValueChange={(v) => onUpdate({ landing_id: v ?? "" })}
                    placeholder={landings.length ? "Select content…" : "No content uploaded"}
                    emptyText="No static content. Upload some under Static."
                    size="sm"
                    modal={false}
                    clearable
                  />
                </Field>
              )}
            </div>
            <Field label="Root path" hint={source === "landing" ? "Where the content is deployed on the machine." : undefined}>
              <Input
                value={loc.root || ""}
                onChange={(e) => onUpdate({ root: e.target.value })}
                placeholder="/var/www/html"
                className="font-data h-8"
                spellCheck={false}
              />
            </Field>
            {source !== "landing" ? (
              <Field label="Index files" optional hint="Defaults to index.html index.htm (index.php is prepended when PHP is on).">
                <Input
                  value={loc.index || ""}
                  onChange={(e) => onUpdate({ index: e.target.value })}
                  placeholder="index.html index.htm"
                  className="font-data h-8"
                  spellCheck={false}
                />
              </Field>
            ) : (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                <span>
                  <span className="block text-[13px]">Replace on deploy</span>
                  <span className="block text-xs text-muted-foreground">Overwrite files when the content is redeployed</span>
                </span>
                <Switch checked={loc.replace_landing_content ?? true} onCheckedChange={(v) => onUpdate({ replace_landing_content: v })} />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  children,
  onClick,
  disabled,
  destructive,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(destructive && "text-destructive hover:text-destructive")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
