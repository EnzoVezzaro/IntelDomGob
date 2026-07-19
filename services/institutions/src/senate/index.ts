import type { InstitutionService, InstitutionResult, InstitutionDocument, InstitutionLaw, BulletinDoc } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchJson } from "../shared";
import {
  searchExpedientes,
  expedienteToLaw,
  expedienteToResult,
  expedienteToBulletin,
  fetchBulletins,
  searchSenadoConcepts,
  type SenateConceptMap,
} from "./dspace";

// Senado de la República.
// Two complementary channels:
//   1) WordPress REST API (senadord.gob.do) — narrative activity / press.
//   2) DSpace REST API (memoriahistorica.senadord.gob.do) — structured
//      legislative records (expedientes / iniciativas / proyectos de ley).

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
  async search(query: string, restricted = true): Promise<InstitutionResult[]> {
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
        // In free search we keep all posts (ranked by WP relevance). Only apply
        // the strict topical gate when a portal is explicitly restricted.
        if (restricted && toks.length > 0) {
          const needed = requiredOverlap(toks);
          if (tokenOverlap(r.title, toks) < needed) continue;
        }
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

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> {
    await this.search("República Dominicana", false);
  }

  /**
   * Merge WordPress narrative activity with structured SIL expedientes so the
   * Senate contributes BOTH its news coverage and its actual legislative record.
   */
  async search(query: string, restricted = false): Promise<InstitutionResult[]> {
    const wp = await senateApi.search(query, restricted).catch(() => [] as InstitutionResult[]);
    const sil = await searchExpedientes(query, { maxResults: 20 })
      .then((exps) => exps.map(expedienteToResult))
      .catch(() => [] as InstitutionResult[]);
    const seen = new Set<string>();
    const merged: InstitutionResult[] = [];
    for (const r of [...wp, ...sil]) {
      const k = r.url.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(r);
    }
    return merged;
  }

  async getDocuments(): Promise<InstitutionDocument[]> {
    const docs = await senateApi.search("", false).catch(() => [] as InstitutionResult[]);
    return docs.map(({ institution, ...d }) => d);
  }

  async healthCheck(): Promise<boolean> {
    const data = await fetchJson(`${WP_API}?per_page=1`);
    return Array.isArray(data);
  }

  /** Structured Senate SIL laws/iniciativas for a keyword (ranked, top 20). */
  async getLaws(query: string): Promise<InstitutionLaw[]> {
    const exps = await searchExpedientes(query, { maxResults: 20 })
      .catch(() => [] as Awaited<ReturnType<typeof searchExpedientes>>);
    return exps.map(expedienteToLaw);
  }

  /** Recent bulletins, session records, and year-based Senado content. */
  async getBulletins(query: string): Promise<BulletinDoc[]> {
    return fetchBulletins(query, { maxResults: 10 }).catch(() => []);
  }

  /**
   * Broad Senado DSpace search, separated by legislative concept
   * (iniciativas / resoluciones / boletines / actas / informes). SIL
   * iniciativas are the highest-priority concept; the rest are supplementary.
   * Returns streams already shaped as LawRef / BulletinRef for the response.
   */
  async getConcepts(query: string): Promise<{
    iniciativas: InstitutionLaw[];
    resoluciones: InstitutionLaw[];
    boletines: BulletinDoc[];
    actas: BulletinDoc[];
    informes: BulletinDoc[];
  }> {
    const concept = await searchSenadoConcepts(query, { maxPerConcept: 8 }).catch(() => null);
    if (!concept) {
      return { iniciativas: [], resoluciones: [], boletines: [], actas: [], informes: [] };
    }
    return {
      iniciativas: concept.iniciativas.map(expedienteToLaw),
      resoluciones: concept.resoluciones.map(expedienteToLaw),
      boletines: concept.boletines.map(expedienteToBulletin),
      actas: concept.actas.map(expedienteToBulletin),
      informes: concept.informes.map(expedienteToBulletin),
    };
  }
}

export const senateService = new SenateService();
export default senateService;
