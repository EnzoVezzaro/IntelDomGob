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
// A node that misses a heartbeat for this long is gone (pruned). Matches the
// 5-minute liveness window the Admin console uses to flag a degraded node.
const NODE_TTL_MS = 5 * 60 * 1000;
const CLIENTS_ZSET = "intel:clients";
const CLIENTS_META = "intel:clients:meta";

export type MetricScope = "global" | "product" | "tenant" | "apiKey" | "node" | "client";

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
  xrevrange(stream: string, end: string, start: string, count?: number): Promise<Array<[string, string[]]>>;
  hincrby(key: string, field: string, by: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<number>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  del(key: string): Promise<number>;
  zincrby(key: string, by: number, member: string): Promise<number>;
  zrevrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]>;
  ping(): Promise<string>;
}

export interface ClientStat {
  id: string;
  requests: number;
  isKey: boolean;
  product?: string;
  /** Surface classification: studio | cli | sdk | api | custom | unknown. */
  type?: string;
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
  private memClients = new Map<string, ClientStat>();
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
      // Early writes during the init window landed in the in-memory buffers.
      // Replay them so nothing is lost once the broker is live.
      await this.flushBuffers();
    } catch (err) {
      log.warn("Telemetry: DragonflyDB unavailable; using in-memory fallback", { error: String(err) });
      this.inMemory = true;
    }
  }

  /** Replay in-memory buffers into Redis (called once connected). */
  private async flushBuffers(): Promise<void> {
    if (!this.redis) return;
    for (const info of this.memNodes.values()) {
      await this.redis.hset(NODES_HASH, info.id, JSON.stringify(info)).catch(() => {});
    }
    for (const c of this.memClients.values()) {
      await this.redis.zincrby(CLIENTS_ZSET, c.requests, c.id).catch(() => {});
      await this.redis.hset(CLIENTS_META, c.id, JSON.stringify({ isKey: c.isKey, product: c.product ?? null })).catch(() => {});
    }
    for (const entry of this.memLogs) {
      const args: string[] = [];
      for (const [k, v] of Object.entries(entry.fields)) args.push(k, v);
      await this.redis.xadd(LOG_STREAM, "MAXLEN", LOG_MAXLEN, "*", ...args).catch(() => {});
    }
    this.memNodes.clear();
    this.memClients.clear();
    this.memLogs = [];
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
      // Note: ioredis rejects a positional COUNT on xrevrange in this version,
      // so we fetch the window and slice in JS instead.
      const entries = await this.redis.xrevrange(LOG_STREAM, endId, startId).catch(() => []);
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

  /** Drop nodes whose last heartbeat is older than NODE_TTL_MS (orphaned containers). */
  private pruneStaleNodes(nodes: NodeInfo[]): { live: NodeInfo[]; staleIds: string[] } {
    const now = Date.now();
    const live: NodeInfo[] = [];
    const staleIds: string[] = [];
    for (const n of nodes) {
      const age = Date.parse(n.lastHeartbeat);
      if (Number.isNaN(age) || now - age > NODE_TTL_MS) staleIds.push(n.id);
      else live.push(n);
    }
    return { live, staleIds };
  }

  async getNodes(): Promise<NodeInfo[]> {
    if (this.inMemory || !this.redis) {
      return this.pruneStaleNodes([...this.memNodes.values()]).live;
    }
    const raw = await this.redis.hgetall(NODES_HASH).catch(() => ({}));
    const all = Object.values(raw).map((v) => JSON.parse(v) as NodeInfo);
    const { live, staleIds } = this.pruneStaleNodes(all);
    if (staleIds.length) {
      // Self-cleaning: drop orphaned node records so the fleet count stays honest.
      await this.redis.hdel(NODES_HASH, ...staleIds).catch(() => {});
    }
    return live;
  }

  /** Record a request attributed to a client (api-key id, or `ip:<addr>`). */
  async recordClient(clientId: string, meta?: { isKey?: boolean; product?: string; type?: string }, by = 1): Promise<void> {
    const isKey = meta?.isKey ?? false;
    const product = meta?.product;
    const type = meta?.type;
    if (this.inMemory || !this.redis) {
      const cur = this.memClients.get(clientId) ?? { id: clientId, requests: 0, isKey, product, type };
      cur.requests += by;
      cur.isKey = cur.isKey || isKey;
      if (product) cur.product = product;
      if (type) cur.type = type;
      this.memClients.set(clientId, cur);
      return;
    }
    await this.redis.zincrby(CLIENTS_ZSET, by, clientId).catch(() => {});
    await this.redis.hset(CLIENTS_META, clientId, JSON.stringify({ isKey, product: product ?? null, type: type ?? null })).catch(() => {});
    await this.redis.expire(CLIENTS_ZSET, METRICS_TTL_SECONDS).catch(() => {});
  }

  /** Top clients by total request count (api-keyed + anonymous IP clients). */
  async topClients(limit = 20): Promise<ClientStat[]> {
    if (this.inMemory || !this.redis) {
      return [...this.memClients.values()].sort((a, b) => b.requests - a.requests).slice(0, limit);
    }
    const raw = await this.redis.zrevrange(CLIENTS_ZSET, 0, limit - 1, "WITHSCORES").catch(() => []);
    const meta = await this.redis.hgetall(CLIENTS_META).catch(() => ({}));
    const out: ClientStat[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const id = raw[i];
      const m = meta[id] ? (JSON.parse(meta[id]) as { isKey: boolean; product?: string; type?: string }) : { isKey: false };
      out.push({ id, requests: Number(raw[i + 1]), isKey: m.isKey, product: m.product, type: m.type });
    }
    return out;
  }

  /** Liveness probe for the underlying DragonflyDB/Redis broker. */
  async ping(): Promise<boolean> {
    if (this.inMemory || !this.redis) return true;
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await (this.redis as any)?.quit?.().catch(() => {});
  }
}

export function createTelemetry(redisUrl?: string): TelemetryService {
  return new TelemetryService(redisUrl);
}
