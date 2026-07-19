// services/document-intelligence
//
// Orchestrates the Document Intelligence Pipeline described in WORK.md:
//
//   Upload → Storage → OCR → Text → Classification → Metadata → Entities
//          → Embedding → Knowledge Graph → Available for AI
//
// It is a coordination service: it calls the Storage, OCR, Entities, and
// Embeddings services (single responsibility each) and the Knowledge Graph
// service, but contains no provider logic itself. Heavy steps are also emitted
// as events so workers can process them asynchronously.

import { createLogger } from "@intel.dom.gob/logger";
import type { StorageService } from "@intel.dom.gob/service-storage";
import type { OcrService } from "@intel.dom.gob/service-ocr";
import type { EntitiesService } from "@intel.dom.gob/service-entities";
import type { EmbeddingsService } from "@intel.dom.gob/service-embeddings";
import type { KnowledgeGraphService } from "@intel.dom.gob/service-knowledge-graph";
import type { EventBus } from "@intel.dom.gob/events";

const log = createLogger("service:document-intelligence");

export interface DocumentIntelligenceResult {
  documentId: string;
  storageKey: string;
  textStorageKey?: string;
  charCount: number;
  classification: string;
  metadata: Record<string, unknown>;
  entities: { text: string; type: string }[];
  relations: { from: string; to: string; type: string }[];
  embeddingDim?: number;
  graphEntities?: number;
}

export interface DocumentIntelligenceDeps {
  storage: StorageService;
  ocr: OcrService;
  entities: EntitiesService;
  embeddings: EmbeddingsService;
  knowledgeGraph: KnowledgeGraphService;
  bus?: EventBus;
}

export class DocumentIntelligenceService {
  private readonly deps: DocumentIntelligenceDeps;

  constructor(deps: DocumentIntelligenceDeps) {
    this.deps = deps;
  }

  /** Classify a document by simple keyword heuristics (replaceable later). */
  private classify(text: string): string {
    const t = text.toLowerCase();
    if (/ley|decreto|resolución|resolucion|cámara|senado/.test(t)) return "legislation";
    if (/contrataci|licitaci|dgcp|proveedor/.test(t)) return "procurement";
    if (/sentencia|tribunal|juzgado|corte/.test(t)) return "jurisprudence";
    if (/presupuesto|finanzas|banco central/.test(t)) return "finance";
    return "general";
  }

  async process(documentId: string, storageKey: string, format: "text" | "markdown" | "tables" = "text"): Promise<DocumentIntelligenceResult> {
    const { storage, ocr, entities, embeddings, knowledgeGraph, bus } = this.deps;
    log.info("Document intelligence pipeline start", { documentId });

    await bus?.publish("ocr.started", { documentId }, documentId);
    const file = await storage.get(storageKey);
    const text = format === "markdown"
      ? await ocr.extractMarkdown(file)
      : format === "tables"
        ? await ocr.extractTables(file)
        : await ocr.extractText(file);
    const textKey = `${storageKey}.ocr.txt`;
    await storage.put(textKey, Buffer.from(text, "utf-8"));
    await bus?.publish("ocr.completed", { documentId, textStorageKey: textKey, charCount: text.length }, documentId);

    const classification = this.classify(text);
    const metadata = { pages: text.length, language: "es", source: storageKey };

    await bus?.publish("entity.extracted", { documentId }, documentId);
    const extraction = await entities.extract(text);

    const vector = await embeddings.embed(text);
    await bus?.publish("embedding.completed", { documentId, dim: vector.length }, documentId);

    // Feed the knowledge graph: laws + institutions become entities/relations.
    const kgResult = await knowledgeGraph.ingest({
      response: { citations: extraction.entities.filter((e) => e.type === "institution" || e.type === "law").map((e) => ({ title: e.text, institution: e.type === "institution" ? e.text : undefined })) },
      sources: { laws: extraction.entities.filter((e) => e.type === "law").map((e) => ({ numero: e.text, tipo: "Ley", url: "" })) },
    });

    const result: DocumentIntelligenceResult = {
      documentId,
      storageKey,
      textStorageKey: textKey,
      charCount: text.length,
      classification,
      metadata,
      entities: extraction.entities.map((e) => ({ text: e.text, type: e.type })),
      relations: extraction.relations.map((r) => ({ from: r.from, to: r.to, type: r.type })),
      embeddingDim: vector.length,
      graphEntities: kgResult.entities.length,
    };

    await bus?.publish("document.intelligence.completed", { documentId, ready: true }, documentId);
    log.info("Document intelligence pipeline completed", { documentId, classification });
    return result;
  }
}
