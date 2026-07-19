// tests/e2e.test.ts
//
// End-to-end test at the client boundary: the REAL SDK (the same client Studio,
// Web, CLI and Admin use) drives the API surface backed by a mocked
// orchestrator. This proves the Studio -> API contract works without a browser.

import { describe, it, expect } from "vitest";
import { createClient } from "@intel.dom.gob/sdk";
import type { AiService } from "@intel.dom.gob/service-ai";
import type { SearchService } from "@intel.dom.gob/service-search";
import type { Orchestrator } from "@intel.dom.gob/service-orchestrator";
import { bootstrap } from "@intel.dom.gob/app-api";
import request from "supertest";

// Bridge the Express app into a fetch() shim for the SDK using supertest.
function appToFetch(app: any): typeof fetch {
  return (async (input: any, init: any = {}) => {
    const full = typeof input === "string" ? input : input.url;
    const path = full.replace(/^https?:\/\/[^/]+/, "");
    const method = (init.method || "GET").toLowerCase();
    let r = (request(app) as any)[method](path);
    if (init.headers) r = r.set(init.headers);
    if (init.body) r = r.send(init.body);
    const res = await r;
    return {
      ok: res.status < 400,
      status: res.status,
      statusText: "",
      headers: { get: () => null },
      json: async () => res.body,
      text: async () => (typeof res.text === "string" ? res.text : JSON.stringify(res.body)),
      body: null,
    } as any;
  }) as any;
}

const fakeSearch = {
  webSearch: async () => [],
  newsActivity: async () => [],
} as unknown as SearchService;

const fakeAi = {
  providerId: "mock",
  generate: async () => ({ text: "{}", model: "mock" }),
  generateJson: async () => ({ response: { summary: "e2e", detailedAnalysis: "e2e", confidenceLevel: "High" }, evidence: [], citations: [] }),
  chat: async () => "e2e-chat",
} as unknown as AiService;

const fakeOrchestrator = {
  runQuery: async () => ({
    query: "q", timestamp: new Date().toISOString(), searchEngine: "mock",
    sources: { congress: [], tribunal: [], datos: [], news: [], laws: [], bulletins: [], perInstitution: {} },
    planner: { intent: "q", institutionsSelected: [], plan: "" },
    institution: { domainsSearched: [] }, search: { queriesRun: ["q"] },
    retrieval: { documentsAnalyzed: [], extractedCount: 0 }, evidence: [],
    validation: { conflictingStatements: [], duplicateSourcesRemoved: 0, statusMessage: "" },
    refinement: { coherenceScore: 1, textLengthReduced: 0 },
    response: { summary: "e2e", detailedAnalysis: "e2e", timeline: [], confidenceLevel: "High", citations: [] },
  }),
  runQueryStream: async (req: any, emit: any) => { emit({ type: "result", result: {} }); },
} as unknown as Orchestrator;

describe("SDK e2e (Studio client path)", () => {
  it("createClient().query() reaches the API and returns a result", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const client = createClient({ baseUrl: "http://api.localhost", fetchImpl: appToFetch(app as Express) });
    const result = await client.query({ query: "reforma", apiKey: "test" });
    expect(result.response.summary).toBe("e2e");
  });

  it("createClient().listInstitutions() returns the registry", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const client = createClient({ baseUrl: "http://api.localhost", fetchImpl: appToFetch(app as Express) });
    const inst = await client.listInstitutions();
    expect(Array.isArray(inst)).toBe(true);
  });

  it("createClient().graph() + graphIngest() round-trip", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, search: fakeSearch, ai: fakeAi });
    const client = createClient({ baseUrl: "http://api.localhost", fetchImpl: appToFetch(app as Express) });
    const packet = { response: { citations: [{ title: "Ley X", url: "https://x.gob.do", institution: "DGCP" }] }, sources: { laws: [] }, evidence: [] };
    const ingested = await client.graphIngest(packet);
    expect(ingested.entities).toBeGreaterThan(0);
    const g = await client.graph();
    expect(g.graph.entities.length).toBeGreaterThan(0);
  });
});
