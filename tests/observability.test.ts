// tests/observability.test.ts
import { describe, it, expect } from "vitest";
import { ObservabilityService } from "@intel.dom.gob/service-observability";

describe("ObservabilityService (unit)", () => {
  it("counts counters", () => {
    const obs = new ObservabilityService();
    obs.inc("requests", { status: "200" }, 3);
    const m = obs.collect().find((x) => x.name === "requests");
    expect(m?.value).toBe(3);
    expect(m?.labels?.status).toBe("200");
  });

  it("records timer durations", () => {
    const obs = new ObservabilityService();
    const end = obs.timer("work");
    // busy-wait a tiny bit
    const t = Date.now();
    while (Date.now() - t < 5) {}
    end();
    const m = obs.collect().find((x) => x.name === "work_count");
    expect(m?.value).toBe(1);
    const sum = obs.collect().find((x) => x.name === "work_sum");
    expect(sum!.value).toBeGreaterThan(0);
  });

  it("tracks spans with parent links", () => {
    const obs = new ObservabilityService();
    const parent = obs.startSpan("parent");
    const child = obs.startSpan("child", parent.spanId);
    obs.endSpan(child);
    obs.endSpan(parent);
    const spans = obs.getSpans();
    expect(spans.length).toBe(2);
    expect(child.parentId).toBe(parent.spanId);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.endedAt).toBeDefined();
  });

  it("renders Prometheus text", () => {
    const obs = new ObservabilityService();
    obs.inc("hits", {}, 2);
    const text = obs.renderPrometheus();
    expect(text).toContain("# TYPE hits counter");
    expect(text).toContain("hits 2");
    expect(text).toContain("# TYPE");
  });
});
