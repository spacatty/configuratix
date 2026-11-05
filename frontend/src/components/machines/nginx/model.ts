import type { ConfigCategory, ConfigFile, MachineNginxInventory, NginxFileEntry } from "@/lib/api";

export type FileState = "active" | "disabled" | "backup" | "inactive" | "missing";

export interface ExplorerFile {
  /** Unique key (path, or "missing:<fqdn>"). */
  key: string;
  path: string;
  name: string;
  state: FileState;
  source: "nginx" | "legacy";
  managed?: boolean;
  drift?: boolean;
  domainFqdn?: string;
  domainId?: string;
  nginxConfigId?: string;
  size?: number;
  mtime?: string | null;
  linkTarget?: string;
  readonly?: boolean;
  /** Legacy custom path ids (for edit/remove). */
  legacy?: { categoryId: string; pathId?: string; reloadCommand?: string; type: string };
}

export interface ExplorerGroup {
  id: string;
  label: string;
  /** "nginx" groups come from the inventory; others from /configs. */
  kind: "nginx" | "builtin" | "custom";
  description?: string;
  files: ExplorerFile[];
  subgroups?: { id: string; label: string; files: ExplorerFile[] }[];
  custom?: { emoji?: string; color?: string; category: ConfigCategory };
}

export const NGINX_GROUPS: { id: NginxFileEntry["category"]; label: string; description: string }[] = [
  { id: "configuratix_domain", label: "Configuratix domains", description: "Per-domain server blocks generated from nginx configs" },
  { id: "configuratix_passthrough", label: "Passthrough", description: "DNS pool HTTP / L7 routing" },
  { id: "configuratix_stream", label: "Stream (L4)", description: "SNI passthrough in stream.d" },
  { id: "configuratix_snippet", label: "Snippets", description: "Shared Configuratix snippets" },
  { id: "system", label: "System", description: "nginx.conf and conf.d" },
  { id: "site", label: "Sites", description: "sites-enabled / sites-available" },
  { id: "other", label: "Other", description: "Everything else under /etc/nginx" },
];

export function nginxGroups(inv: MachineNginxInventory): ExplorerGroup[] {
  const by = new Map<string, ExplorerFile[]>();
  for (const f of inv.files ?? []) {
    const file: ExplorerFile = {
      key: f.path,
      path: f.path,
      name: f.path.startsWith("/etc/nginx/sites-available/") ? `${f.name}` : f.name,
      state: f.state,
      source: "nginx",
      managed: f.managed,
      drift: f.drift,
      domainFqdn: f.domain_fqdn,
      domainId: f.domain_id,
      nginxConfigId: f.nginx_config_id,
      size: f.size,
      mtime: f.mtime,
      linkTarget: f.link_target || undefined,
      readonly: f.state === "backup",
    };
    const arr = by.get(f.category) ?? [];
    arr.push(file);
    by.set(f.category, arr);
  }
  for (const m of inv.missing_domains ?? []) {
    const arr = by.get("configuratix_domain") ?? [];
    arr.push({
      key: `missing:${m.fqdn}`,
      path: m.expected_path,
      name: `${m.fqdn}.conf`,
      state: "missing",
      source: "nginx",
      managed: true,
      domainFqdn: m.fqdn,
      domainId: m.domain_id,
      nginxConfigId: m.nginx_config_id ?? undefined,
      readonly: true,
    });
    by.set("configuratix_domain", arr);
  }
  const stateOrder: Record<FileState, number> = { missing: 0, active: 1, inactive: 2, disabled: 3, backup: 4 };
  return NGINX_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    description: g.description,
    kind: "nginx" as const,
    files: (by.get(g.id) ?? []).sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || a.path.localeCompare(b.path)),
  })).filter((g) => g.files.length > 0);
}

function legacyFile(f: ConfigFile, categoryId: string): ExplorerFile {
  return {
    key: f.path,
    path: f.path,
    name: f.name || f.path.split("/").pop() || f.path,
    state: "active",
    source: "legacy",
    readonly: f.readonly,
    legacy: { categoryId, pathId: f.id, reloadCommand: f.reload_command, type: f.file_type || f.type || "text" },
  };
}

/**
 * Legacy categories (/configs). When the nginx inventory is available, nginx-only categories are
 * dropped (the inventory is the complete, authoritative list).
 */
export function legacyGroups(cats: ConfigCategory[], hasInventory: boolean): ExplorerGroup[] {
  const out: ExplorerGroup[] = [];
  for (const c of cats) {
    const files = (c.files ?? []).map((f) => legacyFile(f, c.id));
    const subgroups = (c.subcategories ?? []).map((s) => ({ id: `${c.id}/${s.id}`, label: s.name, files: s.files.map((f) => legacyFile(f, c.id)) }));
    const all = [...files, ...subgroups.flatMap((s) => s.files)];
    const nginxOnly = all.length > 0 && all.every((f) => f.path.startsWith("/etc/nginx/"));
    if (hasInventory && c.is_built_in && (nginxOnly || c.id === "nginx" || /nginx|configuratix/i.test(c.id))) continue;
    out.push({
      id: `legacy:${c.id}`,
      label: c.name,
      kind: c.is_built_in ? "builtin" : "custom",
      description: c.description,
      files,
      subgroups: subgroups.filter((s) => s.files.length > 0),
      custom: c.is_built_in ? undefined : { emoji: c.emoji, color: c.color, category: c },
    });
  }
  return out;
}

export function allFiles(groups: ExplorerGroup[]): ExplorerFile[] {
  return groups.flatMap((g) => [...g.files, ...(g.subgroups ?? []).flatMap((s) => s.files)]);
}

export const STATE_LABEL: Record<FileState, string> = {
  active: "active",
  inactive: "not loaded",
  disabled: "disabled",
  backup: "backup",
  missing: "missing",
};
