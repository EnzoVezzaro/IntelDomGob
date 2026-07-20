// Provider architecture.
//
// Everything external to the platform is abstracted behind a Provider. Adding a
// new search engine or AI model requires ONLY creating a new Provider
// implementation and registering it — no other code in the platform changes.
//
//   Search Providers:  SearXNG (default), Brave, Exa, Tavily, Google
//   AI Providers:      Gemini (default), OpenAI, Anthropic, Ollama, DeepSeek
//
// Each provider implementation lives in its own folder and exports a single
// factory returning the provider instance.

import type { ProviderDescriptor } from "@intel.dom.gob/types";

// ---------------------------------------------------------------------------
// Search provider contract
// ---------------------------------------------------------------------------

export interface SearchOptions {
  lang?: string;
  category?: string;
  safe?: boolean;
  timeRange?: string;
  engines?: string;
  maxResults?: number;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  engine: string;
}

export interface SearchProvider extends ProviderDescriptor {
  search(query: string, opts?: SearchOptions): Promise<SearchResultItem[]>;
}

// ---------------------------------------------------------------------------
// AI provider contract
// ---------------------------------------------------------------------------

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiRequest {
  model?: string;
  messages: AiMessage[];
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** When set, the model must return JSON conforming to this schema. */
  responseSchema?: unknown;
  /** When true, the model is expected to output JSON (responseMimeType). */
  jsonMode?: boolean;
}

export interface AiResponse {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Result of a provider liveness probe (no token cost where possible). */
export interface AiProviderHealth {
  ok: boolean;
  /** The provider's default model (for display + verification). */
  model?: string;
  detail?: string;
}

export interface AiProvider extends ProviderDescriptor {
  /** Generate a completion. */
  generate(req: AiRequest): Promise<AiResponse>;
  /** Stream a completion token-by-token. */
  stream?(req: AiRequest): AsyncIterable<string>;
  /** Lightweight liveness check, provider-specific (no token cost where possible). */
  health?(): Promise<AiProviderHealth>;
}

// ---------------------------------------------------------------------------
// OCR provider contract
// ---------------------------------------------------------------------------

export interface OcrProvider extends ProviderDescriptor {
  extractText(file: Buffer | string): Promise<string>;
  extractMarkdown(file: Buffer | string): Promise<string>;
  extractTables(file: Buffer | string): Promise<string>;
  extractImages(file: Buffer | string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Presentation provider contract (e.g. HyperFrames)
// ---------------------------------------------------------------------------

export interface PresentationProvider extends ProviderDescriptor {
  /** Render a report/summary into a shareable presentation artifact. */
  render(input: { title: string; content: string; format?: "html" | "video" }): Promise<{ url: string; format: string }>;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private readonly search = new Map<string, SearchProvider>();
  private readonly ai = new Map<string, AiProvider>();
  private readonly ocr = new Map<string, OcrProvider>();
  private readonly presentation = new Map<string, PresentationProvider>();

  registerSearch(provider: SearchProvider): void {
    this.search.set(provider.id, provider);
  }
  registerAi(provider: AiProvider): void {
    this.ai.set(provider.id, provider);
  }
  registerOcr(provider: OcrProvider): void {
    this.ocr.set(provider.id, provider);
  }
  registerPresentation(provider: PresentationProvider): void {
    this.presentation.set(provider.id, provider);
  }

  getSearch(id: string): SearchProvider | undefined {
    return this.search.get(id);
  }
  getAi(id: string): AiProvider | undefined {
    return this.ai.get(id);
  }
  getOcr(id: string): OcrProvider | undefined {
    return this.ocr.get(id);
  }
  getPresentation(id: string): PresentationProvider | undefined {
    return this.presentation.get(id);
  }

  listSearch(): SearchProvider[] {
    return [...this.search.values()];
  }
  listAi(): AiProvider[] {
    return [...this.ai.values()];
  }
  listOcr(): OcrProvider[] {
    return [...this.ocr.values()];
  }
  listPresentation(): PresentationProvider[] {
    return [...this.presentation.values()];
  }
}

export const providerRegistry = new ProviderRegistry();
