// tests/tenancy.test.ts
import { describe, it, expect } from "vitest";
import { TenantResolver, withTenant, tenantFilter, TenantError } from "@intel.dom.gob/service-tenancy";
import type { ApiKeyRecord } from "@intel.dom.gob/service-auth";

describe("Tenancy (unit)", () => {
  const resolver = new TenantResolver();

  it("resolves the key's own tenant", () => {
    const rec: ApiKeyRecord = { id: "1", name: "k", scopes: ["read"], active: true, tenantId: "t1" };
    const ctx = resolver.resolve(rec);
    expect(ctx.tenantId).toBe("t1");
  });

  it("rejects a spoofed X-Tenant-Id header", () => {
    const rec: ApiKeyRecord = { id: "1", name: "k", scopes: ["read"], active: true, tenantId: "t1" };
    expect(() => resolver.resolve(rec, "t2")).toThrow(TenantError);
  });

  it("treats tenant-less keys as global", () => {
    const rec: ApiKeyRecord = { id: "1", name: "k", scopes: ["*"], active: true };
    expect(resolver.isGlobal(rec)).toBe(true);
    expect(resolver.resolve(rec).tenantId).toBe("default");
  });

  it("withTenant stamps a tenant id", () => {
    const r = withTenant("t9", { name: "x" });
    expect(r.tenantId).toBe("t9");
    expect(r.name).toBe("x");
  });

  it("tenantFilter builds an isolation clause", () => {
    const f = tenantFilter("t9");
    expect(f.clause).toBe("tenant_id = $1");
    expect(f.param).toBe("t9");
  });
});
