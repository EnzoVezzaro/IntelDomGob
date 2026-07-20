import { describe, it, expect, beforeAll } from "vitest";
import { bootstrap } from "@intel.dom.gob/app-api";
import request from "supertest";
import type { AiService } from "@intel.dom.gob/service-ai";
import { AuthService } from "@intel.dom.gob/service-auth";
import type { ApiKeyRecord } from "@intel.dom.gob/service-auth";
import { createBilling, PLANS } from "@intel.dom.gob/service-billing";
import type { TelemetryService } from "@intel.dom.gob/service-telemetry";
import type { Database } from "@intel.dom.gob/database";

// The /query handler requires GEMINI_API_KEY (or body.apiKey) to be present;
// set it so the public-facing path can be exercised without a gateway API key.
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

const fakeTelemetry = {
  recordRequest: async () => {},
  summary: () => ({}),
} as unknown as TelemetryService;

/**
 * In-memory fake of `@intel.dom.gob/database` that persists API-key rows keyed
 * by their hash, mirroring the columns the AuthService reads/writes.
 */
function makeFakeDb(): Database {
  const byHash = new Map<string, any>();
  const store = (params: unknown[]) => {
    const [org, tenant, user, name, keyHash, scopes, attrs, product, plan, qd, rl, ps, exp] = params as any[];
    const id = `key-${byHash.size + 1}`;
    byHash.set(keyHash, {
      id, name, scopes, active: true,
      organization_id: org, tenant_id: tenant,
      attributes: typeof attrs === "string" ? JSON.parse(attrs) : (attrs ?? {}),
      product, plan, quota_daily: qd, rate_limit: rl, payment_status: ps, expires_at: exp,
    });
    return [{ id }];
  };
  return {
    migrate: async () => {},
    async query(text: string, params: unknown[] = []): Promise<any[]> {
      if (text.includes("INSERT INTO api_keys (organization_id")) return store(params);
      if (text.includes("INSERT INTO api_keys (name, key_hash")) return [];
      if (text.includes("WHERE key_hash = $1")) {
        const row = byHash.get(params[0] as string);
        return row ? [row] : [];
      }
      if (text.includes("UPDATE api_keys SET last_used_at")) return [];
      if (text.includes("WHERE $1 = ANY(scopes)")) return []; // ensureAdminKey: none yet
      return [];
    },
  } as unknown as Database;
}

  const PLAN_IDS = ["publico", "investigador", "pro", "institucional", "free"] as const;
  let adminKey = "";

describe("API-key wall across every plan", () => {
  let auth!: AuthService;
  let billing!: ReturnType<typeof createBilling>;
  let app!: Awaited<ReturnType<typeof bootstrap>>;
  const keys: Record<string, string> = {};

  beforeAll(async () => {
    const db = makeFakeDb();
    auth = new AuthService(db);
    billing = createBilling(auth, fakeTelemetry, db, "");
    app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth, billing, database: db } as any);
    for (const p of PLAN_IDS) {
      const plan = PLANS[p];
      const { key } = await auth.createApiKey({
        name: `plan-${p}`,
        plan: p,
        product: "studio",
        scopes: plan.scopes,
        quotaDaily: plan.quotaDaily,
        rateLimit: plan.rateLimit,
      });
      keys[p] = key;
    }
    const admin = await auth.createApiKey({ name: "admin", plan: "institucional", product: "admin", scopes: ["admin", "*"], paymentStatus: "ok" });
    adminKey = admin.key;
  });

  it("creates a working API key per plan", async () => {
    for (const p of PLAN_IDS) {
      const rec = await auth.verifyApiKey(keys[p]);
      expect(rec, `plan ${p} key should verify`).not.toBeNull();
      expect(rec!.plan).toBe(p);
    }
  });

  it("Público: query/chat OK, execute + admin-only blocked", async () => {
    const a = request(app);
    expect((await a.post("/v1/query").set("Authorization", `Bearer ${keys.publico}`).send({ query: "x" })).status).toBe(200);
    expect((await a.post("/v1/chat").set("Authorization", `Bearer ${keys.publico}`).send({ message: "x" })).status).toBe(200);
    expect((await a.post("/v1/plugins/x/run").set("Authorization", `Bearer ${keys.publico}`).send({})).status).toBe(401);
    expect((await a.get("/v1/openapi.json").set("Authorization", `Bearer ${keys.publico}`)).status).toBe(403);
  });

  it("Investigador: query/chat OK, execute + admin-only blocked", async () => {
    const a = request(app);
    expect((await a.post("/v1/query").set("Authorization", `Bearer ${keys.investigador}`).send({ query: "x" })).status).toBe(200);
    expect((await a.post("/v1/chat").set("Authorization", `Bearer ${keys.investigador}`).send({ message: "x" })).status).toBe(200);
    expect((await a.post("/v1/plugins/x/run").set("Authorization", `Bearer ${keys.investigador}`).send({})).status).toBe(401);
    expect((await a.get("/v1/openapi.json").set("Authorization", `Bearer ${keys.investigador}`)).status).toBe(403);
  });

  it("Pro: query/chat/execute OK, admin-only blocked", async () => {
    const a = request(app);
    expect((await a.post("/v1/query").set("Authorization", `Bearer ${keys.pro}`).send({ query: "x" })).status).toBe(200);
    expect((await a.post("/v1/chat").set("Authorization", `Bearer ${keys.pro}`).send({ message: "x" })).status).toBe(200);
    // execute scope passes the wall; missing plugin then 400s (auth OK, not 401)
    const proRun = await a.post("/v1/plugins/x/run").set("Authorization", `Bearer ${keys.pro}`).send({});
    expect([400, 501]).toContain(proRun.status);
    expect((await a.get("/v1/openapi.json").set("Authorization", `Bearer ${keys.pro}`)).status).toBe(403);
  });

  it("Institucional: query/chat/execute + admin-only all OK", async () => {
    const a = request(app);
    expect((await a.post("/v1/query").set("Authorization", `Bearer ${keys.institucional}`).send({ query: "x" })).status).toBe(200);
    expect((await a.post("/v1/chat").set("Authorization", `Bearer ${keys.institucional}`).send({ message: "x" })).status).toBe(200);
    const instRun = await a.post("/v1/plugins/x/run").set("Authorization", `Bearer ${keys.institucional}`).send({});
    expect([400, 501]).toContain(instRun.status);
    expect((await a.get("/v1/openapi.json").set("Authorization", `Bearer ${keys.institucional}`)).status).toBe(200);
  });

  it("Free (legacy): query blocked, read-only endpoints OK", async () => {
    const a = request(app);
    expect((await a.post("/v1/query").set("Authorization", `Bearer ${keys.free}`).send({ query: "x" })).status).toBe(401);
    expect((await a.get("/v1/institutions").set("Authorization", `Bearer ${keys.free}`)).status).toBe(200);
  });

  it("no-key Público preview still works (read/query/chat)", async () => {
    const a = request(app);
    expect((await a.post("/v1/query").send({ query: "x" })).status).toBe(200);
    expect((await a.get("/v1/institutions")).status).toBe(200);
  });

  it("invalid key is rejected (401) on an internal endpoint", async () => {
    const a = request(app);
    expect((await a.get("/v1/tenant").set("Authorization", "Bearer not-a-real-key")).status).toBe(401);
  });

  it("explicit admin key unlocks admin-only OpenAPI/Swagger", async () => {
    const a = request(app);
    expect((await a.get("/v1/openapi.json").set("Authorization", `Bearer ${adminKey}`)).status).toBe(200);
    expect((await a.get("/v1/docs").set("Authorization", `Bearer ${adminKey}`)).status).toBe(200);
  });

  it("suspended / overdue keys are blocked with 402", async () => {
    const a = request(app);
    const suspended = await auth.createApiKey({ name: "susp", plan: "pro", product: "studio", scopes: PLANS.pro.scopes, paymentStatus: "suspended" });
    const overdue = await auth.createApiKey({ name: "over", plan: "pro", product: "studio", scopes: PLANS.pro.scopes, paymentStatus: "overdue" });
    expect((await a.post("/v1/query").set("Authorization", `Bearer ${suspended.key}`).send({ query: "x" })).status).toBe(402);
    expect((await a.post("/v1/query").set("Authorization", `Bearer ${overdue.key}`).send({ query: "x" })).status).toBe(402);
  });

  it(`Público enforces its ${PLANS.publico.quotaDaily}/day cap (the 21st query -> 429, not 200)`, async () => {
    // isolate the daily-quota check: rate limit 0 so only the daily cap applies
    const { key } = await auth.createApiKey({
      name: "publico-cap", plan: "publico", product: "studio",
      scopes: PLANS.publico.scopes, quotaDaily: PLANS.publico.quotaDaily, rateLimit: 0,
    });
    const a = request(app);
    let ok = 0;
    for (let i = 0; i < PLANS.publico.quotaDaily; i++) {
      if ((await a.post("/v1/query").set("Authorization", `Bearer ${key}`).send({ query: "x" })).status === 200) ok++;
    }
    expect(ok).toBe(PLANS.publico.quotaDaily);
    const blocked = await a.post("/v1/query").set("Authorization", `Bearer ${key}`).send({ query: "x" });
    expect(blocked.status).toBe(429);
  });
});

describe("Billing guard enforces README plan limits", () => {
  const db = makeFakeDb();
  const auth = new AuthService(db);
  const billing = createBilling(auth, fakeTelemetry, db, "");

  const rec = (over: Partial<ApiKeyRecord>): ApiKeyRecord => ({
    id: "r", name: "r", scopes: ["query"], active: true, plan: "pro",
    product: "studio", paymentStatus: "ok", quotaDaily: 0, rateLimit: 0,
    ...over,
  });

  it("non-metered scope (read) never throttles, on any plan", async () => {
    for (const p of PLAN_IDS) {
      const r = rec({ id: `read-${p}`, plan: p, quotaDaily: PLANS[p].quotaDaily, rateLimit: PLANS[p].rateLimit });
      await expect(billing.guard(r, "read")).resolves.toBeUndefined();
    }
  });

  for (const p of PLAN_IDS) {
    const plan = PLANS[p];
    it(`${p}: daily quota ${plan.quotaDaily}/day (the next over quota -> 429, not 200)`, async () => {
      const r = rec({ id: `qd-${p}`, plan: p, quotaDaily: plan.quotaDaily, rateLimit: 0 });
      if (plan.quotaDaily <= 0) {
        for (let i = 0; i < 5; i++) await expect(billing.guard(r, "query")).resolves.toBeUndefined();
        return;
      }
      for (let i = 0; i < plan.quotaDaily; i++) await expect(billing.guard(r, "query")).resolves.toBeUndefined();
      await expect(billing.guard(r, "query")).rejects.toMatchObject({ status: 429 });
    });

    it(`${p}: rate limit ${plan.rateLimit}/min (the next over rate -> 429)`, async () => {
      const r = rec({ id: `rl-${p}`, plan: p, quotaDaily: 0, rateLimit: plan.rateLimit });
      if (plan.rateLimit <= 0) {
        for (let i = 0; i < 5; i++) await expect(billing.guard(r, "query")).resolves.toBeUndefined();
        return;
      }
      for (let i = 0; i < plan.rateLimit; i++) await expect(billing.guard(r, "query")).resolves.toBeUndefined();
      await expect(billing.guard(r, "query")).rejects.toMatchObject({ status: 429 });
    });
  }

  it("suspended / overdue -> 402 regardless of scope", async () => {
    await expect(billing.guard(rec({ id: "susp", paymentStatus: "suspended" }), "read")).rejects.toMatchObject({ status: 402 });
    await expect(billing.guard(rec({ id: "over", paymentStatus: "overdue" }), "read")).rejects.toMatchObject({ status: 402 });
  });
});
