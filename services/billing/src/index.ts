// services/billing
//
// Entitlements + metering for the platform. Enforces, at the API gateway, that
// every API-keyed client (each "product" surface) complies with its key's
// billing restrictions: payment status, daily quota, and rate limit. Also
// records per-request usage into Telemetry (for Admin dashboards) and the
// `usage` table (for billing history).
//
// No external payment processor is integrated yet — `paymentStatus` is set by
// an operator in the Admin console. Quota/rate-limit state lives in DragonflyDB
// (infrastructure, not a Provider).

import { createLogger } from "@intel.dom.gob/logger";
import type { Database } from "@intel.dom.gob/database";
import type { ApiKeyRecord } from "@intel.dom.gob/service-auth";
import { AuthError } from "@intel.dom.gob/service-auth";
import type { TelemetryService } from "@intel.dom.gob/service-telemetry";

const log = createLogger("service:billing");

/** Scopes that consume the metered (paid) compute layer. */
export const METERED_SCOPES = new Set(["query", "chat", "execute"]);

export interface Plan {
  label: string;
  scopes: string[];
  quotaDaily: number;
  rateLimit: number;
  /** USD per overage unit (a metered request), for Pro overage billing. */
  overageUsd: number;
}

/** Plan catalog (mirrors README pricing). Keys store plan + quota/rate directly. */
export const PLANS: Record<string, Plan> = {
  free: { label: "Free", scopes: ["read"], quotaDaily: 0, rateLimit: 0, overageUsd: 0 },
  // Público == anonymous preview: sin apikey any public-facing product still
  // works, but only read + query + chat, throttled to 20/day & 10/min.
  publico: { label: "Público", scopes: ["read", "query", "chat"], quotaDaily: 20, rateLimit: 10, overageUsd: 0 },
  investigador: { label: "Investigador", scopes: ["read", "query", "chat"], quotaDaily: 200, rateLimit: 30, overageUsd: 0 },
  pro: { label: "Pro", scopes: ["read", "query", "chat", "execute"], quotaDaily: 1000, rateLimit: 120, overageUsd: 0.01 },
  institucional: { label: "Institucional", scopes: ["*"], quotaDaily: 0, rateLimit: 0, overageUsd: 0 },
};

export const PAYMENT_STATUSES = ["ok", "pending", "overdue", "suspended"] as const;

interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export interface RecordRequestOpts {
  status?: number;
  latencyMs?: number;
  tokens?: number;
  costUsd?: number;
  kind?: string;
}

export class BillingService {
  private redis: RedisLike | null = null;
  private inMemory = false;
  private memRate = new Map<string, number>();
  private memQuota = new Map<string, number>();
  constructor(
    private readonly auth: { verifyApiKey(k: string): Promise<ApiKeyRecord | null> },
    private readonly telemetry: TelemetryService,
    private readonly db?: Database,
    redisUrl?: string,
  ) {
    // Start in in-memory mode. Only flip to Redis once a live connection is
    // confirmed, so the gateway never blocks on an unreachable DragonflyDB.
    this.inMemory = true;
    if (redisUrl) {
      import("ioredis").then(({ default: Redis }) => {
        const r = new Redis(redisUrl, {
          lazyConnect: true,
          connectTimeout: 2000,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
        }) as unknown as RedisLike;
        // Swallow connection errors so an unreachable DragonflyDB degrades to
        // in-memory counters instead of crashing the process.
        (r as any).on?.("error", () => {});
        (r as any).connect()
          .then(() => { this.inMemory = false; })
          .catch(() => {
            this.inMemory = true;
            log.warn("Billing: DragonflyDB unavailable; using in-memory counters");
          });
        this.redis = r;
      }).catch((e) => {
        log.warn("Billing: DragonflyDB unavailable; using in-memory counters", { error: String(e) });
        this.inMemory = true;
      });
    }
  }

  /** Plan-bound default scopes, so admin key creation can mirror the catalog. */
  static scopesForPlan(plan: string): string[] {
    return PLANS[plan]?.scopes ?? PLANS.free.scopes;
  }

  private dayKey(id: string): string {
    return `intel:quota:day:${id}:${new Date().toISOString().slice(0, 10)}`;
  }
  private minuteKey(id: string): string {
    return `intel:ratelimit:min:${id}:${Math.floor(Date.now() / 60000)}`;
  }

  /**
   * Gateway entitlement check. Throws AuthError when the key may not serve the
   * request. Non-metered scopes (e.g. `read`) only require a valid, non-suspended
   * key. Metered scopes additionally enforce rate limit + daily quota.
   */
    async guard(record: ApiKeyRecord, scope: string): Promise<void> {
    if (!record.active || record.paymentStatus === "suspended") {
      throw new AuthError("Key suspended: payment required to continue.", 402);
    }
    if (record.paymentStatus === "overdue") {
      throw new AuthError("Key overdue: settle payment to continue.", 402);
    }
    if (!METERED_SCOPES.has(scope)) return;

    if (record.rateLimit && record.rateLimit > 0) {
      const count = await this.bump(this.minuteKey(record.id), 60);
      if (count > record.rateLimit) {
        throw new AuthError(`Rate limit exceeded (${record.rateLimit}/min).`, 429);
      }
    }
    if (record.quotaDaily && record.quotaDaily > 0) {
      const used = await this.bump(this.dayKey(record.id), 86400);
      if (used > record.quotaDaily) {
        throw new AuthError(`Daily quota exceeded (${record.quotaDaily}).`, 429);
      }
    }
  }

  private memBump(key: string): number {
    const m = key.startsWith("intel:ratelimit") ? this.memRate : this.memQuota;
    const v = (m.get(key) ?? 0) + 1;
    m.set(key, v);
    return v;
  }

  private async bump(key: string, ttl: number): Promise<number> {
    if (this.inMemory || !this.redis) return this.memBump(key);
    try {
      const n = await (this.redis as any).incr(key);
      if (n === 1) await (this.redis as any).expire(key, ttl).catch(() => {});
      return n;
    } catch {
      // DragonflyDB op failed at runtime — degrade to in-memory counters.
      this.inMemory = true;
      log.warn("Billing: DragonflyDB operation failed; using in-memory counters");
      return this.memBump(key);
    }
  }

  /** Record a served (metered) request across every relevant scope. */
  async recordRequest(record: ApiKeyRecord, opts: RecordRequestOpts): Promise<void> {
    const base = { status: opts.status, latencyMs: opts.latencyMs };
    await this.telemetry.recordRequest("global", "all", base);
    if (record.product) await this.telemetry.recordRequest("product", record.product, base);
    if (record.tenantId) await this.telemetry.recordRequest("tenant", record.tenantId, base);
    await this.telemetry.recordRequest("apiKey", record.id, { ...base, tokens: opts.tokens, costUsd: opts.costUsd });
    if (this.db && (opts.tokens || opts.costUsd || opts.kind)) {
      await this.db.query(
        `INSERT INTO usage (organization_id, user_id, kind, tokens, cost_usd) VALUES ($1, $2, $3, $4, $5)`,
        [record.organizationId ?? null, (record as any).userId ?? null, opts.kind ?? "request", opts.tokens ?? 0, opts.costUsd ?? 0],
      ).catch(() => {});
    }
  }

  /** Current daily usage for a key (for quota gauges in Admin). */
  async dailyUsage(id: string): Promise<number> {
    if (this.inMemory || !this.redis) return this.memQuota.get(this.dayKey(id)) ?? 0;
    try {
      const n = await (this.redis as any).get?.(this.dayKey(id));
      return n ? Number(n) : 0;
    } catch {
      this.inMemory = true;
      return this.memQuota.get(this.dayKey(id)) ?? 0;
    }
  }
}

export function createBilling(
  auth: { verifyApiKey(k: string): Promise<ApiKeyRecord | null> },
  telemetry: TelemetryService,
  db?: Database,
  redisUrl?: string,
): BillingService {
  return new BillingService(auth, telemetry, db, redisUrl);
}
