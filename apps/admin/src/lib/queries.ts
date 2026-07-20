import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { adminApi } from "./api";
import type {
  CreateApiKeyInput,
  MetricScope,
} from "./types";

export const qk = {
  apiKeys: (filters: Record<string, string | undefined>) => ["apiKeys", filters] as const,
  apiKey: (id: string) => ["apiKey", id] as const,
  products: () => ["products"] as const,
  nodes: () => ["nodes"] as const,
  metrics: (scope: MetricScope, id: string, range: string) => ["metrics", scope, id, range] as const,
  logs: (filters: Record<string, string | number | undefined>) => ["logs", filters] as const,
  users: (orgId?: string) => ["users", orgId ?? "all"] as const,
  organizations: () => ["organizations"] as const,
  tenants: () => ["tenants"] as const,
};

export function useApiKeys(filters: Record<string, string | undefined> = {}) {
  return useQuery({
    queryKey: qk.apiKeys(filters),
    queryFn: () => adminApi.listApiKeys(filters),
  });
}

export function useApiKey(id: string) {
  return useQuery({
    queryKey: qk.apiKey(id),
    queryFn: () => adminApi.getApiKey(id),
    enabled: !!id,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) => adminApi.createApiKey(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apiKeys"] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apiKeys"] }),
  });
}

export function useActivateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.activateApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apiKeys"] }),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apiKeys"] }),
  });
}

export function useUpdateBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      adminApi.updateBilling(id, patch),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
      qc.invalidateQueries({ queryKey: qk.apiKey(v.id) });
    },
  });
}

export function useProducts() {
  return useQuery({ queryKey: qk.products(), queryFn: () => adminApi.listProducts() });
}

export function useNodes() {
  return useQuery({ queryKey: qk.nodes(), queryFn: () => adminApi.listNodes() });
}

export function useMetrics(scope: MetricScope, id: string, range = "24h") {
  return useQuery({
    queryKey: qk.metrics(scope, id, range),
    queryFn: () => adminApi.getMetrics(scope, id, { from: rangeToFrom(range) }),
    enabled: !!id,
  });
}

export function useLogs(filters: Record<string, string | number | undefined> = {}) {
  return useQuery({
    queryKey: qk.logs(filters),
    queryFn: () => adminApi.queryLogs(filters),
    refetchInterval: filters.live ? 4000 : false,
  });
}

export function useUsers(orgId?: string) {
  return useQuery({
    queryKey: qk.users(orgId),
    queryFn: () => adminApi.listUsers(orgId),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; displayName?: string; role?: string; organizationId?: string }) =>
      adminApi.createUser(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useOrganizations() {
  return useQuery({ queryKey: qk.organizations(), queryFn: () => adminApi.listOrganizations() });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; slug: string; tenantId?: string }) =>
      adminApi.createOrganization(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

export function useTenants() {
  return useQuery({ queryKey: qk.tenants(), queryFn: () => adminApi.listTenants() });
}

/** Map a friendly range label to an ISO `from` timestamp. */
export function rangeToFrom(range: string): string {
  const now = Date.now();
  const map: Record<string, number> = {
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const span = map[range] ?? map["24h"];
  return new Date(now - span).toISOString();
}
