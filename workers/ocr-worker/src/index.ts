// workers/ocr-worker
//
// Consumes `document.uploaded` events, runs OCR via the OcrService, stores the
// extracted text, and publishes `ocr.completed`. This keeps heavy OCR work off
// the HTTP request path. The worker is a pure consumer of the event bus — it
// never talks to external systems directly (that is the OcrProvider's job).

import { createLogger } from "@intel.dom.gob/logger";
import { createEventBus } from "@intel.dom.gob/events";
import { providerRegistry } from "@intel.dom.gob/providers";
import { OcrService } from "@intel.dom.gob/service-ocr";
import { StorageService } from "@intel.dom.gob/service-storage";

const log = createLogger("worker:ocr");

interface DocumentUploaded {
  documentId: string;
  /** Storage key for the original file. */
  storageKey: string;
  format?: "text" | "markdown" | "tables";
}

interface OcrCompleted {
  documentId: string;
  storageKey: string;
  textStorageKey: string;
  charCount: number;
}

async function main(): Promise<void> {
  const bus = createEventBus({ redisUrl: process.env.REDIS_URL, inMemory: !process.env.REDIS_URL });
  const ocrProvider = providerRegistry.getOcr("unlimited-ocr") ?? undefined;
  if (!ocrProvider) {
    log.warn("No OCR provider registered; OCR worker will idle until one is available.");
  }
  const ocr = ocrProvider ? new OcrService(ocrProvider) : null;
  const storage = new StorageService();

  bus.subscribe<DocumentUploaded>("document.uploaded", async (env) => {
    const { documentId, storageKey, format } = env.payload;
    if (!ocr) {
      log.warn("Skipping OCR — no provider", { documentId });
      return;
    }
    log.info("OCR started", { documentId });
    await bus.publish("ocr.started", { documentId }, documentId);
    try {
      const file = await storage.get(storageKey);
      const text = format === "markdown"
        ? await ocr.extractMarkdown(file)
        : format === "tables"
          ? await ocr.extractTables(file)
          : await ocr.extractText(file);
      const textKey = `${storageKey}.ocr.txt`;
      await storage.put(textKey, Buffer.from(text, "utf-8"));
      const completed: OcrCompleted = { documentId, storageKey, textStorageKey: textKey, charCount: text.length };
      await bus.publish("ocr.completed", completed, documentId);
      log.info("OCR completed", { documentId, charCount: text.length });
    } catch (err) {
      log.error("OCR failed", { documentId, error: String(err) });
    }
  });

  log.info("OCR worker listening for document.uploaded events");
}

main().catch((e) => {
  log.error("OCR worker crashed", { error: String(e) });
  process.exit(1);
});
