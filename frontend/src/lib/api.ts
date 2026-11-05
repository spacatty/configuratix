// Backend API URL - used for all API calls and agent install script
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// Backend URL without /api suffix - for install script and direct backend access
export const BACKEND_URL = API_URL.replace(/\/api\/?$/, "");

export interface LoginRequest {
  email: string;
  password: string;
  totp_code?: string;
}

export interface LoginResponse {
  token?: string;
  user: User;
  requires_2fa?: boolean;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface ApiError {
  message: string;
  code?: string;
}

export interface SetupStatus {
  needs_setup: boolean;
}

export interface CreateAdminRequest {
  email: string;
  password: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  role: string;
  totp_enabled: boolean;
  password_changed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface UserWithDetails extends User {
  machine_count: number;
  project_count: number;
}

export interface UFWRule {
  port: string;
  protocol: string;
  action: string;
  from: string;
}

export interface InterfaceIP {
  interface: string;
  ip: string;
  is_public: boolean;
  is_ipv6: boolean;
}

export interface Machine {
  id: string;
  agent_id: string | null;
  owner_id: string | null;
  project_id: string | null;
  title: string | null;
  hostname: string | null;
  ip_address: string | null;
  detected_ips: InterfaceIP[] | null;
  primary_ip: string | null;
  ubuntu_version: string | null;
  notes_md: string | null;
  access_token_set: boolean;
  created_at: string;
  updated_at: string;
  agent_name: string | null;
  agent_version: string | null;
  last_seen: string | null;
  owner_email: string | null;
  owner_name: string | null;
  project_name: string | null;
  // Settings
  ssh_port: number;
  ufw_enabled: boolean;
  ufw_rules: UFWRule[] | null;
  fail2ban_enabled: boolean;
  fail2ban_config: string | null;
  root_password_set: boolean;
  // Stats
  cpu_percent: number;
  memory_used: number;
  memory_total: number;
  disk_used: number;
  disk_total: number;
  // Machine summary (utilization) - from list/detail when available
  assigned_domains_count?: number;
  healthy_domains_count?: number;
  unhealthy_domains_count?: number;
  proxied_domains_count?: number;
  passthrough_pool_count?: number;
  wildcard_pool_count?: number;
  active_dns_target_count?: number;
  group_count?: number;
  assigned_domains_summary?: { fqdn: string; status: string }[];
  /** Groups this machine belongs to (list + detail). */
  group_names?: { id: string; name: string; color: string | null; emoji: string | null }[];
}

export interface MachineGroup {
  id: string;
  owner_id: string;
  name: string;
  emoji: string;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
  machine_count?: number;
}

export interface MachineGroupWithCount extends MachineGroup {
  machine_count: number;
}

export interface MachineGroupMember {
  id: string;
  title: string | null;
  hostname: string | null;
  ip_address: string | null;
  last_seen: string | null;
  position: number;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  notes_md: string;
  sharing_enabled: boolean;
  invite_token?: string;
  invite_expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithStats extends Project {
  owner_email: string;
  owner_name: string;
  machine_count: number;
  member_count: number;
  online_machines: number;
  offline_machines: number;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  can_view_notes: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  user_email: string;
  user_name: string;
}

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  agent_id: string;
  type: string;
  payload_json: unknown;
  /** One of JobStatus; typed as string for forward compatibility. */
  status: string;
  logs: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  // Optional enrichment (backend may or may not send these yet)
  /** Human title, e.g. "Apply nginx config to web-1". Prefer `jobTitle(job)` to read it. */
  title?: string | null;
  /** Free-form target label (domain, path, service...). */
  target?: string | null;
  machine_id?: string | null;
  machine_name?: string | null;
  machine_title?: string | null;
  triggered_by?: string | null;
  error_message?: string | null;
  duration_ms?: number | null;
  rollback_status?: string | null;
}

// ===== Jobs API (backend/API_CHANGES.md) =====

export type JobEntityType =
  | "domain" | "nginx_config" | "machine" | "dns_domain" | "landing"
  | "php_runtime" | "passthrough" | "command" | "file" | "agent";

/** Row of GET /api/jobs (no logs/payload unless include_logs). */
export interface JobListItem {
  id: string;
  title: string;
  type: string;
  /** Logical action / template id, e.g. "apply_domain", "remove_domain", "nginx_inventory". */
  action: string | null;
  status: string;
  agent_id: string | null;
  machine_id: string | null;
  machine_title: string | null;
  machine_hostname: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_by_email: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  attempts: number;
  cancel_requested: boolean;
  parent_job_id: string | null;
  /** Only with include_logs (tail, secrets redacted). */
  logs?: string | null;
}

export interface JobCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface JobListPage {
  jobs: JobListItem[];
  next_cursor: string | null;
  counts: JobCounts;
}

export interface JobListParams {
  machine_id?: string;
  agent_id?: string;
  /** One or more statuses (sent comma-separated). */
  status?: string | string[];
  /** Matches job type or action. */
  type?: string;
  action?: string;
  entity_type?: string;
  entity_id?: string;
  /** Title search (ILIKE). */
  q?: string;
  /** RFC3339 timestamp or Go duration like "24h". */
  since?: string;
  /** Default 50, max 200. */
  limit?: number;
  cursor?: string;
  include_logs?: boolean;
}

/** Parsed CONFIGURATIX_* markers, stored under result_json.apply. */
export interface JobApplyResult {
  status?: "applied" | "removed" | "rolled_back" | "failed" | string;
  reason?: string;
  disabled?: string[];
  reenabled?: string[];
}

export interface JobDetail extends JobListItem {
  timeout_seconds: number | null;
  updated_at: string;
  /** Full logs, secrets redacted. */
  logs: string;
  /** Payload with secrets masked ("••••••"). */
  payload: unknown;
  result_json: ({ apply?: JobApplyResult } & Record<string, unknown>) | unknown[] | null;
  /** Ids of retry jobs cloned from this one. */
  retries: string[];
}

/** Returned by endpoints that create a job (payload redacted). */
export interface JobCreated {
  id: string;
  job_id: string;
  agent_id: string;
  type: string;
  action: string | null;
  title: string | null;
  status: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: unknown;
  created_at: string;
}

export interface JobCancelResult {
  id: string;
  status: string;
  cancel_requested: boolean;
}

export interface JobStatsBucket extends JobCounts {
  hour: string;
}

export interface JobStats {
  hours: number;
  since: string;
  counts: JobCounts;
  total: number;
  buckets: JobStatsBucket[];
  top_failing: { type: string; failed: number; total: number }[];
  avg_duration_ms: number | null;
}

// ===== Dashboard =====

export interface DashboardSummary {
  generated_at: string;
  machines: {
    total: number;
    online: number;
    offline: number;
    outdated_agents: number | null;
    updating: number;
    latest_agent_version: string | null;
  };
  domains: {
    total: number;
    healthy: number;
    unhealthy: number;
    unknown: number;
    apply_failed: number;
    applying: number;
    /** L7 proxy certificates expiring within 30 days. */
    ssl_expiring_soon: number | null;
  };
  nginx_configs: { total: number; out_of_sync: number; out_of_sync_domains: number };
  jobs: {
    last24h?: JobCounts;
    total_24h?: number;
    buckets?: JobStatsBucket[];
    top_failing?: { type: string; failed: number; total: number }[];
    running: number;
    recent_failed: {
      id: string;
      title: string;
      machine_id: string | null;
      machine_title: string | null;
      finished_at: string | null;
      error_message: string | null;
    }[];
  };
  security: { active_bans: number; bans_24h: number } | null;
  top_machines_by_cpu: { id: string; title: string; cpu: number; mem_pct: number; disk_pct: number; online: boolean }[];
}

// ===== Apply / sync =====

export type DomainApplyStatus = "pending" | "applying" | "applied" | "failed" | "removing";

export interface ApplyJobsResponse {
  jobs: JobCreated[];
  /** Main apply job (first of jobs). */
  job_id: string;
}

export interface NginxConfigDomainRef {
  id: string;
  fqdn: string;
  machine_id: string | null;
  machine_title: string | null;
  apply_status: DomainApplyStatus | null;
  last_applied_at: string | null;
  last_apply_error: string | null;
  last_job_id: string | null;
  out_of_sync: boolean;
}

export interface NginxConfigApplyResult {
  config_id: string;
  results: { domain_id: string; fqdn: string; job_id?: string; jobs?: JobCreated[]; error?: string }[];
  jobs: JobCreated[];
}

// ===== Machine nginx view =====

export type NginxFileCategory =
  | "configuratix_domain" | "configuratix_passthrough" | "configuratix_stream"
  | "configuratix_snippet" | "system" | "site" | "other";

export interface NginxFileEntry {
  path: string;
  name: string;
  category: NginxFileCategory;
  /** active = included by nginx; inactive = present but not matched by an include (e.g. sites-available not linked). */
  state: "active" | "disabled" | "backup" | "inactive";
  size: number;
  mtime: string | null;
  sha256: string;
  link_target?: string;
  managed: boolean;
  domain_fqdn?: string;
  domain_id?: string;
  nginx_config_id?: string;
  expected_sha256?: string;
  drift: boolean;
}

export interface MachineNginxInventory {
  machine_id: string;
  job_id: string;
  nginx: { active: boolean; state: string; test_ok: boolean; test_output: string; version: string };
  files: NginxFileEntry[];
  missing_domains: { domain_id: string; fqdn: string; expected_path: string; nginx_config_id: string | null }[];
  fetched_at: string;
}

export interface NginxExpectedFile {
  path: string;
  content: string;
  /** sha256 of content; compare with NginxFileEntry.sha256. */
  sha256: string;
  source: {
    kind: "domain" | "passthrough_stream" | "passthrough_http" | "passthrough_l7";
    domain_id?: string;
    nginx_config_id?: string;
  };
}

/** 202 response when the inventory job did not finish within ~20s. */
export interface MachineNginxPending {
  pending: true;
  job_id: string;
  status: string;
}

export interface NginxJobResult {
  job_id: string;
  status: string;
  finished: boolean;
  test_ok: boolean;
  output: string;
}

export interface VariableDef {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface CommandStep {
  action: string;
  command?: string;
  timeout?: number;
  path?: string;
  content?: string;
  url?: string;
  mode?: string;
  op?: string;
  name?: string;
}

export interface CommandTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  variables: VariableDef[];
  steps: CommandStep[];
  on_error: string;
}

export interface EnrollmentToken {
  id: string;
  name: string | null;
  token?: string;
  owner_id?: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface Landing {
  id: string;
  name: string;
  owner_id: string;
  type: string; // html, php
  file_name: string;
  file_size: number;
  preview_path?: string;
  created_at: string;
  updated_at: string;
  owner_email?: string;
  owner_name?: string;
}

export interface Domain {
  id: string;
  fqdn: string;
  assigned_machine_id: string | null;
  status: string;
  /** Expected HTTP status code for health (default 200) */
  health_check_expected_status?: number;
  notes_md: string | null;
  last_check_at: string | null;
  created_at: string;
  updated_at: string;
  machine_name: string | null;
  machine_ip: string | null;
  config_id: string | null;
  config_name: string | null;
  // Apply tracking (backend migration 039) — optional until every backend ships it
  /** null | pending | applying | applied | failed | removing */
  apply_status?: string | null;
  last_job_id?: string | null;
  last_apply_error?: string | null;
  last_applied_at?: string | null;
  last_job_status?: string | null;
  config_updated_at?: string | null;
  /** Config changed since the last successful apply. */
  out_of_sync?: boolean | null;
  /** Last health-check HTTP response code, when the backend reports it. */
  last_check_status_code?: number | null;
  /** Response time of the last successful health probe (ms). */
  last_check_response_ms?: number | null;
  /** Why the last probe got no HTTP response (DNS/connection error). */
  last_check_error?: string | null;
  /** Custom health check path (null = "/"). */
  health_check_path?: string | null;
}

/** Job references a domain mutation may return (assign / apply / bulk-assign). */
export interface DomainJobsResponse {
  message?: string;
  job?: Job | null;
  job_id?: string | null;
  job_ids?: string[] | null;
  jobs?: Array<Job | { id: string; job_id?: string; title?: string | null }> | null;
}

export interface DomainGroup {
  id: string;
  owner_id: string;
  name: string;
  emoji: string;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
  domain_count?: number;
}

export interface DomainGroupWithCount extends DomainGroup {
  domain_count: number;
}

export interface DomainGroupMember {
  id: string;
  fqdn: string;
  status: string;
  position: number;
}

export interface DNSManagedDomain {
  id: string;
  owner_id: string;
  fqdn: string;
  dns_account_id: string | null;
  proxy_mode: string; // 'static' | 'separate' | 'wildcard' | 'layer7'
  listener_protocol?: string; // 'http_only' | 'http_and_https' | 'https_only'
  ns_status: string; // unknown, pending, valid, invalid
  ns_last_check: string | null;
  ns_expected: string[] | null;
  ns_actual: string[] | null;
  notes_md: string | null;
  created_at: string;
  updated_at: string;
  dns_account_name?: string | null;
  dns_account_provider?: string | null;
  /** Number of DNS records stored for this domain (list + detail). */
  records_count?: number;
}

/** Response of endpoints that queue passthrough nginx jobs (pool regenerate, L7 issue, machine apply). */
export interface PassthroughJobsResponse {
  status: "queued";
  jobs: JobCreated[];
  /** Per-machine failures (job not created). */
  errors?: string[];
  /** Single-machine apply only. */
  job?: JobCreated;
}

export interface DNSAccount {
  id: string;
  owner_id: string;
  provider: string; // dnspod, cloudflare, desec, njalla, cloudns
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface DNSRecord {
  id: string;
  dns_domain_id: string; // References dns_managed_domains
  name: string; // subdomain: www, @, *
  record_type: string; // A, AAAA, CNAME, TXT, MX
  value: string;
  ttl: number;
  priority: number | null;
  proxied: boolean;
  http_incoming_port: number | null;
  http_outgoing_port: number | null;
  https_incoming_port: number | null;
  https_outgoing_port: number | null;
  remote_record_id: string | null;
  sync_status: string; // synced, pending, conflict, local_only, remote_only, error
  sync_error: string | null;
  last_synced_at: string | null;
  mode: string; // 'static' or 'dynamic'
  created_at: string;
  updated_at: string;
}

// DNS Passthrough (Dynamic rotation) types
export interface PassthroughPool {
  id: string;
  dns_record_id: string;
  target_ip: string;
  target_scheme: "http" | "https";
  target_port: number;       // HTTPS (443) target port
  target_port_http: number;  // HTTP (80) target port
  preserve_host: boolean;
  tls_verify_upstream: boolean;
  ssl_email: string;
  rotation_strategy: string; // 'round_robin' or 'random'
  rotation_mode: string; // 'interval' or 'scheduled'
  interval_minutes: number;
  scheduled_times: string[];
  health_check_enabled: boolean;
  proxy_protocol: boolean;   // Send PROXY protocol to backend
  current_machine_id: string | null;
  current_index: number;
  is_paused: boolean;
  last_rotated_at: string | null;
  group_ids: string[]; // Machine groups for dynamic membership
  created_at: string;
  updated_at: string;
}

export interface PassthroughMember {
  id: string;
  pool_id: string;
  machine_id: string;
  priority: number;
  is_enabled: boolean;
  nginx_config_applied: boolean;
  created_at: string;
  // Extended fields
  machine_name?: string;
  machine_ip?: string;
  last_seen?: string;
  is_online?: boolean;
}

export interface PassthroughPoolResponse {
  pool: PassthroughPool;
  members: PassthroughMember[];
  groups?: MachineGroupWithCount[];
}

export interface PassthroughPoolRequest {
  target_ip: string;
  target_scheme?: "http" | "https";
  target_port?: number;       // HTTPS (443) target port
  target_port_http?: number;  // HTTP (80) target port
  preserve_host?: boolean;
  tls_verify_upstream?: boolean;
  ssl_email?: string;
  rotation_strategy?: string;
  rotation_mode?: string;
  interval_minutes?: number;
  scheduled_times?: string[];
  health_check_enabled?: boolean;
  proxy_protocol?: boolean;   // Send PROXY protocol to backend
  machine_ids: string[];
  group_ids?: string[]; // Machine groups for dynamic membership
}

export interface WildcardPool {
  id: string;
  dns_domain_id: string;
  include_root: boolean;
  target_ip: string;
  target_scheme: "http" | "https";
  target_port: number;       // HTTPS (443) target port
  target_port_http: number;  // HTTP (80) target port
  preserve_host: boolean;
  tls_verify_upstream: boolean;
  ssl_email: string;
  rotation_strategy: string;
  rotation_mode: string;
  interval_minutes: number;
  scheduled_times: string[];
  health_check_enabled: boolean;
  proxy_protocol: boolean;   // Send PROXY protocol to backend
  current_machine_id: string | null;
  current_index: number;
  is_paused: boolean;
  last_rotated_at: string | null;
  group_ids: string[]; // Machine groups for dynamic membership
  created_at: string;
  updated_at: string;
}

export interface WildcardPoolMember {
  id: string;
  pool_id: string;
  machine_id: string;
  priority: number;
  is_enabled: boolean;
  nginx_config_applied: boolean;
  created_at: string;
  machine_name?: string;
  machine_ip?: string;
  last_seen?: string;
  is_online?: boolean;
}

export interface WildcardPoolResponse {
  pool: WildcardPool;
  members: WildcardPoolMember[];
  groups?: MachineGroupWithCount[];
}

export interface WildcardPoolRequest {
  include_root?: boolean;
  target_ip: string;
  target_scheme?: "http" | "https";
  target_port?: number;       // HTTPS (443) target port
  target_port_http?: number;  // HTTP (80) target port
  preserve_host?: boolean;
  tls_verify_upstream?: boolean;
  ssl_email?: string;
  rotation_strategy?: string;
  rotation_mode?: string;
  interval_minutes?: number;
  scheduled_times?: string[];
  health_check_enabled?: boolean;
  proxy_protocol?: boolean;   // Send PROXY protocol to backend
  machine_ids: string[];
  group_ids?: string[]; // Machine groups for dynamic membership
}

export interface RotationHistory {
  id: string;
  pool_type: string;
  pool_id: string;
  dns_domain_id: string | null;
  record_name: string | null;
  from_machine_id: string | null;
  from_ip: string;
  to_machine_id: string | null;
  to_ip: string;
  trigger: string; // 'scheduled', 'manual', 'health'
  rotated_at: string;
  from_machine_name?: string;
  to_machine_name?: string;
}

export interface L7CertificateStatus {
  id: string;
  machine_id: string;
  domain: string;
  status: string;
  expires_at: string | null;
  issuer: string | null;
  last_checked_at: string | null;
  last_job_id: string | null;
  last_error: string | null;
  machine_name: string;
  machine_ip: string;
}

export interface NSStatus {
  valid: boolean;
  status: string; // unknown, pending, valid, invalid, external
  expected: string[];
  actual: string[];
  message: string;
}

export interface DNSSyncResult {
  in_sync: boolean;
  created: DNSSyncRecord[];
  updated: DNSSyncRecord[];
  deleted: DNSSyncRecord[];
  conflicts: DNSConflict[];
  errors: string[];
}

export interface DNSSyncRecord {
  id: string;
  name: string;
  type: string;
  value: string;
  ttl: number;
  priority: number;
  proxied: boolean;
}

export interface DNSConflict {
  record_name: string;
  record_type: string;
  local_value: string;
  remote_value: string;
  remote_id: string;
  local_id: string;
}

export interface NginxConfig {
  id: string;
  name: string;
  mode: string;
  structured_json: NginxConfigStructured | null;
  raw_text: string | null;
  created_at: string;
  updated_at: string;
  /** Domains using this config (list + detail responses). */
  domains_count?: number;
  /** Assigned domains whose last successful apply is older than updated_at. */
  out_of_sync_count?: number;
  domains?: NginxConfigDomainRef[];
}

export interface NginxConfigStructured {
  // Passthrough mode - SSL passthrough proxy (Layer 4)
  is_passthrough?: boolean;       // If true, use stream proxy (SSL passthrough)
  passthrough_target?: string;    // Backend target for passthrough (host:port)
  passthrough_http_enabled?: boolean; // Enable manual passthrough listener/marker for port 80 (default: true)
  passthrough_http_port?: number; // Backend HTTP port for Host-based HTTP routing
  passthrough_proxy_protocol?: boolean; // Send PROXY protocol to HTTPS backend
  passthrough_http_client_max_body_size?: string; // client_max_body_size for the port 80 block (default: 100M, 0 = unlimited)
  passthrough_http_extra_directives?: string; // Extra raw directives inside location / of the port 80 block

  // Standard HTTP mode settings
  ssl_mode: string;
  ssl_email?: string; // Email for SSL certificate issuance
  locations: LocationConfig[];
  cors: CORSConfig | null;
  autoindex_off?: boolean;      // Deny directory listing (default: true)
  deny_all_catchall?: boolean;  // Add deny all catch-all for unmatched paths (default: true)

  // Proxy/Real IP settings
  proxy_settings?: ProxySettings;

  // Security settings
  ua_blocking_enabled?: boolean;       // Block requests from bad user agents
  endpoint_blocking_enabled?: boolean; // Block requests to non-allowed endpoints
}

export interface ProxySettings {
  enabled: boolean;
  proxy_type: 'cloudflare' | 'proxy_protocol' | 'custom';
  use_proxy_protocol?: boolean;   // Use PROXY protocol for listen directive
  proxy_protocol_port?: number;   // Custom port for PROXY protocol (default: 443)
  custom_trusted_ips?: string;    // Comma-separated trusted IPs for custom type
}

export interface LocationConfig {
  path: string;
  match_type?: string;  // prefix (default), exact, regex
  type: string;        // proxy, static
  static_type?: string; // local, landing (for static type)
  proxy_url?: string;
  root?: string;
  index?: string;
  landing_id?: string;  // UUID of landing page
  use_php?: boolean;    // Enable PHP-FPM for this location
  replace_landing_content?: boolean; // Whether to replace landing content on redeploy (default: true)
}

export interface CORSConfig {
  enabled: boolean;
  allow_all: boolean;
  allow_methods?: string[];
  allow_headers?: string[];
  allow_origins?: string[];
}

export interface AdminStats {
  total_users: number;
  total_machines: number;
  total_projects: number;
  online_machines: number;
  total_domains: number;
}

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem("auth_token");
    }
  }

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== "undefined") {
      if (token) {
        localStorage.setItem("auth_token", token);
      } else {
        localStorage.removeItem("auth_token");
      }
    }
  }

  getApiUrl(): string {
    return this.baseUrl;
  }

  getToken(): string | null {
    return this.token;
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText || "An error occurred");
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  // Setup
  async checkSetup(): Promise<SetupStatus> {
    return this.request<SetupStatus>("/api/setup/status");
  }

  async createFirstAdmin(data: CreateAdminRequest): Promise<{ message: string }> {
    return this.request<{ message: string }>("/api/setup/create-admin", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Auth
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (response.token) {
      this.setToken(response.token);
    }
    return response;
  }

  async register(data: RegisterRequest): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (response.token) {
      this.setToken(response.token);
    }
    return response;
  }

  async logout(): Promise<void> {
    this.setToken(null);
  }

  async getMe(): Promise<User> {
    return this.request<User>("/api/auth/me");
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  }

  async updateProfile(name: string): Promise<User> {
    return this.request<User>("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  }

  async setup2FA(): Promise<{ secret: string; qr_code: string; url: string }> {
    return this.request("/api/auth/2fa/setup", { method: "POST" });
  }

  async enable2FA(code: string): Promise<void> {
    await this.request("/api/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  async disable2FA(password: string): Promise<void> {
    await this.request("/api/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  }

  // Admin
  async getAdminStats(): Promise<AdminStats> {
    return this.request<AdminStats>("/api/admin/stats");
  }

  async listUsers(): Promise<UserWithDetails[]> {
    return this.request<UserWithDetails[]>("/api/admin/users");
  }

  async getUser(id: string): Promise<UserWithDetails> {
    return this.request<UserWithDetails>(`/api/admin/users/${id}`);
  }

  async createAdmin(email: string, password: string, name: string, role: string): Promise<User> {
    return this.request<User>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, name, role }),
    });
  }

  async updateUserRole(id: string, role: string): Promise<void> {
    await this.request(`/api/admin/users/${id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    });
  }

  async changeUserPassword(id: string, newPassword: string): Promise<void> {
    await this.request(`/api/admin/users/${id}/password`, {
      method: "PUT",
      body: JSON.stringify({ new_password: newPassword }),
    });
  }

  async resetUser2FA(id: string): Promise<void> {
    await this.request(`/api/admin/users/${id}/2fa`, { method: "DELETE" });
  }

  async deleteUser(id: string): Promise<void> {
    await this.request(`/api/admin/users/${id}`, { method: "DELETE" });
  }

  async resetMachineToken(machineId: string): Promise<void> {
    await this.request(`/api/admin/machines/${machineId}/token`, { method: "DELETE" });
  }

  // Projects
  async listProjects(): Promise<ProjectWithStats[]> {
    return this.request<ProjectWithStats[]>("/api/projects");
  }

  async getProject(id: string): Promise<ProjectWithStats> {
    return this.request<ProjectWithStats>(`/api/projects/${id}`);
  }

  async createProject(name: string): Promise<Project> {
    return this.request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async updateProject(id: string, data: { name?: string; notes_md?: string }): Promise<void> {
    await this.request(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.request(`/api/projects/${id}`, { method: "DELETE" });
  }

  async toggleProjectSharing(id: string, enabled: boolean): Promise<Project> {
    return this.request<Project>(`/api/projects/${id}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
  }

  async requestJoinProject(inviteToken: string): Promise<{ message: string; project_name: string }> {
    return this.request(`/api/projects/join`, {
      method: "POST",
      body: JSON.stringify({ invite_token: inviteToken }),
    });
  }

  async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
    return this.request<ProjectMember[]>(`/api/projects/${projectId}/members`);
  }

  async approveMember(projectId: string, memberId: string, role: string, canViewNotes: boolean): Promise<void> {
    await this.request(`/api/projects/${projectId}/members/${memberId}/approve`, {
      method: "POST",
      body: JSON.stringify({ role, can_view_notes: canViewNotes }),
    });
  }

  async denyMember(projectId: string, memberId: string): Promise<void> {
    await this.request(`/api/projects/${projectId}/members/${memberId}/deny`, { method: "POST" });
  }

  async updateMember(projectId: string, memberId: string, data: { role?: string; can_view_notes?: boolean }): Promise<void> {
    await this.request(`/api/projects/${projectId}/members/${memberId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    await this.request(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
  }

  // Machines
  async listMachines(search?: string, projectId?: string): Promise<Machine[]> {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (projectId) params.set("project_id", projectId);
    const query = params.toString();
    return this.request<Machine[]>(`/api/machines${query ? `?${query}` : ""}`);
  }

  async getMachine(id: string): Promise<Machine> {
    return this.request<Machine>(`/api/machines/${id}`);
  }

  async updateMachine(id: string, data: { title?: string; project_id?: string | null; notes_md?: string; primary_ip?: string }): Promise<void> {
    await this.request(`/api/machines/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async updateMachineNotes(id: string, notes: string): Promise<void> {
    await this.request(`/api/machines/${id}/notes`, {
      method: "PUT",
      body: JSON.stringify({ notes }),
    });
  }

  async deleteMachine(id: string): Promise<void> {
    await this.request(`/api/machines/${id}`, { method: "DELETE" });
  }

  async setMachineAccessToken(id: string, currentToken: string, newToken: string): Promise<void> {
    await this.request(`/api/machines/${id}/access-token`, {
      method: "PUT",
      body: JSON.stringify({ current_token: currentToken, new_token: newToken }),
    });
  }

  async verifyMachineAccessToken(id: string, token: string): Promise<{ valid: boolean }> {
    return this.request(`/api/machines/${id}/access-token/verify`, {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  // Machine Commands
  async changeSSHPort(id: string, port: number): Promise<Job> {
    return this.request<Job>(`/api/machines/${id}/ssh-port`, {
      method: "POST",
      body: JSON.stringify({ port }),
    });
  }

  async changeRootPassword(id: string, password: string): Promise<Job> {
    return this.request<Job>(`/api/machines/${id}/root-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  }

  async toggleUFW(id: string, enabled: boolean): Promise<Job> {
    return this.request<Job>(`/api/machines/${id}/ufw`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  }

  async addUFWRule(id: string, port: string, protocol: string): Promise<Job> {
    return this.request<Job>(`/api/machines/${id}/ufw/rules`, {
      method: "POST",
      body: JSON.stringify({ port, protocol }),
    });
  }

  async removeUFWRule(id: string, port: string, protocol: string): Promise<Job> {
    return this.request<Job>(`/api/machines/${id}/ufw/rules`, {
      method: "DELETE",
      body: JSON.stringify({ port, protocol }),
    });
  }

  async toggleFail2ban(id: string, enabled: boolean, config?: string): Promise<Job> {
    return this.request<Job>(`/api/machines/${id}/fail2ban`, {
      method: "POST",
      body: JSON.stringify({ enabled, config }),
    });
  }

  async getMachineLogs(machineId: string, logType: string, lines?: number): Promise<{ logs: string }> {
    const params = new URLSearchParams();
    params.set("type", logType);
    if (lines) params.set("lines", lines.toString());
    return this.request<{ logs: string }>(`/api/machines/${machineId}/logs?${params}`);
  }

  async execTerminalCommand(machineId: string, command: string): Promise<{ output: string; exit_code: number }> {
    return this.request<{ output: string; exit_code: number }>(`/api/machines/${machineId}/exec`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
  }

  // Speed Test / Tools
  async runSpeedTest(machineId: string, request: SpeedTestRequest): Promise<Job> {
    return this.request<Job>(`/api/machines/${machineId}/tools/speedtest`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async runSpeedTestSync(machineId: string, request: SpeedTestRequest): Promise<SpeedTestResult> {
    return this.request<SpeedTestResult>(`/api/machines/${machineId}/tools/speedtest/sync`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async getMachinesForSpeedTest(): Promise<SpeedTestMachine[]> {
    return this.request<SpeedTestMachine[]>("/api/machines/tools/list");
  }

  // Enrollment Tokens
  async listEnrollmentTokens(): Promise<EnrollmentToken[]> {
    return this.request<EnrollmentToken[]>("/api/enrollment-tokens");
  }

  async createEnrollmentToken(name?: string): Promise<EnrollmentToken> {
    return this.request<EnrollmentToken>("/api/enrollment-tokens", {
      method: "POST",
      body: JSON.stringify({ name: name || "" }),
    });
  }

  async deleteEnrollmentToken(id: string): Promise<void> {
    await this.request(`/api/enrollment-tokens/${id}`, { method: "DELETE" });
  }

  // Machine Groups
  async listMachineGroups(): Promise<MachineGroupWithCount[]> {
    return this.request<MachineGroupWithCount[]>("/api/machine-groups");
  }

  async createMachineGroup(data: { name: string; emoji?: string; color?: string }): Promise<MachineGroup> {
    return this.request<MachineGroup>("/api/machine-groups", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateMachineGroup(id: string, data: { name?: string; emoji?: string; color?: string; position?: number }): Promise<void> {
    await this.request(`/api/machine-groups/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteMachineGroup(id: string): Promise<void> {
    await this.request(`/api/machine-groups/${id}`, { method: "DELETE" });
  }

  async reorderMachineGroups(groupIds: string[]): Promise<void> {
    await this.request("/api/machine-groups/reorder", {
      method: "PUT",
      body: JSON.stringify({ group_ids: groupIds }),
    });
  }

  async getGroupMembers(groupId: string): Promise<MachineGroupMember[]> {
    return this.request<MachineGroupMember[]>(`/api/machine-groups/${groupId}/members`);
  }

  async addGroupMembers(groupId: string, machineIds: string[]): Promise<{ added: number }> {
    return this.request<{ added: number }>(`/api/machine-groups/${groupId}/members`, {
      method: "POST",
      body: JSON.stringify({ machine_ids: machineIds }),
    });
  }

  async setGroupMembers(groupId: string, machineIds: string[]): Promise<{ count: number }> {
    return this.request<{ count: number }>(`/api/machine-groups/${groupId}/members`, {
      method: "PUT",
      body: JSON.stringify({ machine_ids: machineIds }),
    });
  }

  async removeGroupMember(groupId: string, machineId: string): Promise<void> {
    await this.request(`/api/machine-groups/${groupId}/members/${machineId}`, { method: "DELETE" });
  }

  async reorderGroupMembers(groupId: string, machineIds: string[]): Promise<void> {
    await this.request(`/api/machine-groups/${groupId}/members/reorder`, {
      method: "PUT",
      body: JSON.stringify({ machine_ids: machineIds }),
    });
  }

  async getMachineGroups(machineId: string): Promise<MachineGroup[]> {
    return this.request<MachineGroup[]>(`/api/machines/${machineId}/groups`);
  }

  async setMachineGroups(machineId: string, groupIds: string[]): Promise<void> {
    await this.request(`/api/machines/${machineId}/groups`, {
      method: "PUT",
      body: JSON.stringify({ group_ids: groupIds }),
    });
  }

  // Domain Groups
  async listDomainGroups(): Promise<DomainGroupWithCount[]> {
    return this.request<DomainGroupWithCount[]>("/api/domain-groups");
  }

  async createDomainGroup(data: { name: string; emoji?: string; color?: string }): Promise<DomainGroup> {
    return this.request<DomainGroup>("/api/domain-groups", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDomainGroup(id: string, data: { name?: string; emoji?: string; color?: string; position?: number }): Promise<void> {
    await this.request(`/api/domain-groups/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteDomainGroup(id: string): Promise<void> {
    await this.request(`/api/domain-groups/${id}`, { method: "DELETE" });
  }

  async reorderDomainGroups(groupIds: string[]): Promise<void> {
    await this.request("/api/domain-groups/reorder", {
      method: "PUT",
      body: JSON.stringify({ group_ids: groupIds }),
    });
  }

  async getDomainGroupMembers(groupId: string): Promise<DomainGroupMember[]> {
    return this.request<DomainGroupMember[]>(`/api/domain-groups/${groupId}/members`);
  }

  async setDomainGroupMembers(groupId: string, domainIds: string[]): Promise<{ count: number }> {
    return this.request<{ count: number }>(`/api/domain-groups/${groupId}/members`, {
      method: "PUT",
      body: JSON.stringify({ domain_ids: domainIds }),
    });
  }

  async addDomainGroupMembers(groupId: string, domainIds: string[]): Promise<{ added: number }> {
    return this.request<{ added: number }>(`/api/domain-groups/${groupId}/members`, {
      method: "POST",
      body: JSON.stringify({ domain_ids: domainIds }),
    });
  }

  async removeDomainGroupMember(groupId: string, domainId: string): Promise<void> {
    await this.request(`/api/domain-groups/${groupId}/members/${domainId}`, { method: "DELETE" });
  }

  async reorderDomainGroupMembers(groupId: string, domainIds: string[]): Promise<void> {
    await this.request(`/api/domain-groups/${groupId}/members/reorder`, {
      method: "PUT",
      body: JSON.stringify({ domain_ids: domainIds }),
    });
  }

  async getDomainGroups(domainId: string): Promise<DomainGroup[]> {
    return this.request<DomainGroup[]>(`/api/domains/${domainId}/groups`);
  }

  async setDomainGroups(domainId: string, groupIds: string[]): Promise<void> {
    await this.request(`/api/domains/${domainId}/groups`, {
      method: "PUT",
      body: JSON.stringify({ group_ids: groupIds }),
    });
  }

  // Jobs
  /** Legacy helper: newest jobs (max 200, logs tail included) as a plain array. Prefer listJobsPage. */
  async listJobs(machineId?: string): Promise<Job[]> {
    const page = await this.listJobsPage({ machine_id: machineId, include_logs: true, limit: 200 });
    return page.jobs.map((j) => ({ ...j, agent_id: j.agent_id ?? "", payload_json: null, logs: j.logs ?? null }));
  }

  /** GET /api/jobs — filtered, permission-scoped, cursor-paginated list with status counts. */
  async listJobsPage(params: JobListParams = {}): Promise<JobListPage> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      if (key === "status" && Array.isArray(value)) {
        if (value.length) qs.set("status", value.join(","));
      } else if (key === "include_logs") {
        if (value) qs.set("include_logs", "1");
      } else {
        qs.set(key, String(value));
      }
    }
    const query = qs.toString();
    return this.request<JobListPage>(`/api/jobs${query ? `?${query}` : ""}`);
  }

  async getJob(id: string): Promise<Job> {
    return this.request<Job>(`/api/jobs/${id}`);
  }

  /** GET /api/jobs/{id} — full detail (logs + redacted payload + result_json). */
  async getJobDetail(id: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`);
  }

  /** Pending → cancelled immediately; running → cancel_requested. 409 when already finished. */
  async cancelJob(id: string): Promise<JobCancelResult> {
    return this.request<JobCancelResult>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  /** Clone a failed/cancelled job as a new pending job (parent_job_id = id). */
  async retryJob(id: string): Promise<JobCreated> {
    return this.request<JobCreated>(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
  }

  async getJobStats(hours = 24): Promise<JobStats> {
    return this.request<JobStats>(`/api/jobs/stats?hours=${encodeURIComponent(String(hours))}`);
  }

  // Dashboard
  async getDashboard(): Promise<DashboardSummary> {
    return this.request<DashboardSummary>("/api/dashboard");
  }

  // Machine nginx view
  /** Runs a read-only inventory job (waits ~20s). Pass jobId to fetch the result of a pending run. */
  async getMachineNginx(machineId: string, jobId?: string): Promise<MachineNginxInventory | MachineNginxPending> {
    const q = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
    return this.request<MachineNginxInventory | MachineNginxPending>(`/api/machines/${encodeURIComponent(machineId)}/nginx${q}`);
  }

  async testMachineNginx(machineId: string): Promise<NginxJobResult> {
    return this.request<NginxJobResult>(`/api/machines/${encodeURIComponent(machineId)}/nginx/test`, { method: "POST" });
  }

  /** Tests then reloads nginx. wait=false returns the created job immediately. */
  async reloadMachineNginx(machineId: string, wait = false): Promise<NginxJobResult | JobCreated> {
    return this.request<NginxJobResult | JobCreated>(
      `/api/machines/${encodeURIComponent(machineId)}/nginx/reload${wait ? "?wait=1" : ""}`,
      { method: "POST" },
    );
  }

  /** What Configuratix would write for a managed nginx file (rejects with a 404 message for unmanaged paths). */
  async getMachineNginxExpected(machineId: string, path: string): Promise<NginxExpectedFile> {
    return this.request<NginxExpectedFile>(
      `/api/machines/${encodeURIComponent(machineId)}/nginx/expected?path=${encodeURIComponent(path)}`,
    );
  }

  /** Re-apply an nginx config to every assigned domain using it (or a subset). */
  async applyNginxConfig(
    configId: string,
    opts: { domain_ids?: string[]; only_out_of_sync?: boolean } = {},
  ): Promise<NginxConfigApplyResult> {
    return this.request<NginxConfigApplyResult>(`/api/nginx-configs/${encodeURIComponent(configId)}/apply`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
  }

  // Domains
  async listDomains(): Promise<Domain[]> {
    return this.request<Domain[]>("/api/domains");
  }

  async getDomain(id: string): Promise<Domain> {
    return this.request<Domain>(`/api/domains/${id}`);
  }

  async createDomain(fqdn: string): Promise<Domain> {
    return this.request<Domain>("/api/domains", {
      method: "POST",
      body: JSON.stringify({ fqdn }),
    });
  }

  async assignDomain(id: string, machineId: string | null, configId: string | null): Promise<DomainJobsResponse> {
    const res = await this.request<DomainJobsResponse | null>(`/api/domains/${id}/assign`, {
      method: "PUT",
      body: JSON.stringify({ machine_id: machineId, config_id: configId }),
    });
    return res ?? {};
  }

  /** Re-apply the domain's nginx config on its machine (returns the created job(s)). */
  async applyDomain(id: string): Promise<DomainJobsResponse> {
    const res = await this.request<DomainJobsResponse | null>(`/api/domains/${id}/apply`, { method: "POST" });
    return res ?? {};
  }

  /** Returns `{deleted, jobs, warnings}` — assigned domains get a `remove_domain` job. */
  async deleteDomain(id: string): Promise<DomainJobsResponse & { deleted?: number; warnings?: string[] }> {
    const res = await this.request<(DomainJobsResponse & { deleted?: number; warnings?: string[] }) | null>(
      `/api/domains/${id}`,
      { method: "DELETE" }
    );
    return res ?? {};
  }

  async updateDomainNotes(id: string, notes: string): Promise<void> {
    await this.request(`/api/domains/${id}/notes`, {
      method: "PUT",
      body: JSON.stringify({ notes }),
    });
  }

  /** expectedHttpStatus 0 keeps the current value; path "" or "/" resets to "/", undefined leaves it unchanged. */
  async updateDomainHealthCheck(id: string, expectedHttpStatus: number, path?: string): Promise<void> {
    const body: Record<string, unknown> = { expected_http_status: expectedHttpStatus };
    if (path !== undefined) body.path = path;
    await this.request(`/api/domains/${id}/health-check`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async triggerDomainHealthCheck(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/api/domains/${id}/check`, { method: "POST" });
  }

  async bulkAssignDomains(
    domainIds: string[],
    machineId: string | null,
    configId: string | null
  ): Promise<{ ok: number; errors: { id: string; error: string }[] } & DomainJobsResponse> {
    return this.request("/api/domains/bulk/assign", {
      method: "POST",
      body: JSON.stringify({
        domain_ids: domainIds,
        machine_id: machineId,
        config_id: configId,
      }),
    });
  }

  async bulkDeleteDomains(domainIds: string[]): Promise<{ deleted: number; warnings?: string[] } & DomainJobsResponse> {
    return this.request<{ deleted: number; warnings?: string[] } & DomainJobsResponse>("/api/domains/bulk/delete", {
      method: "POST",
      body: JSON.stringify({ domain_ids: domainIds }),
    });
  }

  async bulkCheckDomains(
    domainIds: string[]
  ): Promise<{ results: { id: string; status?: string; error?: string }[] }> {
    return this.request("/api/domains/bulk/check", {
      method: "POST",
      body: JSON.stringify({ domain_ids: domainIds }),
    });
  }

  // DNS Accounts
  async listDNSAccounts(): Promise<DNSAccount[]> {
    return this.request<DNSAccount[]>("/api/dns-accounts");
  }

  async createDNSAccount(data: {
    provider: string;
    name: string;
    api_id?: string;
    api_token: string;
    is_default?: boolean;
  }): Promise<DNSAccount> {
    return this.request<DNSAccount>("/api/dns-accounts", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDNSAccount(id: string, data: {
    name?: string;
    api_id?: string;
    api_token?: string;
    is_default?: boolean;
  }): Promise<void> {
    await this.request(`/api/dns-accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteDNSAccount(id: string): Promise<void> {
    await this.request(`/api/dns-accounts/${id}`, { method: "DELETE" });
  }

  async testDNSAccount(id: string): Promise<{ valid: boolean; message: string }> {
    return this.request<{ valid: boolean; message: string }>(`/api/dns-accounts/${id}/test`, {
      method: "POST",
    });
  }

  async getExpectedNameservers(accountId: string, domain: string): Promise<{
    found: boolean;
    nameservers: string[];
    message: string;
    provider: string;
  }> {
    return this.request(`/api/dns-accounts/${accountId}/nameservers?domain=${encodeURIComponent(domain)}`);
  }

  // DNS Managed Domains (separate from main domains)
  async listDNSManagedDomains(): Promise<DNSManagedDomain[]> {
    return this.request<DNSManagedDomain[]>("/api/dns-domains");
  }

  async getDNSManagedDomain(id: string): Promise<DNSManagedDomain> {
    return this.request<DNSManagedDomain>(`/api/dns-domains/${id}`);
  }

  async createDNSManagedDomain(data: {
    fqdn: string;
    dns_account_id?: string;
  }): Promise<DNSManagedDomain> {
    return this.request<DNSManagedDomain>("/api/dns-domains", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDNSManagedDomain(id: string, data: {
    dns_account_id?: string | null;
    notes_md?: string;
    listener_protocol?: 'http_only' | 'http_and_https' | 'https_only';
  }): Promise<void> {
    await this.request(`/api/dns-domains/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteDNSManagedDomain(id: string): Promise<void> {
    await this.request(`/api/dns-domains/${id}`, { method: "DELETE" });
  }

  async checkDNSDomainNS(id: string): Promise<NSStatus> {
    return this.request<NSStatus>(`/api/dns-domains/${id}/ns-check`, {
      method: "POST",
    });
  }

  // DNS Records (for DNS Managed Domains)
  async listDNSRecords(dnsDomainId: string): Promise<DNSRecord[]> {
    return this.request<DNSRecord[]>(`/api/dns-domains/${dnsDomainId}/records`);
  }

  async createDNSRecord(dnsDomainId: string, data: {
    name: string;
    record_type: string;
    value: string;
    ttl?: number;
    priority?: number;
    proxied?: boolean;
    http_incoming_port?: number;
    http_outgoing_port?: number;
    https_incoming_port?: number;
    https_outgoing_port?: number;
  }): Promise<DNSRecord> {
    return this.request<DNSRecord>(`/api/dns-domains/${dnsDomainId}/records`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDNSRecord(dnsDomainId: string, recordId: string, data: {
    name: string;
    record_type: string;
    value: string;
    ttl?: number;
    priority?: number;
    proxied?: boolean;
    http_incoming_port?: number;
    http_outgoing_port?: number;
    https_incoming_port?: number;
    https_outgoing_port?: number;
  }): Promise<void> {
    await this.request(`/api/dns-domains/${dnsDomainId}/records/${recordId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteDNSRecord(dnsDomainId: string, recordId: string): Promise<void> {
    await this.request(`/api/dns-domains/${dnsDomainId}/records/${recordId}`, { method: "DELETE" });
  }

  // DNS Sync
  async compareDNSRecords(dnsDomainId: string): Promise<DNSSyncResult> {
    return this.request<DNSSyncResult>(`/api/dns-domains/${dnsDomainId}/sync`);
  }

  async applyDNSToRemote(dnsDomainId: string): Promise<DNSSyncResult> {
    return this.request<DNSSyncResult>(`/api/dns-domains/${dnsDomainId}/sync/apply`, {
      method: "POST",
    });
  }

  async importDNSFromRemote(dnsDomainId: string): Promise<{ imported: number; message: string }> {
    return this.request<{ imported: number; message: string }>(`/api/dns-domains/${dnsDomainId}/sync/import`, {
      method: "POST",
    });
  }

  async lookupDNS(dnsDomainId: string, subdomain?: string): Promise<{
    domain: string;
    subdomain: string;
    lookup: string;
    results: Record<string, { type: string; records: string[]; error?: string }>;
  }> {
    const params = subdomain ? `?subdomain=${encodeURIComponent(subdomain)}` : "";
    return this.request(`/api/dns-domains/${dnsDomainId}/lookup${params}`);
  }

  async listRemoteRecords(dnsDomainId: string): Promise<{
    domain: string;
    provider: string;
    records: Array<{
      id: string;
      name: string;
      type: string;
      value: string;
      ttl: number;
      priority: number;
      proxied: boolean;
    }>;
  }> {
    return this.request(`/api/dns-domains/${dnsDomainId}/remote-records`);
  }

  // DNS Passthrough (Dynamic rotation)
  async getDomainProxyMode(domainId: string): Promise<{ proxy_mode: string }> {
    return this.request(`/api/dns-domains/${domainId}/proxy-mode`);
  }

  async setDomainProxyMode(domainId: string, proxyMode: string): Promise<void> {
    return this.request(`/api/dns-domains/${domainId}/proxy-mode`, {
      method: "PUT",
      body: JSON.stringify({ proxy_mode: proxyMode }),
    });
  }

  async listDomainL7Certificates(domainId: string): Promise<L7CertificateStatus[]> {
    return this.request(`/api/dns-domains/${domainId}/l7-certificates`);
  }

  async issueDomainL7Certificates(domainId: string): Promise<PassthroughJobsResponse> {
    return this.request(`/api/dns-domains/${domainId}/l7-certificates/issue`, {
      method: "POST",
    });
  }

  // Record pool (for separate mode)
  async getRecordPool(recordId: string): Promise<PassthroughPoolResponse> {
    return this.request(`/api/dns/records/${recordId}/passthrough`);
  }

  async createOrUpdateRecordPool(recordId: string, data: PassthroughPoolRequest): Promise<PassthroughPool> {
    return this.request(`/api/dns/records/${recordId}/passthrough`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteRecordPool(recordId: string): Promise<void> {
    return this.request(`/api/dns/records/${recordId}/passthrough`, { method: "DELETE" });
  }

  async rotateRecordPool(poolId: string): Promise<void> {
    return this.request(`/api/dns/passthrough/${poolId}/rotate`, { method: "POST" });
  }

  async pauseRecordPool(poolId: string): Promise<void> {
    return this.request(`/api/dns/passthrough/${poolId}/pause`, { method: "POST" });
  }

  async resumeRecordPool(poolId: string): Promise<void> {
    return this.request(`/api/dns/passthrough/${poolId}/resume`, { method: "POST" });
  }

  async getRotationHistory(poolId: string): Promise<RotationHistory[]> {
    return this.request(`/api/dns/passthrough/${poolId}/history`);
  }

  async getRecordPoolHistory(poolId: string): Promise<RotationHistory[]> {
    return this.request(`/api/dns/passthrough/${poolId}/history`);
  }

  // Wildcard pool (for wildcard mode)
  async getWildcardPool(domainId: string): Promise<WildcardPoolResponse> {
    return this.request(`/api/dns-domains/${domainId}/wildcard`);
  }

  async createOrUpdateWildcardPool(domainId: string, data: WildcardPoolRequest): Promise<WildcardPool> {
    return this.request(`/api/dns-domains/${domainId}/wildcard`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteWildcardPool(domainId: string): Promise<void> {
    return this.request(`/api/dns-domains/${domainId}/wildcard`, { method: "DELETE" });
  }

  async rotateWildcardPool(poolId: string): Promise<void> {
    return this.request(`/api/dns/wildcard/${poolId}/rotate`, { method: "POST" });
  }

  async pauseWildcardPool(poolId: string): Promise<void> {
    return this.request(`/api/dns/wildcard/${poolId}/pause`, { method: "POST" });
  }

  async resumeWildcardPool(poolId: string): Promise<void> {
    return this.request(`/api/dns/wildcard/${poolId}/resume`, { method: "POST" });
  }

  async getWildcardPoolHistory(poolId: string): Promise<RotationHistory[]> {
    return this.request(`/api/dns/wildcard/${poolId}/history`);
  }

  // Regenerate nginx passthrough configs for all pool members
  async regeneratePoolConfigs(poolId: string, isWildcard: boolean): Promise<PassthroughJobsResponse> {
    return this.request(`/api/dns/passthrough/${poolId}/apply-nginx?wildcard=${isWildcard}`, { method: "POST" });
  }

  /** Push the generated passthrough nginx config to one machine (needs manage rights). */
  async applyMachinePassthroughNginx(machineId: string): Promise<PassthroughJobsResponse> {
    return this.request(`/api/dns/passthrough/nginx/${encodeURIComponent(machineId)}/apply`, { method: "POST" });
  }

  // Nginx Configs
  async listNginxConfigs(): Promise<NginxConfig[]> {
    return this.request<NginxConfig[]>("/api/nginx-configs");
  }

  async getNginxConfig(id: string): Promise<NginxConfig> {
    return this.request<NginxConfig>(`/api/nginx-configs/${id}`);
  }

  async createNginxConfig(data: {
    name: string;
    mode?: string;
    structured_json?: NginxConfigStructured;
    raw_text?: string;
  }): Promise<NginxConfig> {
    return this.request<NginxConfig>("/api/nginx-configs", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateNginxConfig(id: string, data: {
    name?: string;
    mode?: string;
    structured_json?: NginxConfigStructured;
    raw_text?: string;
  }): Promise<NginxConfig> {
    return this.request<NginxConfig>(`/api/nginx-configs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteNginxConfig(id: string): Promise<void> {
    await this.request(`/api/nginx-configs/${id}`, { method: "DELETE" });
  }

  // Commands (Templates)
  async listCommands(): Promise<CommandTemplate[]> {
    return this.request<CommandTemplate[]>("/api/commands");
  }

  async getCommand(id: string): Promise<CommandTemplate> {
    return this.request<CommandTemplate>(`/api/commands/${id}`);
  }

  async executeCommand(machineId: string, commandId: string, variables: Record<string, string>): Promise<Job> {
    return this.request<Job>("/api/commands/execute", {
      method: "POST",
      body: JSON.stringify({
        machine_id: machineId,
        command_id: commandId,
        variables,
      }),
    });
  }

  // Landings
  async listLandings(): Promise<Landing[]> {
    return this.request<Landing[]>("/api/static");
  }

  async getLanding(id: string): Promise<Landing> {
    return this.request<Landing>(`/api/static/${id}`);
  }

  async uploadLanding(name: string, file: File): Promise<Landing> {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("file", file);
    // Type is auto-detected by backend from ZIP contents

    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/static`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText || "Upload failed");
    }

    return response.json();
  }

  async updateLanding(id: string, data: { name?: string; type?: string }): Promise<void> {
    await this.request(`/api/static/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteLanding(id: string): Promise<void> {
    await this.request(`/api/static/${id}`, { method: "DELETE" });
  }

  async downloadStatic(id: string, fileName: string): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/static/${id}/download`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error("Download failed");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  // Machine Configs (file editing)
  async listMachineConfigs(machineId: string): Promise<ConfigListResponse> {
    return this.request<ConfigListResponse>(`/api/machines/${machineId}/configs`);
  }

  async createConfigCategory(machineId: string, data: { name: string; emoji?: string; color?: string }): Promise<void> {
    await this.request(`/api/machines/${machineId}/configs/categories`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteConfigCategory(machineId: string, categoryId: string): Promise<void> {
    await this.request(`/api/machines/${machineId}/configs/categories/${categoryId}`, {
      method: "DELETE",
    });
  }

  async updateConfigCategory(machineId: string, categoryId: string, data: { name: string; emoji: string; color: string }): Promise<void> {
    await this.request(`/api/machines/${machineId}/configs/categories/${categoryId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async updateConfigPath(machineId: string, categoryId: string, pathId: string, data: { name: string; path: string; file_type: string; reload_command?: string }): Promise<void> {
    await this.request(`/api/machines/${machineId}/configs/categories/${categoryId}/paths/${pathId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // Agent Update APIs
  async getAgentVersion(): Promise<{ version: string; checksum: string; size: number; updated_at: string }> {
    return this.request("/api/agent/version");
  }

  async triggerMachineUpdate(machineId: string): Promise<{ job_id: string; machine_id: string; status: string }> {
    return this.request(`/api/machines/${machineId}/update-agent`, { method: "POST" });
  }

  async triggerAllAgentUpdates(): Promise<{ latest_version: string; agents_found: number; jobs_created: number }> {
    return this.request("/api/admin/agent/update-all", { method: "POST" });
  }

  async rebuildAgent(): Promise<{ version: string; checksum: string; size: number }> {
    return this.request("/api/admin/agent/rebuild", { method: "POST" });
  }

  async addConfigPath(machineId: string, categoryId: string, data: { 
    name: string; 
    path: string; 
    file_type?: string; 
    reload_command?: string;
  }): Promise<void> {
    await this.request(`/api/machines/${machineId}/configs/categories/${categoryId}/paths`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async removeConfigPath(machineId: string, categoryId: string, pathId: string): Promise<void> {
    await this.request(`/api/machines/${machineId}/configs/categories/${categoryId}/paths/${pathId}`, {
      method: "DELETE",
    });
  }

  async readMachineConfig(machineId: string, path: string): Promise<{ content: string; path: string }> {
    return this.request<{ content: string; path: string }>(`/api/machines/${machineId}/configs/read`, {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  }

  async writeMachineConfig(machineId: string, path: string, content: string): Promise<{ success: boolean; logs: string }> {
    return this.request<{ success: boolean; logs: string }>(`/api/machines/${machineId}/configs/write`, {
      method: "POST",
      body: JSON.stringify({ path, content }),
    });
  }

  // Fast File Operations (via WebSocket-based agent file module)
  async listDirectory(machineId: string, path: string, recursive = false): Promise<FileOperationResult> {
    return this.request<FileOperationResult>(`/api/machines/${machineId}/files/list?path=${encodeURIComponent(path)}&recursive=${recursive}`);
  }

  async readFileFast(machineId: string, path: string): Promise<FileOperationResult> {
    return this.request<FileOperationResult>(`/api/machines/${machineId}/files/read?path=${encodeURIComponent(path)}`);
  }

  async writeFileFast(machineId: string, path: string, content: string): Promise<FileOperationResult> {
    return this.request<FileOperationResult>(`/api/machines/${machineId}/files/write`, {
      method: "POST",
      body: JSON.stringify({ path, content }),
    });
  }

  async fileExists(machineId: string, path: string): Promise<FileOperationResult> {
    return this.request<FileOperationResult>(`/api/machines/${machineId}/files/exists?path=${encodeURIComponent(path)}`);
  }

  async getFileSessionStatus(machineId: string): Promise<{ connected: boolean }> {
    return this.request<{ connected: boolean }>(`/api/machines/${machineId}/files/status`);
  }

  // PHP Runtimes
  async getPHPRuntime(machineId: string): Promise<PHPRuntimeResponse> {
    return this.request<PHPRuntimeResponse>(`/api/machines/${machineId}/php`);
  }

  async installPHPRuntime(machineId: string, version: string, extensions: string[]): Promise<{ message: string; job_id: string }> {
    return this.request<{ message: string; job_id: string }>(`/api/machines/${machineId}/php`, {
      method: "POST",
      body: JSON.stringify({ version, extensions }),
    });
  }

  async updatePHPRuntime(machineId: string, version: string, extensions: string[]): Promise<{ message: string; job_id: string }> {
    return this.request<{ message: string; job_id: string }>(`/api/machines/${machineId}/php`, {
      method: "PUT",
      body: JSON.stringify({ version, extensions }),
    });
  }

  async removePHPRuntime(machineId: string): Promise<{ message: string; job_id: string }> {
    return this.request<{ message: string; job_id: string }>(`/api/machines/${machineId}/php`, {
      method: "DELETE",
    });
  }

  async getPHPRuntimeInfo(machineId: string): Promise<{ message: string; job_id: string }> {
    return this.request<{ message: string; job_id: string }>(`/api/machines/${machineId}/php/info`);
  }

  async listPHPExtensions(): Promise<{ extensions: string[]; versions: string[] }> {
    return this.request<{ extensions: string[]; versions: string[] }>("/api/php/extensions");
  }

  async listPHPExtensionTemplates(): Promise<PHPExtensionTemplate[]> {
    return this.request<PHPExtensionTemplate[]>("/api/php/templates");
  }

  // ============================================================
  // Security Module
  // ============================================================

  // IP Bans
  async listSecurityBans(params?: {
    page?: number;
    page_size?: number;
    search?: string;
    reason?: string;
    machine_id?: string;
    active_only?: boolean;
  }): Promise<BanListPage> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.reason) searchParams.set("reason", params.reason);
    if (params?.machine_id) searchParams.set("machine_id", params.machine_id);
    if (params?.active_only) searchParams.set("active_only", "true");
    const query = searchParams.toString();
    return this.request(`/api/security/bans${query ? "?" + query : ""}`);
  }

  /** Download all bans matching the filters (streamed; no page limit). csv or txt (one IP per line). */
  async exportSecurityBans(params: {
    format?: "csv" | "txt";
    active_only?: boolean;
    search?: string;
    reason?: string;
    machine_id?: string;
  } = {}): Promise<Blob> {
    const qs = new URLSearchParams({ format: params.format ?? "csv" });
    if (params.active_only) qs.set("active_only", "true");
    if (params.search) qs.set("search", params.search);
    if (params.reason) qs.set("reason", params.reason);
    if (params.machine_id) qs.set("machine_id", params.machine_id);
    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}/api/security/bans/export?${qs.toString()}`, { headers });
    if (!response.ok) {
      throw new Error((await response.text()) || response.statusText || "Export failed");
    }
    return response.blob();
  }

  async createSecurityBan(data: CreateBanRequest): Promise<SecurityIPBan> {
    return this.request("/api/security/bans", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async importSecurityBans(data: { 
    ips?: string[]; 
    reason?: string;
    csv?: Array<{
      ip_address: string;
      reason: string;
      user_agent: string;
      path: string;
      expires_at: string;
      banned_at: string;
    }>;
  }): Promise<ImportBansResponse> {
    return this.request("/api/security/bans/import", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteSecurityBan(id: string): Promise<void> {
    await this.request(`/api/security/bans/${id}`, { method: "DELETE" });
  }

  async deleteAllSecurityBans(): Promise<{ unbanned: number }> {
    return this.request("/api/security/bans", { method: "DELETE" });
  }

  // Whitelist
  async listSecurityWhitelist(): Promise<SecurityIPWhitelist[]> {
    return this.request("/api/security/whitelist");
  }

  async createSecurityWhitelistEntry(data: { ip_cidr: string; description?: string }): Promise<SecurityIPWhitelist> {
    return this.request("/api/security/whitelist", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteSecurityWhitelistEntry(id: string): Promise<void> {
    await this.request(`/api/security/whitelist/${id}`, { method: "DELETE" });
  }

  // UA Patterns
  async listSecurityUAPatterns(): Promise<UAPatternsByCategory[]> {
    return this.request("/api/security/ua-patterns");
  }

  async createSecurityUAPattern(data: {
    category: string;
    pattern: string;
    match_type?: string;
    description?: string;
  }): Promise<SecurityUAPattern> {
    return this.request("/api/security/ua-patterns", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteSecurityUAPattern(id: string): Promise<void> {
    await this.request(`/api/security/ua-patterns/${id}`, { method: "DELETE" });
  }

  async toggleSecurityUACategory(category: string, enabled: boolean): Promise<void> {
    await this.request(`/api/security/ua-categories/${category}`, {
      method: "PUT",
      body: JSON.stringify({ is_enabled: enabled }),
    });
  }

  // Per-config security settings
  async getSecuritySettings(configId: string): Promise<SecurityConfigSettings> {
    return this.request(`/api/nginx-configs/${configId}/security`);
  }

  async updateSecuritySettings(configId: string, data: Partial<SecurityConfigSettings>): Promise<SecurityConfigSettings> {
    return this.request(`/api/nginx-configs/${configId}/security`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async listSecurityEndpointRules(configId: string): Promise<SecurityEndpointRule[]> {
    return this.request(`/api/nginx-configs/${configId}/security/endpoints`);
  }

  async createSecurityEndpointRule(configId: string, data: {
    pattern: string;
    description?: string;
    priority?: number;
  }): Promise<SecurityEndpointRule> {
    return this.request(`/api/nginx-configs/${configId}/security/endpoints`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteSecurityEndpointRule(configId: string, ruleId: string): Promise<void> {
    await this.request(`/api/nginx-configs/${configId}/security/endpoints/${ruleId}`, {
      method: "DELETE",
    });
  }

  // Per-machine security settings
  async getMachineSecuritySettings(machineId: string): Promise<SecurityMachineSettings> {
    return this.request(`/api/machines/${machineId}/security`);
  }

  async updateMachineSecuritySettings(machineId: string, data: Partial<SecurityMachineSettings>): Promise<SecurityMachineSettings> {
    return this.request(`/api/machines/${machineId}/security`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // Stats
  async getSecurityStats(): Promise<SecurityStats> {
    return this.request("/api/security/stats");
  }

  // Tracker
  async listTrackerCategories(): Promise<TrackerCategoryWithCount[]> {
    return this.request("/api/tracker/categories");
  }

  async createTrackerCategory(data: { name: string; icon?: string; color?: string; notify_days_before?: number; identifier_label?: string }): Promise<TrackerCategory> {
    return this.request("/api/tracker/categories", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTrackerCategory(id: string, data: { name?: string; icon?: string; color?: string; position?: number; notify_days_before?: number; identifier_label?: string }): Promise<void> {
    await this.request(`/api/tracker/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteTrackerCategory(id: string): Promise<void> {
    await this.request(`/api/tracker/categories/${id}`, { method: "DELETE" });
  }

  async reorderTrackerCategories(categoryIds: string[]): Promise<void> {
    await this.request("/api/tracker/categories/reorder", {
      method: "PUT",
      body: JSON.stringify({ category_ids: categoryIds }),
    });
  }

  async listTrackerCategoryTags(categoryId: string): Promise<TrackerTag[]> {
    return this.request(`/api/tracker/categories/${categoryId}/tags`);
  }

  async createTrackerCategoryTag(categoryId: string, data: { name: string; color?: string }): Promise<TrackerTag> {
    return this.request(`/api/tracker/categories/${categoryId}/tags`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTrackerTag(id: string, data: { name?: string; color?: string }): Promise<TrackerTag> {
    return this.request(`/api/tracker/tags/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteTrackerTag(id: string): Promise<void> {
    await this.request(`/api/tracker/tags/${id}`, { method: "DELETE" });
  }

  async listTrackerResources(q?: string): Promise<TrackerResource[]> {
    const params = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    return this.request(`/api/tracker/resources${params}`);
  }

  async getTrackerResource(id: string): Promise<TrackerResource> {
    return this.request(`/api/tracker/resources/${id}`);
  }

  async createTrackerResource(data: { name: string; url?: string | null; notes_md?: string | null }): Promise<TrackerResource> {
    return this.request("/api/tracker/resources", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTrackerResource(id: string, data: Partial<{ name: string; url: string | null; notes_md: string | null }>): Promise<TrackerResource> {
    return this.request(`/api/tracker/resources/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteTrackerResource(id: string): Promise<void> {
    await this.request(`/api/tracker/resources/${id}`, { method: "DELETE" });
  }

  async listTrackerItems(categoryId?: string): Promise<TrackerItemWithCategory[]> {
    const params = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : "";
    return this.request(`/api/tracker/items${params}`);
  }

  async getTrackerItem(id: string): Promise<TrackerItemWithCategory> {
    return this.request(`/api/tracker/items/${id}`);
  }

  async createTrackerItem(data: {
    name: string;
    resource_id?: string | null;
    resource_name?: string;
    identifier_value?: string;
    category_id?: string | null;
    tag_ids?: string[];
    purchase_time?: string | null;
    order_date?: string | null;
    expiry_at?: string | null;
    recurring_period_type?: string | null;
    recurring_period_days?: number | null;
    price_usd?: number | null;
    notes_md?: string | null;
  }): Promise<TrackerItem> {
    return this.request("/api/tracker/items", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTrackerItem(id: string, data: Partial<{
    name: string;
    identifier_value: string;
    resource_id: string | null;
    category_id: string | null;
    tag_ids: string[];
    purchase_time: string | null;
    order_date: string | null;
    expiry_at: string | null;
    recurring_period_type: string | null;
    recurring_period_days: number | null;
    price_usd: number | null;
    notes_md: string | null;
  }>): Promise<void> {
    await this.request(`/api/tracker/items/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteTrackerItem(id: string): Promise<void> {
    await this.request(`/api/tracker/items/${id}`, { method: "DELETE" });
  }

  async recordTrackerPaid(id: string, data: {
    expiry_at?: string | null;
    recurring_period_type?: string | null;
    recurring_period_days?: number | null;
    amount_usd?: number | null;
  }): Promise<TrackerItem> {
    return this.request(`/api/tracker/items/${id}/paid`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async listTrackerRenewals(itemId: string): Promise<TrackerRenewal[]> {
    return this.request(`/api/tracker/items/${itemId}/renewals`);
  }

  async listTrackerNotifications(unreadOnly?: boolean): Promise<TrackerNotificationWithItem[]> {
    const params = unreadOnly ? "?unread_only=true" : "";
    return this.request(`/api/tracker/notifications${params}`);
  }

  async markTrackerNotificationRead(id: string): Promise<void> {
    await this.request(`/api/tracker/notifications/${id}/read`, { method: "POST" });
  }

  async markAllTrackerNotificationsRead(): Promise<void> {
    await this.request("/api/tracker/notifications/read-all", { method: "POST" });
  }

  async getTrackerDashboard(): Promise<TrackerDashboardSummary> {
    return this.request("/api/tracker/dashboard");
  }
}

export interface PHPRuntime {
  id: string;
  machine_id: string;
  version: string;
  extensions: string[];
  status: string; // pending, installing, installed, failed, removing
  socket_path: string | null;
  error_message: string | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PHPRuntimeResponse {
  installed: boolean;
  runtime?: PHPRuntime;
}

export interface PHPExtensionTemplate {
  id: string;
  name: string;
  description: string | null;
  extensions: string[];
  is_default: boolean;
  created_at: string;
}

export interface ConfigFile {
  id?: string; // Only set for custom paths (from DB)
  name: string;
  path: string;
  type: string; // nginx, nginx_site, php, ssh, text
  file_type?: string; // alias for type
  readonly: boolean;
  reload_command?: string;
}

export interface ConfigPath {
  id: string;
  name: string;
  path: string;
  file_type: string;
  reload_command?: string;
}

// Fast file operations (via agent file module)
export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mode: string;
  mod_time: string;
}

export interface FileOperationResult {
  id: string;
  type: string;
  path?: string;
  content?: string;
  result?: FileInfo[] | boolean | FileInfo;
  error?: string;
  success: boolean;
}

export interface ConfigSubcategory {
  id: string;
  name: string;
  files: ConfigFile[];
}

export interface ConfigCategory {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description?: string;
  is_built_in: boolean;
  subcategories?: ConfigSubcategory[];
  files?: ConfigFile[];
}

export interface ConfigListResponse {
  categories: ConfigCategory[];
}

// ============================================================
// Security Module Types
// ============================================================

export interface SecurityIPBan {
  id: string;
  ip_address: string;
  source_machine_id?: string;
  reason: string;
  details: Record<string, unknown>;
  banned_at: string;
  expires_at: string;
  created_by?: string;
  is_active: boolean;
  unbanned_at?: string;
  source_machine_name?: string;
  created_by_email?: string;
}

export interface BanListPage {
  bans: SecurityIPBan[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CreateBanRequest {
  ip_address: string;
  reason?: string;
  details?: Record<string, unknown>;
  expires_in_days?: number;
}

export interface ImportBansResponse {
  imported: number;
  skipped_whitelist: number;
  already_banned: number;
  invalid: number;
  skipped_ips?: string[];
}

export interface SecurityIPWhitelist {
  id: string;
  owner_id: string;
  ip_cidr: string;
  description: string;
  created_at: string;
}

export interface SecurityUAPattern {
  id: string;
  owner_id?: string;
  category: string;
  pattern: string;
  match_type: string;
  description: string;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
}

export interface UAPatternsByCategory {
  category: string;
  is_enabled: boolean;
  pattern_count: number;
  patterns: SecurityUAPattern[];
}

export interface SecurityEndpointRule {
  id: string;
  nginx_config_id: string;
  pattern: string;
  description: string;
  priority: number;
  is_active: boolean;
  created_at: string;
}

export interface SecurityConfigSettings {
  id: string;
  nginx_config_id: string;
  ua_blocking_enabled: boolean;
  endpoint_blocking_enabled: boolean;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface SecurityMachineSettings {
  id: string;
  machine_id: string;
  nftables_enabled: boolean;
  last_sync_at?: string;
  ban_count: number;
  created_at: string;
  updated_at: string;
}

export interface SecurityStats {
  total_bans: number;
  active_bans: number;
  bans_today: number;
  bans_this_week: number;
  top_reasons: { reason: string; count: number }[];
  top_machines: { machine_id: string; machine_name: string; count: number }[];
  whitelist_count: number;
  ua_pattern_count: number;
}

export interface NftablesState {
  enabled: boolean;
  ban_count: number;
  table_exists: boolean;
  set_exists: boolean;
  rule_exists: boolean;
  last_error?: string;
  checked_at: string;
}

// Speed Test / Tools Types
export interface SpeedTestRequest {
  type: "public" | "download" | "upload" | "iperf_server" | "iperf_client" | "latency" | "network_info" | "machine_download" | "serve";
  url?: string;
  target_ip?: string;
  port?: number;
  size_mb?: number;
  duration?: number;
  reverse?: boolean;
  count?: number;
}

export interface SpeedTestResult {
  job_id: string;
  status: string;
  type: string;
  logs: string;
  finished: boolean;
}

export interface SpeedTestMachine {
  id: string;
  title: string | null;
  hostname: string | null;
  ip_address: string | null;
  primary_ip: string | null;
  is_online: boolean;
}

// Tracker (subscriptions, servers, domains)
export interface TrackerCategory {
  id: string;
  owner_id: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  notify_days_before: number;
  identifier_label: string;
  created_at: string;
  updated_at: string;
}

export interface TrackerCategoryWithCount extends TrackerCategory {
  item_count: number;
}

export interface TrackerTag {
  id: string;
  owner_id: string;
  category_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface TrackerResource {
  id: string;
  owner_id: string;
  name: string;
  url: string | null;
  notes_md: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerItem {
  id: string;
  owner_id: string;
  category_id: string | null;
  name: string;
  identifier_value: string;
  resource_id: string | null;
  purchase_time: string | null;
  order_date: string | null;
  expiry_at: string | null;
  recurring_period_type: string | null;
  recurring_period_days: number | null;
  price_usd: number | null;
  notes_md: string | null;
  last_notified_at: string | null;
  next_notification_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerItemTagRef {
  id: string;
  name: string;
  color: string;
}

export interface TrackerItemWithCategory extends TrackerItem {
  category_name?: string | null;
  category_icon?: string | null;
  category_color?: string | null;
  category_identifier_label?: string | null;
  resource_name?: string | null;
  resource_url?: string | null;
  tags?: TrackerItemTagRef[];
}

export interface TrackerRenewal {
  id: string;
  item_id: string;
  renewed_at: string;
  expiry_before: string | null;
  expiry_after: string;
  amount_usd: number | null;
  created_at: string;
}

export interface TrackerNotification {
  id: string;
  owner_id: string;
  item_id: string | null;
  title: string;
  body: string | null;
  type: string;
  read_at: string | null;
  created_at: string;
}

export interface TrackerNotificationWithItem extends TrackerNotification {
  item_name?: string | null;
}

export interface TrackerDashboardSummary {
  monthly_recurring_expense: number;
  total_spent: number;
  closest_payment: TrackerItem | null;
  due_soon_count: number;
  overdue_count: number;
}

export const api = new ApiClient(API_URL);
