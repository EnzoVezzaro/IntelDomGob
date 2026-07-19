// Default AI Provider: Google Gemini.
//
// This wraps the existing @google/genai SDK behind the platform's AiProvider
// contract. Any other model vendor (OpenAI, Anthropic, ...) only needs its own
// provider implementation — nothing else in the platform changes.

import { GoogleGenAI, Type } from "@google/genai";
import type { AiProvider, AiRequest, AiResponse } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("provider:gemini");

export interface GeminiProviderOptions {
  /** API key (may be overridden per-request). */
  apiKey?: string;
  id?: string;
  defaultModel?: string;
}

export class GeminiAiProvider implements AiProvider {
  id: string;
  kind = "ai" as const;
  label = "Google Gemini";
  enabled = true;

  private readonly defaultModel: string;
  private apiKey?: string;
  private client: GoogleGenAI | null = null;

  constructor(opts: GeminiProviderOptions = {}) {
    this.apiKey = opts.apiKey;
    this.id = opts.id ?? "gemini";
    this.defaultModel = opts.defaultModel ?? "gemini-3.1-flash-lite";
  }

  private getClient(apiKey?: string): GoogleGenAI {
    const key = apiKey || this.apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not configured. Provide it via env or request.");
    }
    if (!this.client || (apiKey && this.client["apiKey"] !== apiKey)) {
      this.client = new GoogleGenAI({
        apiKey: key,
        httpOptions: { headers: { "User-Agent": "intel-dom-gob" } },
      });
    }
    return this.client;
  }

  async generate(req: AiRequest): Promise<AiResponse> {
    const ai = this.getClient(req.model ? undefined : undefined);
    const model = req.model || this.defaultModel;

    const contents = req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : m.role, parts: [{ text: m.content }] }));

    const config: Record<string, unknown> = {
      systemInstruction: req.systemInstruction,
      temperature: req.temperature ?? 0.4,
      maxOutputTokens: req.maxOutputTokens ?? 8192,
    };
    if (req.jsonMode) {
      config.responseMimeType = "application/json";
      if (req.responseSchema) config.responseSchema = req.responseSchema;
    }

    // Retry on transient errors (503 / overload) with exponential backoff.
    const MAX_RETRIES = 5;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await ai.models.generateContent({ model, contents, config });
        return { text: response.text ?? "", model, usage: { outputTokens: response.usageMetadata?.candidatesTokenCount } };
      } catch (err) {
        lastErr = err;
        const status = String((err as any)?.status || (err as any)?.code || (err as any)?.message || "");
        const transient =
          status === "503" ||
          status === "UNAVAILABLE" ||
          status === "429" ||
          /high demand|UNAVAILABLE|503|overload|try again later|ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed/i.test(status);
        if (!transient || attempt === MAX_RETRIES) break;
        const waitMs = 5000 * attempt;
        log.warn("Gemini transient error", { attempt, waitMs, model });
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Stream a completion token-by-token (Server-Sent-Events friendly). */
  async *stream(req: AiRequest): AsyncIterable<string> {
    const ai = this.getClient(req.model ? undefined : undefined);
    const model = req.model || this.defaultModel;

    const contents = req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : m.role, parts: [{ text: m.content }] }));
    const config: Record<string, unknown> = {
      systemInstruction: req.systemInstruction,
      temperature: req.temperature ?? 0.4,
      maxOutputTokens: req.maxOutputTokens ?? 8192,
    };
    if (req.jsonMode) {
      config.responseMimeType = "application/json";
      if (req.responseSchema) config.responseSchema = req.responseSchema;
    }

    const result = await ai.models.generateContentStream({ model, contents, config });
    for await (const chunk of result) {
      const text = chunk.text ?? "";
      if (text) yield text;
    }
  }
}

export function createGeminiProvider(opts: GeminiProviderOptions = {}): GeminiAiProvider {
  return new GeminiAiProvider(opts);
}

/**
 * Embedding model backed by Gemini's `text-embedding-004`. Returns a 768-dim
 * semantic vector. Used by the Embeddings service when a key is configured;
 * the service falls back to the deterministic hash model otherwise.
 */
export class GeminiEmbeddingModel {
  readonly dim = 768;
  private readonly apiKey?: string;
  private readonly model: string;
  private client: GoogleGenAI | null = null;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "text-embedding-004";
  }

  private getClient(): GoogleGenAI {
    const key = this.apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not configured for embeddings.");
    if (!this.client) this.client = new GoogleGenAI({ apiKey: key });
    return this.client;
  }

  async embed(text: string): Promise<number[]> {
    const ai = this.getClient();
    const res = await ai.models.embedContent({
      model: this.model,
      contents: text,
    });
    const values = res.embeddings?.[0]?.values;
    if (!values || values.length === 0) throw new Error("Gemini returned an empty embedding.");
    return values as number[];
  }
}

export function createGeminiEmbeddingModel(opts: { apiKey?: string; model?: string } = {}): GeminiEmbeddingModel {
  return new GeminiEmbeddingModel(opts);
}

/** Re-export the Google schema helper so providers can declare JSON schemas. */
export { Type };
