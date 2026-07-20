// Versioned API router (v1). Pure delegation — no business logic here.
//
// ENDPOINT CLASSIFICATION (wall logic lives in createRouter):
//   [PUBLIC-FACING] product endpoints — always behind the API-key wall;
//       no key => "Público" preview (tight shared limits). See README
//       "Suscripciones (API Key Tiers)".
//   [INTERNAL]       infrastructure/operator endpoints — require a valid key
//       (no preview). /admin/* and Swagger/OpenAPI are admin-only.
// The API itself is PRIVATE: our public-facing products (Studio, Web, CLI,
// MCP, SDK) are the only clients.

import { Router, type Response, type Request, type NextFunction } from "express";
import { createLogger } from "@intel.dom.gob/logger";
import type { Orchestrator } from "@intel.dom.gob/service-orchestrator";
import type { SearchService } from "@intel.dom.gob/service-search";
import type { AuthService } from "@intel.dom.gob/service-auth";
import { registerAllInstitutions, describeAll, getInstitution } from "@intel.dom.gob/service-institutions";
import { tools as mcpTools } from "@intel.dom.gob/service-mcp";
import { buildCategorizedUrlTree } from "@intel.dom.gob/service-crawler";
import { parseBearer, AuthError, type ApiKeyRecord, PREVIEW_RECORD } from "@intel.dom.gob/service-auth";
import { BillingService } from "@intel.dom.gob/service-billing";
import { METERED_SCOPES } from "@intel.dom.gob/service-billing";
import type { TelemetryService } from "@intel.dom.gob/service-telemetry";
import { setLogSink } from "@intel.dom.gob/logger";
import { AsyncLocalStorage } from "node:async_hooks";
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
  billing?: BillingService;
  telemetry?: TelemetryService;
  /** Identifier of this API instance for fleet-wide log/metric attribution. */
  nodeId?: string;
}

/**
 * Per-request correlation store. The API registers a log sink (see createRouter)
 * that tags every emitted log with the fields collected here, so the Admin
 * console can filter logs by apiKey / tenant / product / node / user.
 */
const requestContext = new AsyncLocalStorage<Record<string, string>>();

export function createRouter(deps: RouterDeps): Router {
  const router = Router();

  // Per-request correlation: run every request inside an AsyncLocalStorage store
  // (node id + anything authz adds later), and forward all structured logs to
  // Telemetry tagged with those fields. This is what lets the Admin console
  // "see all logs everywhere" filtered by apiKey / tenant / product / node.
  router.use((req: Request, res: Response, next: NextFunction) => {
    const store: Record<string, string> = { node: deps.nodeId ?? process.env.NODE_ID ?? "api" };
    (req as any).__res = res;
    requestContext.run(store, () => {
      (req as any).__ctx = store;
      next();
    });
  });

  if (deps.telemetry) {
    setLogSink((entry) => {
      const ctx = requestContext.getStore();
      if (ctx) Object.assign(entry, ctx);
      deps.telemetry!.appendLog(entry).catch(() => {});
    });
  }

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

  // --- Endpoint classification ------------------------------------------------
  // The API is PRIVATE (it is our product). Our public-facing products
  // (Studio, Web, CLI, MCP, SDK) are the only clients. Two tiers:
  //   [PUBLIC-FACING]  product endpoints — always behind the API-key wall.
  //       No key  -> anonymous "Público" preview identity (tight shared limits).
  //       Key     -> that tier's blockers (scopes, rate, daily quota, payment).
  //   [INTERNAL]     infrastructure/operator endpoints — require a valid key
  //       (no preview). /admin/* and Swagger/OpenAPI are admin-only.
  // See README "Suscripciones (API Key Tiers)" for the full tier table.
  function resolveScope(scope: string | string[]): string {
    return Array.isArray(scope) ? scope[0] : scope;
  }

  // Enforce the wall. `allowPreview=false` (internal endpoints) rejects keyless
  // requests; `allowPreview=true` (public-facing) falls back to PREVIEW_RECORD.
  async function authz(req: Request, scope: string | string[], allowPreview = true): Promise<void> {
    if (!deps.auth) return;
    const key = parseBearer(req.headers["authorization"]) || (req.body as any)?.apiKey;
    let record: ApiKeyRecord;
    if (!key) {
      if (!allowPreview) throw new AuthError("A valid API key is required.");
      record = PREVIEW_RECORD;
    } else {
      const verified = await deps.auth.verifyApiKey(key);
      if (!verified) throw new AuthError("Invalid API key.");
      record = verified;
    }
    deps.auth.authorize(record, { scope });
    // Billing gate: payment status + rate limit + daily quota for metered scopes.
    if (deps.billing) await deps.billing.guard(record, resolveScope(scope));
    // Multi-tenancy: resolve tenant from the key (deny-by-default). A spoofed
    // X-Tenant-Id header is rejected by the resolver.
    if (deps.tenancy) {
      const headerTenant = req.headers["x-tenant-id"];
      const tenant = deps.tenancy.resolve(record, typeof headerTenant === "string" ? headerTenant : null);
      (req as any).tenant = tenant;
    }
    (req as any).apiKeyRecord = record;
    // Collect correlation fields for structured logs (consumed by the sink).
    const ctx = (req as any).__ctx as Record<string, string> | undefined;
    if (ctx) {
      ctx.apiKeyId = record.id;
      if (record.product) ctx.product = record.product;
      if (record.tenantId) ctx.tenantId = record.tenantId;
      if (record.organizationId) ctx.organizationId = record.organizationId;
    }
    // Metering: record the served request (counts, latency, errors) on finish.
    if (deps.billing && METERED_SCOPES.has(resolveScope(scope))) {
      const start = process.hrtime.bigint();
      const r = (req as any).__res as Response;
      r.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        deps.billing!.recordRequest(record, { status: r.statusCode, latencyMs: ms }).catch(() => {});
      });
    }
  }

  // Public-facing READ endpoints (all GET) are gated here with the preview
  // fallback. Write/internal routes call `authz(...)` explicitly in-handler.
  const PUBLIC_READ_PREFIXES = [
    "/institutions", "/sil/", "/senado/news", "/graph", "/url-tree",
    "/models", "/tools", "/prompts", "/plugins", "/mcp/tools",
  ];
  const isPublicRead = (path: string): boolean =>
    !path.startsWith("/graph/ingest") &&
    PUBLIC_READ_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p));
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" && isPublicRead(req.path)) {
      authz(req, "read").then(() => next()).catch((e: AuthError) => {
        res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: e.message });
      });
    } else {
      next();
    }
  });

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
  // Swagger/OpenAPI is NOT public — admin-only (the API is private).
  router.get("/openapi.json", adminOnly, (_req, res) => {
    res.json(buildOpenApiSpec("v1"));
  });

  // Interactive Swagger UI (admin-only).
  router.get("/docs", adminOnly, (_req, res) => {
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

  // Per-institution search endpoint.
  router.get("/institutions/:id/search", async (req, res) => {
    try {
      registerAllInstitutions();
      const svc = getInstitution(req.params.id);
      if (!svc) {
        res.status(404).json({ error: `Unknown institution: ${req.params.id}` });
        return;
      }
      const q = String(req.query.q ?? req.query.query ?? "");
      const results = await svc.search(q);
      res.json({ id: svc.id, name: svc.name, results });
    } catch (e: any) {
      res.status(500).json({ error: "Institution search failed", message: e.message });
    }
  });

  // [PUBLIC-FACING] Institution / SIL discovery (read-only, behind wall + preview)
  // --- Institution Direct Data Endpoints ---------------------------------------
  // Both chambers have their own SIL (Sistema de Información Legislativa):
  //   - Cámara SIL: diputadosrd.gob.do/sil/api/
  //   - Senado SIL: memoriahistorica.senadord.gob.do/server/api (DSpace)
  // These bypass the full query pipeline and hit institution APIs directly.

  // Cámara SIL endpoints (diputadosrd.gob.do)
  router.get("/sil/camara/iniciativas", async (req, res: Response) => {
    try {
      const { chamberApi } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const periodoId = Number(req.query.periodoId || 0);
      const result = await chamberApi.getLaws(q, periodoId);
      res.json({ total: result.length, results: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cámara SIL: Comisiones
  router.get("/sil/camara/comision/tipo", async (req, res: Response) => {
    try {
      const { getComisionTipos } = await import("@intel.dom.gob/service-institutions");
      const periodoId = Number(req.query.periodoId || 0);
      const result = await getComisionTipos(periodoId);
      res.json({ total: result.length, results: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sil/camara/comisiones", async (req, res: Response) => {
    try {
      const { getComisionesByTipo, getComisiones } = await import("@intel.dom.gob/service-institutions");
      const periodoId = Number(req.query.periodoId || 0);
      const tipoId = Number(req.query.tipoId || 0);
      if (tipoId) {
        const result = await getComisionesByTipo(tipoId, periodoId);
        res.json({ total: result.length, results: result });
      } else {
        const result = await getComisiones(periodoId);
        res.json({ total: result.length, results: result });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cámara SIL: Iniciativas — count, grupos, materias, filtered search
  router.get("/sil/camara/iniciativa/count", async (req, res: Response) => {
    try {
      const { getIniciativaCount } = await import("@intel.dom.gob/service-institutions");
      const periodoId = Number(req.query.periodoId || 0);
      const count = await getIniciativaCount(periodoId);
      res.json({ total: count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sil/camara/iniciativa/grupos", async (req, res: Response) => {
    try {
      const { getIniciativaGrupos } = await import("@intel.dom.gob/service-institutions");
      const periodoId = Number(req.query.periodoId || 0);
      const result = await getIniciativaGrupos(periodoId);
      res.json({ total: result.length, results: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sil/camara/iniciativa/materias", async (req, res: Response) => {
    try {
      const { getIniciativaMaterias } = await import("@intel.dom.gob/service-institutions");
      const grupo = Number(req.query.grupo || 0);
      const periodoId = Number(req.query.periodoId || 0);
      if (!grupo) { res.status(400).json({ error: "grupo parameter is required" }); return; }
      const result = await getIniciativaMaterias(grupo, periodoId);
      res.json({ total: result.length, results: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sil/camara/iniciativas", async (req, res: Response) => {
    try {
      const { getIniciativasFiltered, chamberApi } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const periodoId = Number(req.query.periodoId || 0);
      const grupo = req.query.grupo ? Number(req.query.grupo) : undefined;
      const tipo = req.query.tipo != null ? req.query.tipo !== "false" : undefined;
      const perimidas = req.query.perimidas != null ? req.query.perimidas === "true" : undefined;
      if (grupo != null || q) {
        const result = await getIniciativasFiltered({ page: 1, grupo, tipo, perimidas, keyword: q || undefined, periodoId });
        res.json(result);
      } else {
        const result = await chamberApi.getLaws(q, periodoId);
        res.json({ total: result.length, results: result });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cámara SIL: detalle COMPLETO de una iniciativa (base + proponentes,
  // historicos, comisiones, documentos, votaciones) en un solo objeto.
  router.get("/sil/camara/iniciativa/:id/completa", async (req, res: Response) => {
    try {
      const { getIniciativaCompleta } = await import("@intel.dom.gob/service-institutions");
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid iniciativa id" });
      const periodoId = Number(req.query.periodoId || 0);
      const iniciativa = await getIniciativaCompleta(id, periodoId);
      if (!iniciativa) return res.status(404).json({ error: "Iniciativa not found" });
      res.json(iniciativa);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cámara SIL: sub-recurso individual de una iniciativa (solo el dato pedido,
  // sin traer todo el bundle). sub ∈ {proponentes, historicos, comisiones,
  // actividades, documentos, votaciones}. Evita llamar a /completa para
  // preguntas específicas (p.ej. "dame los documentos de esta iniciativa").
  router.get("/sil/camara/iniciativa/:id/:sub", async (req, res: Response) => {
    try {
      const { getIniciativaSub, INICIATIVA_SUB_RECURSOS } = await import("@intel.dom.gob/service-institutions");
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid iniciativa id" });
      const sub = String(req.params.sub);
      if (!(INICIATIVA_SUB_RECURSOS as string[]).includes(sub)) {
        return res.status(404).json({ error: `Unknown sub-resource: ${sub}` });
      }
      const periodoId = Number(req.query.periodoId || 0);
      const items = await getIniciativaSub(sub as any, id, periodoId);
      if (!items) return res.status(404).json({ error: "Sub-resource not found" });
      const total = Array.isArray((items as any[])) ? (items as any[]).length : 0;
      res.json({ sub, id, total, periodoId, results: items });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cámara SIL: detalle de una iniciativa por ID (solo objeto base)
  router.get("/sil/camara/iniciativa/:id", async (req, res: Response) => {
    try {
      const { getIniciativaDetalle } = await import("@intel.dom.gob/service-institutions");
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid iniciativa id" });
      const periodoId = Number(req.query.periodoId || 0);
      const iniciativa = await getIniciativaDetalle(id, periodoId);
      if (!iniciativa) return res.status(404).json({ error: "Iniciativa not found" });
      res.json(iniciativa);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cámara SIL: Sesiones
  router.get("/sil/camara/sesiones", async (req, res: Response) => {
    try {
      const { getSesiones } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const periodoId = Number(req.query.periodoId || 0);
      const result = await getSesiones(q, periodoId);
      res.json({ total: result.length, results: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cámara SIL: Grupos Parlamentarios
  router.get("/sil/camara/grupos", async (req, res: Response) => {
    try {
      const { getGruposParlamentarios } = await import("@intel.dom.gob/service-institutions");
      const periodoId = Number(req.query.periodoId || 0);
      const keyword = String(req.query.query || "");
      const result = await getGruposParlamentarios(periodoId, keyword);
      res.json({ total: result.length, results: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cámara SIL: Legisladores
  router.get("/sil/camara/legislador", async (req, res: Response) => {
    try {
      const { getLegislador } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const periodoId = Number(req.query.periodoId || 0);
      const result = await getLegislador(q, periodoId);
      res.json({ total: result.length, results: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Senado SIL endpoints (memoriahistorica.senadord.gob.do — DSpace)
  router.get("/sil/senado/iniciativas", async (req, res: Response) => {
    try {
      const { searchSenadoConcepts } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const concepts = await searchSenadoConcepts(q, { maxPerConcept: 20 });
      const initiatives = [...(concepts.iniciativas || []), ...(concepts.resoluciones || [])];
      res.json({ total: initiatives.length, results: initiatives });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sil/senado/boletines", async (req, res: Response) => {
    try {
      const { searchSenadoConcepts } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const concepts = await searchSenadoConcepts(q, { maxPerConcept: 20 });
      const bulletins = [...(concepts.boletines || []), ...(concepts.actas || []), ...(concepts.informes || [])];
      res.json({ total: bulletins.length, results: bulletins });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sil/senado/resoluciones", async (req, res: Response) => {
    try {
      const { searchSenadoConcepts } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const concepts = await searchSenadoConcepts(q, { maxPerConcept: 20 });
      const resolutions = concepts.resoluciones || [];
      res.json({ total: resolutions.length, results: resolutions });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Senado WordPress news (not SIL — press/blog from senadord.gob.do)
  router.get("/senado/news", async (req, res: Response) => {
    try {
      const { senateApi } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const result = await senateApi.search(q, false);
      res.json({ total: result.length, results: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Senado DSpace full-text search (scopeable to root community or sub-trees).
  router.get("/sil/senado/search", async (req, res: Response) => {
    try {
      const { searchExpedientes, SENATE_SCOPE_ROOT, SENATE_SCOPE_INICIATIVAS } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const scopeParam = String(req.query.scope || "root");
      const maxResults = Math.min(Number(req.query.maxResults) || 20, 100);
      const scope = scopeParam === "iniciativas" ? SENATE_SCOPE_INICIATIVAS
        : scopeParam === "all" ? undefined
        : SENATE_SCOPE_ROOT;
      const results = await searchExpedientes(q, { maxResults, scope });
      res.json({ total: results.length, scope: scopeParam, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Senado DSpace community tree (sub-communities + collections).
  router.get("/sil/senado/communities", async (req, res: Response) => {
    try {
      const dspaceHost = "https://memoriahistorica.senadord.gob.do";
      const base = `${dspaceHost}/server/api`;
      const parentId = String(req.query.parentId || "fc1aa418-1f3f-46ee-a300-6d6047e53d01");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const [subRes, colRes] = await Promise.all([
        fetch(`${base}/core/communities/${parentId}/subcommunities?page=0&size=100`, {
          signal: ctrl.signal, headers: { Accept: "application/json", "User-Agent": "IntelDomGob/1.0" },
        }).then((r) => r.json()).catch(() => null),
        fetch(`${base}/core/communities/${parentId}/collections?page=0&size=100`, {
          signal: ctrl.signal, headers: { Accept: "application/json", "User-Agent": "IntelDomGob/1.0" },
        }).then((r) => r.json()).catch(() => null),
      ]);
      clearTimeout(timer);
      const extractList = (data: any, key: string): any[] => {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (data._embedded?.searchResult?._embedded?.objects)
          return data._embedded.searchResult._embedded.objects.map((o: any) => o._embedded?.indexableObject).filter(Boolean);
        if (data._embedded?.[key]) return data._embedded[key];
        if (data.page?._embedded?.[key]) return data.page._embedded[key];
        return [];
      };
      const subCommunities = extractList(subRes, "subcommunities").map((c: any) => ({
        id: c.id, name: c.name || c.metadata?.["dc.title"]?.[0]?.value || "Unknown",
        collections: 0,
      }));
      const collections = extractList(colRes, "collections").map((c: any) => ({
        id: c.id, name: c.name || c.metadata?.["dc.title"]?.[0]?.value || "Unknown",
      }));
      res.json({ parentId, subCommunities, collections });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Senado DSpace collection items (search within a specific collection).
  router.get("/sil/senado/collections/:collectionId/items", async (req, res: Response) => {
    try {
      const { searchExpedientes } = await import("@intel.dom.gob/service-institutions");
      const collectionId = req.params.collectionId;
      const q = String(req.query.query || "");
      const maxResults = Math.min(Number(req.query.maxResults) || 20, 100);
      const results = await searchExpedientes(q, { maxResults, scope: collectionId });
      res.json({ collectionId, total: results.length, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Cronológico de Senadores (senator directory) -------------------------
  // Senators grouped by constitutional period (2010-2028). Each senator has
  // name, party, province, quadrennium and photo.

  // Search senators by name (across all periods, or within one via ?periodo).
  router.get("/sil/senado/senadores", async (req, res: Response) => {
    try {
      const { searchSenadores } = await import("@intel.dom.gob/service-institutions");
      const q = String(req.query.query || "");
      const periodo = req.query.periodo ? String(req.query.periodo) : undefined;
      const maxResults = Math.min(Number(req.query.maxResults) || 20, 100);
      const results = await searchSenadores(q, { periodo, maxResults });
      res.json({ total: results.length, periodo: periodo ?? "all", results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List available constitutional periods with senator counts.
  router.get("/sil/senado/senadores/periodos", async (_req, res: Response) => {
    try {
      const { listSenadoresPeriodos } = await import("@intel.dom.gob/service-institutions");
      const periodos = await listSenadoresPeriodos();
      res.json({ total: periodos.length, periodos });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List all senators for a specific constitutional period (paginated).
  router.get("/sil/senado/senadores/periodo/:periodo", async (req, res: Response) => {
    try {
      const { listSenadoresByPeriodo } = await import("@intel.dom.gob/service-institutions");
      const periodo = String(req.params.periodo);
      const page = Math.max(Number(req.query.page) || 0, 0);
      const size = Math.min(Number(req.query.size) || 40, 100);
      const result = await listSenadoresByPeriodo(periodo, { page, size });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Fetch a single senator's full record by DSpace item UUID.
  router.get("/sil/senado/senadores/:itemId", async (req, res: Response) => {
    try {
      const { getSenador } = await import("@intel.dom.gob/service-institutions");
      const senador = await getSenador(String(req.params.itemId));
      if (!senador) return res.status(404).json({ error: "Senador not found" });
      res.json(senador);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Senado DSpace: expediente individual por UUID (fetch granular de UN solo
  // registro, con su metadata y PDFs, sin correr una búsqueda amplia).
  router.get("/sil/senado/expediente/:itemId", async (req, res: Response) => {
    try {
      const { getExpediente } = await import("@intel.dom.gob/service-institutions");
      const itemId = String(req.params.itemId);
      const expediente = await getExpediente(itemId);
      if (!expediente) return res.status(404).json({ error: "Expediente not found" });
      res.json(expediente);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Knowledge Graph --------------------------------------------------------
  // Knowledge Graph: build/merge a graph from an IntelligenceResult packet and
  // return the current graph (or the neighborhood of a given entity).
  router.post("/graph/ingest", async (req, res) => {
    try {
      await authz(req, "execute", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
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

  // POST /v1/fetch — fetch a single web page and return its readable text + metadata.
  // This answers "what does this URL say?" questions that keyword search alone cannot.
  router.post("/fetch", async (req, res: Response) => {
    try {
      await authz(req, "read");
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: e.message });
      return;
    }
    const { url, timeoutMs, maxChars } = req.body ?? {};
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: "Missing or invalid 'url' parameter (must be http/https)" });
      return;
    }
    try {
      const page = await deps.search.fetchWebpage(url, {
        timeoutMs: typeof timeoutMs === "number" ? timeoutMs : 15000,
        maxChars: typeof maxChars === "number" ? maxChars : 16000,
      });
      if (!page) {
        res.status(502).json({ error: "Failed to fetch page", message: "The URL could not be reached or parsed" });
        return;
      }
      res.json(page);
    } catch (e: any) {
      log.error("fetch failed", { url, error: e.message });
      res.status(500).json({ error: "Fetch failed", message: e.message });
    }
  });

  // Multi-agent intelligence query — delegates to the Orchestrator.
  router.post("/query", async (req, res: Response) => {
    const body = req.body as QueryRequest;
    try {
      await authz(req, "query");
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: e.message });
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
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: e.message });
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
      res.status((e as any).status ?? 401).json({ error: { message: e.message, type: "invalid_request_error" } });
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
      res.status((e as any).status ?? 401).json({ error: { message: e.message, type: "invalid_request_error" } });
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
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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
      await authz(req, "query", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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
      await authz(req, "query", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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
      await authz(req, "query", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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
  // NOTE: GET /tools is [PUBLIC-FACING] (wall + preview); POST /tools/:id/execute
  // is [INTERNAL] (requires a valid key — no preview).

  router.get("/tools", (req, res) => {
    if (!deps.toolRegistry) {
      res.status(501).json({ error: "Tool registry unavailable" });
      return;
    }
    res.json(deps.toolRegistry.list().map((t) => ({ id: t.id, name: t.name, description: t.description, category: t.category, risk: t.risk, params: t.params })));
  });

  router.post("/tools/:id/execute", async (req, res: Response) => {
    try {
      await authz(req, "query", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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
      await authz(req, "admin", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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

  router.post("/prompts/:key/render", async (req, res) => {
    try {
      await authz(req, "read");
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
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
    try {
      await authz(req, "read", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
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
    try {
      await authz(req, "read", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
      return;
    }
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
      await authz(req, "execute", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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
      await authz(_req, "read", false);
    } catch (e) {
      res.status((e as any).status ?? 401).json({ error: "Unauthorized", message: (e as Error).message });
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
      tools: mcpTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        ...(t.annotations ? { annotations: t.annotations } : {}),
      })),
    });
  });

  // ---------------------------------------------------------------------------
  // [INTERNAL] Admin console (operator) endpoints. All require an admin-scoped
  // API key (see adminOnly). Not for end users.
  // These delegate to AuthService / BillingService / TelemetryService; no
  // business logic lives here.
  // ---------------------------------------------------------------------------

  /** Gate an admin endpoint. Independent of requireApiKey (always protected). */
  async function adminOnly(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!deps.auth) {
      res.status(501).json({ error: "Auth unavailable" });
      return;
    }
    const key = parseBearer(req.headers["authorization"]) || (req.body as any)?.apiKey;
    if (!key) {
      res.status(401).json({ error: "Admin API key required" });
      return;
    }
    const record = await deps.auth.verifyApiKey(key);
    if (!record) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    try {
      deps.auth.authorize(record, { scope: "admin" });
    } catch {
      res.status(403).json({ error: "Admin scope required" });
      return;
    }
    (req as any).adminRecord = record;
    next();
  }

  const admin = Router();
  admin.use(adminOnly);

  // --- API keys -------------------------------------------------------------
  admin.get("/apikeys", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    const keys = await deps.auth.listApiKeys({
      product: req.query.product ? String(req.query.product) : undefined,
      tenantId: req.query.tenantId ? String(req.query.tenantId) : undefined,
      active: req.query.active === undefined ? undefined : req.query.active === "true",
      paymentStatus: req.query.paymentStatus ? String(req.query.paymentStatus) : undefined,
    });
    res.json({ total: keys.length, keys });
  });

  admin.post("/apikeys", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    const b = req.body ?? {};
    if (!b.name || !b.product) {
      res.status(400).json({ error: "name and product are required" });
      return;
    }
    const scopes = Array.isArray(b.scopes) ? b.scopes : BillingService.scopesForPlan(b.plan ?? "free");
    const { key, record } = await deps.auth.createApiKey({
      name: b.name,
      product: b.product,
      tenantId: b.tenantId,
      organizationId: b.organizationId,
      userId: b.userId,
      scopes,
      plan: b.plan ?? "free",
      quotaDaily: b.quotaDaily ?? 0,
      rateLimit: b.rateLimit ?? 0,
      paymentStatus: b.paymentStatus ?? "ok",
      expiresAt: b.expiresAt,
      attributes: b.attributes,
    });
    res.status(201).json({ key, record });
  });

  admin.get("/apikeys/:id", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    const k = await deps.auth.getApiKeyById(req.params.id);
    if (!k) return res.status(404).json({ error: "Key not found" });
    const usage = deps.billing ? await deps.billing.dailyUsage(k.id) : 0;
    res.json({ ...k, dailyUsage: usage });
  });

  admin.post("/apikeys/:id/revoke", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    await deps.auth.revokeApiKey(req.params.id);
    res.json({ ok: true });
  });

  admin.post("/apikeys/:id/activate", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    await deps.auth.activateApiKey(req.params.id);
    res.json({ ok: true });
  });

  admin.delete("/apikeys/:id", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    await deps.auth.deleteApiKey(req.params.id);
    res.json({ ok: true });
  });

  admin.post("/apikeys/:id/billing", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    await deps.auth.updateApiKeyBilling(req.params.id, req.body ?? {});
    res.json({ ok: true });
  });

  // --- Products (client surfaces) -------------------------------------------
  admin.get("/products", async (_req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    const keys = await deps.auth.listApiKeys();
    const byProduct = new Map<string, { keys: number; active: number }>();
    for (const k of keys) {
      const p = byProduct.get(k.product ?? "custom") ?? { keys: 0, active: 0 };
      p.keys++;
      if (k.active) p.active++;
      byProduct.set(k.product ?? "custom", p);
    }
    res.json({ products: [...byProduct.entries()].map(([product, stats]) => ({ product, ...stats })) });
  });

  // --- Logs & metrics -------------------------------------------------------
  admin.get("/logs", async (req, res) => {
    if (!deps.telemetry) return res.status(501).json({ error: "Telemetry unavailable" });
    const logs = await deps.telemetry.queryLogs({
      service: req.query.service ? String(req.query.service) : undefined,
      level: req.query.level ? String(req.query.level) : undefined,
      apiKeyId: req.query.apiKeyId ? String(req.query.apiKeyId) : undefined,
      tenantId: req.query.tenantId ? String(req.query.tenantId) : undefined,
      product: req.query.product ? String(req.query.product) : undefined,
      node: req.query.node ? String(req.query.node) : undefined,
      userId: req.query.userId ? String(req.query.userId) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      until: req.query.until ? String(req.query.until) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 200,
    });
    res.json(logs);
  });

  admin.get("/metrics", async (req, res) => {
    if (!deps.telemetry) return res.status(501).json({ error: "Telemetry unavailable" });
    const scope = (req.query.scope as any) ?? "global";
    const id = (req.query.id as string) ?? "all";
    const m = await deps.telemetry.getMetrics(scope, id, req.query.from ? String(req.query.from) : undefined, req.query.until ? String(req.query.until) : undefined);
    res.json(m);
  });

  admin.get("/nodes", async (_req, res) => {
    if (!deps.telemetry) return res.status(501).json({ error: "Telemetry unavailable" });
    res.json({ nodes: await deps.telemetry.getNodes() });
  });

  // --- Employees / orgs / tenants -------------------------------------------
  admin.get("/users", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    res.json({ users: await deps.auth.listUsers(req.query.organizationId ? String(req.query.organizationId) : undefined) });
  });
  admin.post("/users", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    const b = req.body ?? {};
    if (!b.email) return res.status(400).json({ error: "email is required" });
    const u = await deps.auth.createUser(b);
    res.status(201).json(u);
  });
  admin.get("/organizations", async (_req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    res.json({ organizations: await deps.auth.listOrganizations() });
  });
  admin.post("/organizations", async (req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    const b = req.body ?? {};
    if (!b.name || !b.slug) return res.status(400).json({ error: "name and slug are required" });
    const o = await deps.auth.createOrganization(b);
    res.status(201).json(o);
  });
  admin.get("/tenants", async (_req, res) => {
    if (!deps.auth) return res.status(501).json({ error: "Auth unavailable" });
    res.json({ tenants: await deps.auth.listTenants() });
  });

  router.use("/admin", admin);

  return router;
}
