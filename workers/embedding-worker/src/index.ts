// workers/embedding-worker
//
// Consumes `ocr.completed` events and produces embeddings for the extracted
// text via the Embeddings service, publishing `embedding.completed`.

import { createLogger } from "@intel.dom.gob/logger";
import { createEventBus } from "@intel.dom.gob/events";
import { EmbeddingsService } from "@intel.dom.gob/service-embeddings";
import { StorageService } from "@intel.dom.gob/service-storage";

const log = createLogger("worker:embedding");

interface OcrCompleted {
  documentId: string;
  storageKey: string;
  textStorageKey: string;
  charCount: number;
}

async function main(): Promise<void> {
  const bus = createEventBus({ redisUrl: process.env.REDIS_URL, inMemory: !process.env.REDIS_URL });
  const embeddings = await EmbeddingsService.createDefault();
  const storage = new StorageService();

  bus.subscribe<OcrCompleted>("ocr.completed", async (env) => {
    const { documentId, textStorageKey } = env.payload;
    await bus.publish("embedding.started", { documentId }, documentId);
    try {
      const text = (await storage.get(textStorageKey)).toString("utf-8");
      const vector = await embeddings.embed(text);
      const vecKey = `${textStorageKey}.vec.json`;
      await storage.put(vecKey, Buffer.from(JSON.stringify(vector), "utf-8"));
      await bus.publish("embedding.completed", { documentId, vectorStorageKey: vecKey, dim: vector.length }, documentId);
      log.info("Embedding completed", { documentId, dim: vector.length });
    } catch (err) {
      log.error("Embedding failed", { documentId, error: String(err) });
    }
  });

  log.info("Embedding worker listening for ocr.completed events");
}

main().catch((e) => {
  log.error("Embedding worker crashed", { error: String(e) });
  process.exit(1);
});
