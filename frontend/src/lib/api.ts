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

export interface Machine {
  id: string;
  agent_id: string | null;
  owner_id: string | null;
  project_id: string | null;
  title: string | null;
  hostname: string | null;
  ip_address: string | null;
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

export interface Job {
  id: string;
  agent_id: string;
  type: string;
  payload_json: unknown;
  status: string;
  logs: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
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
  notes_md: string | null;
  last_check_at: string | null;
  created_at: string;
  updated_at: string;
  machine_name: string | null;
  machine_ip: string | null;
  config_id: string | null;
  config_name: string | null;
}

// DNS Managed Domain - completely separate from main domains
export interface DNSManagedDomain {
  id: string;
  owner_id: string;
  fqdn: string;
  dns_account_id: string | null;
  ns_status: string; // unknown, pending, valid, invalid
  ns_last_check: string | null;
  ns_expected: string[] | null;
  ns_actual: string[] | null;
  notes_md: string | null;
  created_at: string;
  updated_at: string;
  dns_account_name?: string | null;
  dns_account_provider?: string | null;
}

export interface DNSAccount {
  id: string;
  owner_id: string;
  provider: string; // dnspod, cloudflare
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
  created_at: string;
  updated_at: string;
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
}

export interface NginxConfigStructured {
  // Passthrough mode - SSL passthrough proxy (Layer 4)
  is_passthrough?: boolean;       // If true, use stream proxy (SSL passthrough)
  passthrough_target?: string;    // Backend target for passthrough (host:port)

  // Standard HTTP mode settings
  ssl_mode: string;
  ssl_email?: string; // Email for SSL certificate issuance
  locations: LocationConfig[];
  cors: CORSConfig | null;
  autoindex_off?: boolean;      // Deny directory listing (default: true)
  deny_all_catchall?: boolean;  // Add deny all catch-all for unmatched paths (default: true)
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

  async updateMachine(id: string, data: { title?: string; project_id?: string | null; notes_md?: string }): Promise<void> {
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
  async listMachineGroups(): Promise<MachineGroup[]> {
    return this.request<MachineGroup[]>("/api/machine-groups");
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

  // Jobs
  async listJobs(machineId?: string): Promise<Job[]> {
    const params = machineId ? `?machine_id=${machineId}` : "";
    return this.request<Job[]>(`/api/jobs${params}`);
  }

  async getJob(id: string): Promise<Job> {
    return this.request<Job>(`/api/jobs/${id}`);
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

  async assignDomain(id: string, machineId: string | null, configId: string | null): Promise<void> {
    await this.request(`/api/domains/${id}/assign`, {
      method: "PUT",
      body: JSON.stringify({ machine_id: machineId, config_id: configId }),
    });
  }

  async deleteDomain(id: string): Promise<void> {
    await this.request(`/api/domains/${id}`, { method: "DELETE" });
  }

  async updateDomainNotes(id: string, notes: string): Promise<void> {
    await this.request(`/api/domains/${id}/notes`, {
      method: "PUT",
      body: JSON.stringify({ notes }),
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
  name: string;
  path: string;
  type: string; // nginx, nginx_site, php, ssh, text
  readonly: boolean;
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

export const api = new ApiClient(API_URL);
