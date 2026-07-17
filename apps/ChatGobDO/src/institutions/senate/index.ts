import type { InstitutionService, InstitutionResult, InstitutionDocument } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchJson } from "../shared";

// Senado de la República — public WordPress REST API. Surfaces initiatives,
// sessions and coverage as posts. (Legacy MasterLex/wfilemaster is login-gated.)

const SENADO_HOST = "https://www.senadord.gob.do";
const WP_API = `${SENADO_HOST}/wp-json/wp/v2/posts`;

export const senateConfig = {
  id: "senate",
  name: "Senado de la República",
  description: "Cámara alta del Congreso Nacional — iniciativas, sesiones y cobertura.",
  url: SENADO_HOST,
  enabledByDefault: true,
  wpApi: WP_API,
  perPage: 10,
  maxResults: 20,
};

interface SenadoPost {
  link?: string;
  url?: string;
  title?: { rendered?: string } | string;
  date?: string;
}

function toResult(post: SenadoPost): InstitutionResult | null {
  const link: string = post.link || post.url || "";
  const raw = typeof post.title === "string" ? post.title : post.title?.rendered || "";
  const title: string = raw.replace(/<[^>]+>/g, "").trim();
  const date: string = post.date || "";
  if (!link || !title) return null;
  return { title, url: link, date, engine: "senado-api", institution: senateConfig.name };
}

export const senateApi = {
  /** Keyword search over the Senate WordPress posts. */
  async search(query: string): Promise<InstitutionResult[]> {
    const out: InstitutionResult[] = [];
    const seen = new Set<string>();
    const toks = queryTokens(query);
    const queries = Array.from(new Set([query, ...toks]));
    for (const q of queries) {
      if (!q) continue;
      const ep = `${WP_API}?search=${encodeURIComponent(q)}&per_page=${senateConfig.perPage}`;
      const data = await fetchJson(ep);
      if (!Array.isArray(data)) continue;
      for (const post of data as SenadoPost[]) {
        const r = toResult(post);
        if (!r || seen.has(r.url)) continue;
        const needed = requiredOverlap(toks);
        if (toks.length > 0 && tokenOverlap(r.title, toks) < needed) continue;
        seen.add(r.url);
        out.push(r);
      }
      if (out.length >= senateConfig.maxResults) break;
    }
    return out.slice(0, senateConfig.maxResults);
  },
};

class SenateService implements InstitutionService {
  id = senateConfig.id;
  name = senateConfig.name;
  description = senateConfig.description;
  enabledByDefault = senateConfig.enabledByDefault;
  url = senateConfig.url;

  async initialize(): Promise<void> {
    // No warm-up needed; WP API is public.
  }
  async seed(): Promise<void> {}
  async sync(): Promise<void> {
    await this.search("República Dominicana");
  }
  async search(query: string): Promise<InstitutionResult[]> {
    return senateApi.search(query);
  }
  async getDocuments(): Promise<InstitutionDocument[]> {
    const posts = await senateApi.search("");
    return posts.map(({ institution, ...doc }) => doc);
  }
  async healthCheck(): Promise<boolean> {
    const data = await fetchJson(`${WP_API}?per_page=1`);
    return Array.isArray(data);
  }
}

export const senateService = new SenateService();
export default senateService;
