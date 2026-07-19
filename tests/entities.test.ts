// tests/entities.test.ts
//
// Unit tests for the Entities service (rule-based extraction) and the Document
// Intelligence pipeline (orchestration over storage/ocr/entities/embeddings/kg).

import { describe, it, expect } from "vitest";
import { EntitiesService, RuleBasedEntityExtractor } from "@intel.dom.gob/service-entities";
import { DocumentIntelligenceService } from "@intel.dom.gob/service-document-intelligence";
import { StorageService, LocalStorageBackend } from "@intel.dom.gob/service-storage";
import { EmbeddingsService, HashEmbeddingModel } from "@intel.dom.gob/service-embeddings";
import { KnowledgeGraphService } from "@intel.dom.gob/service-knowledge-graph";
import { EventBus } from "@intel.dom.gob/events";

describe("RuleBasedEntityExtractor", () => {
  it("extracts a Dominican law", async () => {
    const ex = new RuleBasedEntityExtractor();
    const { entities } = await ex.extract("La Ley 87-01 creó la Seguridad Social Dominicana.");
    const laws = entities.filter((e) => e.type === "law");
    expect(laws.some((l) => l.text.toLowerCase().includes("ley 87-01"))).toBe(true);
  });

  it("extracts institutions by lexicon", async () => {
    const ex = new RuleBasedEntityExtractor();
    const { entities } = await ex.extract("El Senado de la República debatió el presupuesto.");
    expect(entities.some((e) => e.type === "institution" && /senado/i.test(e.text))).toBe(true);
  });

  it("extracts dates", async () => {
    const ex = new RuleBasedEntityExtractor();
    const { entities } = await ex.extract("Aprobado el 12 de marzo de 2021 en Santo Domingo.");
    expect(entities.some((e) => e.type === "date" && e.text.includes("2021"))).toBe(true);
    expect(entities.some((e) => e.type === "location" && /santo domingo/i.test(e.text))).toBe(true);
  });

  it("extracts a creates relation from law to target", async () => {
    const ex = new RuleBasedEntityExtractor();
    const { relations } = await ex.extract("La Ley 87-01 creó la Seguridad Social Dominicana (SDSS).");
    expect(relations.some((r) => r.type === "creates" && /ley 87-01/i.test(r.from))).toBe(true);
  });
});

describe("EntitiesService", () => {
  it("delegates to the configured extractor", async () => {
    const svc = new EntitiesService();
    const res = await svc.extract("Decreto 123-45 del Poder Ejecutivo.");
    expect(res.entities.some((e) => e.type === "law")).toBe(true);
  });
});

// --- Document Intelligence pipeline (in-memory fakes) ------------------------

class FakeOcr {
  async extractText(file: Buffer) {
    return file.toString("utf-8");
  }
  async extractMarkdown(file: Buffer) {
    return file.toString("utf-8");
  }
  async extractTables(file: Buffer) {
    return file.toString("utf-8");
  }
  async extractImages() {
    return [];
  }
}

describe("DocumentIntelligenceService", () => {
  it("runs the pipeline and returns structured output", async () => {
    const storage = new StorageService(new LocalStorageBackend("/tmp/idg-di-test"));
    const embeddings = new EmbeddingsService(new HashEmbeddingModel(256));
    const kg = new KnowledgeGraphService();
    const bus = new EventBus({ inMemory: true });
    const published: string[] = [];
    bus.subscribe("document.intelligence.completed", () => published.push("completed"));

    const svc = new DocumentIntelligenceService({
      storage,
      ocr: new FakeOcr() as any,
      entities: new EntitiesService(),
      embeddings,
      knowledgeGraph: kg,
      bus,
    });

    await storage.put("doc1.pdf", Buffer.from("La Ley 87-01 creó la Seguridad Social Dominicana el 12 de marzo de 2021.", "utf-8"));
    const result = await svc.process("doc1", "doc1.pdf");

    expect(result.documentId).toBe("doc1");
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.classification).toBe("legislation");
    expect(result.embeddingDim).toBe(256);
    expect(published).toContain("completed");
  });
});
