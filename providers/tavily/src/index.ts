// Search Provider: Tavily.
//
// Adapter to the Tavily Search API (optimized for LLM/RAG workloads). Registered
// only when TAVILY_API_KEY is present.

import type { SearchProvider, SearchOptions, SearchResultItem } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:tavily");

export interface TavilyProviderOptions {
  apiKey?: string;
  id?: string;
}

interface RawTavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export class TavilySearchProvider implements SearchProvider {
  id: string;
  kind = "search" as const;
  label = "Tavily";
  enabled = true;

  private apiKey?: string;

  constructor(opts: TavilyProviderOptions = {}) {
    this.apiKey = opts.apiKey || process.env.TAVILY_API_KEY;
    this.id = opts.id ?? "tavily";
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResultItem[]> {
    const key = this.apiKey || process.env.TAVILY_API_KEY;
    if (!key) {
      log.warn("Tavily search skipped: TAVILY_API_KEY not configured");
      return [];
    }
    const maxResults = opts.maxResults ?? 10;
    const body = {
      api_key: key,
      query,
      max_results: maxResults,
      search_depth: opts.timeRange ? "advanced" : "basic",
      include_answer: false,
      language: opts.lang || "es",
    };
    try {
      const data = await fetchJson<{ results?: RawTavilyResult[] }>("https://api.tavily.com/search", {
        timeoutMs: 15000,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return (data.results ?? [])
        .filter((r) => r.url)
        .slice(0, maxResults)
        .map((r) => ({
          title: r.title || "Untitled",
          url: r.url as string,
          snippet: r.content || "",
          engine: "tavily",
        }));
    } catch (e) {
      log.warn("Tavily search failed", { query, error: String(e) });
      return [];
    }
  }
}

export function createTavilyProvider(opts: TavilyProviderOptions = {}): TavilySearchProvider {
  return new TavilySearchProvider(opts);
}
