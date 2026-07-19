// tests/auth-tenant.test.ts
import { describe, it, expect } from "vitest";
import { AuthService, AuthError } from "@intel.dom.gob/service-auth";

// Minimal in-memory Database stub so we can exercise the tenant-scoped methods
// without Postgres (mirrors packages/database query shape).
function fakeDb() {
  const keys = new Map<string, any>();
  return {
    query: async (sql: string, params: any[]) => {
      if (sql.startsWith("INSERT")) {
        const id = `id_${keys.size + 1}`;
        keys.set(id, { id, tenant_id: params[1], organization_id: params[0], scopes: params[4], attributes: params[5], name: params[2] });
        return [{ id }];
      }
      if (sql.startsWith("SELECT")) {
        for (const k of keys.values()) if (k.id) return [k];
        return [];
      }
      return [];
    },
    migrate: async () => {},
  } as any;
}

describe("AuthService tenant scoping (unit)", () => {
  it("creates a tenant-scoped key and resolves the tenant", async () => {
    const auth = new AuthService(fakeDb());
    const { record } = await auth.createApiKey({ name: "k", tenantId: "t1", scopes: ["read"] });
    expect(record.tenantId).toBe("t1");
    const ctx = auth.resolveTenant(record);
    expect(ctx.tenantId).toBe("t1");
  });

  it("allows same-tenant access and denies cross-tenant", async () => {
    const auth = new AuthService(fakeDb());
    const { record } = await auth.createApiKey({ name: "k", tenantId: "t1", scopes: ["read"] });
    expect(() => auth.assertTenant(record, "t1")).not.toThrow();
    expect(() => auth.assertTenant(record, "t2")).toThrow(AuthError);
  });

  it("permits global (tenant-less) keys across tenants", async () => {
    const auth = new AuthService(fakeDb());
    const { record } = await auth.createApiKey({ name: "admin", scopes: ["*"] });
    expect(() => auth.assertTenant(record, "any-tenant")).not.toThrow();
  });
});
