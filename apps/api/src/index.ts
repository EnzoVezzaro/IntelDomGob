// API bootstrap — wires providers, services and the orchestrator together, then
// mounts the versioned REST router. The API contains NO business logic: every
// endpoint delegates to the Orchestrator / services.

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import os from "node:os";
import { config } from "@intel.dom.gob/config";
import { createLogger } from "@intel.dom.gob/logger";
import { createSearXNGProvider } from "@intel.dom.gob/provider-searxng";
import { createGeminiProvider } from "@intel.dom.gob/provider-gemini";
import { providerRegistry } from "@intel.dom.gob/providers";
import { AiService } from "@intel.dom.gob/service-ai";
import { SearchService, setSearxngBaseUrl } from "@intel.dom.gob/service-search";
import { Orchestrator } from "@intel.dom.gob/service-orchestrator";
import { KnowledgeGraphService } from "@intel.dom.gob/service-knowledge-graph";
import { EmbeddingsService } from "@intel.dom.gob/service-embeddings";
import { EntitiesService } from "@intel.dom.gob/service-entities";
import { DocumentIntelligenceService } from "@intel.dom.gob/service-document-intelligence";
import { WorkflowEngine } from "@intel.dom.gob/service-workflow";
import { ToolRegistry, createDefaultToolRegistry } from "@intel.dom.gob/service-tool-registry";
import { PromptService } from "@intel.dom.gob/service-prompts";
import { EvaluationService } from "@intel.dom.gob/service-evaluation";
import { ObservabilityService } from "@intel.dom.gob/service-observability";
import { TenantResolver } from "@intel.dom.gob/service-tenancy";
import { PluginRegistry } from "@intel.dom.gob/service-plugins";
import { OcrService } from "@intel.dom.gob/service-ocr";
import { StorageService } from "@intel.dom.gob/service-storage";
import { createDatabase } from "@intel.dom.gob/database";
import { AuthService } from "@intel.dom.gob/service-auth";
import { createEventBus } from "@intel.dom.gob/events";
import { TelemetryService, createTelemetry } from "@intel.dom.gob/service-telemetry";
import { BillingService, createBilling } from "@intel.dom.gob/service-billing";
import { createRouter } from "./routes";

const log = createLogger("api");

export interface BootstrapDeps {
  /** Optional pre-built dependencies (used in tests). */
  orchestrator?: Orchestrator;
  search?: SearchService;
  ai?: AiService;
  embeddings?: import("@intel.dom.gob/service-embeddings").EmbeddingsService;
  entities?: import("@intel.dom.gob/service-entities").EntitiesService;
  documentIntelligence?: import("@intel.dom.gob/service-document-intelligence").DocumentIntelligenceService;
  storage?: import("@intel.dom.gob/service-storage").StorageService;
  ocr?: import("@intel.dom.gob/service-ocr").OcrService;
  bus?: import("@intel.dom.gob/events").EventBus;
  workflowEngine?: import("@intel.dom.gob/service-workflow").WorkflowEngine;
  toolRegistry?: ToolRegistry;
  promptService?: PromptService;
  evaluation?: EvaluationService;
  observability?: ObservabilityService;
  tenancy?: TenantResolver;
  plugins?: PluginRegistry;
  database?: ReturnType<typeof createDatabase>;
  auth?: AuthService;
  knowledgeGraph?: KnowledgeGraphService;
  telemetry?: TelemetryService;
  billing?: BillingService;
}

export async function bootstrap(deps: BootstrapDeps = {}) {
  // 1. Providers
  const searxng = createSearXNGProvider({ baseUrl: config.searxngUrl });
  providerRegistry.registerSearch(searxng);
  setSearxngBaseUrl(config.searxngUrl);

  const gemini = createGeminiProvider({ apiKey: process.env.GEMINI_API_KEY });
  providerRegistry.registerAi(gemini);

  // Additional AI providers are registered only when their keys are present.
  if (process.env.OPENAI_API_KEY) {
    const { createOpenAiProvider } = await import("@intel.dom.gob/provider-openai");
    providerRegistry.registerAi(createOpenAiProvider({ apiKey: process.env.OPENAI_API_KEY }));
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const { createAnthropicProvider } = await import("@intel.dom.gob/provider-anthropic");
    providerRegistry.registerAi(createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }));
  }
  if (process.env.DEEPSEEK_API_KEY) {
    const { createDeepSeekProvider } = await import("@intel.dom.gob/provider-deepseek");
    providerRegistry.registerAi(createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }));
  }
  if (process.env.OLLAMA_BASE_URL) {
    const { createOllamaProvider } = await import("@intel.dom.gob/provider-ollama");
    providerRegistry.registerAi(createOllamaProvider({ baseUrl: process.env.OLLAMA_BASE_URL }));
  }

  // Additional search providers are registered only when their keys are present.
  if (process.env.BRAVE_API_KEY) {
    const { createBraveProvider } = await import("@intel.dom.gob/provider-brave");
    providerRegistry.registerSearch(createBraveProvider({ apiKey: process.env.BRAVE_API_KEY }));
  }
  if (process.env.TAVILY_API_KEY) {
    const { createTavilyProvider } = await import("@intel.dom.gob/provider-tavily");
    providerRegistry.registerSearch(createTavilyProvider({ apiKey: process.env.TAVILY_API_KEY }));
  }
  if (process.env.EXA_API_KEY) {
    const { createExaProvider } = await import("@intel.dom.gob/provider-exa");
    providerRegistry.registerSearch(createExaProvider({ apiKey: process.env.EXA_API_KEY }));
  }

  // OCR provider (Unlimited-OCR) — registered when an endpoint is configured.
  if (process.env.UNLIMITED_OCR_URL) {
    const { createUnlimitedOcrProvider } = await import("@intel.dom.gob/provider-unlimited-ocr");
    providerRegistry.registerOcr(createUnlimitedOcrProvider({ baseUrl: process.env.UNLIMITED_OCR_URL }));
  }

  // Presentation provider (HyperFrames).
  {
    const { createHyperFramesProvider } = await import("@intel.dom.gob/provider-hyperframes");
    providerRegistry.registerPresentation(createHyperFramesProvider({ baseUrl: process.env.HYPERFRAMES_URL }));
  }

  // 2. Services
  const ai = deps.ai ?? new AiService(gemini);
  const search = deps.search ?? new SearchService({ provider: searxng });

  // 3. Orchestrator (the heart)
  const orchestrator = deps.orchestrator ?? new Orchestrator({ ai, search });

  // Knowledge Graph service (proposed differentiator) — in-memory by default.
  const knowledgeGraph = deps.knowledgeGraph ?? new KnowledgeGraphService();

  // Embeddings service (semantic when GEMINI_API_KEY present, hash fallback).
  const embeddings = deps.embeddings ?? (await EmbeddingsService.createDefault());

  // Document intelligence pipeline: storage + ocr + entities + kg + embeddings.
  const storage = deps.storage ?? new StorageService();
  const ocrProvider = providerRegistry.getOcr("unlimited-ocr");
  const ocr = deps.ocr ?? (ocrProvider ? new OcrService(ocrProvider) : undefined);
  const entities = deps.entities ?? new EntitiesService();
  const documentIntelligence = deps.documentIntelligence ?? (ocr
    ? new DocumentIntelligenceService({ storage, ocr, entities, embeddings, knowledgeGraph, bus: deps.bus })
    : undefined);

  // Event bus (DragonflyDB Streams; in-memory fallback when no broker).
  const bus = deps.bus ?? createEventBus({ redisUrl: config.redisUrl });

  // Workflow engine — DAG execution with retries, checkpoints, approvals, HITL.
  const workflowEngine = deps.workflowEngine ?? new WorkflowEngine((type, payload) => bus.publish(type as any, payload).catch(() => {}));

  // Tool registry — declarative, discoverable tools for agents / MCP.
  const toolRegistry = deps.toolRegistry ?? createDefaultToolRegistry();

  // Prompt service — versioned prompt templates rendered at call time.
  const promptService = deps.promptService ?? new PromptService();

  // Evaluation — faithfulness / quality assessment of generated answers.
  const evaluation = deps.evaluation ?? new EvaluationService();

  // Observability — in-process metrics + tracing, exported as Prometheus text.
  const observability = deps.observability ?? new ObservabilityService();

  // Multi-tenancy — tenant resolution + data isolation helpers.
  const tenancy = deps.tenancy ?? new TenantResolver();

  // Plugins — discoverable, guarded extension registry.
  const plugins = deps.plugins ?? new PluginRegistry();

  // 4. Persistence + auth (migrations are idempotent).
  const database = deps.database ?? createDatabase(config);
  const auth = deps.auth ?? new AuthService(database);
  await database.migrate().catch((e) => log.warn("DB migration skipped", { error: String(e) }));

  // Telemetry (logs + metrics in DragonflyDB) and Billing (entitlements + usage).
  const nodeId = process.env.NODE_ID ?? `api-${os.hostname()}-${process.pid}`;
  const telemetry = deps.telemetry ?? createTelemetry(config.redisUrl);
  const billing = deps.billing ?? createBilling(auth, telemetry, database, config.redisUrl);

  // Ensure an admin key exists so the Admin console can authenticate. If
  // INTEL_API_TOKEN is set it is used (so the Admin app's token works); else a
  // one-time key is generated and logged.
  auth.ensureAdminKey(process.env.INTEL_API_TOKEN).then(({ key, created }) => {
    if (created) {
      if (!process.env.INTEL_API_TOKEN) log.info("Generated admin API key for the Admin console", { key });
      else log.info("Seeded admin API key from INTEL_API_TOKEN");
    }
  }).catch((e) => log.warn("Admin key bootstrap skipped", { error: String(e) }));

  // Heartbeat this node for fleet-wide log/metric attribution.
  telemetry.heartbeat(nodeId, "api", os.hostname()).catch(() => {});

  // 5. Express app
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));

  // Basic rate limiting (per IP) to protect the gateway.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Rate limit exceeded", message: "Too many requests, slow down." },
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), service: "api", apiKeyConfigured: !!process.env.GEMINI_API_KEY });
  });
  app.get("/ready", (_req, res) => res.json({ status: "ok", service: "api" }));
  app.get("/live", (_req, res) => res.json({ status: "ok", service: "api" }));

  // Root-level Prometheus metrics (standard scrape target) — mirrors /v1/metrics.
  app.get("/metrics", (_req, res) => {
    if (!observability) {
      res.status(501).json({ error: "Observability unavailable" });
      return;
    }
    res.type("text/plain; version=0.0.4").send(observability.renderPrometheus());
  });

  app.use("/v1", createRouter({ orchestrator, search, auth, knowledgeGraph, ai, embeddings, documentIntelligence, entities, workflowEngine, toolRegistry, promptService, evaluation, observability, tenancy, plugins, billing, telemetry, nodeId }));

  app.use((_req, res) => res.status(404).json({ error: "Not Found", message: "Unknown endpoint" }));

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().then((app) => {
    app.listen(config.apiPort, "0.0.0.0", () => {
      log.info(`API listening on :${config.apiPort}`, { env: config.env, domain: config.domain });
    });
  });
}
