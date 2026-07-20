import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { tools, registerInstitutionTools, type McpTool } from "../src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Mocked SDK client.
//
// We inject a fake IntelDomGobClient that records every call (method + args)
// and returns deterministic fixtures. This lets us verify, for EVERY tool:
//   1. the right SDK method is invoked with the right arguments,
//   2. defaults (e.g. periodoId = 0) are applied correctly,
//   3. return values are passed through / shaped as expected,
//   4. progress `notify` callbacks fire with the right info messages,
//   5. error path: a throwing SDK method surfaces as "Tool error: …".
//
// No network, no live API, no external government portals are touched.
// ─────────────────────────────────────────────────────────────────────────────

interface Call {
  method: string;
  args: any[];
}

class MockClient {
  calls: Call[] = [];
  /** When set, the next matching method throws this error. */
  throwOn: Map<string, Error> = new Map();

  private record(method: string, args: any[], fixture: any): any {
    this.calls.push({ method, args });
    const err = this.throwOn.get(method);
    if (err) {
      this.throwOn.delete(method);
      throw err;
    }
    return fixture;
  }

  lastCall(method: string): Call | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      if (this.calls[i].method === method) return this.calls[i];
    }
    return undefined;
  }

  // --- fixtures ---
  health() { return this.record("health", [], { status: "ok" }); }
  listInstitutions() {
    return this.record("listInstitutions", [], {
      institutions: [
        { id: "senate", name: "Senado", url: "https://senado.gob.do", enabledByDefault: true, hasLegislative: true },
        { id: "chamber", name: "Cámara", url: "https://camara.gob.do", enabledByDefault: true, hasLegislative: true },
        { id: "presidency", name: "Presidencia", url: "https://presidencia.gob.do", enabledByDefault: true },
        { id: "judiciary", name: "Tribunal Constitucional", url: "https://tc.gob.do", enabledByDefault: true },
        { id: "dgcp", name: "DGCP", url: "https://dgcp.gob.do", enabledByDefault: true },
        { id: "datos", name: "Datos Abiertos RD", url: "https://datos.gob.do", enabledByDefault: true },
        { id: "consultoria", name: "Consultoría Jurídica", url: "https://consultoria.gov.do", enabledByDefault: true },
        { id: "compras", name: "Comunidad de Compras", url: "https://compras.gob.do", enabledByDefault: true },
      ],
    });
  }
  searchInstitution(id: string, query: string) {
    return this.record("searchInstitution", [id, query], { id, name: id, results: [{ title: query }] });
  }
  query(_req: any) { return this.record("query", [_req], { answer: "x" }); }
  chat(req: any) { return this.record("chat", [req], { reply: "chat reply" }); }
  queryStream(req: any, onEvent: (e: any) => void) {
    this.calls.push({ method: "queryStream", args: [req, onEvent] });
    const err = this.throwOn.get("queryStream");
    if (err) {
      this.throwOn.delete("queryStream");
      throw err;
    }
    onEvent({ type: "search", query: req.query });
    onEvent({ type: "plan", intent: "legis", queries: ["a"] });
    onEvent({ type: "retrieval", totalResults: 3 });
    onEvent({ type: "reasoning" });
    onEvent({ type: "result", answer: "final answer" });
    return Promise.resolve();
  }
  fetchUrl(url: string, opts: any) {
    return this.record("fetchUrl", [url, opts], { url, title: "T", text: "body", publishedDate: null, dominican: true });
  }

  // Cámara SIL
  silCamaraIniciativas(q: string, p: number) { return this.record("silCamaraIniciativas", [q, p], { total: 1, results: [{ q }] }); }
  silCamaraIniciativaDetalle(id: number, p: number) { return this.record("silCamaraIniciativaDetalle", [id, p], { id }); }
  silCamaraIniciativaCompleta(id: number, p: number) { return this.record("silCamaraIniciativaCompleta", [id, p], { id, full: true }); }
  silCamaraIniciativaSub(sub: string, id: number, p: number) { return this.record("silCamaraIniciativaSub", [sub, id, p], { sub, id }); }
  silCamaraComisiones(t?: number, p?: number) { return this.record("silCamaraComisiones", [t, p], { total: 2, results: [] }); }
  silCamaraComisionTipos(p?: number) { return this.record("silCamaraComisionTipos", [p], { total: 3, results: [] }); }
  silCamaraIniciativaCount(p?: number) { return this.record("silCamaraIniciativaCount", [p], { total: 999 }); }
  silCamaraIniciativaGrupos(p?: number) { return this.record("silCamaraIniciativaGrupos", [p], { total: 15, results: [] }); }
  silCamaraIniciativaMaterias(g: number, p?: number) { return this.record("silCamaraIniciativaMaterias", [g, p], { total: 4, results: [] }); }
  silCamaraSesiones(q: string, p?: number) { return this.record("silCamaraSesiones", [q, p], { total: 1, results: [] }); }
  silCamaraGrupos(p?: number, k?: string) { return this.record("silCamaraGrupos", [p, k], { total: 59, results: [] }); }
  silCamaraLegislador(q: string, p?: number) { return this.record("silCamaraLegislador", [q, p], { total: 1, results: [] }); }

  // Senado SIL
  silSenadoIniciativas(q: string) { return this.record("silSenadoIniciativas", [q], { total: 1, results: [] }); }
  silSenadoBoletines(q: string) { return this.record("silSenadoBoletines", [q], { total: 1, results: [] }); }
  silSenadoResoluciones(q: string) { return this.record("silSenadoResoluciones", [q], { total: 1, results: [] }); }
  senadoNews(q: string) { return this.record("senadoNews", [q], { total: 1, results: [] }); }
  silSenadoSearch(q: string, scope: string, max: number) { return this.record("silSenadoSearch", [q, scope, max], { total: 20, scope, results: [] }); }
  silSenadoCommunities(pid?: string) { return this.record("silSenadoCommunities", [pid], { parentId: pid ?? "root", subCommunities: [], collections: [] }); }
  silSenadoCollectionItems(cid: string, q: string, max: number) { return this.record("silSenadoCollectionItems", [cid, q, max], { collectionId: cid, total: 5, results: [] }); }
  silSenadoSenadores(q: string, periodo?: string, max?: number) { return this.record("silSenadoSenadores", [q, periodo, max], { total: 2, periodo: periodo ?? "all", results: [] }); }
  silSenadoSenadoresPeriodos() { return this.record("silSenadoSenadoresPeriodos", [], { total: 4, periodos: [] }); }
  silSenadoSenadoresPeriodo(periodo: string, page: number, size: number) { return this.record("silSenadoSenadoresPeriodo", [periodo, page, size], { periodo, total: 32, results: [] }); }
  silSenadoSenador(itemId: string) { return this.record("silSenadoSenador", [itemId], { id: itemId }); }
  silSenadoExpediente(itemId: string) { return this.record("silSenadoExpediente", [itemId], { id: itemId, documents: [] }); }

  graph(e?: string) { return this.record("graph", [e], { graph: {}, neighbors: [] }); }
  graphIngest(r: unknown) { return this.record("graphIngest", [r], { entities: 1, relations: 1 }); }
}

// ── test harness ─────────────────────────────────────────────────────────────

// Tools are registered at runtime (institution tools come from the SDK), so
// resolve the registry lazily on each lookup.
function byName(): Map<string, McpTool> {
  return new Map<string, McpTool>(tools.map((t) => [t.name, t]));
}

let mock: MockClient;
let notifications: { level: string; message: string }[] = [];

before(async () => {
  mock = new MockClient();
  notifications = [];
  // Institution search tools (tribunal_search, dgcp_search, …) are registered
  // from the SDK's listInstitutions() — exercise that path with the mock client.
  await registerInstitutionTools(mock as any);
});

async function runTool(name: string, args: any): Promise<unknown> {
  const tool = byName().get(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  const notify = (level: "info" | "warning" | "error", message: string) => {
    notifications.push({ level, message });
  };
  return tool.run(args, mock as any, notify);
}

// For each tool we assert >=5 behaviours. We group assertions per tool but keep
// them as separate `it`s so failures are localized.

describe("tool registry sanity", () => {
  it("every tool has a unique name, description and object inputSchema", () => {
    const seen = new Set<string>();
    for (const t of tools) {
      assert.ok(t.name && !seen.has(t.name), `duplicate or empty name: ${t.name}`);
      seen.add(t.name);
      assert.ok(typeof t.description === "string" && t.description.length > 0, `${t.name} missing description`);
      assert.equal(t.inputSchema?.type, "object", `${t.name} inputSchema must be an object`);
    }
    // Core + institution + SIL tools. The set is large and partly derived from
    // the SDK; assert a healthy minimum rather than a brittle exact count.
    assert.ok(tools.length >= 38, `expected a rich tool set, got ${tools.length}`);
  });

  it("per-institution search tools are registered from the SDK list", () => {
    for (const name of ["tribunal_search", "presidencia_search", "dgcp_search", "datos_search", "consultoria_search", "compras_search"]) {
      assert.ok(byName().has(name), `missing institution tool: ${name}`);
    }
  });
});

// ── Core intelligence tools ──────────────────────────────────────────────────

describe("query", () => {
  it("invokes queryStream with the query and surfaces the result event (scenario 1: bare query)", async () => {
    notifications = [];
    const out: any = await runTool("query", { query: "reforma pensional" });
    const c = mock.lastCall("queryStream");
    assert.ok(c, "queryStream must be called");
    assert.equal(c!.args[0].query, "reforma pensional");
    assert.equal(out.answer, "final answer");
  });

  it("passes institutions array through (scenario 2)", async () => {
    await runTool("query", { query: "x", institutions: ["senate", "chamber"] });
    const c = mock.lastCall("queryStream");
    assert.deepEqual(c!.args[0].institutions, ["senate", "chamber"]);
  });

  it("forwards scope to the SDK (scenario 3: scope=diputado)", async () => {
    await runTool("query", { query: "y", scope: "diputado" });
    const c = mock.lastCall("queryStream");
    assert.equal(c!.args[0].scope, "diputado");
  });

  it("emits progress notifications for search/plan/retrieval/reasoning (scenario 4)", async () => {
    notifications = [];
    await runTool("query", { query: "z" });
    const levels = notifications.map((n) => n.level);
    assert.ok(levels.includes("info"), "should emit info notifications");
    assert.ok(notifications.some((n) => /Searching|Planning|Retrieved|Generating/.test(n.message)), "expected human-readable progress");
  });

  it("returns error-shaped object when the stream throws (scenario 5)", async () => {
    notifications = [];
    mock.throwOn.set("queryStream", new Error("stream down"));
    const out: any = await runTool("query", { query: "q" });
    assert.ok(out.error || notifications.some((n) => n.level === "error"), "stream failure must surface as error");
  });
});

describe("chat", () => {
  it("calls chat with message + context (scenario 1)", async () => {
    const out: any = await runTool("chat", { message: "hola", context: { answer: "prev" } });
    const c = mock.lastCall("chat");
    assert.equal(c!.args[0].message, "hola");
    assert.deepEqual(c!.args[0].context, { answer: "prev" });
    assert.equal(out.reply, "chat reply");
  });
  it("forwards history array (scenario 2)", async () => {
    await runTool("chat", { message: "m", context: {}, history: [{ role: "user", text: "a" }] });
    assert.deepEqual(mock.lastCall("chat")!.args[0].history, [{ role: "user", text: "a" }]);
  });
  it("returns reply object unchanged (scenario 3)", async () => {
    const out: any = await runTool("chat", { message: "m", context: { a: 1 } });
    assert.equal(typeof out.reply, "string");
  });
  it("passes context verbatim even when empty (scenario 4)", async () => {
    await runTool("chat", { message: "m", context: {} });
    assert.deepEqual(mock.lastCall("chat")!.args[0].context, {});
  });
  it("surfaces SDK error as thrown Tool error (scenario 5)", async () => {
    mock.throwOn.set("chat", new Error("bad ctx"));
    await assert.rejects(() => runTool("chat", { message: "m", context: {} }));
  });
});

describe("list_institutions", () => {
  it("calls listInstitutions and returns the array (scenario 1)", async () => {
    const out: any = await runTool("list_institutions", {});
    assert.ok(mock.lastCall("listInstitutions"));
    assert.ok(Array.isArray(out.institutions));
  });
  it("returns the institution descriptors with ids (scenario 2)", async () => {
    const out: any = await runTool("list_institutions", {});
    assert.ok(out.institutions.some((i: any) => i.id === "senate"));
  });
  it("no args required (scenario 3)", async () => {
    await runTool("list_institutions", {});
    assert.equal(mock.lastCall("listInstitutions")!.args.length, 0);
  });
  it("returns enabledByDefault flag (scenario 4)", async () => {
    const out: any = await runTool("list_institutions", {});
    assert.ok(out.institutions.every((i: any) => "enabledByDefault" in i));
  });
  it("surfaces error on failure (scenario 5)", async () => {
    mock.throwOn.set("listInstitutions", new Error("boom"));
    await assert.rejects(() => runTool("list_institutions", {}));
  });
});

describe("fetch_url", () => {
  it("calls fetchUrl with the exact url (scenario 1)", async () => {
    await runTool("fetch_url", { url: "https://tc.gob.do/foo" });
    assert.equal(mock.lastCall("fetchUrl")!.args[0], "https://tc.gob.do/foo");
  });
  it("forwards timeoutMs + maxChars options (scenario 2)", async () => {
    await runTool("fetch_url", { url: "u", timeoutMs: 9000, maxChars: 5000 });
    const opts = mock.lastCall("fetchUrl")!.args[1];
    assert.equal(opts.timeoutMs, 9000);
    assert.equal(opts.maxChars, 5000);
  });
  it("defaults omitted options to undefined (scenario 3)", async () => {
    await runTool("fetch_url", { url: "u" });
    const opts = mock.lastCall("fetchUrl")!.args[1];
    assert.equal(opts.timeoutMs, undefined);
  });
  it("emits an info notification naming the url (scenario 4)", async () => {
    notifications = [];
    await runTool("fetch_url", { url: "https://x.do" });
    assert.ok(notifications.some((n) => n.message.includes("https://x.do")));
  });
  it("surfaces fetch error (scenario 5)", async () => {
    mock.throwOn.set("fetchUrl", new Error("404"));
    await assert.rejects(() => runTool("fetch_url", { url: "u" }));
  });
});

// ── Generic institution search tools ─────────────────────────────────────────

const INSTITUTION_SEARCH_TOOLS: [string, string][] = [
  ["tribunal_search", "judiciary"],
  ["presidencia_search", "presidency"],
  ["dgcp_search", "dgcp"],
  ["datos_search", "datos"],
  ["consultoria_search", "consultoria"],
  ["compras_search", "compras"],
];

for (const [toolName, instId] of INSTITUTION_SEARCH_TOOLS) {
  describe(toolName, () => {
    it("calls searchInstitution with the mapped institution id (scenario 1)", async () => {
      await runTool(toolName, { query: "contrato" });
      const c = mock.lastCall("searchInstitution");
      assert.equal(c!.args[0], instId);
    });
    it("passes the query through verbatim (scenario 2)", async () => {
      await runTool(toolName, { query: "licitación 2024" });
      assert.equal(mock.lastCall("searchInstitution")!.args[1], "licitación 2024");
    });
    it("returns the institution id in the result (scenario 3)", async () => {
      const out: any = await runTool(toolName, { query: "q" });
      assert.equal(out.id, instId);
    });
    it("emits a progress notification (scenario 4)", async () => {
      notifications = [];
      await runTool(toolName, { query: "q" });
      assert.ok(notifications.length >= 1);
    });
    it("surfaces error when search fails (scenario 5)", async () => {
      mock.throwOn.set("searchInstitution", new Error("down"));
      await assert.rejects(() => runTool(toolName, { query: "q" }));
    });
  });
}

// ── Cámara SIL tools ──────────────────────────────────────────────────────────

describe("sil_camara_iniciativas", () => {
  it("calls with query + default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_iniciativas", { query: "código penal" });
    const c = mock.lastCall("silCamaraIniciativas");
    assert.equal(c!.args[0], "código penal");
    assert.equal(c!.args[1], 0);
  });
  it("honors explicit periodoId (scenario 2)", async () => {
    await runTool("sil_camara_iniciativas", { query: "x", periodoId: 5 });
    assert.equal(mock.lastCall("silCamaraIniciativas")!.args[1], 5);
  });
  it("returns total + results (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_iniciativas", { query: "x" });
    assert.equal(typeof out.total, "number");
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_iniciativas", { query: "x" });
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraIniciativas", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_iniciativas", { query: "x" }));
  });
});

describe("sil_camara_iniciativa_detalle", () => {
  it("calls with id + default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_iniciativa_detalle", { id: 158495 });
    const c = mock.lastCall("silCamaraIniciativaDetalle");
    assert.equal(c!.args[0], 158495);
    assert.equal(c!.args[1], 0);
  });
  it("honors periodoId (scenario 2)", async () => {
    await runTool("sil_camara_iniciativa_detalle", { id: 1, periodoId: 3 });
    assert.equal(mock.lastCall("silCamaraIniciativaDetalle")!.args[1], 3);
  });
  it("returns the id (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_iniciativa_detalle", { id: 7 });
    assert.equal(out.id, 7);
  });
  it("emits notification naming the id (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_iniciativa_detalle", { id: 42 });
    assert.ok(notifications.some((n) => n.message.includes("42")));
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraIniciativaDetalle", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_iniciativa_detalle", { id: 1 }));
  });
});

describe("sil_camara_iniciativa_completa", () => {
  it("calls with id + default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_iniciativa_completa", { id: 158495 });
    const c = mock.lastCall("silCamaraIniciativaCompleta");
    assert.equal(c!.args[0], 158495);
    assert.equal(c!.args[1], 0);
  });
  it("honors periodoId (scenario 2)", async () => {
    await runTool("sil_camara_iniciativa_completa", { id: 1, periodoId: 2 });
    assert.equal(mock.lastCall("silCamaraIniciativaCompleta")!.args[1], 2);
  });
  it("returns full flag (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_iniciativa_completa", { id: 9 });
    assert.equal(out.full, true);
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_iniciativa_completa", { id: 9 });
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraIniciativaCompleta", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_iniciativa_completa", { id: 1 }));
  });
});

const CAMARA_SUBS = ["proponentes", "historicos", "comisiones", "actividades", "documentos", "votaciones"];
for (const sub of CAMARA_SUBS) {
  describe(`sil_camara_iniciativa_${sub}`, () => {
    it("calls silCamaraIniciativaSub with the right sub + id (scenario 1)", async () => {
      await runTool(`sil_camara_iniciativa_${sub}`, { id: 123 });
      const c = mock.lastCall("silCamaraIniciativaSub");
      assert.equal(c!.args[0], sub);
      assert.equal(c!.args[1], 123);
    });
    it("defaults periodoId to 0 (scenario 2)", async () => {
      await runTool(`sil_camara_iniciativa_${sub}`, { id: 1 });
      assert.equal(mock.lastCall("silCamaraIniciativaSub")!.args[2], 0);
    });
    it("honors periodoId (scenario 3)", async () => {
      await runTool(`sil_camara_iniciativa_${sub}`, { id: 1, periodoId: 4 });
      assert.equal(mock.lastCall("silCamaraIniciativaSub")!.args[2], 4);
    });
    it("returns the sub name (scenario 4)", async () => {
      const out: any = await runTool(`sil_camara_iniciativa_${sub}`, { id: 1 });
      assert.equal(out.sub, sub);
    });
    it("surfaces error (scenario 5)", async () => {
      mock.throwOn.set("silCamaraIniciativaSub", new Error("e"));
      await assert.rejects(() => runTool(`sil_camara_iniciativa_${sub}`, { id: 1 }));
    });
  });
}

describe("sil_camara_comisiones", () => {
  it("calls without tipoId (all) by default (scenario 1)", async () => {
    await runTool("sil_camara_comisiones", {});
    const c = mock.lastCall("silCamaraComisiones");
    assert.equal(c!.args[0], undefined);
    assert.equal(c!.args[1], 0);
  });
  it("passes tipoId when given (scenario 2)", async () => {
    await runTool("sil_camara_comisiones", { tipoId: 974 });
    assert.equal(mock.lastCall("silCamaraComisiones")!.args[0], 974);
  });
  it("returns total (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_comisiones", {});
    assert.equal(typeof out.total, "number");
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_comisiones", { tipoId: 975 });
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraComisiones", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_comisiones", {}));
  });
});

describe("sil_camara_comision_tipos", () => {
  it("calls with default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_comision_tipos", {});
    assert.equal(mock.lastCall("silCamaraComisionTipos")!.args[0], 0);
  });
  it("honors periodoId (scenario 2)", async () => {
    await runTool("sil_camara_comision_tipos", { periodoId: 1 });
    assert.equal(mock.lastCall("silCamaraComisionTipos")!.args[0], 1);
  });
  it("returns results (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_comision_tipos", {});
    assert.ok(Array.isArray(out.results));
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_comision_tipos", {});
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraComisionTipos", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_comision_tipos", {}));
  });
});

describe("sil_camara_iniciativa_count", () => {
  it("calls with default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_iniciativa_count", {});
    assert.equal(mock.lastCall("silCamaraIniciativaCount")!.args[0], 0);
  });
  it("honors periodoId (scenario 2)", async () => {
    await runTool("sil_camara_iniciativa_count", { periodoId: 7 });
    assert.equal(mock.lastCall("silCamaraIniciativaCount")!.args[0], 7);
  });
  it("returns a numeric total (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_iniciativa_count", {});
    assert.equal(typeof out.total, "number");
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_iniciativa_count", {});
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraIniciativaCount", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_iniciativa_count", {}));
  });
});

describe("sil_camara_iniciativa_grupos", () => {
  it("calls with default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_iniciativa_grupos", {});
    assert.equal(mock.lastCall("silCamaraIniciativaGrupos")!.args[0], 0);
  });
  it("honors periodoId (scenario 2)", async () => {
    await runTool("sil_camara_iniciativa_grupos", { periodoId: 2 });
    assert.equal(mock.lastCall("silCamaraIniciativaGrupos")!.args[0], 2);
  });
  it("returns 15 groups total (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_iniciativa_grupos", {});
    assert.equal(out.total, 15);
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_iniciativa_grupos", {});
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraIniciativaGrupos", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_iniciativa_grupos", {}));
  });
});

describe("sil_camara_iniciativa_materias", () => {
  it("calls with grupo + default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_iniciativa_materias", { grupo: 3 });
    const c = mock.lastCall("silCamaraIniciativaMaterias");
    assert.equal(c!.args[0], 3);
    assert.equal(c!.args[1], 0);
  });
  it("honors periodoId (scenario 2)", async () => {
    await runTool("sil_camara_iniciativa_materias", { grupo: 1, periodoId: 6 });
    assert.equal(mock.lastCall("silCamaraIniciativaMaterias")!.args[1], 6);
  });
  it("returns results (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_iniciativa_materias", { grupo: 2 });
    assert.ok(Array.isArray(out.results));
  });
  it("emits notification naming the grupo (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_iniciativa_materias", { grupo: 9 });
    assert.ok(notifications.some((n) => n.message.includes("9")));
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraIniciativaMaterias", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_iniciativa_materias", { grupo: 1 }));
  });
});

describe("sil_camara_sesiones", () => {
  it("calls with query + default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_sesiones", { query: "aprobación" });
    const c = mock.lastCall("silCamaraSesiones");
    assert.equal(c!.args[0], "aprobación");
    assert.equal(c!.args[1], 0);
  });
  it("honors periodoId (scenario 2)", async () => {
    await runTool("sil_camara_sesiones", { query: "x", periodoId: 8 });
    assert.equal(mock.lastCall("silCamaraSesiones")!.args[1], 8);
  });
  it("returns results (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_sesiones", { query: "x" });
    assert.ok(Array.isArray(out.results));
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_sesiones", { query: "x" });
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraSesiones", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_sesiones", { query: "x" }));
  });
});

describe("sil_camara_grupos", () => {
  it("calls with default periodoId 0 and empty keyword (scenario 1)", async () => {
    await runTool("sil_camara_grupos", {});
    const c = mock.lastCall("silCamaraGrupos");
    assert.equal(c!.args[0], 0);
    assert.equal(c!.args[1], "");
  });
  it("passes keyword when given (scenario 2)", async () => {
    await runTool("sil_camara_grupos", { query: "PLD" });
    assert.equal(mock.lastCall("silCamaraGrupos")!.args[1], "PLD");
  });
  it("returns 59 groups total (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_grupos", {});
    assert.equal(out.total, 59);
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_grupos", {});
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraGrupos", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_grupos", {}));
  });
});

describe("sil_camara_legislador", () => {
  it("calls with name + default periodoId 0 (scenario 1)", async () => {
    await runTool("sil_camara_legislador", { query: "Juan Pérez" });
    const c = mock.lastCall("silCamaraLegislador");
    assert.equal(c!.args[0], "Juan Pérez");
    assert.equal(c!.args[1], 0);
  });
  it("honors periodoId (scenario 2)", async () => {
    await runTool("sil_camara_legislador", { query: "x", periodoId: 1 });
    assert.equal(mock.lastCall("silCamaraLegislador")!.args[1], 1);
  });
  it("returns results (scenario 3)", async () => {
    const out: any = await runTool("sil_camara_legislador", { query: "x" });
    assert.ok(Array.isArray(out.results));
  });
  it("emits notification naming the legislator (scenario 4)", async () => {
    notifications = [];
    await runTool("sil_camara_legislador", { query: "Reinaldo" });
    assert.ok(notifications.some((n) => n.message.includes("Reinaldo")));
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silCamaraLegislador", new Error("e"));
    await assert.rejects(() => runTool("sil_camara_legislador", { query: "x" }));
  });
});

// ── Senado SIL tools ──────────────────────────────────────────────────────────

describe("sil_senado_iniciativas", () => {
  it("calls with query (scenario 1)", async () => {
    await runTool("sil_senado_iniciativas", { query: "presupuesto" });
    assert.equal(mock.lastCall("silSenadoIniciativas")!.args[0], "presupuesto");
  });
  it("returns results (scenario 2)", async () => {
    const out: any = await runTool("sil_senado_iniciativas", { query: "x" });
    assert.ok(Array.isArray(out.results));
  });
  it("emits notification (scenario 3)", async () => {
    notifications = [];
    await runTool("sil_senado_iniciativas", { query: "x" });
    assert.ok(notifications.length >= 1);
  });
  it("returns a numeric total (scenario 4)", async () => {
    const out: any = await runTool("sil_senado_iniciativas", { query: "x" });
    assert.equal(typeof out.total, "number");
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silSenadoIniciativas", new Error("e"));
    await assert.rejects(() => runTool("sil_senado_iniciativas", { query: "x" }));
  });
});

describe("sil_senado_boletines", () => {
  it("calls with query (scenario 1)", async () => {
    await runTool("sil_senado_boletines", { query: "acta" });
    assert.equal(mock.lastCall("silSenadoBoletines")!.args[0], "acta");
  });
  it("returns results (scenario 2)", async () => {
    const out: any = await runTool("sil_senado_boletines", { query: "x" });
    assert.ok(Array.isArray(out.results));
  });
  it("emits notification (scenario 3)", async () => {
    notifications = [];
    await runTool("sil_senado_boletines", { query: "x" });
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 4)", async () => {
    mock.throwOn.set("silSenadoBoletines", new Error("e"));
    await assert.rejects(() => runTool("sil_senado_boletines", { query: "x" }));
  });
  it("returns numeric total (scenario 5)", async () => {
    const out: any = await runTool("sil_senado_boletines", { query: "x" });
    assert.equal(typeof out.total, "number");
  });
});

describe("sil_senado_resoluciones", () => {
  it("calls with query (scenario 1)", async () => {
    await runTool("sil_senado_resoluciones", { query: "resolución 12" });
    assert.equal(mock.lastCall("silSenadoResoluciones")!.args[0], "resolución 12");
  });
  it("returns results (scenario 2)", async () => {
    const out: any = await runTool("sil_senado_resoluciones", { query: "x" });
    assert.ok(Array.isArray(out.results));
  });
  it("emits notification (scenario 3)", async () => {
    notifications = [];
    await runTool("sil_senado_resoluciones", { query: "x" });
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 4)", async () => {
    mock.throwOn.set("silSenadoResoluciones", new Error("e"));
    await assert.rejects(() => runTool("sil_senado_resoluciones", { query: "x" }));
  });
  it("returns numeric total (scenario 5)", async () => {
    const out: any = await runTool("sil_senado_resoluciones", { query: "x" });
    assert.equal(typeof out.total, "number");
  });
});

describe("senado_news", () => {
  it("calls with query (scenario 1)", async () => {
    await runTool("senado_news", { query: "comunicado" });
    assert.equal(mock.lastCall("senadoNews")!.args[0], "comunicado");
  });
  it("returns results (scenario 2)", async () => {
    const out: any = await runTool("senado_news", { query: "x" });
    assert.ok(Array.isArray(out.results));
  });
  it("emits notification (scenario 3)", async () => {
    notifications = [];
    await runTool("senado_news", { query: "x" });
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 4)", async () => {
    mock.throwOn.set("senadoNews", new Error("e"));
    await assert.rejects(() => runTool("senado_news", { query: "x" }));
  });
  it("returns numeric total (scenario 5)", async () => {
    const out: any = await runTool("senado_news", { query: "x" });
    assert.equal(typeof out.total, "number");
  });
});

describe("senado_search", () => {
  it("calls with query + default scope 'root' + default max 20 (scenario 1)", async () => {
    await runTool("senado_search", { query: "contrato" });
    const c = mock.lastCall("silSenadoSearch");
    assert.equal(c!.args[0], "contrato");
    assert.equal(c!.args[1], "root");
    assert.equal(c!.args[2], 20);
  });
  it("honors scope=iniciativas (scenario 2)", async () => {
    await runTool("senado_search", { query: "x", scope: "iniciativas" });
    assert.equal(mock.lastCall("silSenadoSearch")!.args[1], "iniciativas");
  });
  it("honors maxResults (scenario 3)", async () => {
    await runTool("senado_search", { query: "x", maxResults: 100 });
    assert.equal(mock.lastCall("silSenadoSearch")!.args[2], 100);
  });
  it("emits two notifications (search + found) (scenario 4)", async () => {
    notifications = [];
    await runTool("senado_search", { query: "x" });
    assert.ok(notifications.length >= 2);
    assert.ok(notifications.some((n) => n.message.includes("20 results")));
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silSenadoSearch", new Error("e"));
    await assert.rejects(() => runTool("senado_search", { query: "x" }));
  });
});

describe("senado_communities", () => {
  it("calls with undefined parentId by default (scenario 1)", async () => {
    await runTool("senado_communities", {});
    assert.equal(mock.lastCall("silSenadoCommunities")!.args[0], undefined);
  });
  it("passes parentId when given (scenario 2)", async () => {
    await runTool("senado_communities", { parentId: "abc-123" });
    assert.equal(mock.lastCall("silSenadoCommunities")!.args[0], "abc-123");
  });
  it("returns subCommunities + collections (scenario 3)", async () => {
    const out: any = await runTool("senado_communities", {});
    assert.ok("subCommunities" in out && "collections" in out);
  });
  it("emits notification (scenario 4)", async () => {
    notifications = [];
    await runTool("senado_communities", {});
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silSenadoCommunities", new Error("e"));
    await assert.rejects(() => runTool("senado_communities", {}));
  });
});

describe("senado_collections", () => {
  it("calls with collectionId + default query '' + default max 20 (scenario 1)", async () => {
    await runTool("senado_collections", { collectionId: "col-1" });
    const c = mock.lastCall("silSenadoCollectionItems");
    assert.equal(c!.args[0], "col-1");
    assert.equal(c!.args[1], "");
    assert.equal(c!.args[2], 20);
  });
  it("honors query + maxResults (scenario 2)", async () => {
    await runTool("senado_collections", { collectionId: "c", query: "ley", maxResults: 50 });
    const c = mock.lastCall("silSenadoCollectionItems");
    assert.equal(c!.args[1], "ley");
    assert.equal(c!.args[2], 50);
  });
  it("returns total + results (scenario 3)", async () => {
    const out: any = await runTool("senado_collections", { collectionId: "c" });
    assert.equal(typeof out.total, "number");
  });
  it("emits two notifications (scenario 4)", async () => {
    notifications = [];
    await runTool("senado_collections", { collectionId: "c" });
    assert.ok(notifications.length >= 2);
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silSenadoCollectionItems", new Error("e"));
    await assert.rejects(() => runTool("senado_collections", { collectionId: "c" }));
  });
});

describe("senado_senadores", () => {
  it("calls with query + no periodo + default max 20 (scenario 1)", async () => {
    await runTool("senado_senadores", { query: "valenzuela" });
    const c = mock.lastCall("silSenadoSenadores");
    assert.equal(c!.args[0], "valenzuela");
    assert.equal(c!.args[1], undefined);
    assert.equal(c!.args[2], 20);
  });
  it("honors periodo filter (scenario 2)", async () => {
    await runTool("senado_senadores", { query: "x", periodo: "2020-2024" });
    assert.equal(mock.lastCall("silSenadoSenadores")!.args[1], "2020-2024");
  });
  it("honors maxResults (scenario 3)", async () => {
    await runTool("senado_senadores", { query: "x", maxResults: 100 });
    assert.equal(mock.lastCall("silSenadoSenadores")!.args[2], 100);
  });
  it("emits notification with count (scenario 4)", async () => {
    notifications = [];
    await runTool("senado_senadores", { query: "x" });
    assert.ok(notifications.some((n) => n.message.includes("senator")));
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silSenadoSenadores", new Error("e"));
    await assert.rejects(() => runTool("senado_senadores", { query: "x" }));
  });
});

describe("senado_senadores_periodos", () => {
  it("calls with no args (scenario 1)", async () => {
    await runTool("senado_senadores_periodos", {});
    assert.equal(mock.lastCall("silSenadoSenadoresPeriodos")!.args.length, 0);
  });
  it("returns 4 periodos (scenario 2)", async () => {
    const out: any = await runTool("senado_senadores_periodos", {});
    assert.equal(out.total, 4);
  });
  it("emits notification (scenario 3)", async () => {
    notifications = [];
    await runTool("senado_senadores_periodos", {});
    assert.ok(notifications.length >= 1);
  });
  it("surfaces error (scenario 4)", async () => {
    mock.throwOn.set("silSenadoSenadoresPeriodos", new Error("e"));
    await assert.rejects(() => runTool("senado_senadores_periodos", {}));
  });
  it("returns periodos array (scenario 5)", async () => {
    const out: any = await runTool("senado_senadores_periodos", {});
    assert.ok(Array.isArray(out.periodos));
  });
});

describe("senado_senadores_periodo", () => {
  it("calls with periodo + default page 0 + default size 40 (scenario 1)", async () => {
    await runTool("senado_senadores_periodo", { periodo: "2024-2028" });
    const c = mock.lastCall("silSenadoSenadoresPeriodo");
    assert.equal(c!.args[0], "2024-2028");
    assert.equal(c!.args[1], 0);
    assert.equal(c!.args[2], 40);
  });
  it("honors page + size (scenario 2)", async () => {
    await runTool("senado_senadores_periodo", { periodo: "x", page: 2, size: 80 });
    const c = mock.lastCall("silSenadoSenadoresPeriodo");
    assert.equal(c!.args[1], 2);
    assert.equal(c!.args[2], 80);
  });
  it("returns total + results (scenario 3)", async () => {
    const out: any = await runTool("senado_senadores_periodo", { periodo: "x" });
    assert.equal(typeof out.total, "number");
  });
  it("emits notification with periodo + count (scenario 4)", async () => {
    notifications = [];
    await runTool("senado_senadores_periodo", { periodo: "2020-2024" });
    assert.ok(notifications.some((n) => n.message.includes("2020-2024")));
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silSenadoSenadoresPeriodo", new Error("e"));
    await assert.rejects(() => runTool("senado_senadores_periodo", { periodo: "x" }));
  });
});

describe("senado_senador", () => {
  it("calls with itemId (scenario 1)", async () => {
    await runTool("senado_senador", { itemId: "uuid-9" });
    assert.equal(mock.lastCall("silSenadoSenador")!.args[0], "uuid-9");
  });
  it("returns the id (scenario 2)", async () => {
    const out: any = await runTool("senado_senador", { itemId: "uuid-9" });
    assert.equal(out.id, "uuid-9");
  });
  it("emits notification naming the id (scenario 3)", async () => {
    notifications = [];
    await runTool("senado_senador", { itemId: "uuid-9" });
    assert.ok(notifications.some((n) => n.message.includes("uuid-9")));
  });
  it("surfaces error (scenario 4)", async () => {
    mock.throwOn.set("silSenadoSenador", new Error("e"));
    await assert.rejects(() => runTool("senado_senador", { itemId: "x" }));
  });
  it("passes arbitrary uuid verbatim (scenario 5)", async () => {
    await runTool("senado_senador", { itemId: "c1864891-032e-4647" });
    assert.equal(mock.lastCall("silSenadoSenador")!.args[0], "c1864891-032e-4647");
  });
});

describe("senado_expediente", () => {
  it("calls with itemId (scenario 1)", async () => {
    await runTool("senado_expediente", { itemId: "exp-1" });
    assert.equal(mock.lastCall("silSenadoExpediente")!.args[0], "exp-1");
  });
  it("returns the id (scenario 2)", async () => {
    const out: any = await runTool("senado_expediente", { itemId: "exp-1" });
    assert.equal(out.id, "exp-1");
  });
  it("returns documents array (scenario 3)", async () => {
    const out: any = await runTool("senado_expediente", { itemId: "exp-1" });
    assert.ok(Array.isArray(out.documents));
  });
  it("emits notification naming the id (scenario 4)", async () => {
    notifications = [];
    await runTool("senado_expediente", { itemId: "exp-1" });
    assert.ok(notifications.some((n) => n.message.includes("exp-1")));
  });
  it("surfaces error (scenario 5)", async () => {
    mock.throwOn.set("silSenadoExpediente", new Error("e"));
    await assert.rejects(() => runTool("senado_expediente", { itemId: "x" }));
  });
});

// ── force a clean exit (see protocol.test.ts rationale) ───────────────────────
setTimeout(() => process.exit(0), 200).unref?.();
