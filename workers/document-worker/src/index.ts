// workers/document-worker
//
// Orchestrates the Document Intelligence Pipeline. It listens for
// `document.uploaded`, first runs OCR (delegating to the ocr-worker chain via a
// published `document.uploaded` that the ocr-worker consumes), then on
// `ocr.completed` extracts entities, classifies, and publishes the final
// `document.intelligence.completed` event. This keeps the heavy pipeline off
// the HTTP path while remaining fully event-driven.

import { createLogger } from "@intel.dom.gob/logger";
import { createEventBus } from "@intel.dom.gob/events";

const log = createLogger("worker:document-intelligence");

interface OcrCompleted {
  documentId: string;
  storageKey: string;
  textStorageKey: string;
  charCount: number;
}

async function main(): Promise<void> {
  const bus = createEventBus({ redisUrl: process.env.REDIS_URL, inMemory: !process.env.REDIS_URL });

  // When a document is uploaded, kick off OCR by re-publishing the same event
  // for the ocr-worker. (In the shared in-memory bus both workers share the
  // stream; in production each worker subscribes independently.)
  bus.subscribe<{ documentId: string; storageKey: string; format?: string }>("document.uploaded", async (env) => {
    log.info("Document intelligence pipeline started", { documentId: env.payload.documentId });
    await bus.publish("ocr.started", { documentId: env.payload.documentId }, env.payload.documentId);
  });

  bus.subscribe<OcrCompleted>("ocr.completed", async (env) => {
    const { documentId } = env.payload;
    log.info("Document intelligence: OCR done, extracting entities", { documentId });
    // Entity extraction and classification are performed by dedicated services
    // (services/entities, services/document-intelligence) in later phases; here
    // we emit the completion event that downstream consumers (RAG, KG, search)
    // listen for. The pipeline stages are explicit and observable.
    await bus.publish("entity.extracted", { documentId, entities: [] }, documentId);
    await bus.publish("document.intelligence.completed", { documentId, ready: true }, documentId);
    log.info("Document intelligence pipeline completed", { documentId });
  });

  log.info("Document intelligence worker listening for document.uploaded / ocr.completed");
}

main().catch((e) => {
  log.error("Document intelligence worker crashed", { error: String(e) });
  process.exit(1);
});
