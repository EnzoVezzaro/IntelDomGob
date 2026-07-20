import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { bootstrap } from "@intel.dom.gob/app-api";
import request from "supertest";
import type { AiService } from "@intel.dom.gob/service-ai";
import { AuthService } from "@intel.dom.gob/service-auth";
import type { ApiKeyRecord } from "@intel.dom.gob/service-auth";
import { createBilling, PLANS } from "@intel.dom.gob/service-billing";
import type { TelemetryService } from "@intel.dom.gob/service-telemetry";
import type { Database } from "@intel.dom.gob/database";

// Capturing telemetry fake: records the product/type each served request is
// attributed to, so we can assert the X-Intel-Client header drives attribution.
const captured: Array<{ clientId: string; product?: string; type?: string }> = [];
const fakeTelemetry = {
  recordRequest: async () => {},
  recordClient: async (clientId: string, meta?: { isKey?: boolean; product?: string; type?: string }) => {
    captured.push({ clientId, product: meta?.product, type: meta?.type });
  },
  recordLog: async () => {},
  queryLogs: async () => ({ logs: [] }),
  getMetrics: async () => ({ points: [] }),
  topClients: async () => [],
  getNodes: async () => ({ nodes: [] }),
  renderPrometheus: () => "",
  summary: () => ({}),
} as unknown as TelemetryService;

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

function makeFakeDb(): Database {
  const byHash = new Map<string, any>();
  return {
    migrate: async () => {},
    async query(text: string, params: unknown[] = []): Promise<any[]> {
      if (text.includes("INSERT INTO api_keys (organization_id")) {
        const [org, tenant, user, name, keyHash, scopes, attrs, product, plan, qd, rl, ps, exp] = params as any[];
        const id = `key-${byHash.size + 1}`;
        byHash.set(keyHash, {
          id, name, scopes, active: true,
          organization_id: org, tenant_id: tenant,
          attributes: typeof attrs === "string" ? JSON.parse(attrs) : (attrs ?? {}),
          product, plan, quota_daily: qd, rate_limit: rl, payment_status: ps, expires_at: exp,
        });
        return [{ id }];
      }
      if (text.includes("INSERT INTO api_keys (name, key_hash")) return [];
      if (text.includes("WHERE key_hash = $1")) {
        const row = byHash.get(params[0] as string);
        return row ? [row] : [];
      }
      if (text.includes("UPDATE api_keys SET last_used_at")) return [];
      if (text.includes("WHERE $1 = ANY(scopes)")) return [];
      return [];
    },
  } as unknown as Database;
}

const SURFACES = ["cli", "studio", "web", "mcp", "sdk", "admin", "custom"] as const;

describe("Client attribution via X-Intel-Client", () => {
  let app: Awaited<ReturnType<typeof bootstrap>>;
  let auth: AuthService;
  let db: Database;

  beforeAll(() => {
    db = makeFakeDb();
    auth = new AuthService(db);
  });

  // Fresh billing per test so the shared Público preview rate/quota counters
  // reset (otherwise rapid preview requests trip the 10/min limit mid-suite).
  beforeEach(async () => {
    captured.length = 0;
    const billing = createBilling(auth, fakeTelemetry, db, "");
    app = await bootstrap({ orchestrator: fakeOrchestrator, ai: fakeAi, auth, billing, database: db } as any);
  });

  it("origin header is recorded as the client surface (preview, no key)", async () => {
    for (const s of SURFACES) {
      captured.length = 0;
      const res = await request(app).post("/v1/query").set("X-Intel-Client", s).send({ query: "x" });
      expect(res.status).toBe(200);
      expect(captured.length).toBe(1);
      // The recorded product is the originating surface (the origin wins).
      expect(captured[0].product).toBe(s);
    }
  });

  it("type is derived from the surface (web -> web, mcp/admin -> api)", async () => {
    const typeFor: Record<string, string> = {
      cli: "cli", studio: "studio", web: "web", sdk: "sdk", custom: "custom",
      mcp: "api", admin: "api",
    };
    for (const s of SURFACES) {
      captured.length = 0;
      await request(app).post("/v1/query").set("X-Intel-Client", s).send({ query: "x" });
      expect(captured[0].type).toBe(typeFor[s]);
    }
  });

  it("origin header overrides the API key's stored product", async () => {
    // Key issued for the Studio surface...
    const { key } = await auth.createApiKey({ name: "k", plan: "pro", product: "studio", scopes: PLANS.pro.scopes });
    captured.length = 0;
    // ...but the request originates from the CLI.
    const res = await request(app).post("/v1/query").set("Authorization", `Bearer ${key}`).set("X-Intel-Client", "cli").send({ query: "x" });
    expect(res.status).toBe(200);
    expect(captured[0].product).toBe("cli");
  });

  it("falls back to the key product when no header is sent", async () => {
    const { key } = await auth.createApiKey({ name: "k2", plan: "pro", product: "web", scopes: PLANS.pro.scopes });
    captured.length = 0;
    const res = await request(app).post("/v1/query").set("Authorization", `Bearer ${key}`).send({ query: "x" });
    expect(res.status).toBe(200);
    expect(captured[0].product).toBe("web");
  });

  it("unknown header values are ignored (fall back to key/UA)", async () => {
    const { key } = await auth.createApiKey({ name: "k3", plan: "pro", product: "studio", scopes: PLANS.pro.scopes });
    captured.length = 0;
    const res = await request(app).post("/v1/query").set("Authorization", `Bearer ${key}`).set("X-Intel-Client", "totally-made-up").send({ query: "x" });
    expect(res.status).toBe(200);
    expect(captured[0].product).toBe("studio");
  });

  it("no key and no header falls back to User-Agent classification", async () => {
    captured.length = 0;
    const res = await request(app).post("/v1/query").set("User-Agent", "curl/8.0").send({ query: "x" });
    expect(res.status).toBe(200);
    // No product header/key product -> type derived from User-Agent ("api").
    expect(captured[0].product).toBeUndefined();
    expect(captured[0].type).toBe("api");
  });
});
