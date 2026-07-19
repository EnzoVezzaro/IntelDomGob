// services/rag
//
// Single responsibility: retrieval-augmented generation over an indexed corpus.
//
// Stores embedded documents and answers queries by nearest-neighbour retrieval,
// then defers synthesis to the AI service. It owns NO provider logic — it calls
// the AI service passed in by the orchestrator. This is the RAG layer referenced
// in WORK.md.

import { createLogger } from "@intel.dom.gob/logger";
import { EmbeddingsService } from "@intel.dom.gob/service-embeddings";
import type { AiService } from "@intel.dom.gob/service-ai";

const log = createLogger("service:rag");

interface IndexedDoc {
  id: string;
  text: string;
  vector: number[];
  meta?: Record<string, unknown>;
}

export class RagService {
  private readonly embeddings: EmbeddingsService;
  private docs: IndexedDoc[] = [];

  constructor(embeddings: EmbeddingsService = new EmbeddingsService()) {
    this.embeddings = embeddings;
  }

  async index(id: string, text: string, meta?: Record<string, unknown>): Promise<void> {
    const vector = await this.embeddings.embed(text);
    this.docs.push({ id, text, vector, meta });
  }

  /** Retrieve the top-k most similar chunks to the query. */
  async retrieve(query: string, k = 4): Promise<IndexedDoc[]> {
    const qv = await this.embeddings.embed(query);
    return this.docs
      .map((d) => ({ d, score: cosineLocal(qv, d.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.d);
  }

  /** Retrieve context and synthesize an answer via the AI service. */
  async answer(query: string, ai: AiService, k = 4): Promise<string> {
    const hits = await this.retrieve(query, k);
    const context = hits.map((h, i) => `[${i + 1}] ${h.text}`).join("\n\n");
    return ai.chat({
      systemInstruction: "Responde la pregunta usando SOLO el CONTEXTO. Cita los fragmentos relevantes.",
      grounding: context,
      message: query,
    });
  }
}

function cosineLocal(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
