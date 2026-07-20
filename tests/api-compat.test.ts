// tests/api-compat.test.ts
//
// Tests for OpenAI-compatible endpoints, embeddings endpoint, and RBAC/ABAC
// authorization logic.

import { describe, it, expect } from "vitest";
import { AuthService, AuthError } from "@intel.dom.gob/service-auth";
import type { Database } from "@intel.dom.gob/database";
import type { AiService } from "@intel.dom.gob/service-ai";
import { bootstrap } from "@intel.dom.gob/app-api";
import request from "supertest";

// --- Fake DB for AuthService RBAC/ABAC unit tests ---------------------------

function fakeDb(handler: (sql: string, params: unknown[]) => unknown[][]): Database {
  return {
    query: async (sql: string, params: unknown[] = []) => handler(sql, params),
    migrate: async () => {},
    getPool: () => ({} as any),
    close: async () => {},
  } as unknown as Database;
}

const record = { id: "1", name: "k", scopes: ["query", "chat"], active: true, organizationId: "org-1" };

describe("AuthService RBAC/ABAC", () => {
  it("passes when the required scope is granted", () => {
    const auth = new AuthService(fakeDb(() => []));
    expect(() => auth.authorize(record, { scope: "query" })).not.toThrow();
    expect(() => auth.authorize(record, { scope: ["read", "query"] })).not.toThrow();
  });

  it("throws when the required scope is missing", () => {
    const auth = new AuthService(fakeDb(() => []));
    expect(() => auth.authorize(record, { scope: "admin" })).toThrow(AuthError);
  });

  it("passes wildcard scope", () => {
    const auth = new AuthService(fakeDb(() => []));
    const admin = { ...record, scopes: ["*"] };
    expect(() => auth.authorize(admin, { scope: "delete" })).not.toThrow();
  });

  it("enforces ABAC attribute constraints (deny-by-default)", () => {
    const auth = new AuthService(fakeDb(() => []));
    // A key with no attributes is denied when an attribute is required.
    expect(() => auth.authorize(record, { scope: "query", attributes: { clearance: "level3" } })).toThrow(AuthError);
    // A key with the matching attribute is allowed.
    const cleared = { ...record, attributes: { clearance: "level3", department: "justice" } };
    expect(() => auth.authorize(cleared, { scope: "query", attributes: { clearance: "level3" } })).not.toThrow();
    // A key with a mismatching attribute is denied.
    const wrong = { ...record, attributes: { clearance: "level1" } };
    expect(() => auth.authorize(wrong, { scope: "query", attributes: { clearance: "level3" } })).toThrow(AuthError);
  });
});

// --- OpenAI-compatible endpoints (gate disabled in tests) -------------------

const fakeAi: AiService = {
  providerId: "mock",
  generate: async () => ({ text: "{}", model: "mock" }),
  generateJson: async () => ({}),
  chat: async () => "respuesta",
  chatFromContext: async () => "respuesta-contexto",
  streamChat: async function* () {
    yield "tok";
  },
  resolveProvider: async () => ({ id: "mock", kind: "ai", label: "mock" }) as any,
} as unknown as AiService;

const fakeOrchestrator: any = {
  runQuery: async () => ({ query: "x", response: { summary: "ok" } }),
  aiService: fakeAi,
};

// --- Fake auth (so internal endpoints have a valid key in tests) --------
// "test-key" resolves to an admin record (scopes ["admin","*"], unlimited).
// Preview / public-facing behaviors are covered in tests/api-wall.test.ts.
const wallAdminRecord = {
  id: "test", name: "test", scopes: ["admin", "*"], active: true,
  plan: "institucional", paymentStatus: "ok", quotaDaily: 0, rateLimit: 0,
  product: "admin", attributes: {},
} as unknown as import("@intel.dom.gob/service-auth").ApiKeyRecord;

const fakeAuth = {
  verifyApiKey: async (k: string) => (k === "test-key" ? wallAdminRecord : null),
  authorize: () => {},
  ensureAdminKey: async () => ({ key: "x", created: false }),
} as unknown as import("@intel.dom.gob/service-auth").AuthService;

describe("OpenAI-compatible API", () => {
  it("POST /v1/chat/completions returns an OpenAI-shaped response", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth });
    const res = await request(app as any).post("/v1/chat/completions").set("Authorization", "Bearer test-key").send({ model: "intel", messages: [{ role: "user", content: "Hola" }] });
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("chat.completion");
    expect(res.body.choices[0].message.role).toBe("assistant");
    expect(res.body.choices[0].message.content).toBe("respuesta-contexto");
  });

  it("POST /v1/chat/completions streams SSE chunks", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth });
    const res = await request(app as any).post("/v1/chat/completions").set("Authorization", "Bearer test-key").send({ model: "intel", messages: [{ role: "user", content: "Hola" }], stream: true });
    expect(res.status).toBe(200);
    expect(res.text).toContain("chat.completion.chunk");
    expect(res.text).toContain("[DONE]");
  });

  it("GET /v1/models lists available models", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth });
    const res = await request(app as any).get("/v1/models");
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // Inject a fake embeddings service so the test is isolated from the real
  // provider selection (which keys off DEFAULT_AI_API_KEY in the environment).
  const fakeEmbeddings = { embed: async (t: string) => [0.1, 0.2, 0.3, 0.4] } as unknown as import("@intel.dom.gob/service-embeddings").EmbeddingsService;

  it("POST /v1/embeddings returns vectors", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, embeddings: fakeEmbeddings });
    const res = await request(app as any).post("/v1/embeddings").set("Authorization", "Bearer test-key").send({ input: "Ley 87-01" });
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
    expect(Array.isArray(res.body.data[0].embedding)).toBe(true);
  });
});

import { EntitiesService } from "@intel.dom.gob/service-entities";
import { WorkflowEngine } from "@intel.dom.gob/service-workflow";
import { ToolRegistry, createDefaultToolRegistry } from "@intel.dom.gob/service-tool-registry";
import { PromptService } from "@intel.dom.gob/service-prompts";
import { EvaluationService } from "@intel.dom.gob/service-evaluation";
import { ObservabilityService } from "@intel.dom.gob/service-observability";
import { TenantResolver } from "@intel.dom.gob/service-tenancy";
import { PluginRegistry } from "@intel.dom.gob/service-plugins";

describe("Entities & Document Intelligence API", () => {
  it("POST /v1/entities/extract returns entities and relations", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, entities: new EntitiesService() });
    const res = await request(app as any).post("/v1/entities/extract").set("Authorization", "Bearer test-key").send({ text: "La Ley 87-01 creó la Seguridad Social Dominicana." });
    expect(res.status).toBe(200);
    expect(res.body.entities.some((e: any) => e.type === "law")).toBe(true);
  });
});

describe("Workflow API", () => {
  it("POST /v1/workflows executes a DAG and reports completion", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, workflowEngine: new WorkflowEngine() });
    const res = await request(app as any)
      .post("/v1/workflows")
      .set("Authorization", "Bearer test-key").send({
        name: "test",
        inputs: { q: "x" },
        steps: [
          { id: "a", action: "search", params: {} },
          { id: "b", deps: ["a"], action: "report", params: {} },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("completed");
    expect(res.body.workflowId).toBeDefined();
  });

  it("GET /v1/workflows/:id returns the workflow state", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, workflowEngine: new WorkflowEngine() });
    const created = await request(app as any)
      .post("/v1/workflows")
      .set("Authorization", "Bearer test-key").send({ name: "t2", steps: [{ id: "a", action: "x" }] });
    const id = created.body.workflowId;
    const res = await request(app as any).get(`/v1/workflows/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.workflowId).toBe(id);
  });

  it("handles human-in-the-loop approval", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, workflowEngine: new WorkflowEngine() });
    const created = await request(app as any)
      .post("/v1/workflows")
      .set("Authorization", "Bearer test-key").send({
        name: "approval",
        steps: [
          { id: "draft", action: "draft" },
          { id: "gate", deps: ["draft"], requiresApproval: true, action: "publish" },
        ],
      });
    expect(created.body.status).toBe("awaiting_approval");
    const id = created.body.workflowId;
    const approved = await request(app as any).post(`/v1/workflows/${id}/approve`).set("Authorization", "Bearer test-key").send({ stepId: "gate" });
    expect(approved.body.status).toBe("completed");
  });
});

describe("Tool Registry API", () => {
  it("GET /v1/tools lists registered tools", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, toolRegistry: createDefaultToolRegistry() });
    const res = await request(app as any).get("/v1/tools");
    expect(res.status).toBe(200);
    expect(res.body.some((t: any) => t.id === "web.search")).toBe(true);
  });

  it("POST /v1/tools/:id/execute runs a tool", async () => {
    const reg = new ToolRegistry();
    reg.register({ id: "echo", name: "Echo", description: "d", category: "c", risk: "low", params: { msg: { type: "string", required: true } }, execute: async (a) => ({ echo: a.msg }) });
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, toolRegistry: reg });
    const res = await request(app as any).post("/v1/tools/echo/execute").set("Authorization", "Bearer test-key").send({ msg: "hi" });
    expect(res.status).toBe(200);
    expect(res.body.result.echo).toBe("hi");
  });

  it("rejects execution with invalid params", async () => {
    const reg = new ToolRegistry();
    reg.register({ id: "echo", name: "Echo", description: "d", category: "c", risk: "low", params: { msg: { type: "string", required: true } }, execute: async () => ({}) });
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, toolRegistry: reg });
    const res = await request(app as any).post("/v1/tools/echo/execute").set("Authorization", "Bearer test-key").send({});
    expect(res.status).toBe(400);
  });
});

describe("Prompt Service API", () => {
  it("creates and renders a prompt", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, promptService: new PromptService() });
    const created = await request(app as any).post("/v1/prompts").set("Authorization", "Bearer test-key").send({ key: "greet", template: "Hola {{name}}" });
    expect(created.status).toBe(201);
    const rendered = await request(app as any).post("/v1/prompts/greet/render").set("Authorization", "Bearer test-key").send({ vars: { name: "Ana" } });
    expect(rendered.body.rendered).toBe("Hola Ana");
  });

  it("GET /v1/prompts lists prompts", async () => {
    const ps = new PromptService();
    ps.add("k", "t");
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, promptService: ps });
    const res = await request(app as any).get("/v1/prompts");
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.key === "k")).toBe(true);
  });
});

describe("Evaluation API", () => {
  it("POST /v1/evaluate/faithfulness scores grounded answers", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, evaluation: new EvaluationService() });
    const res = await request(app as any)
      .post("/v1/evaluate/faithfulness")
      .set("Authorization", "Bearer test-key").send({ answer: "La Ley 87-01 creó la TSS.", context: "La Ley 87-01 creó la TSS en el 2001." });
    expect(res.status).toBe(200);
    expect(res.body.score).toBeGreaterThan(0.8);
  });

  it("POST /v1/evaluate/quality returns dimension scores", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, evaluation: new EvaluationService() });
    const res = await request(app as any)
      .post("/v1/evaluate/quality")
      .set("Authorization", "Bearer test-key").send({ answer: "La Ley 87-01 creó la TSS para administrar los fondos de seguridad social dominicana.", prompt: "Qué es la TSS" });
    expect(res.status).toBe(200);
    expect(res.body.dimensions).toBeDefined();
    expect(res.body.score).toBeGreaterThan(0.6);
  });

  it("rejects faithfulness with missing body", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, evaluation: new EvaluationService() });
    const res = await request(app as any).post("/v1/evaluate/faithfulness").set("Authorization", "Bearer test-key").send({});
    expect(res.status).toBe(400);
  });
});

describe("Observability API", () => {
  it("GET /v1/metrics returns Prometheus text and counts requests", async () => {
    const obs = new ObservabilityService();
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, observability: obs });
    await request(app as any).get("/v1/institutions");
    const res = await request(app as any).get("/v1/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("http_requests_total");
  });
});

describe("Plugins & Tenancy API", () => {
  it("GET /v1/plugins lists registered plugins", async () => {
    const reg = new PluginRegistry();
    reg.register({ manifest: { id: "p1", name: "P1", version: "1.0.0", kind: "source" }, invoke: async () => ({}) });
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, plugins: reg });
    const res = await request(app as any).get("/v1/plugins");
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.id === "p1")).toBe(true);
  });

  it("POST /v1/plugins/:id/run invokes a plugin", async () => {
    const reg = new PluginRegistry();
    reg.register({ manifest: { id: "echo", name: "Echo", version: "1.0.0", kind: "transform" }, invoke: async (args) => ({ echo: args.msg }) });
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, plugins: reg });
    const res = await request(app as any).post("/v1/plugins/echo/run").set("Authorization", "Bearer test-key").send({ msg: "hi" });
    expect(res.status).toBe(200);
    expect(res.body.result.echo).toBe("hi");
  });

  it("GET /v1/tenant reports the resolved tenant", async () => {
    const app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth, tenancy: new TenantResolver() });
    const res = await request(app as any).get("/v1/tenant").set("Authorization", "Bearer test-key");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tenantId");
  });
});
