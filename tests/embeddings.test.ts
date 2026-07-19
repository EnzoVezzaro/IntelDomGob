// tests/embeddings.test.ts
//
// Unit tests for the Embeddings service and RAG retrieval. No real network.

import { describe, it, expect } from "vitest";
import { EmbeddingsService, HashEmbeddingModel, cosine } from "@intel.dom.gob/service-embeddings";
import { RagService } from "@intel.dom.gob/service-rag";
import type { AiService } from "@intel.dom.gob/service-ai";

describe("HashEmbeddingModel", () => {
  it("produces a fixed-dimension vector", () => {
    const m = new HashEmbeddingModel(128);
    const v = m.embed("Ley 87-01 creó la SDSS");
    expect(v.length).toBe(128);
  });

  it("is deterministic for the same input", () => {
    const m = new HashEmbeddingModel(128);
    expect(m.embed("misma ley")).toEqual(m.embed("misma ley"));
  });
});

describe("EmbeddingsService", () => {
  it("embeds text and exposes the model dimension", async () => {
    const svc = new EmbeddingsService(new HashEmbeddingModel(64));
    expect(svc.dim).toBe(64);
    const v = await svc.embed("contrato público");
    expect(v.length).toBe(64);
  });

  it("similarity is higher for related text than unrelated", async () => {
    const svc = new EmbeddingsService(new HashEmbeddingModel(512));
    const a = await svc.similarity("contratación pública DGCP compras estado", "contratación pública DGCP licitaciones estado");
    const b = await svc.similarity("contratación pública DGCP compras estado", "receta sancocho pérdiz dominicano");
    expect(a).toBeGreaterThan(b);
  });
});

describe("cosine", () => {
  it("is 1 for identical vectors", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe("RagService", () => {
  it("indexes and retrieves the most relevant chunk", async () => {
    const rag = new RagService(new EmbeddingsService(new HashEmbeddingModel(512)));
    await rag.index("d1", "Ley 87-01 creó la Seguridad Social Dominicana");
    await rag.index("d2", "Receta de sancocho con pérdiz");
    const hits = await rag.retrieve("seguridad social ley", 1);
    expect(hits[0].id).toBe("d1");
  });

  it("answers a query using retrieved context", async () => {
    const fakeAi: AiService = {
      providerId: "mock",
      generate: async () => ({ text: "x", model: "mock" }),
      generateJson: async () => ({}),
      chat: async (req) => {
        const content = req.grounding ?? "";
        return content.includes("Seguridad Social") ? "SDSS creada por ley 87-01" : "no sé";
      },
      chatFromContext: async () => "x",
      streamChat: async function* () {},
      resolveProvider: async () => ({ id: "mock", kind: "ai", label: "mock" }) as any,
    } as unknown as AiService;
    const rag = new RagService(new EmbeddingsService(new HashEmbeddingModel(512)));
    await rag.index("d1", "Ley 87-01 creó la Seguridad Social Dominicana (SDSS)");
    const ans = await rag.answer("¿Qué creó la ley 87-01?", fakeAi, 1);
    expect(ans).toBe("SDSS creada por ley 87-01");
  });
});
