// Internal Admin API client. Talks ONLY to /v1/admin endpoints (operator-only).
// This is NOT part of the public @intel.dom.gob/sdk — the SDK is a public
// package for external developers and must never expose internal endpoints.

const TOKEN_KEY = "intel_admin_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}
export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
export function hasToken(): boolean {
  return !!getToken();
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("No admin token. Sign in first.");
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
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(err.message ?? err.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// --- API keys ---------------------------------------------------------------
export const listApiKeys = (params: Record<string, string | undefined> = {}) => api<{ total: number; keys: any[] }>("/apikeys", { params });
export const getApiKey = (id: string) => api<any>(`/apikeys/${id}`);
export const createApiKey = (body: Record<string, unknown>) => api<{ key: string; record: any }>("/apikeys", { method: "POST", body });
export const revokeApiKey = (id: string) => api<{ ok: boolean }>(`/apikeys/${id}/revoke`, { method: "POST" });
export const activateApiKey = (id: string) => api<{ ok: boolean }>(`/apikeys/${id}/activate`, { method: "POST" });
export const deleteApiKey = (id: string) => api<{ ok: boolean }>(`/apikeys/${id}`, { method: "DELETE" });
export const updateBilling = (id: string, patch: Record<string, unknown>) => api<{ ok: boolean }>(`/apikeys/${id}/billing`, { method: "POST", body: patch });

// --- Products / nodes / telemetry -------------------------------------------
export const listProducts = () => api<{ products: Array<{ product: string; keys: number; active: number }> }>("/products");
export const queryLogs = (params: Record<string, string | number | undefined> = {}) => api<{ total: number; logs: Array<Record<string, string>> }>("/logs", { params });
export const getMetrics = (params: Record<string, string | undefined> = {}) => api<any>("/metrics", { params });
export const listNodes = () => api<{ nodes: any[] }>("/nodes");

// --- Employees / orgs / tenants ---------------------------------------------
export const listUsers = (organizationId?: string) => api<{ users: any[] }>("/users", { params: { organizationId } });
export const createUser = (body: Record<string, unknown>) => api<{ id: string }>("/users", { method: "POST", body });
export const listOrganizations = () => api<{ organizations: any[] }>("/organizations");
export const createOrganization = (body: Record<string, unknown>) => api<{ id: string }>("/organizations", { method: "POST", body });
export const listTenants = () => api<{ tenants: any[] }>("/tenants");
