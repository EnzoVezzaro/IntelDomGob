// services/embeddings
//
// Single responsibility: produce and compare vector embeddings for text.
//
// The embedding MODEL is pluggable behind a small interface (no provider
// coupling here). By default it uses a deterministic hash-based bag-of-tokens
// embedding so the service works without external dependencies; swap in a real
// model (e.g. Gemini/text-embedding) by supplying an EmbeddingModel.

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:embeddings");

export interface EmbeddingModel {
  dim: number;
  embed(text: string): number[] | Promise<number[]>;
}

/** Deterministic, dependency-free fallback embedding (NOT semantic). */
export class HashEmbeddingModel implements EmbeddingModel {
  dim: number;
  constructor(dim = 256) {
    this.dim = dim;
  }
  embed(text: string): number[] {
    const vec = new Array(this.dim).fill(0);
    const tokens = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\W+/).filter(Boolean);
    for (const t of tokens) {
      let h = 2166136261;
      for (let i = 0; i < t.length; i++) {
        h ^= t.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      vec[Math.abs(h) % this.dim] += 1;
    }
    return vec;
  }
}

export class EmbeddingsService {
  private readonly model: EmbeddingModel;
  constructor(model: EmbeddingModel = new HashEmbeddingModel()) {
    this.model = model;
  }

  get dim(): number {
    return this.model.dim;
  }

  /** Build an EmbeddingsService. Uses a semantic Gemini embedding model when a
   * key is configured, otherwise the deterministic hash fallback. */
  static async createDefault(): Promise<EmbeddingsService> {
    if (process.env.DEFAULT_AI_API_KEY) {
      try {
        const { createGeminiEmbeddingModel } = await import("@intel.dom.gob/provider-gemini");
        return new EmbeddingsService(createGeminiEmbeddingModel());
      } catch {
        // fall through to hash model if the provider cannot be loaded
      }
    }
    return new EmbeddingsService();
  }

  async embed(text: string): Promise<number[]> {
    return this.model.embed(text);
  }

  /** Cosine similarity in [0,1]. */
  async similarity(a: string, b: string): Promise<number> {
    const [va, vb] = await Promise.all([this.embed(a), this.embed(b)]);
    return cosine(va, vb);
  }
}

export function cosine(a: number[], b: number[]): number {
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
