// tests/workers.test.ts
//
// Verifies the event-driven worker pipeline end-to-end using the in-memory
// event bus (no DragonflyDB required). Simulates the OCR -> embedding chain
// that the real workers implement, proving the publish/subscribe contract that
// keeps heavy work off the HTTP path.

import { describe, it, expect } from "vitest";
import { EventBus } from "@intel.dom.gob/events";

describe("Worker pipeline (OCR -> Embedding)", () => {
  it("flows document.uploaded through ocr.completed to embedding.completed", async () => {
    const bus = new EventBus({ inMemory: true });
    const steps: string[] = [];

    // Simulate ocr-worker
    bus.subscribe<{ documentId: string; storageKey: string }>("document.uploaded", async (env) => {
      steps.push("ocr.started");
      await bus.publish("ocr.completed", { documentId: env.payload.documentId, textStorageKey: "k.txt", charCount: 10 }, env.payload.documentId);
    });

    // Simulate embedding-worker
    bus.subscribe<{ documentId: string }>("ocr.completed", async (env) => {
      steps.push("embedding.started");
      await bus.publish("embedding.completed", { documentId: env.payload.documentId, dim: 768 }, env.payload.documentId);
    });

    bus.subscribe<{ documentId: string }>("embedding.completed", (env) => {
      steps.push("embedding.done:" + env.payload.documentId);
    });

    await bus.publish("document.uploaded", { documentId: "doc-1", storageKey: "doc-1.pdf" }, "doc-1");

    expect(steps).toEqual([
      "ocr.started",
      "embedding.started",
      "embedding.done:doc-1",
    ]);
    await bus.close();
  });

  it("isolates work per correlation id", async () => {
    const bus = new EventBus({ inMemory: true });
    const seen: string[] = [];
    bus.subscribe<{ documentId: string }>("ocr.completed", (env) => seen.push(env.correlationId!));
    await bus.publish("ocr.completed", { documentId: "a" }, "a");
    await bus.publish("ocr.completed", { documentId: "b" }, "b");
    expect(seen).toEqual(["a", "b"]);
    await bus.close();
  });
});
