// tests/events.test.ts
//
// Unit tests for the Event Bus. Uses the in-memory transport so no broker is
// required. Covers publish/subscribe dispatch and the canonical event types.

import { describe, it, expect } from "vitest";
import { EventBus, type PlatformEvent } from "@intel.dom.gob/events";

describe("EventBus (in-memory transport)", () => {
  it("delivers a published event to a subscribed handler", async () => {
    const bus = new EventBus({ inMemory: true });
    const received: any[] = [];
    bus.subscribe("document.uploaded" as PlatformEvent, (env) => {
      received.push(env);
    });
    await bus.publish("document.uploaded" as PlatformEvent, { documentId: "d1", storageKey: "k1" }, "d1");
    // dispatch is synchronous in the in-memory fallback
    expect(received.length).toBe(1);
    expect(received[0].payload.documentId).toBe("d1");
    expect(received[0].correlationId).toBe("d1");
    expect(received[0].type).toBe("document.uploaded");
    await bus.close();
  });

  it("routes different event types to their own handlers", async () => {
    const bus = new EventBus({ inMemory: true });
    const ocr: any[] = [];
    const embed: any[] = [];
    bus.subscribe("ocr.completed" as PlatformEvent, (e) => ocr.push(e.payload));
    bus.subscribe("embedding.completed" as PlatformEvent, (e) => embed.push(e.payload));
    await bus.publish("ocr.completed" as PlatformEvent, { documentId: "d1" });
    await bus.publish("embedding.completed" as PlatformEvent, { documentId: "d1", dim: 768 });
    expect(ocr.length).toBe(1);
    expect(embed.length).toBe(1);
    expect(embed[0].dim).toBe(768);
    await bus.close();
  });

  it("isolates handlers per event type", async () => {
    const bus = new EventBus({ inMemory: true });
    let count = 0;
    bus.subscribe("workflow.completed" as PlatformEvent, () => {
      count++;
    });
    await bus.publish("ocr.started" as PlatformEvent, { documentId: "x" });
    expect(count).toBe(0);
    await bus.publish("workflow.completed" as PlatformEvent, { workflowId: "w1" });
    expect(count).toBe(1);
    await bus.close();
  });
});
