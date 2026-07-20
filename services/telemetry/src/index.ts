// services/telemetry
//
// Central, queryable logs + metrics for the Admin console.
//
// Storage is DragonflyDB (Redis protocol) — the same infrastructure the event
// bus already uses — so no new dependency is introduced. This keeps log/metric
// reads fast even with thousands of API-keyed clients:
//
//   * Logs   → a capped Redis Stream (`intel:logs`) with time-addressable IDs.
//   * Metrics→ per-minute Redis hashes keyed by scope+id; O(buckets) to aggregate.
//   * Nodes  → a Redis hash of live platform instances for fleet attribution.
//
// When no broker is configured it falls back to an in-memory buffer so local
// dev and tests work without DragonflyDB. No external system is touched here
// (DragonflyDB is platform infrastructure, not a Provider).

import { createLogger } from "@intel.dom.gob/logger";
import type { LogEntry } from "@intel.dom.gob/logger";

const log = createLogger("service:telemetry");

const LOG_STREAM = "intel:logs";
const LOG_MAXLEN = 2_000_000;
const METRICS_PREFIX = "intel:metrics:";
const METRICS_TTL_SECONDS = 35 * 24 * 60 * 60; // 35 days retention
const NODES_HASH = "intel:nodes";

export type MetricScope = "global" | "product" | "tenant" | "apiKey" | "node";

export interface LogQuery {
  service?: string;
  level?: string;
  apiKeyId?: string;
  tenantId?: string;
  product?: string;
  node?: string;
  userId?: string;
  /** ISO or ms timestamp lower bound. */
  from?: string | number;
  /** ISO or ms timestamp upper bound. */
  until?: string | number;
  search?: string;
  limit?: number;
}

export interface MetricPoint {
  scope: MetricScope;
  id: string;
  requestsTotal: number;
  errorsTotal: number;
  latencySum: number;
  tokensTotal: number;
  costUsdTotal: number;
  /** Per-bucket series for charting: { t: bucketStartMs, ...metrics }. */
  series: Array<Record<string, number>>;
}

export interface NodeInfo {
  id: string;
  service: string;
  host?: string;
  lastHeartbeat: string;
}

interface RedisLike {
  xadd(stream: string, maxlen: string, maxlenVal: number, id: string, ...args: string[]): Promise<string>;
  xrevrange(stream: string, end: string, start: string, count: number): Promise<Array<[string, string[]]>>;
  hincrby(key: string, field: string, by: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<number>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

function toMs(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value;
  const n = Number(value);
  if (!Number.isNaN(n)) return n;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export class TelemetryService {
  private redis: RedisLike | null = null;
  private inMemory: boolean;
  private readonly redisUrl?: string;
  // In-memory fallback stores.
  private memLogs: Array<{ id: string; fields: Record<string, string> }> = [];
  private memMetrics = new Map<string, Record<string, number>>();
  private memNodes = new Map<string, NodeInfo>();
  private seq = 0;

  constructor(redisUrl?: string) {
    this.redisUrl = redisUrl;
    this.inMemory = !redisUrl;
    if (!this.inMemory) this.initRedis(redisUrl as string);
  }

  private async initRedis(url: string): Promise<void> {
    try {
      const { default: Redis } = await import("ioredis");
      this.redis = new Redis(url, { maxRetriesPerRequest: null }) as unknown as RedisLike;
      log.info("Telemetry connected to DragonflyDB", { stream: LOG_STREAM });
    } catch (err) {
      log.warn("Telemetry: DragonflyDB unavailable; using in-memory fallback", { error: String(err) });
      this.inMemory = true;
    }
  }

  /** Append a structured log entry. `entry` comes straight from the logger sink. */
  async appendLog(entry: LogEntry): Promise<void> {
    const fields: Record<string, string> = {
      service: entry.service,
      level: entry.level,
      message: entry.message,
      timestamp: entry.timestamp,
    };
    if (entry.requestId) fields.requestId = entry.requestId;
    // Correlation fields (set by the API per request).
    for (const key of ["apiKeyId", "tenantId", "product", "node", "userId"]) {
      const v = (entry as any)[key];
      if (v) fields[key] = String(v);
    }
    if (this.inMemory || !this.redis) {
      this.seq++;
      this.memLogs.push({ id: `${Date.now()}-${this.seq}`, fields });
      if (this.memLogs.length > LOG_MAXLEN) this.memLogs.shift();
      return;
    }
    const args: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      args.push(k, v);
    }
    await this.redis.xadd(LOG_STREAM, "MAXLEN", LOG_MAXLEN, "*", ...args).catch((e) => log.warn("log append failed", { error: String(e) }));
  }

  /** Query recent logs with optional filters. Bounded + in-memory filtered. */
  async queryLogs(q: LogQuery = {}): Promise<{ total: number; logs: Array<Record<string, string>> }> {
    const limit = Math.min(q.limit ?? 200, 5000);
    const fromMs = toMs(q.from);
    const untilMs = toMs(q.until);
    const startId = fromMs ? `${fromMs}-0` : "-";
    const endId = untilMs ? `${untilMs}-0` : "+";

    let raw: Array<{ id: string; fields: Record<string, string> }> = [];
    if (this.inMemory || !this.redis) {
      raw = this.memLogs;
    } else {
      const entries = await this.redis.xrevrange(LOG_STREAM, endId, startId, limit * 4).catch(() => []);
      raw = (entries ?? []).map(([id, f]) => {
        const fields: Record<string, string> = {};
        for (let i = 0; i < f.length; i += 2) fields[f[i]] = f[i + 1];
        return { id, fields };
      });
    }

    const filtered = raw.filter((r) => {
      const f = r.fields;
      if (q.service && f.service !== q.service) return false;
      if (q.level && f.level !== q.level) return false;
      if (q.apiKeyId && f.apiKeyId !== q.apiKeyId) return false;
      if (q.tenantId && f.tenantId !== q.tenantId) return false;
      if (q.product && f.product !== q.product) return false;
      if (q.node && f.node !== q.node) return false;
      if (q.userId && f.userId !== q.userId) return false;
      if (q.search) {
        const hay = `${f.message} ${f.service} ${f.apiKeyId ?? ""} ${JSON.stringify(f)}`.toLowerCase();
        if (!hay.includes(q.search.toLowerCase())) return false;
      }
      return true;
    });

    const page = (this.inMemory ? filtered.slice(-limit) : filtered.slice(0, limit)).map((r) => ({ id: r.id, ...r.fields }));
    return { total: filtered.length, logs: page };
  }

  private bucketMs(ts: number): number {
    return Math.floor(ts / 60000) * 60000;
  }

  /** Increment a metric counter for a scope+id at the current minute bucket. */
  async inc(scope: MetricScope, id: string, metric: string, by = 1, atMs = Date.now()): Promise<void> {
    const key = `${METRICS_PREFIX}${this.bucketMs(atMs)}:${scope}:${id}`;
    if (this.inMemory || !this.redis) {
      const m = this.memMetrics.get(key) ?? {};
      m[metric] = (m[metric] ?? 0) + by;
      this.memMetrics.set(key, m);
      return;
    }
    await this.redis.hincrby(key, metric, by).catch(() => {});
    await this.redis.expire(key, METRICS_TTL_SECONDS).catch(() => {});
  }

  /** Record a request's outcome for a scope+id (call from the gateway). */
  async recordRequest(scope: MetricScope, id: string, opts: { status?: number; latencyMs?: number; tokens?: number; costUsd?: number }): Promise<void> {
    await this.inc(scope, id, "requestsTotal", 1);
    if (opts.status && opts.status >= 500) await this.inc(scope, id, "errorsTotal", 1);
    if (opts.latencyMs) await this.inc(scope, id, "latencySum", opts.latencyMs);
    if (opts.tokens) await this.inc(scope, id, "tokensTotal", opts.tokens);
    if (opts.costUsd) await this.inc(scope, id, "costUsdTotal", opts.costUsd);
  }

  /** Aggregate metrics for a scope+id across a time window. */
  async getMetrics(scope: MetricScope, id: string, from?: string | number, until?: string | number): Promise<MetricPoint> {
    const to = toMs(until) ?? Date.now();
    const fromMs = toMs(from) ?? to - 60 * 60 * 1000;
    const startBucket = this.bucketMs(fromMs);
    const endBucket = this.bucketMs(to);
    const series: Array<Record<string, number>> = [];
    const totals = { requestsTotal: 0, errorsTotal: 0, latencySum: 0, tokensTotal: 0, costUsdTotal: 0 };

    if (this.inMemory || !this.redis) {
      for (const [key, m] of this.memMetrics) {
        const [bucketStr, s, i] = key.replace(METRICS_PREFIX, "").split(":");
        if (s !== scope || i !== id) continue;
        const bucket = Number(bucketStr);
        if (bucket < startBucket || bucket > endBucket) continue;
        this.accumulate(totals, m);
        series.push({ t: bucket, ...m });
      }
    } else {
      for (let b = startBucket; b <= endBucket; b += 60000) {
        const key = `${METRICS_PREFIX}${b}:${scope}:${id}`;
        const m = await this.redis.hgetall(key).catch(() => ({}));
        if (Object.keys(m).length) {
          const numeric: Record<string, number> = {};
          for (const [k, v] of Object.entries(m)) numeric[k] = Number(v);
          this.accumulate(totals, numeric);
          series.push({ t: b, ...numeric });
        }
      }
    }
    return { scope, id, ...totals, series };
  }

  private accumulate(totals: Record<string, number>, m: Record<string, number>): void {
    for (const [k, v] of Object.entries(m)) totals[k] = (totals[k] ?? 0) + v;
  }

  /** Register/refresh a node heartbeat. */
  async heartbeat(nodeId: string, service: string, host?: string): Promise<void> {
    const info: NodeInfo = { id: nodeId, service, host, lastHeartbeat: new Date().toISOString() };
    if (this.inMemory || !this.redis) {
      this.memNodes.set(nodeId, info);
      return;
    }
    await this.redis.hset(NODES_HASH, nodeId, JSON.stringify(info)).catch(() => {});
  }

  async getNodes(): Promise<NodeInfo[]> {
    if (this.inMemory || !this.redis) return [...this.memNodes.values()];
    const raw = await this.redis.hgetall(NODES_HASH).catch(() => ({}));
    return Object.values(raw).map((v) => JSON.parse(v) as NodeInfo);
  }

  async close(): Promise<void> {
    await (this.redis as any)?.quit?.().catch(() => {});
  }
}

export function createTelemetry(redisUrl?: string): TelemetryService {
  return new TelemetryService(redisUrl);
}
