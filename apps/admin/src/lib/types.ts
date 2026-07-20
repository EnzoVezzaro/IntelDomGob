// Domain types mirrored from the platform services the Admin console manages.
// These are the shapes returned by the /v1/admin/* endpoints (see apps/api/src/routes.ts).

export type Plan = "free" | "publico" | "investigador" | "pro" | "institucional";
export type PaymentStatus = "ok" | "pending" | "overdue" | "suspended";
export type ProductSurface =
  | "studio"
  | "web"
  | "cli"
  | "mcp"
  | "sdk"
  | "admin"
  | "custom";

export const PLANS: Plan[] = [
  "free",
  "publico",
  "investigador",
  "pro",
  "institucional",
];

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  publico: "Público",
  investigador: "Investigador",
  pro: "Pro",
  institucional: "Institucional",
};

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "ok",
  "pending",
  "overdue",
  "suspended",
];

export const PRODUCTS: ProductSurface[] = [
  "studio",
  "web",
  "cli",
  "mcp",
  "sdk",
  "admin",
  "custom",
];

export const SCOPES = [
  "read",
  "query",
  "chat",
  "execute",
  "admin",
  "*",
] as const;

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: string[];
  active: boolean;
  organizationId?: string;
  tenantId?: string;
  attributes?: Record<string, string>;
  product?: string;
  plan?: string;
  quotaDaily?: number;
  rateLimit?: number;
  paymentStatus?: string;
  expiresAt?: string;
  lastSeenNode?: string;
}

export interface ApiKeyDetail extends ApiKeyRecord {
  dailyUsage: number;
}

export interface ApiKeyListResult {
  total: number;
  keys: ApiKeyRecord[];
}

export interface CreateApiKeyInput {
  name: string;
  product: string;
  tenantId?: string;
  organizationId?: string;
  userId?: string;
  scopes?: string[];
  plan?: string;
  quotaDaily?: number;
  rateLimit?: number;
  paymentStatus?: string;
  expiresAt?: string;
  attributes?: Record<string, string>;
}

export interface CreateApiKeyResult {
  key: string;
  record: ApiKeyRecord;
}

export interface User {
  id: string;
  email: string;
  displayName?: string;
  role: string;
  organizationId?: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  tenantId?: string;
  createdAt: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: string;
  createdAt: string;
}

export interface ProductStat {
  product: string;
  keys: number;
  active: number;
}

export interface LogRow {
  id: string;
  service: string;
  level: string;
  message: string;
  timestamp: string;
  requestId?: string;
  apiKeyId?: string;
  tenantId?: string;
  product?: string;
  node?: string;
  userId?: string;
}

export interface LogQueryResult {
  total: number;
  logs: LogRow[];
}

export type MetricScope = "global" | "product" | "tenant" | "apiKey" | "client" | "node";

export interface MetricPoint {
  scope: MetricScope;
  id: string;
  requestsTotal: number;
  errorsTotal: number;
  latencySum: number;
  tokensTotal: number;
  costUsdTotal: number;
  series: Array<Record<string, number>>;
}

export interface NodeInfo {
  id: string;
  service: string;
  host?: string;
  lastHeartbeat: string;
}

export interface ClientStat {
  id: string;
  requests: number;
  isKey: boolean;
  product?: string;
  /** Surface classification: studio | cli | sdk | api | custom | unknown. */
  type?: string;
  /** True when the id matches a known API key (resolved server-side). */
  knownKey?: boolean;
}

export interface InfraComponent {
  key: string;
  label: string;
  role: string;
  managed: boolean;
  status: "ok" | "degraded" | "down";
  detail: string;
  latencyMs?: number;
  meta?: {
    provider?: string;
    model?: string;
    baseUrl?: string | null;
    keySet?: boolean;
  };
}
