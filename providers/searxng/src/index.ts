// Default Search Provider: SearXNG.
//
// This is the self-hosted anonymous JSON API instance already present in the
// repository (apps/searxng). It is preserved exactly; this provider is simply
// the clean adapter between the platform and that instance.

import type { SearchProvider, SearchOptions, SearchResultItem } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:searxng");

export interface SearXNGProviderOptions {
  /** Base URL of the SearXNG instance, e.g. http://searxng:8080. */
  baseUrl: string;
  id?: string;
}

interface RawSearXNGResult {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
}

export class SearXNGSearchProvider implements SearchProvider {
  id: string;
  kind = "search" as const;
  label = "SearXNG";
  enabled = true;

  private readonly baseUrl: string;

  constructor(opts: SearXNGProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.id = opts.id ?? "searxng";
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResultItem[]> {
    const params: Record<string, string> = {
      q: query,
      format: "json",
      language: opts.lang || "es",
      categories: opts.category || "general",
    };
    if (opts.safe) params.safesearch = "1";
    if (opts.timeRange) params.time_range = opts.timeRange;
    if (opts.engines) params.engines = opts.engines;

    const maxResults = opts.maxResults ?? 10;
    const url = `${this.baseUrl}/search?${new URLSearchParams(params).toString()}`;
    try {
      const data = await fetchJson<{ results?: RawSearXNGResult[] }>(url, { timeoutMs: 15000 });
      const results = data.results ?? [];
      return results
        .filter((r) => r.url)
        .slice(0, maxResults)
        .map((r) => ({
          title: r.title || "Untitled",
          url: r.url as string,
          snippet: r.content || "",
          engine: r.engine || "unknown",
        }));
    } catch (e) {
      log.warn("SearXNG search failed", { query, error: String(e) });
      return [];
    }
  }
}

export function createSearXNGProvider(opts: SearXNGProviderOptions): SearXNGSearchProvider {
  return new SearXNGSearchProvider(opts);
}
