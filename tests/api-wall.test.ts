import { describe, it, expect, beforeAll } from "vitest";
import { bootstrap } from "@intel.dom.gob/app-api";
import request from "supertest";
import type { AiService } from "@intel.dom.gob/service-ai";

// The /query handler requires GEMINI_API_KEY (or body.apiKey) to be present;
// set it so the preview path can be exercised without a gateway API key.
beforeAll(() => { process.env.GEMINI_API_KEY = "test"; });

const fakeAi: any = {
  providerId: "mock",
  generate: async () => ({ text: "{}", model: "mock" }),
  generateJson: async () => ({}),
  chat: async () => "r",
  chatFromContext: async () => "r",
  streamChat: async function* () { yield "tok"; },
  resolveProvider: async () => ({ id: "mock", kind: "ai", label: "mock" }) as any,
};

const fakeOrchestrator: any = {
  runQuery: async () => ({ query: "x", response: { summary: "ok" } }),
  aiService: fakeAi,
};

const adminRecord = {
  id: "test", name: "test", scopes: ["admin", "*"], active: true,
  plan: "institucional", paymentStatus: "ok", quotaDaily: 0, rateLimit: 0,
  product: "admin", attributes: {},
} as unknown as import("@intel.dom.gob/service-auth").ApiKeyRecord;

const fakeAuth = {
  verifyApiKey: async (k: string) => (k === "test-key" ? adminRecord : null),
  authorize: () => {},
  ensureAdminKey: async () => ({ key: "x", created: false }),
} as unknown as import("@intel.dom.gob/service-auth").AuthService;

async function app() {
  return bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth: fakeAuth } as any);
}

const KEY = "Bearer test-key";

describe("API-key wall", () => {
  it("public endpoint works WITHOUT a key (Público preview)", async () => {
    const res = await request(await app()).post("/v1/query").send({ query: "x" });
    expect(res.status).toBe(200);
  });

  it("public read endpoint works WITHOUT a key", async () => {
    expect((await request(await app()).get("/v1/institutions")).status).toBe(200);
  });

  it("invalid key is rejected (401)", async () => {
    const res = await request(await app())
      .post("/v1/query")
      .set("Authorization", "Bearer bad")
      .send({ query: "x" });
    expect(res.status).toBe(401);
  });

  it("internal endpoint WITHOUT a key is rejected (401)", async () => {
    const a = request(await app());
    expect((await a.post("/v1/workflows").send({ name: "t", steps: [{ id: "a", action: "x" }] })).status).toBe(401);
    expect((await a.get("/v1/tenant")).status).toBe(401);
    expect((await a.post("/v1/evaluate/faithfulness").send({ answer: "a", context: "c" })).status).toBe(401);
    expect((await a.get("/v1/openapi.json")).status).toBe(401);
    expect((await a.get("/v1/docs")).status).toBe(401);
  });

  it("internal endpoint WITH a valid key works (200)", async () => {
    const a = request(await app());
    expect((await a.get("/v1/tenant").set("Authorization", KEY)).status).toBe(200);
    const wf = await a.post("/v1/workflows").set("Authorization", KEY).send({ name: "t", steps: [{ id: "a", action: "x" }] });
    expect(wf.status).toBe(202);
  });

  it("Swagger/OpenAPI is admin-only (admin key -> 200)", async () => {
    const a = request(await app());
    expect((await a.get("/v1/openapi.json").set("Authorization", KEY)).status).toBe(200);
    expect((await a.get("/v1/docs").set("Authorization", KEY)).status).toBe(200);
  });

  it("health / metrics stay open (no key -> 200)", async () => {
    const a = request(await app());
    expect((await a.get("/v1/health")).status).toBe(200);
    expect((await a.get("/v1/metrics")).status).toBe(200);
  });
});
