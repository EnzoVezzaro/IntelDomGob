// services/observability
//
// In-process observability: metrics (counters, gauges, histograms) and traces
// (spans with parent links). Metrics are exported in Prometheus text format via
// `renderPrometheus()`. This keeps the platform self-contained (no external
// collector required); a future exporter can scrape `collect()`.
//
// All timing helpers return stop functions so callers can bracket work:
//   const end = obs.timer("ai.latency");
//   ... work ...
//   end();

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:observability");

export interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  value: number;
  labels?: Record<string, string>;
  buckets?: number[]; // for histograms (cumulative counts)
}

export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  attributes: Record<string, unknown>;
}

export class ObservabilityService {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private spans: Span[] = [];
  private readonly bucketBoundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  inc(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key = this.k(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauges.set(this.k(name, labels), value);
  }

  /** Record a duration (seconds). Returns nothing; increments histogram + counter. */
  observe(name: string, seconds: number, labels: Record<string, string> = {}): void {
    const key = this.k(name, labels);
    const arr = this.histograms.get(key) ?? [];
    arr.push(seconds);
    this.histograms.set(key, arr);
    this.inc(`${name}_count`, labels);
    this.setGauge(`${name}_sum`, (this.gauges.get(this.k(`${name}_sum`, labels)) ?? 0) + seconds, labels);
  }

  /** Bracket a unit of work; returns a stop fn that records its duration. */
  timer(name: string, labels: Record<string, string> = {}): () => void {
    const start = process.hrtime.bigint();
    return () => {
      const end = process.hrtime.bigint();
      const secs = Number(end - start) / 1e9;
      this.observe(name, secs, labels);
    };
  }

  startSpan(name: string, parentId?: string, attributes: Record<string, unknown> = {}): Span {
    const span: Span = {
      traceId: parentId ? this.traceOf(parentId) ?? this.newId() : this.newId(),
      spanId: this.newId(),
      parentId,
      name,
      startedAt: Date.now(),
      attributes,
    };
    this.spans.push(span);
    if (this.spans.length > 1000) this.spans.shift();
    return span;
  }

  endSpan(span: Span, extra: Record<string, unknown> = {}): void {
    span.endedAt = Date.now();
    span.attributes = { ...span.attributes, ...extra };
  }

  getSpans(): Span[] {
    return this.spans;
  }

  private traceOf(spanId: string): string | undefined {
    return this.spans.find((s) => s.spanId === spanId)?.traceId;
  }

  private newId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  private k(name: string, labels: Record<string, string>): string {
    const l = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return l.length ? `${name}|${l.map(([k, v]) => `${k}=${v}`).join(",")}` : name;
  }

  collect(): Metric[] {
    const out: Metric[] = [];
    for (const [key, value] of this.counters) {
      const { name, labels } = this.parse(key);
      out.push({ name, help: "", type: "counter", value, labels });
    }
    for (const [key, value] of this.gauges) {
      const { name, labels } = this.parse(key);
      out.push({ name, help: "", type: "gauge", value, labels });
    }
    for (const [key, arr] of this.histograms) {
      const { name, labels } = this.parse(key);
      out.push({ name, help: "", type: "histogram", value: arr.length, labels, buckets: this.bucketBoundaries });
    }
    return out;
  }

  private parse(key: string): { name: string; labels: Record<string, string> } {
    const [name, labelPart] = key.split("|");
    const labels: Record<string, string> = {};
    if (labelPart) {
      for (const pair of labelPart.split(",")) {
        const [k, v] = pair.split("=");
        labels[k] = v;
      }
    }
    return { name, labels };
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [key, value] of this.counters) {
      const { name, labels } = this.parse(key);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${this.labelStr(labels)} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      const { name, labels } = this.parse(key);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${this.labelStr(labels)} ${value}`);
    }
    for (const [key, arr] of this.histograms) {
      const { name, labels } = this.parse(key);
      lines.push(`# TYPE ${name} histogram`);
      const counts = new Array(this.bucketBoundaries.length).fill(0);
      let total = 0;
      for (const v of arr) {
        total++;
        this.bucketBoundaries.forEach((b, i) => {
          if (v <= b) counts[i]++;
        });
      }
      this.bucketBoundaries.forEach((b, i) => {
        lines.push(`${name}_bucket${this.labelStr({ ...labels, le: String(b) })} ${counts[i]}`);
      });
      lines.push(`${name}_bucket${this.labelStr({ ...labels, le: "+Inf" })} ${total}`);
      lines.push(`${name}_sum${this.labelStr(labels)} ${(arr.reduce((a, b) => a + b, 0)).toFixed(6)}`);
      lines.push(`${name}_count${this.labelStr(labels)} ${total}`);
    }
    return lines.join("\n") + "\n";
  }

  private labelStr(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (!entries.length) return "";
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
  }
}
