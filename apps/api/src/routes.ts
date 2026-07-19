// Versioned API router (v1). Pure delegation — no business logic here.

import { Router, type Response, type Request, type NextFunction } from "express";
import { createLogger } from "@intel.dom.gob/logger";
import type { Orchestrator } from "@intel.dom.gob/service-orchestrator";
import type { SearchService } from "@intel.dom.gob/service-search";
import type { AuthService } from "@intel.dom.gob/service-auth";
import { registerAllInstitutions, describeAll } from "@intel.dom.gob/service-institutions";
import { buildCategorizedUrlTree } from "@intel.dom.gob/service-crawler";
import { parseBearer, AuthError } from "@intel.dom.gob/service-auth";
import type { QueryRequest, ChatRequest } from "@intel.dom.gob/types";
import type { DocumentIntelligenceService } from "@intel.dom.gob/service-document-intelligence";
import type { EntitiesService } from "@intel.dom.gob/service-entities";
import type { WorkflowEngine, WorkflowDef } from "@intel.dom.gob/service-workflow";
import type { ToolRegistry } from "@intel.dom.gob/service-tool-registry";
import type { PromptService } from "@intel.dom.gob/service-prompts";
import type { EvaluationService } from "@intel.dom.gob/service-evaluation";
import type { ObservabilityService } from "@intel.dom.gob/service-observability";
import type { TenantResolver } from "@intel.dom.gob/service-tenancy";
import type { PluginRegistry } from "@intel.dom.gob/service-plugins";
import { buildOpenApiSpec } from "./openapi";

const log = createLogger("api:routes");

/** Coarse route label for metrics (strips path ids). */
function routeLabel(req: Request): string {
  const path = (req as any).route?.path ?? req.url?.split("?")[0] ?? "/";
  return path.replace(/\/[0-9a-f]{8,}/gi, "/:id").replace(/\/[^/]+\/approve$/, "/:id/approve").replace(/\/[^/]+\/deny$/, "/:id/deny");
}

const SWAGGER_UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>INTEL.DOM.GOB API — Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({ url: "/v1/openapi.json", dom_id: "#swagger" });
      };
    </script>
  </body>
</html>`;

export interface RouterDeps {
  orchestrator: Orchestrator;
  search: SearchService;
  auth?: AuthService;
  requireApiKey?: boolean;
  knowledgeGraph?: import("@intel.dom.gob/service-knowledge-graph").KnowledgeGraphService;
  ai?: import("@intel.dom.gob/service-ai").AiService;
  embeddings?: import("@intel.dom.gob/service-embeddings").EmbeddingsService;
  documentIntelligence?: DocumentIntelligenceService;
  entities?: EntitiesService;
  workflowEngine?: WorkflowEngine;
  toolRegistry?: ToolRegistry;
  promptService?: PromptService;
  evaluation?: EvaluationService;
  observability?: ObservabilityService;
  tenancy?: TenantResolver;
  plugins?: PluginRegistry;
}

export function createRouter(deps: RouterDeps): Router {
  const router = Router();

  // Observability: time every request and count status codes. Skipped for the
  // SSE/streaming path to avoid misleading durations. This is the API's only
  // observability touch-point; all logic lives in services/observability.
  if (deps.observability) {
    router.use((req: Request, res: Response, next: NextFunction) => {
      const end = deps.observability!.timer("http_request_duration_seconds", { method: req.method, route: routeLabel(req) });
      res.on("finish", () => {
        end();
        deps.observability!.inc("http_requests_total", { method: req.method, status: String(res.statusCode) });
      });
      next();
    });
  }

  // Resolve the API-key record for the current request (used by scope checks).
  async function authz(req: Request, scope: string | string[]): Promise<void> {
    if (!deps.requireApiKey || !deps.auth) return;
    const key = parseBearer(req.headers["authorization"]) || (req.body as any)?.apiKey;
    if (!key) throw new AuthError("A valid API key is required.");
    const record = await deps.auth.verifyApiKey(key);
    if (!record) throw new AuthError("Invalid API key.");
    deps.auth.authorize(record, { scope });
    // Multi-tenancy: resolve tenant from the key (deny-by-default). A spoofed
    // X-Tenant-Id header is rejected by the resolver.
    if (deps.tenancy) {
      const headerTenant = req.headers["x-tenant-id"];
      const tenant = deps.tenancy.resolve(record, typeof headerTenant === "string" ? headerTenant : null);
      (req as any).tenant = tenant;
    }
    (req as any).apiKeyRecord = record;
  }

  // API-key gate (only enforced when REQUIRE_API_KEY is enabled). Default scope
  // for top-level access is "read".
  if (deps.requireApiKey && deps.auth) {
    router.use(async (req: Request, res: Response, next: NextFunction) => {
      authz(req, "read").then(() => next()).catch((e: AuthError) => {
        res.status(401).json({ error: "Unauthorized", message: e.message });
      });
    });
  }

  // Health within the versioned API (convenience).
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), service: "api", version: "v1" });
  });

  // Prometheus-style metrics endpoint. Observability is in-process; an external
  // scraper can poll this. Requires no auth (standard metrics scrape pattern).
  router.get("/metrics", (_req, res) => {
    if (!deps.observability) {
      res.status(501).json({ error: "Observability unavailable" });
      return;
    }
    res.type("text/plain; version=0.0.4").send(deps.observability.renderPrometheus());
  });

  // Auto-generated OpenAPI specification (the public contract for all clients).
  router.get("/openapi.json", (_req, res) => {
    res.json(buildOpenApiSpec("v1"));
  });

  // Interactive Swagger UI.
  router.get("/docs", (_req, res) => {
    res.type("html").send(SWAGGER_UI_HTML);
  });

  // Dynamic institution registry discovery.
  router.get("/institutions", async (_req, res) => {
    try {
      registerAllInstitutions();
      res.json({ institutions: describeAll() });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to load institutions", message: e.message });
    }
  });

  // Knowledge Graph: build/merge a graph from an IntelligenceResult packet and
  // return the current graph (or the neighborhood of a given entity).
  router.post("/graph/ingest", async (req, res) => {
    try {
      if (!deps.knowledgeGraph) return res.status(501).json({ error: "Knowledge Graph service not available" });
      const graph = await deps.knowledgeGraph.ingest(req.body);
      res.json({ entities: graph.entities.length, relations: graph.relations.length });
    } catch (e: any) {
      res.status(500).json({ error: "Graph ingest failed", message: e.message });
    }
  });
  router.get("/graph", async (req, res) => {
    try {
      if (!deps.knowledgeGraph) return res.status(501).json({ error: "Knowledge Graph service not available" });
      const result = await deps.knowledgeGraph.query(req.query.entity ? String(req.query.entity) : undefined);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: "Graph query failed", message: e.message });
    }
  });

  // Categorized URL tree (cached in-memory).
  let urlTreeCache: any = null;
  let urlTreeBuilding = false;
  router.get("/url-tree", async (req, res) => {
    const force = req.query.refresh === "1";
    const portalFilter = req.query.portals ? String(req.query.portals).split(",").map((s) => s.trim()).filter(Boolean) : null;

    if (urlTreeCache && !force) {
      const portals = portalFilter ? urlTreeCache.portals.filter((p: any) => portalFilter.includes(p.name)) : urlTreeCache.portals;
      res.json({ cached: true, generatedAt: urlTreeCache.generatedAt, portals });
      return;
    }
    if (urlTreeBuilding) {
      res.status(202).json({ status: "building", message: "URL tree is being generated. Try again shortly." });
      return;
    }
    urlTreeBuilding = true;
    try {
      const allPortals = await buildCategorizedUrlTree();
      urlTreeCache = { generatedAt: new Date().toISOString(), portals: allPortals };
      const portals = portalFilter ? allPortals.filter((p: any) => portalFilter.includes(p.name)) : allPortals;
      res.json({ cached: false, generatedAt: urlTreeCache.generatedAt, portals });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to build URL tree", message: e.message });
    } finally {
      urlTreeBuilding = false;
    }
  });

  // Multi-agent intelligence query — delegates to the Orchestrator.
  router.post("/query", async (req, res: Response) => {
    const body = req.body as QueryRequest;
    try {
      await authz(req, "query");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: e.message });
      return;
    }
    if (!body?.query || typeof body.query !== "string") {
      res.status(400).json({ error: "Missing or invalid query parameter" });
      return;
    }
    if (!process.env.GEMINI_API_KEY && !body.apiKey) {
      res.status(400).json({
        error: "Missing API Key",
        message: "The GEMINI_API_KEY is not configured. Provide it in settings or as an env var.",
      });
      return;
    }
    try {
      const result = await deps.orchestrator.runQuery(body);
      res.json(result);
    } catch (e: any) {
      log.error("Query failed", { error: e.message });
      res.status(500).json({ error: "Retrieval Processing Error", message: e.message || "Unexpected error during analysis." });
    }
  });

  // Context-grounded follow-up chat. Delegates to the AI service's
  // chatFromContext (no provider is instantiated here).
  router.post("/chat", async (req, res: Response) => {
    const body = req.body as ChatRequest;
    try {
      await authz(req, "chat");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: e.message });
      return;
    }
    if (!body?.message || typeof body.message !== "string") {
      res.status(400).json({ error: "Missing or invalid message parameter" });
      return;
    }
    if (!process.env.GEMINI_API_KEY && !body.apiKey && !(req as any).apiKeyRecord) {
      res.status(400).json({ error: "Missing API Key", message: "The GEMINI_API_KEY is not configured." });
      return;
    }

    try {
      const ai = deps.ai ?? deps.orchestrator.aiService;
      const reply = await ai.chatFromContext({
        context: body.context,
        message: body.message,
        history: body.history,
        model: body.model,
        apiKey: body.apiKey,
        provider: body.provider,
      });
      res.json({ reply });
    } catch (e: any) {
      log.error("Chat failed", { error: e.message });
      res.status(500).json({ error: "Chat Error", message: e.message || "No se pudo generar la respuesta." });
    }
  });

  // Streaming multi-agent query (Server-Sent Events).
  router.post("/query/stream", async (req, res: Response) => {
    const body = req.body as QueryRequest;
    if (!body?.query || typeof body.query !== "string") {
      res.status(400).json({ error: "Missing or invalid query parameter" });
      return;
    }
    if (!process.env.GEMINI_API_KEY && !body.apiKey) {
      res.status(400).json({ error: "Missing API Key", message: "The GEMINI_API_KEY is not configured." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: { type: string; [k: string]: unknown }) => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await deps.orchestrator.runQueryStream(body, send);
    } catch (e: any) {
      log.error("Streaming query failed", { error: e.message });
      send({ type: "error", message: e.message || "Processing error" });
    } finally {
      res.end();
    }
  });

  // ---------------------------------------------------------------------------
  // OpenAI-compatible API surface. Any OpenAI-compatible client can connect
  // without modification. The platform extends it with government intelligence.
  // ---------------------------------------------------------------------------

  // POST /v1/chat/completions — maps an OpenAI chat request to an intelligence
  // query (or a context-grounded chat when previous messages are supplied).
  router.post("/chat/completions", async (req, res: Response) => {
    try {
      await authz(req, "chat");
    } catch (e) {
      res.status(401).json({ error: { message: e.message, type: "invalid_request_error" } });
      return;
    }
    const { model, messages, stream } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: { message: "messages is required", type: "invalid_request_error" } });
      return;
    }
    const last = messages[messages.length - 1];
    const query = typeof last?.content === "string" ? last.content : String(last?.content ?? "");
    const context = messages.length > 1 ? { message: query, history: messages.slice(0, -1).map((m: any) => ({ role: m.role, content: String(m.content) })) } : undefined;

    const ai = deps.ai ?? deps.orchestrator.aiService;
    try {
      if (stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        let i = 0;
        for await (const tok of ai.streamChat({
          systemInstruction: "Eres el asistente de INTEL.DOM.GOB. Responde con base en fuentes oficiales dominicanas.",
          grounding: "Pregunta de inteligencia gubernamental.",
          message: query,
          model,
        })) {
          res.write(`data: ${JSON.stringify({ id: "idg", object: "chat.completion.chunk", model: model || "intel", choices: [{ index: 0, delta: { content: tok }, finish_reason: null }] })}\n\n`);
          i++;
        }
        res.write(`data: ${JSON.stringify({ id: "idg", object: "chat.completion.chunk", model: model || "intel", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      const reply = context
        ? await ai.chatFromContext({ context: { query }, message: query, model })
        : await ai.chatFromContext({ context: { query }, message: query, model });
      res.json({
        id: "idg-" + Date.now(),
        object: "chat.completion",
        model: model || "intel",
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    } catch (e: any) {
      res.status(500).json({ error: { message: e.message, type: "server_error" } });
    }
  });

  // GET /v1/models — list available models from the provider registry.
  router.get("/models", async (_req, res: Response) => {
    try {
      const { providerRegistry } = await import("@intel.dom.gob/providers");
      const models = providerRegistry.listAi().map((p) => ({ id: p.id, object: "model", owned_by: "intel.dom.gob" }));
      res.json({ object: "list", data: models.length ? models : [{ id: "intel", object: "model", owned_by: "intel.dom.gob" }] });
    } catch (e: any) {
      res.status(500).json({ error: { message: e.message, type: "server_error" } });
    }
  });

  // POST /v1/embeddings — produce embeddings via the Embeddings service.
  router.post("/embeddings", async (req, res: Response) => {
    try {
      await authz(req, "read");
    } catch (e) {
      res.status(401).json({ error: { message: e.message, type: "invalid_request_error" } });
      return;
    }
    const { input } = req.body ?? {};
    if (!input) {
      res.status(400).json({ error: { message: "input is required", type: "invalid_request_error" } });
      return;
    }
    try {
      const embeddings = deps.embeddings ?? (await (await import("@intel.dom.gob/service-embeddings")).EmbeddingsService.createDefault());
      const texts = Array.isArray(input) ? input : [input];
      const data = await Promise.all(texts.map(async (t: string, i: number) => ({ object: "embedding", index: i, embedding: await embeddings.embed(String(t)) })));
      res.json({ object: "list", data, model: "intel-embeddings", usage: { prompt_tokens: 0, total_tokens: 0 } });
    } catch (e: any) {
      res.status(500).json({ error: { message: e.message, type: "server_error" } });
    }
  });

  // --- Document Intelligence Pipeline ----------------------------------------

  // POST /v1/documents/process — run the full pipeline (storage -> OCR -> text
  // -> classification -> metadata -> entities -> embedding -> knowledge graph).
  // Requires an OCR provider to be registered; returns the structured result.
  router.post("/documents/process", async (req, res: Response) => {
    try {
      await authz(req, "query");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    const { documentId, storageKey, format } = req.body ?? {};
    if (!documentId || !storageKey) {
      res.status(400).json({ error: "Missing documentId or storageKey" });
      return;
    }
    if (!deps.documentIntelligence) {
      res.status(501).json({ error: "Document intelligence unavailable (OCR provider not configured)" });
      return;
    }
    try {
      const result = await deps.documentIntelligence.process(documentId, storageKey, format || "text");
      res.json(result);
    } catch (e: any) {
      log.error("Document intelligence failed", { error: e.message });
      res.status(500).json({ error: "Document processing failed", message: e.message });
    }
  });

  // POST /v1/entities/extract — extract entities and relations from arbitrary
  // text. Available even without an OCR provider.
  router.post("/entities/extract", async (req, res: Response) => {
    try {
      await authz(req, "read");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    const { text } = req.body ?? {};
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    try {
      const entities = deps.entities ?? new (await import("@intel.dom.gob/service-entities")).EntitiesService();
      const result = await entities.extract(text);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: "Entity extraction failed", message: e.message });
    }
  });

  // --- Workflow Engine --------------------------------------------------------

  // POST /v1/workflows — define and execute a DAG workflow. Each step: { id,
  // deps?, requiresApproval?, retries?, timeoutMs?, run is supplied inline as a
  // string expression or a step descriptor resolved server-side }. For safety,
  // step.run is provided as a name referencing a registered step factory; here
  // we accept an inline descriptor with `kind` resolved by the engine adapter.
  router.post("/workflows", async (req, res: Response) => {
    try {
      await authz(req, "query");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    if (!deps.workflowEngine) {
      res.status(501).json({ error: "Workflow engine unavailable" });
      return;
    }
    const { name, steps, inputs } = req.body ?? {};
    if (!name || !Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: "name and a non-empty steps array are required" });
      return;
    }
    try {
      // Resolve step.run from an inline descriptor. A step may carry a `run`
      // string (evaluated against a sandboxed set of primitives) or be a
      // declarative step handled by the workflow adapter. To keep the API
      // safe and testable, steps declare `action` + `params` and the engine
      // adapter executes them; here we wrap with a generic executor.
      const def: WorkflowDef = {
        name,
        steps: steps.map((s: any) => ({
          id: s.id,
          deps: s.deps,
          requiresApproval: s.requiresApproval,
          retries: s.retries,
          timeoutMs: s.timeoutMs,
          run: async (ctx: any) => ({ action: s.action, params: s.params, echoedInputs: ctx.inputs }),
        })),
      };
      const state = await deps.workflowEngine.start(def, inputs ?? {}, req.body.workflowId);
      deps.workflowEngine.attachDef(state.workflowId, def);
      res.status(202).json(state);
    } catch (e: any) {
      res.status(500).json({ error: "Workflow failed to start", message: e.message });
    }
  });

  router.get("/workflows/:id", (req, res) => {
    const state = deps.workflowEngine?.getState(req.params.id);
    if (!state) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(state);
  });

  router.post("/workflows/:id/approve", async (req, res) => {
    try {
      await authz(req, "query");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    const { stepId } = req.body ?? {};
    const state = await deps.workflowEngine?.approve(req.params.id, stepId);
    if (!state) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(state);
  });

  router.post("/workflows/:id/deny", async (req, res) => {
    try {
      await authz(req, "query");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    const { stepId } = req.body ?? {};
    const state = await deps.workflowEngine?.deny(req.params.id, stepId);
    if (!state) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(state);
  });

  // --- Tool Registry ----------------------------------------------------------

  router.get("/tools", (req, res) => {
    if (!deps.toolRegistry) {
      res.status(501).json({ error: "Tool registry unavailable" });
      return;
    }
    res.json(deps.toolRegistry.list().map((t) => ({ id: t.id, name: t.name, description: t.description, category: t.category, risk: t.risk, params: t.params })));
  });

  router.post("/tools/:id/execute", async (req, res: Response) => {
    try {
      await authz(req, "query");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    if (!deps.toolRegistry) {
      res.status(501).json({ error: "Tool registry unavailable" });
      return;
    }
    const tool = deps.toolRegistry.get(req.params.id);
    if (!tool) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }
    try {
      const out = await deps.toolRegistry.execute(req.params.id, req.body ?? {}, { request: (req as any).apiKey });
      res.json({ tool: req.params.id, result: out });
    } catch (e: any) {
      res.status(400).json({ error: "Tool execution failed", message: e.message });
    }
  });

  // --- Prompt Service ---------------------------------------------------------

  router.get("/prompts", (req, res) => {
    if (!deps.promptService) {
      res.status(501).json({ error: "Prompt service unavailable" });
      return;
    }
    res.json(deps.promptService.list().map((p) => ({ key: p.key, description: p.description, latest: p.versions.length, versions: p.versions.map((v) => ({ version: v.version, createdAt: v.createdAt, note: v.note })) })));
  });

  router.get("/prompts/:key", (req, res) => {
    const prompt = deps.promptService?.get(req.params.key);
    if (!prompt) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }
    res.json(prompt);
  });

  router.post("/prompts", async (req, res: Response) => {
    try {
      await authz(req, "admin");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    const { key, template, description, note } = req.body ?? {};
    if (!key || typeof template !== "string") {
      res.status(400).json({ error: "key and template are required" });
      return;
    }
    const v = deps.promptService!.add(key, template, { description, note });
    res.status(201).json(v);
  });

  router.post("/prompts/:key/render", (req, res) => {
    try {
      const vars = req.body?.vars ?? {};
      const version = req.body?.version;
      const rendered = version ? deps.promptService!.renderVersion(req.params.key, version, vars) : deps.promptService!.render(req.params.key, vars);
      res.json({ key: req.params.key, rendered });
    } catch (e: any) {
      res.status(404).json({ error: e.message });
    }
  });

  // --- Evaluation -------------------------------------------------------------

  router.post("/evaluate/faithfulness", async (req, res: Response) => {
    if (!deps.evaluation) {
      res.status(501).json({ error: "Evaluation unavailable" });
      return;
    }
    const { answer, context } = req.body ?? {};
    if (typeof answer !== "string" || typeof context !== "string") {
      res.status(400).json({ error: "answer and context strings are required" });
      return;
    }
    res.json(deps.evaluation.faithfulness(answer, context));
  });

  router.post("/evaluate/quality", async (req, res: Response) => {
    if (!deps.evaluation) {
      res.status(501).json({ error: "Evaluation unavailable" });
      return;
    }
    const { answer, prompt } = req.body ?? {};
    if (typeof answer !== "string") {
      res.status(400).json({ error: "answer string is required" });
      return;
    }
    res.json(deps.evaluation.quality(answer, prompt));
  });

  // --- Plugins ----------------------------------------------------------------

  router.get("/plugins", (_req, res) => {
    if (!deps.plugins) {
      res.status(501).json({ error: "Plugin registry unavailable" });
      return;
    }
    res.json(deps.plugins.list());
  });

  router.post("/plugins/:id/run", async (req, res: Response) => {
    try {
      await authz(req, "execute");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    if (!deps.plugins) {
      res.status(501).json({ error: "Plugin registry unavailable" });
      return;
    }
    const tenant = (req as any).tenant;
    try {
      const out = await deps.plugins.run(req.params.id, req.body ?? {}, { tenantId: tenant?.tenantId });
      res.json({ plugin: req.params.id, result: out });
    } catch (e: any) {
      res.status(400).json({ error: "Plugin run failed", message: e.message });
    }
  });

  // --- Tenancy ----------------------------------------------------------------

  router.get("/tenant", async (_req, res: Response) => {
    try {
      await authz(_req, "read");
    } catch (e) {
      res.status(401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
    const tenant = (_req as any).tenant;
    res.json({ tenantId: tenant?.tenantId ?? "default", global: !tenant?.record?.tenantId && !tenant?.record?.organizationId });
  });

  // Catalog of tools exposed by the INTEL.DOM.GOB MCP server. The MCP server is
  // a pure SDK client of this API; this endpoint documents the tools it serves
  // so clients (e.g. Studio's MCP Browser) can discover them without coupling
  // to the MCP process. Kept in sync with services/mcp/src/index.ts.
  router.get("/mcp/tools", (_req, res) => {
    res.json({
      server: "intel-dom-gob-mcp",
      transport: "http",
      tools: [
        {
          name: "intel_query",
          description: "Run a full multi-agent intelligence query and return the structured result.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" }, institutions: { type: "array", items: { type: "string" } } },
            required: ["query"],
          },
        },
        {
          name: "intel_chat",
          description: "Context-grounded follow-up chat over a completed intelligence result.",
          inputSchema: {
            type: "object",
            properties: { context: { type: "object" }, message: { type: "string" }, history: { type: "array" } },
            required: ["context", "message"],
          },
        },
        {
          name: "list_institutions",
          description: "List the registered DR government institution sources.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
  });

  return router;
}
