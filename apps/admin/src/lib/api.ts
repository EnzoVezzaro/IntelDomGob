// Internal Admin API client. Talks ONLY to /v1/admin endpoints (operator-only).
// This is NOT the public @intel.dom.gob/sdk — the SDK is for external developers
// and must never expose internal endpoints. The admin token is the admin-scoped
// API key (see services/auth ensureAdminKey / INTEL_API_TOKEN).

import type {
  ApiKeyDetail,
  ApiKeyListResult,
  ApiKeyRecord,
  CreateApiKeyInput,
  CreateApiKeyResult,
  LogQueryResult,
  MetricPoint,
  MetricScope,
  NodeInfo,
  Organization,
  ProductStat,
  Tenant,
  User,
} from "./types";

const TOKEN_KEY = "intel_admin_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}
export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t.trim());
  else localStorage.removeItem(TOKEN_KEY);
}
export function hasToken(): boolean {
  return !!getToken();
}

export class AdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new AdminApiError("No admin token. Sign in first.", 401);

  const url = new URL(`/api/v1/admin${path}`, window.location.origin);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    const status = res.status;
    const error = new AdminApiError(err.message ?? err.error ?? `Request failed (${status})`, status);
    if (status === 401) handleUnauthorized();
    throw error;
  }
  return res.json() as Promise<T>;
}

/** Validate the stored admin token by hitting a protected endpoint. */
export async function validateToken(): Promise<boolean> {
  try {
    await request<{ nodes: NodeInfo[] }>("/nodes");
    return true;
  } catch {
    return false;
  }
}

export const adminApi = {
  // --- API keys -------------------------------------------------------------
  listApiKeys: (params: Record<string, string | undefined> = {}) =>
    request<ApiKeyListResult>("/apikeys", { params }),
  getApiKey: (id: string) => request<ApiKeyDetail>(`/apikeys/${id}`),
  createApiKey: (body: CreateApiKeyInput) =>
    request<CreateApiKeyResult>("/apikeys", { method: "POST", body }),
  revokeApiKey: (id: string) =>
    request<{ ok: boolean }>(`/apikeys/${id}/revoke`, { method: "POST" }),
  activateApiKey: (id: string) =>
    request<{ ok: boolean }>(`/apikeys/${id}/activate`, { method: "POST" }),
  deleteApiKey: (id: string) =>
    request<{ ok: boolean }>(`/apikeys/${id}`, { method: "DELETE" }),
  updateBilling: (id: string, patch: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/apikeys/${id}/billing`, { method: "POST", body: patch }),

  // --- Products / telemetry -------------------------------------------------
  listProducts: () => request<{ products: ProductStat[] }>("/products"),
  queryLogs: (params: Record<string, string | number | undefined> = {}) =>
    request<LogQueryResult>("/logs", { params }),
  getMetrics: (scope: MetricScope, id: string, params: Record<string, string | undefined> = {}) =>
    request<MetricPoint>("/metrics", { params: { scope, id, ...params } }),
  listNodes: () => request<{ nodes: NodeInfo[] }>("/nodes"),

  // --- Users / orgs / tenants ----------------------------------------------
  listUsers: (organizationId?: string) =>
    request<{ users: User[] }>("/users", { params: { organizationId } }),
  createUser: (body: { email: string; displayName?: string; role?: string; organizationId?: string }) =>
    request<{ id: string }>("/users", { method: "POST", body }),
  listOrganizations: () => request<{ organizations: Organization[] }>("/organizations"),
  createOrganization: (body: { name: string; slug: string; tenantId?: string }) =>
    request<{ id: string }>("/organizations", { method: "POST", body }),
  listTenants: () => request<{ tenants: Tenant[] }>("/tenants"),
};

export type { ApiKeyRecord };

/**
 * On an admin 401 the session is invalid/expired: drop the token and return to
 * login (unless we're already there), so the operator re-authenticates.
 */
function handleUnauthorized(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  setToken("");
  window.location.assign("/login");
}
