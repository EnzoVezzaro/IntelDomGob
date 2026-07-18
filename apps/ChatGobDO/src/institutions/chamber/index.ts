import type { InstitutionService, InstitutionResult, InstitutionDocument, InstitutionLaw } from "../types";
import {
  fetchJson, relevanceScore, tokenizeQuery, isNumberQuery, numeroMatchesQuery,
} from "../shared";

// Cámara de Diputados — structured legislative records via the public SIL API.
// The SIL exposes a JSON endpoint (iniciativas / proyectos de ley) that is the
// authoritative source; the legacy portal HTML sections are SPA shells with no
// server-rendered legislative content, so this module relies solely on the API.

const CHAMBER_HOST = "https://www.camarediputados.gob.do";
const SIL_HOST = "https://www.diputadosrd.gob.do";
const SIL_API = `${SIL_HOST}/sil/api/iniciativa/getIniciativas`;
const SIL_PAGE_SIZE = 10;

export const chamberConfig = {
  id: "chamber",
  name: "Cámara de Diputados",
  description: "Cámara baja del Congreso Nacional — iniciativas (SIL), sesiones, comisiones.",
  url: CHAMBER_HOST,
  enabledByDefault: true,
  silApi: SIL_API,
  silContextMax: 12,
  maxResults: 40,
  searchMax: 30,
};

interface SilRaw {
  id: number;
  numero?: string;
  tipo?: string;
  descripcion?: string;
  estado?: string;
  condicion?: string;
  materia?: string;
  grupo?: string;
  origen?: string;
  legislatura?: string;
  periodoRegistro?: string;
  fechaDeposito?: string;
  fechaPromulgacion?: string | null;
  numPromulgacion?: string | null;
  temaId?: number | null;
}

interface SilPage {
  page: number;
  pageSize: number;
  total: number;
  results: SilRaw[];
}

export const chamberApi = {
  /**
   * Query the Diputados SIL laws API and paginate through every matching page.
   * The API does server-side substring matching on keyword (numero + descripcion
   * + tipo + materia) and ignores all filter params; it only honors `keyword`
   * and `page` (pageSize is fixed at 10). periodoId=0 already spans all
   * legislatures, so no period enumeration is needed.
   */
  async getLaws(keyword: string, periodoId = 0, maxResults = 30): Promise<InstitutionLaw[]> {
    const raw = (keyword || "").trim();
    // The SIL API does phrase/AND matching on the keyword, so a multi-word raw
    // query (e.g. "3 causales en la reforma penal") returns nothing. We therefore
    // query with individual meaningful tokens (most-specific first) and let the
    // shared relevanceScorer decide which returned records are actually on-topic.
    // Also extract number-like patterns (e.g. "50-88") so they are searched with
    // hyphens preserved.
    const tokens = tokenizeQuery(raw);
    const numberPatterns = (raw.match(/\d+\s*[-–]\s*\d+/g) || []).map((m) => m.replace(/\s+/g, ""));
    const attempts: string[] = Array.from(new Set([...tokens, ...numberPatterns])).sort((a, b) => b.length - a.length);
    
    const byId = new Map<number, { law: InstitutionLaw; score: number }>();
    for (const kw of attempts) {
      if (!kw || byId.size >= maxResults * 3) continue;
      let page = 1;
      // Paginate until a short page or we've covered `total`.
      for (;;) {
        const url = `${SIL_API}?page=${page}&keyword=${encodeURIComponent(kw)}&periodoId=${periodoId}`;
        let data: SilPage | null = null;
        try {
          data = (await fetchJson(url)) as SilPage | null;
        } catch {
          break; // transient API failure: stop paginating this keyword
        }
        const results: SilRaw[] = data?.results || [];
        for (const r of results) {
          if (!r.id || byId.has(r.id)) continue;
          const law: InstitutionLaw = {
            numero: r.numero || "",
            tipo: r.tipo || "Iniciativa",
            descripcion: (r.descripcion || "").replace(/\s+/g, " ").trim(),
            estado: r.estado || r.condicion || "",
            condicion: r.condicion || "",
            materia: r.materia || r.grupo || "",
            grupo: r.grupo || "",
            origen: r.origen || "",
            legislatura: r.legislatura || r.periodoRegistro || "",
            fechaDeposito: (r.fechaDeposito || "").slice(0, 10),
            numPromulgacion: r.numPromulgacion || "",
            url: `https://www.diputadosrd.gob.do/sil/iniciativa/${r.id}`,
          };
          // Score against the keyword that actually retrieved this record, so a
          // record returned for "penal" is judged relevant to "penal" (and never
          // against unrelated tokens from the original multi-word query).
          const hay = `${law.numero} ${law.tipo} ${law.descripcion} ${law.materia} ${law.grupo}`;
          byId.set(r.id, { law, score: relevanceScore(hay, kw) });
          if (byId.size >= maxResults * 3) break;
        }
        if (results.length < SIL_PAGE_SIZE) break;
        if (data && page * SIL_PAGE_SIZE >= data.total) break;
        page++;
        if (page > 60) break; // safety cap (~600 records)
      }
      if (byId.size >= maxResults * 3) break;
    }
    // Rank by relevance, then drop non-relevant records (score 0) so only
    // genuinely on-topic iniciativas reach the context (e.g. "Código Penal",
    // not "parcela Reformada" / "reforma curricular").
    const numberQuery = isNumberQuery(raw);
    return Array.from(byId.values())
      .filter((x) => x.score > 0)
      // For a number-like query, the expediente NUMBER must actually contain the
      // query as a number token — never a loose substring (e.g. "50-88" must not
      // match "05088-2024-2028-CD"). This keeps fuzzy full-text hits out of the
      // Cámara context for ID-style lookups.
      .filter((x) => !numberQuery || numeroMatchesQuery(x.law.numero, raw))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.law)
      .slice(0, maxResults);
  },
};

function lawToResult(law: InstitutionLaw): InstitutionResult {
  const snippet = [
    law.tipo,
    law.estado ? `Estado: ${law.estado}` : "",
    law.materia ? `Materia: ${law.materia}` : "",
    law.fechaDeposito ? `Depositado: ${law.fechaDeposito}` : "",
  ].filter(Boolean).join(" | ");
  return {
    title: `${law.numero} — ${law.descripcion}`.slice(0, 220),
    url: law.url,
    snippet,
    engine: "camara-sil",
    institution: chamberConfig.name,
  };
}

class ChamberService implements InstitutionService {
  id = chamberConfig.id;
  name = chamberConfig.name;
  description = chamberConfig.description;
  enabledByDefault = chamberConfig.enabledByDefault;
  url = chamberConfig.url;

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> {
    await chamberApi.getLaws("República Dominicana", 0, 5);
  }

  /** Topical search over the SIL — returns real iniciativas as results. */
  async search(query: string): Promise<InstitutionResult[]> {
    const laws = await chamberApi.getLaws(query, 0, chamberConfig.searchMax).catch(() => [] as InstitutionLaw[]);
    return laws.map(lawToResult);
  }

  async getDocuments(): Promise<InstitutionDocument[]> {
    const laws = await chamberApi.getLaws("", 0, chamberConfig.searchMax).catch(() => [] as InstitutionLaw[]);
    return laws.map((l) => ({
      title: `${l.numero} — ${l.descripcion}`.slice(0, 220),
      url: l.url,
      snippet: [l.tipo, l.estado ? `Estado: ${l.estado}` : "", l.materia ? `Materia: ${l.materia}` : ""]
        .filter(Boolean).join(" | "),
      engine: "camara-sil",
      date: l.fechaDeposito,
      category: l.materia,
    }));
  }

  async healthCheck(): Promise<boolean> {
    const data = (await fetchJson(`${SIL_API}?page=1&keyword=test&periodoId=0`)) as SilPage | null;
    return !!data && Array.isArray(data.results);
  }

  /** Structured Cámara SIL laws/iniciativas for a keyword. */
  async getLaws(query: string): Promise<InstitutionLaw[]> {
    return chamberApi.getLaws(query, 0, chamberConfig.silContextMax);
  }
}

export const chamberService = new ChamberService();
export default chamberService;
