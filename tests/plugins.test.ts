// tests/plugins.test.ts
import { describe, it, expect } from "vitest";
import { PluginRegistry } from "@intel.dom.gob/service-plugins";

describe("PluginRegistry (unit)", () => {
  it("registers and lists plugins", () => {
    const reg = new PluginRegistry();
    reg.register({
      manifest: { id: "p1", name: "P1", version: "1.0.0", kind: "source" },
      invoke: async () => ({ ok: true }),
    });
    expect(reg.list().map((m) => m.id)).toContain("p1");
  });

  it("runs a plugin with tenant context", async () => {
    const reg = new PluginRegistry();
    reg.register({
      manifest: { id: "echo", name: "Echo", version: "1.0.0", kind: "transform" },
      invoke: async (args, ctx) => ({ args, tenant: ctx.tenantId }),
    });
    const out = await reg.run("echo", { a: 1 }, { tenantId: "t1" });
    expect((out as any).tenant).toBe("t1");
  });

  it("times out a slow plugin", async () => {
    const reg = new PluginRegistry();
    reg.register({
      manifest: { id: "slow", name: "Slow", version: "1.0.0", kind: "exporter" },
      invoke: () => new Promise((r) => setTimeout(r, 500)),
    });
    await expect(reg.run("slow", {}, {}, 20)).rejects.toThrow(/timed out/);
  });

  it("throws on unknown plugin", async () => {
    const reg = new PluginRegistry();
    await expect(reg.run("nope", {})).rejects.toThrow(/not found/);
  });
});
