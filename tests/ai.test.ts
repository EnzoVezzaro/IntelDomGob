// tests/ai.test.ts
//
// Unit tests for the AI Service: provider resolution, context-grounded chat,
// streaming chat, and truncated-JSON repair. No real providers are used.

import { describe, it, expect, beforeAll } from "vitest";
import { AiService, resolveAiProvider, repairTruncatedJson } from "@intel.dom.gob/service-ai";
import { providerRegistry } from "@intel.dom.gob/providers";
import type { AiProvider, AiRequest, AiResponse } from "@intel.dom.gob/providers";

function makeProvider(id: string, text = "respuesta"): AiProvider {
  return {
    id,
    kind: "ai",
    label: id,
    enabled: true,
    generate: async (req: AiRequest): Promise<AiResponse> => ({ text, model: req.model || id }),
    stream: async function* () {
      for (const ch of text) yield ch;
    },
  };
}

beforeAll(() => {
  // Ensure a "gemini" provider exists in the registry for resolution tests.
  if (!providerRegistry.getAi("gemini")) providerRegistry.registerAi(makeProvider("gemini"));
});

describe("AiService.provider resolution", () => {
  it("uses the default provider when no override is given", async () => {
    const svc = new AiService(makeProvider("gemini"));
    const p = await svc.resolveProvider();
    expect(p.id).toBe("gemini");
  });

  it("throws when an unknown provider id is requested", async () => {
    const svc = new AiService(makeProvider("gemini"));
    await expect(svc.resolveProvider({ provider: "nope" })).rejects.toThrow(/not registered/);
  });
});

describe("AiService.chatFromContext", () => {
  it("assembles a grounded prompt from an IntelligenceResult packet", async () => {
    let captured = "";
    const provider = {
      id: "mock",
      kind: "ai" as const,
      label: "mock",
      enabled: true,
      generate: async (req: AiRequest): Promise<AiResponse> => {
        captured = req.messages[0]?.content ?? "";
        return { text: "ok", model: "mock" };
      },
    };
    const svc = new AiService(provider);
    const reply = await svc.chatFromContext({
      context: {
        query: "ley 87-01",
        response: { summary: "creó la SDSS", detailedAnalysis: "análisis" },
        evidence: [{ fact: "creó la SDSS", institution: "Congreso", sourceUrl: "https://gob.do/x", confidence: "High" }],
        sources: { congress: [{ title: "Ley", url: "https://gob.do/x" }] },
      },
      message: "explícame",
    });
    expect(reply).toBe("ok");
    expect(captured).toContain("CONSULTA ORIGINAL: ley 87-01");
    expect(captured).toContain("RESUMEN EJECUTIVO");
    expect(captured).toContain("MATRIZ DE EVIDENCIA");
    expect(captured).toContain("CONTEXTO");
  });

  it("parses a stringified context without throwing", async () => {
    const svc = new AiService(makeProvider("mock", "ok"));
    const reply = await svc.chatFromContext({ context: JSON.stringify({ query: "x" }), message: "hola" });
    expect(reply).toBe("ok");
  });
});

describe("AiService.streamChat", () => {
  it("yields tokens from the provider stream", async () => {
    const svc = new AiService(makeProvider("mock", "abc"));
    let out = "";
    for await (const tok of svc.streamChat({ systemInstruction: "s", grounding: "g", message: "m" })) {
      out += tok;
    }
    expect(out).toBe("abc");
  });

  it("falls back to buffered generation when the provider has no stream", async () => {
    const noStream: AiProvider = {
      id: "mock",
      kind: "ai",
      label: "mock",
      enabled: true,
      generate: async () => ({ text: "buffered", model: "mock" }),
    };
    const svc = new AiService(noStream);
    let out = "";
    for await (const tok of svc.streamChat({ systemInstruction: "s", grounding: "g", message: "m" })) {
      out += tok;
    }
    expect(out).toBe("buffered");
  });
});

describe("repairTruncatedJson", () => {
  it("repairs an object cut off mid-value", () => {
    const repaired = repairTruncatedJson('{"a": 1, "b": [1, 2');
    expect(repaired).toEqual({ a: 1, b: [1, 2] });
  });

  it("repairs a truncated string", () => {
    const repaired = repairTruncatedJson('{"name": "Ley 87');
    expect(repaired.name).toBe("Ley 87");
  });

  it("salvages a truncated intelligence result with a partial summary", () => {
    const repaired = repairTruncatedJson('{"response":{"summary":"Avance del Congreso');
    expect(repaired.response.summary).toContain("Avance del Congreso");
  });

  it("returns a graceful empty response object for unparseable garbage", () => {
    const repaired = repairTruncatedJson("not json at all {{{");
    expect(repaired).toHaveProperty("response");
    expect(repaired.response.summary).toBe("");
  });
});

describe("resolveAiProvider (registry)", () => {
  it("resolves a registered provider by id", async () => {
    const p = await resolveAiProvider({ provider: "gemini" });
    expect(p.id).toBe("gemini");
  });
});
