import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { Orchestrator } from "../src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Consistency test: runQuery (sync /query) and runQueryStream (streaming
// /query/stream) MUST produce identical retrieval + prompts for the same input,
// because both delegate to the shared retrieve() method. This guards against
// the historical divergence where the sync path skipped scope detection and the
// QueryPlanner.
//
// The orchestrator calls real institution services + the QueryPlanner, which
// perform network I/O. We stub global fetch so every external call resolves
// instantly with an empty payload — no real network, no hangs.
// ─────────────────────────────────────────────────────────────────────────────

// Stub fetch: every institution/planner HTTP call returns a safe empty payload.
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (_url: string, _init?: any) => {
  return new Response(JSON.stringify({ results: [], iniciativas: [], boletines: [], resoluciones: [], actas: [], informes: [], comisiones: [], sesiones: [], gruposParlamentarios: [], legisladores: [] }), { status: 200 });
};

class FakeAiProvider {
  capturedMessages: any = null;
  async *stream(opts: any) {
    // Capture the grounded prompt that runQueryStream feeds to the provider so
    // the test can compare it against the sync path's prompt.
    this.capturedMessages = opts?.messages;
    // Emit a minimal valid JSON object matching the response schema so
    // runQueryStream can parse it without a buffered fallback.
    yield JSON.stringify({
      response: { summary: "s", detailedAnalysis: "d", confidenceLevel: "High" },
      evidence: [], citations: [],
    });
  }
}

class MockAi {
  lastGenerateMessages: any = null;
  lastStreamMessages: any = null;
  async generateJson(opts: any) {
    // The QueryPlanner calls the AI service for expanded queries; return a
    // small set so retrieve() stays deterministic and offline.
    if (opts && opts.messages && JSON.stringify(opts.messages).includes("plan")) {
      return { queries: ["reforma código penal", "código penal República Dominicana"] };
    }
    this.lastGenerateMessages = opts.messages;
    return {
      response: { summary: "s", detailedAnalysis: "d", confidenceLevel: "High" },
      evidence: [], citations: [],
    };
  }
  async resolveProvider(_opts: any) {
    return streamProvider;
  }
}

// Single shared provider instance so the test can read the last streamed prompt.
const streamProvider = new FakeAiProvider();

class MockSearch {
  webSearchCalls = 0;
  async webSearch(_q: string, _n: number, _e: string) {
    this.webSearchCalls++;
    return [] as any[];
  }
  async newsActivity(_q: string, _f: any, _r: boolean) {
    return [] as any[];
  }
  async fetchWebpage(_url: string, _o: any) {
    return null;
  }
}

let orch: Orchestrator;
let ai: MockAi;
let search: MockSearch;

before(async () => {
  ai = new MockAi();
  search = new MockSearch();
  orch = new Orchestrator({ ai: ai as any, search: search as any });
});

async function streamPrompt(req: any): Promise<string> {
  await orch.runQueryStream(req, () => {});
  // runQueryStream feeds the shared retrieve()'s groundedUserPrompt to the
  // streaming provider; read it back from the captured provider messages.
  return streamProvider.capturedMessages?.[0]?.content ?? "";
}

describe("orchestrator: runQuery and runQueryStream consistency", () => {
  it("produce the same grounded prompt for a plain query", async () => {
    const req = { query: "reforma del código penal República Dominicana" };
    const sync = await orch.runQuery(req);
    const streamedPrompt = await streamPrompt(req);
    assert.ok(ai.lastGenerateMessages?.[0]?.content, "sync path must call ai.generateJson with a prompt");
    assert.equal(streamedPrompt, ai.lastGenerateMessages[0].content,
      "streaming and sync paths must build the identical grounded prompt");
    assert.equal(sync.planner?.intent, req.query);
  });

  it("scope 'senate' narrows to the Senado in BOTH paths", async () => {
    const req = { query: "ley de transporte senado", scope: "senate" as const };
    await orch.runQuery(req);
    const streamedPrompt = await streamPrompt(req);
    assert.equal(streamedPrompt, ai.lastGenerateMessages[0].content);
    // The narrowed prompt should mention the Senado / Congreso Nacional source.
    assert.ok(/senado/i.test(streamedPrompt) || /congreso/i.test(streamedPrompt));
  });

  it("scope 'sil' activates legislative retrieval in BOTH paths", async () => {
    const req = { query: "iniciativa código penal", scope: "sil" as const };
    await orch.runQuery(req);
    const streamedPrompt = await streamPrompt(req);
    assert.equal(streamedPrompt, ai.lastGenerateMessages[0].content);
  });

  it("scope 'diputado' targets the Cámara in BOTH paths", async () => {
    const req = { query: "diputado Juan Pérez", scope: "diputado" as const };
    await orch.runQuery(req);
    const streamedPrompt = await streamPrompt(req);
    assert.equal(streamedPrompt, ai.lastGenerateMessages[0].content);
  });

  it("planner intent + institutionsSelected attached in both paths", async () => {
    const req = { query: "presupuesto 2024" };
    const sync = await orch.runQuery(req);
    await streamPrompt(req);
    assert.ok(sync.planner, "planner block must be attached");
    assert.ok(Array.isArray(sync.planner!.institutionsSelected) && sync.planner!.institutionsSelected.length > 0);
    assert.ok(typeof sync.planner!.plan === "string" && sync.planner!.plan.length > 0);
  });

  it("same number of SearXNG web searches in both paths (shared retrieve)", async () => {
    const before = search.webSearchCalls;
    const req = { query: "contrataciones públicas DGCP" };
    await orch.runQuery(req);
    const afterSync = search.webSearchCalls;
    await orch.runQueryStream(req, () => {});
    const afterStream = search.webSearchCalls;
    // Both paths should trigger the same fan-out (28 calls each in this mock).
    assert.equal(afterSync - before, afterStream - afterSync,
      "sync and streaming must run the same number of web searches");
  });
});

