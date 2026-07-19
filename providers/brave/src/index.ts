// Search Provider: Brave Search API.
//
// Adapter to the Brave Web Search API. Registered only when BRAVE_API_KEY is
// present; never crashes boot. No other platform code changes to add a provider.

import type { SearchProvider, SearchOptions, SearchResultItem } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:brave");

export interface BraveProviderOptions {
  apiKey?: string;
  id?: string;
}

interface RawBraveResult {
  title?: string;
  url?: string;
  description?: string;
}

export class BraveSearchProvider implements SearchProvider {
  id: string;
  kind = "search" as const;
  label = "Brave Search";
  enabled = true;

  private apiKey?: string;

  constructor(opts: BraveProviderOptions = {}) {
    this.apiKey = opts.apiKey || process.env.BRAVE_API_KEY;
    this.id = opts.id ?? "brave";
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResultItem[]> {
    const key = this.apiKey || process.env.BRAVE_API_KEY;
    if (!key) {
      log.warn("Brave search skipped: BRAVE_API_KEY not configured");
      return [];
    }
    const maxResults = opts.maxResults ?? 10;
    const params = new URLSearchParams({
      q: query,
      count: String(maxResults),
      country: opts.lang === "en" ? "US" : "DO",
      search_lang: opts.lang || "es",
      safesearch: opts.safe ? "strict" : "moderate",
    });
    if (opts.timeRange) params.set("freshness", opts.timeRange === "day" ? "pd" : opts.timeRange === "week" ? "pw" : "pm");

    const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
    try {
      const data = await fetchJson<{ web?: { results?: RawBraveResult[] } }>(url, {
        timeoutMs: 15000,
        headers: { Accept: "application/json", "X-Subscription-Token": key },
      });
      return (data.web?.results ?? [])
        .filter((r) => r.url)
        .slice(0, maxResults)
        .map((r) => ({
          title: r.title || "Untitled",
          url: r.url as string,
          snippet: r.description || "",
          engine: "brave",
        }));
    } catch (e) {
      log.warn("Brave search failed", { query, error: String(e) });
      return [];
    }
  }
}

export function createBraveProvider(opts: BraveProviderOptions = {}): BraveSearchProvider {
  return new BraveSearchProvider(opts);
}
