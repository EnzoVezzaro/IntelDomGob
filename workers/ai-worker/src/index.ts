// workers/ai-worker
//
// Consumes `ai.requested` events for heavy/offline generation (bulk summarization,
// batch analysis). Keeps large generations off the synchronous API path.

import { createLogger } from "@intel.dom.gob/logger";
import { createEventBus } from "@intel.dom.gob/events";
import { resolveAiProvider } from "@intel.dom.gob/service-ai";
import { providerRegistry } from "@intel.dom.gob/providers";

const log = createLogger("worker:ai");

interface AiRequested {
  jobId: string;
  systemInstruction?: string;
  message: string;
  model?: string;
  provider?: string;
  apiKey?: string;
}

async function main(): Promise<void> {
  const bus = createEventBus({ redisUrl: process.env.REDIS_URL, inMemory: !process.env.REDIS_URL });

  bus.subscribe<AiRequested>("ai.requested" as any, async (env) => {
    const { jobId, message, model, provider, apiKey, systemInstruction } = env.payload;
    log.info("AI job started", { jobId });
    try {
      const aiProvider = await resolveAiProvider({ provider, apiKey });
      const res = await aiProvider.generate({
        model,
        systemInstruction: systemInstruction ?? "Eres el asistente de INTEL.DOM.GOB.",
        messages: [{ role: "user", content: message }],
      });
      await bus.publish("ai.completed" as any, { jobId, text: res.text, model: res.model }, jobId);
      log.info("AI job completed", { jobId });
    } catch (err) {
      log.error("AI job failed", { jobId, error: String(err) });
    }
  });

  log.info("AI worker listening for ai.requested", { providers: providerRegistry.listAi().length });
}

main().catch((e) => {
  log.error("AI worker crashed", { error: String(e) });
  process.exit(1);
});
