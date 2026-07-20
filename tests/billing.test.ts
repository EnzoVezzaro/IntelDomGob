import { describe, it, expect } from "vitest";
import { createBilling } from "@intel.dom.gob/service-billing";
import type { AuthService } from "@intel.dom.gob/service-auth";
import type { TelemetryService } from "@intel.dom.gob/service-observability";
import type { DatabasePool } from "@intel.dom.gob/database";

function rec(over: Partial<any> = {}) {
  return {
    id: "k", name: "k", scopes: ["read"], active: true, plan: "publico",
    paymentStatus: "ok", quotaDaily: 20, rateLimit: 10, product: "studio", attributes: {},
    ...over,
  } as any;
}

function billing() {
  const auth = { verifyApiKey: async () => null, authorize: () => {}, ensureAdminKey: async () => ({ key: "x", created: false }) } as unknown as AuthService;
  const telemetry = { heartbeat: async () => {}, getMetrics: async () => ({}) } as unknown as TelemetryService;
  const db = {} as unknown as DatabasePool;
  return createBilling(auth, telemetry, db, "");
}

describe("BillingService.guard", () => {
  it("blocks suspended keys", async () => {
    const b = billing();
    await expect(b.guard(rec({ active: false }), "read")).rejects.toThrow(/suspended/i);
  });

  it("blocks overdue keys", async () => {
    const b = billing();
    await expect(b.guard(rec({ paymentStatus: "overdue" }), "read")).rejects.toThrow(/overdue/i);
  });

  it("allows active, paid keys", async () => {
    const b = billing();
    await expect(b.guard(rec({}), "read")).resolves.toBeUndefined();
  });

  it("admin plan is unlimited (no quota/rate)", async () => {
    const b = billing();
    const r = rec({ plan: "institucional", scopes: ["*"], quotaDaily: 0, rateLimit: 0 });
    await expect(b.guard(r, "execute")).resolves.toBeUndefined();
  });

  it("non-metered scope (read) is not throttled", async () => {
    const b = billing();
    for (let i = 0; i < 50; i++) await b.guard(rec({}), "read");
    expect(true).toBe(true);
  });

  it("metered scope (query) throttles at rate limit", async () => {
    const b = billing();
    const r = rec({ rateLimit: 3 });
    for (let i = 0; i < 3; i++) await b.guard(r, "query");
    await expect(b.guard(r, "query")).rejects.toThrow(/rate/i);
  });

  it("metered scope (query) throttles at daily quota", async () => {
    const b = billing();
    const r = rec({ quotaDaily: 2, rateLimit: 1000 });
    for (let i = 0; i < 2; i++) await b.guard(r, "query");
    await expect(b.guard(r, "query")).rejects.toThrow(/quota/i);
  });
});

describe("PREVIEW_RECORD scopes", async () => {
  const { PREVIEW_RECORD } = await import("@intel.dom.gob/service-auth");
  it("preview grants read, query, chat but not execute", () => {
    expect(PREVIEW_RECORD.scopes).toContain("read");
    expect(PREVIEW_RECORD.scopes).toContain("query");
    expect(PREVIEW_RECORD.scopes).toContain("chat");
    expect(PREVIEW_RECORD.scopes).not.toContain("execute");
    expect(PREVIEW_RECORD.plan).toBe("publico");
  });
});
