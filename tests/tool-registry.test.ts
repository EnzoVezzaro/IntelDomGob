// tests/tool-registry.test.ts
import { describe, it, expect } from "vitest";
import { ToolRegistry, createDefaultToolRegistry } from "@intel.dom.gob/service-tool-registry";

describe("ToolRegistry (unit)", () => {
  it("registers and lists tools", () => {
    const reg = new ToolRegistry();
    reg.register({ id: "t1", name: "T1", description: "d", category: "c", risk: "low", params: {}, execute: async () => 1 });
    expect(reg.list().map((t) => t.id)).toContain("t1");
  });

  it("validates required params", async () => {
    const reg = new ToolRegistry();
    reg.register({
      id: "t",
      name: "T",
      description: "d",
      category: "c",
      risk: "low",
      params: { q: { type: "string", required: true } },
      execute: async (a) => a,
    });
    await expect(reg.execute("t", {})).rejects.toThrow(/Missing required/);
    expect(await reg.execute("t", { q: "hi" })).toEqual({ q: "hi" });
  });

  it("validates param types", async () => {
    const reg = new ToolRegistry();
    reg.register({
      id: "t",
      name: "T",
      description: "d",
      category: "c",
      risk: "low",
      params: { n: { type: "number" } },
      execute: async () => 1,
    });
    await expect(reg.execute("t", { n: "notnum" })).rejects.toThrow(/expected number/);
  });

  it("createDefaultToolRegistry seeds low-risk tools", () => {
    const reg = createDefaultToolRegistry();
    expect(reg.get("web.search")).toBeDefined();
    expect(reg.get("entities.extract")).toBeDefined();
  });
});

// tests/prompts.test.ts
import { PromptService } from "@intel.dom.gob/service-prompts";

describe("PromptService (unit)", () => {
  it("versions prompts and renders the latest", () => {
    const ps = new PromptService();
    ps.add("greet", "hello");
    ps.add("greet", "hi {{name}}");
    expect(ps.latest("greet")!.version).toBe(2);
    expect(ps.render("greet", { name: "Ana" })).toBe("hi Ana");
  });

  it("leaves unknown vars as placeholders", () => {
    const ps = new PromptService();
    ps.add("t", "{{a}} {{b}}");
    expect(ps.render("t", { a: "x" })).toBe("x {{b}}");
  });

  it("renders a specific version", () => {
    const ps = new PromptService();
    ps.add("t", "v1");
    ps.add("t", "v2 {{x}}");
    expect(ps.renderVersion("t", 1, {})).toBe("v1");
    expect(ps.renderVersion("t", 2, { x: "y" })).toBe("v2 y");
  });

  it("throws on unknown key", () => {
    const ps = new PromptService();
    expect(() => ps.render("nope")).toThrow(/not found/);
  });
});
