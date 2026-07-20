// tests/integration.test.ts
//
// Integration tests that exercise the API surface with dependency-injected
// mocks (no real external systems, no real providers). These prove the
// Client -> API -> Orchestrator -> Services wiring end-to-end.

import { describe, it, expect } from "vitest";
import type { AiService } from "@intel.dom.gob/service-ai";
import type { SearchService } from "@intel.dom.gob/service-search";
import type { Orchestrator } from "@intel.dom.gob/service-orchestrator";
import { KnowledgeGraphService } from "@intel.dom.gob/service-knowledge-graph";
import { bootstrap } from "@intel.dom.gob/app-api";
import request from "supertest";

// The /query and /chat handlers require DEFAULT_AI_API_KEY (or body.apiKey) to be
// present. Set it so the preview (no-key) path can be exercised.
process.env.DEFAULT_AI_API_KEY = "test";

// --- Mocks -----------------------------------------------------------------

const fakeSearch: SearchService = {
  webSearch: async () => [
    { title: "Ley 123", url: "https://camaradediputados.gob.do/123", snippet: "Reforma", engine: "bing" },
  ],
  newsActivity: async () => [
    { url: "https://listindiario.com/x", title: "Noticia", source: "Listín", snippet: "ctx" },
  ],
} as unknown as SearchService;

const fakeAi: AiService = {
  providerId: "mock",
  generate: async (req) => ({ text: JSON.stringify({ response: { summary: "ok", detailedAnalysis: "respuesta", confidenceLevel: "High" }, evidence: [], citations: [{ title: "Ley 123", url: "https://camaradediputados.gob.do/123", institution: "Cámara" }], planner: { intent: "q", institutionsSelected: [], plan: "" } }), model: req.model || "mock" }),
  generateJson: async () => ({ response: { summary: "ok", detailedAnalysis: "respuesta", confidenceLevel: "High" }, evidence: [], citations: [{ title: "Ley 123", url: "https://camaradediputados.gob.do/123", institution: "Cámara" }] }),
  chat: async () => "charla",
  chatFromContext: async () => "charla-contexto",
  streamChat: async function* () {
    yield "charla";
  },
  resolveProvider: async () => ({ id: "mock", kind: "ai", label: "mock" }) as any,
} as unknown as AiService;

const fakeOrchestrator: Orchestrator = {
  runQuery: async () => ({
    query: "reforma",
    timestamp: new Date().toISOString(),
    searchEngine: "mock",
    sources: { congress: [], tribunal: [], datos: [], news: [], laws: [], bulletins: [], perInstitution: {} },
    planner: { intent: "reforma", institutionsSelected: [], plan: "plan" },
    institution: { domainsSearched: [] },
    search: { queriesRun: ["reforma"] },
    retrieval: { documentsAnalyzed: [], extractedCount: 0 },
    evidence: [],
    validation: { conflictingStatements: [], duplicateSourcesRemoved: 0, statusMessage: "" },
    refinement: { coherenceScore: 1, textLengthReduced: 0 },
    response: { summary: "ok", detailedAnalysis: "respuesta", timeline: [], confidenceLevel: "High", citations: [{ title: "Ley 123", url: "https://camaradediputados.gob.do/123", institution: "Cámara" }] },
  }),
  runQueryStream: async (req, emit) => {
    emit({ type: "plan", intent: "reforma", institutionsSelected: [], plan: "plan" });
    emit({ type: "search", queriesRun: 1 });
    emit({ type: "token", text: "res" });
    emit({ type: "token", text: "puesta" });
    emit({ type: "result", result: { query: "reforma", planner: {}, response: { summary: "respuesta", detailedAnalysis: "respuesta" } } });
  },
} as unknown as Orchestrator;

// --- API integration -------------------------------------------------------

describe("API integration (mocked orchestrator)", () => {
  it("GET /v1/health returns ok", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const res = await (request(app as any).get("/v1/health"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("POST /v1/query delegates to the orchestrator", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const res = await request(app as any).post("/v1/query").send({ query: "reforma tributaria" });
    expect(res.status).toBe(200);
    expect(res.body.response.summary).toBe("ok");
    expect(res.body.response.citations[0].url).toBe("https://camaradediputados.gob.do/123");
  });

  it("POST /v1/query/stream emits SSE plan/search/token/result", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const res = await request(app as any).post("/v1/query/stream").send({ query: "reforma" });
    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).toContain("event: plan");
    expect(body).toContain("event: search");
    expect(body).toContain("event: token");
    expect(body).toContain("event: result");
  });

  it("GET /v1/institutions lists the registry", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const res = await request(app as any).get("/v1/institutions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.institutions)).toBe(true);
  });

  it("POST /v1/chat delegates to the AI service (no direct provider use)", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const res = await request(app as any)
      .post("/v1/chat")
      .send({ message: "¿Qué dice la ley?", context: { query: "ley 87-01" } });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("charla-contexto");
  });

  it("POST /v1/chat rejects a missing message", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const res = await request(app as any).post("/v1/chat").send({ context: {} });
    expect(res.status).toBe(400);
  });
});

// --- Knowledge Graph integration ------------------------------------------

describe("Knowledge Graph service", () => {
  it("ingests an IntelligenceResult and answers neighborhood queries", async () => {
    const kg = new KnowledgeGraphService();
    const result = {
      response: { citations: [{ title: "Ley 123", url: "https://camaradediputados.gob.do/123", institution: "Cámara de Diputados" }] },
      sources: { laws: [{ numero: "123-24", tipo: "Ley", url: "https://camaradediputados.gob.do/123" }] },
      evidence: [{ institution: "Cámara de Diputados", fact: "Deposited" }],
    };
    const ingested = await kg.ingest(result);
    expect(ingested.entities.length).toBeGreaterThan(0);
    const all = await kg.query();
    expect(all.graph.entities.length).toBe(ingested.entities.length);
  });
});
