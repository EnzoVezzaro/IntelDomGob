// packages/events
//
// Event bus for the platform. Heavy, asynchronous work (OCR of 10k PDFs,
// bulk embedding, document pipelines) flows through events instead of blocking
// the HTTP request path:
//
//   API -> Orchestrator -> Event Bus -> Workers -> Services
//
// The default transport is DragonflyDB (Redis-compatible, drop-in replacement
// for Redis) using Redis Streams (XADD / XREAD). DragonflyDB is used instead of
// Redis because it is significantly faster, memory-efficient, and speaks the
// Redis protocol exactly, so the ioredis client and all Streams commands work
// unchanged. When no broker URL is configured, an in-memory pub/sub fallback is
// used so local development and tests work without a broker.

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("events");

/** Canonical event types emitted across the platform. */
export type PlatformEvent =
  | "document.uploaded"
  | "ocr.started"
  | "ocr.completed"
  | "embedding.started"
  | "embedding.completed"
  | "entity.extracted"
  | "document.intelligence.completed"
  | "workflow.started"
  | "workflow.completed"
  | "workflow.approval.requested"
  | "crawl.completed";

export interface EventEnvelope<T = unknown> {
  type: PlatformEvent;
  payload: T;
  /** ISO timestamp set by the producer. */
  timestamp: string;
  /** Optional correlation id (e.g. document id, workflow id). */
  correlationId?: string;
}

export type EventHandler<T = any> = (envelope: EventEnvelope<T>) => Promise<void> | void;

export interface EventBusOptions {
  redisUrl?: string;
  /** When true (or no redisUrl), use the in-memory fallback. */
  inMemory?: boolean;
}

interface RedisLike {
  xadd(stream: string, id: string, ...args: string[]): Promise<string>;
  xread(count: number, block: number, ...streams: string[]): Promise<Array<[string, Array<[string, string[]]>]> | null>;
  quit(): Promise<void>;
}

/**
 * Minimal event bus abstraction. Producers publish to a stream; consumers
 * subscribe to a stream and process envelopes. One Redis connection is shared
 * across producers and consumers in this process.
 */
export class EventBus {
  private readonly stream: string;
  private inMemory: boolean;
  private redis: RedisLike | null = null;
  private readonly listeners = new Map<string, Set<EventHandler>>();
  private consumerTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(opts: EventBusOptions = {}, stream = "intel.dom.gob.events") {
    this.stream = stream;
    this.inMemory = opts.inMemory || !opts.redisUrl;
    if (!this.inMemory) {
      // Lazy require so the dependency is only loaded when actually used.
      this.initRedis(opts.redisUrl as string);
    } else {
      log.info("Event bus using in-memory transport (no Redis configured)");
    }
  }

  private async initRedis(url: string): Promise<void> {
    try {
      const { default: Redis } = await import("ioredis");
      this.redis = new Redis(url, { maxRetriesPerRequest: null }) as unknown as RedisLike;
      log.info("Event bus connected to Redis Streams", { stream: this.stream });
    } catch (err) {
      log.warn("Redis unavailable; falling back to in-memory transport", { error: String(err) });
      this.inMemory = true;
    }
  }

  /** Publish an event envelope to the bus. */
  async publish<T>(type: PlatformEvent, payload: T, correlationId?: string): Promise<void> {
    const envelope: EventEnvelope<T> = {
      type,
      payload,
      timestamp: new Date().toISOString(),
      correlationId,
    };
    if (this.inMemory || !this.redis) {
      this.dispatchLocal(envelope);
      return;
    }
    const flat: string[] = ["type", type, "payload", JSON.stringify(payload), "timestamp", envelope.timestamp];
    if (correlationId) flat.push("correlationId", correlationId);
    await this.redis.xadd(this.stream, "*", ...flat);
  }

  /** Subscribe a handler to a specific event type. */
  subscribe<T>(type: PlatformEvent, handler: EventHandler<T>): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler as EventHandler);
    if (!this.inMemory && this.redis && !this.consumerTimer) {
      this.startRedisConsumer();
    }
  }

  private dispatchLocal(envelope: EventEnvelope): void {
    const handlers = this.listeners.get(envelope.type);
    if (!handlers) return;
    for (const h of handlers) {
      Promise.resolve(h(envelope)).catch((e) => log.error("Event handler failed", { type: envelope.type, error: String(e) }));
    }
  }

  private startRedisConsumer(): void {
    if (!this.redis) return;
    let lastId = "$";
    const poll = async () => {
      if (this.closed) return;
      try {
        const res = await this.redis!.xread(10, 1000, this.stream, lastId);
        if (res) {
          for (const [, entries] of res) {
            for (const [id, fields] of entries) {
              lastId = id;
              const map: Record<string, string> = {};
              for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
              const envelope = {
                type: map.type as PlatformEvent,
                payload: safeParse(map.payload),
                timestamp: map.timestamp,
                correlationId: map.correlationId,
              } as EventEnvelope;
              this.dispatchLocal(envelope);
            }
          }
        }
      } catch (e) {
        log.warn("Redis consumer error", { error: String(e) });
      }
      this.consumerTimer = setTimeout(poll, 200);
    };
    poll();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.consumerTimer) clearTimeout(this.consumerTimer);
    await this.redis?.quit().catch(() => {});
  }
}

function safeParse(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

/** Convenience factory. */
export function createEventBus(opts: EventBusOptions = {}, stream?: string): EventBus {
  return new EventBus(opts, stream);
}
