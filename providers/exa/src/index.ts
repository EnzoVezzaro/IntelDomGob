// Search Provider: Exa (neural / semantic search).
//
// Adapter to the Exa API. Registered only when EXA_API_KEY is present.

import type { SearchProvider, SearchOptions, SearchResultItem } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:exa");

export interface ExaProviderOptions {
  apiKey?: string;
  id?: string;
}

interface RawExaResult {
  title?: string;
  url?: string;
  text?: string;
}

export class ExaSearchProvider implements SearchProvider {
  id: string;
  kind = "search" as const;
  label = "Exa";
  enabled = true;

  private apiKey?: string;

  constructor(opts: ExaProviderOptions = {}) {
    this.apiKey = opts.apiKey || process.env.EXA_API_KEY;
    this.id = opts.id ?? "exa";
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResultItem[]> {
    const key = this.apiKey || process.env.EXA_API_KEY;
    if (!key) {
      log.warn("Exa search skipped: EXA_API_KEY not configured");
      return [];
    }
    const maxResults = opts.maxResults ?? 10;
    const body = {
      query,
      numResults: maxResults,
      contents: { text: true, highlight: true },
      language: opts.lang || "es",
    };
    try {
      const data = await fetchJson<{ results?: RawExaResult[] }>("https://api.exa.ai/search", {
        timeoutMs: 15000,
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify(body),
      });
      return (data.results ?? [])
        .filter((r) => r.url)
        .slice(0, maxResults)
        .map((r) => ({
          title: r.title || "Untitled",
          url: r.url as string,
          snippet: r.text || "",
          engine: "exa",
        }));
    } catch (e) {
      log.warn("Exa search failed", { query, error: String(e) });
      return [];
    }
  }
}

export function createExaProvider(opts: ExaProviderOptions = {}): ExaSearchProvider {
  return new ExaSearchProvider(opts);
}
