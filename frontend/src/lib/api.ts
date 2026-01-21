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
  ssl_mode: string;
  ssl_email?: string; // Email for SSL certificate issuance
  locations: LocationConfig[];
  cors: CORSConfig | null;
}

export interface LocationConfig {
  path: string;
  type: string;        // proxy, static
  static_type?: string; // local, landing (for static type)
  proxy_url?: string;
  root?: string;
  index?: string;
  landing_id?: string;  // UUID of landing page
  use_php?: boolean;    // Enable PHP-FPM for this location
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
    return this.request<Landing[]>("/api/landings");
  }

  async getLanding(id: string): Promise<Landing> {
    return this.request<Landing>(`/api/landings/${id}`);
  }

  async uploadLanding(name: string, type: string, file: File): Promise<Landing> {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("type", type);
    formData.append("file", file);

    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/landings`, {
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
    await this.request(`/api/landings/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteLanding(id: string): Promise<void> {
    await this.request(`/api/landings/${id}`, { method: "DELETE" });
  }

  getLandingDownloadUrl(id: string): string {
    return `${this.baseUrl}/api/landings/${id}/download`;
  }
}

export const api = new ApiClient(API_URL);
