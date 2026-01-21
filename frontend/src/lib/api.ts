const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
  };
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

export interface Machine {
  id: string;
  agent_id: string | null;
  hostname: string | null;
  ip_address: string | null;
  ubuntu_version: string | null;
  notes_md: string | null;
  created_at: string;
  updated_at: string;
  agent_name: string | null;
  agent_version: string | null;
  last_seen: string | null;
  // Settings
  ssh_port: number;
  ufw_enabled: boolean;
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

export interface EnrollmentToken {
  id: string;
  name: string | null;
  token?: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
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
  locations: LocationConfig[];
  cors: CORSConfig | null;
}

export interface LocationConfig {
  path: string;
  type: string;
  proxy_url?: string;
  root?: string;
  index?: string;
}

export interface CORSConfig {
  enabled: boolean;
  allow_all: boolean;
  allow_methods?: string[];
  allow_headers?: string[];
  allow_origins?: string[];
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
    this.setToken(response.token);
    return response;
  }

  async logout(): Promise<void> {
    this.setToken(null);
  }

  async getMe(): Promise<LoginResponse["user"]> {
    return this.request<LoginResponse["user"]>("/api/auth/me");
  }

  // Machines
  async listMachines(): Promise<Machine[]> {
    return this.request<Machine[]>("/api/machines");
  }

  async getMachine(id: string): Promise<Machine> {
    return this.request<Machine>(`/api/machines/${id}`);
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

  // Machine Settings
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
}

export const api = new ApiClient(API_URL);
