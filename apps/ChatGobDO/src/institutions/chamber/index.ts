import type { InstitutionService, InstitutionResult, InstitutionDocument, InstitutionLaw } from "../types";
import {
  queryTokens, tokenOverlap, requiredOverlap, fetchText, fetchJson, extractLinks, classifyInstitution,
} from "../shared";

// Cámara de Diputados — two live channels:
//  1) SIL API (iniciativas / proyectos de ley) — structured legislative records.
//  2) Official portal HTML scrape of legislative sections (direct activity).

const CHAMBER_HOST = "https://www.camarediputados.gob.do";
const SIL_HOST = "https://www.diputadosrd.gob.do";
const SIL_API = `${SIL_HOST}/sil/api/iniciativa/getIniciativas`;

// Legislative-action sections scraped directly from the portal HTML.
const LEGISLATIVE_SECTIONS = [
  "https://www.diputadosrd.gob.do/sil/iniciativa",
  "https://camaradediputados.gob.do/sesiones-del-pleno/",
  "https://camaradediputados.gob.do/debates-de-sesiones/",
  "https://camaradediputados.gob.do/vistas-publicas/",
  "https://camaradediputados.gob.do/ordenes-del-dia-del-pleno/",
  "https://camaradediputados.gob.do/agenda-comisiones/",
  "https://camaradediputados.gob.do/actas/",
];

export const chamberConfig = {
  id: "chamber",
  name: "Cámara de Diputados",
  description: "Cámara baja del Congreso Nacional — iniciativas (SIL), sesiones, comisiones.",
  url: CHAMBER_HOST,
  enabledByDefault: true,
  silApi: SIL_API,
  silContextMax: 12,
  maxResults: 40,
};

interface SilRaw {
  id: number;
  numero?: string;
  tipo?: string;
  descripcion?: string;
  estado?: string;
  condicion?: string;
  materia?: string;
  fechaDeposito?: string;
}

export const chamberApi = {
  /** Query the Diputados SIL laws API, falling back to individual tokens. */
  async getLaws(keyword: string, periodoId = 0, maxResults = 15): Promise<InstitutionLaw[]> {
    const STOP = new Set([
      "de", "la", "el", "los", "las", "y", "en", "a", "del", "por", "para", "con", "que", "su", "se", "un", "una",
      "proyecto", "ley", "reforma", "sobre", "al", "lo", "como", "o", "es", "dominicana", "republica",
      "cual", "este", "esta", "the", "of", "and", "to", "in", "for", "is", "on", "with", "dominican",
    ]);
    const tokens = keyword
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .split(/\s+/).map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length > 2 && !STOP.has(t));
    const attempts = [keyword, ...Array.from(new Set(tokens))];

    const byId = new Map<number, InstitutionLaw>();
    for (const kw of attempts) {
      if (!kw) continue;
      const url = `${SIL_API}?page=1&keyword=${encodeURIComponent(kw)}&periodoId=${periodoId}`;
      const data = await fetchJson(url);
      const results: SilRaw[] = data?.results || [];
      for (const r of results) {
        if (byId.has(r.id)) continue;
        byId.set(r.id, {
          numero: r.numero || "",
          tipo: r.tipo || "Iniciativa",
          descripcion: (r.descripcion || "").replace(/\s+/g, " ").trim(),
          estado: r.estado || r.condicion || "",
          materia: r.materia || "",
          fechaDeposito: r.fechaDeposito || "",
          url: `https://www.diputadosrd.gob.do/sil/iniciativa/${r.id}`,
        });
      }
      if (byId.size >= maxResults) break;
    }
    return Array.from(byId.values()).slice(0, maxResults);
  },

  /** Scrape the official portal's legislative-action pages for in-domain links. */
  async scrapeActivity(query: string, restricted = true): Promise<InstitutionResult[]> {
    const out: InstitutionResult[] = [];
    const seen = new Set<string>();
    for (const page of LEGISLATIVE_SECTIONS.slice(0, 4)) {
      const html = await fetchText(page);
      if (!html) continue;
      const links = extractLinks(html, page, true);
      const toks = queryTokens(query);
      const needed = requiredOverlap(toks);
      for (const { url, title } of links) {
        if (title.length < 5) continue;
        if (restricted && (toks.length === 0 || tokenOverlap(title, toks) < needed)) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url, engine: "portal-oficial", institution: chamberConfig.name });
      }
    }
    return out.slice(0, chamberConfig.maxResults);
  },
};

class ChamberService implements InstitutionService {
  id = chamberConfig.id;
  name = chamberConfig.name;
  description = chamberConfig.description;
  enabledByDefault = chamberConfig.enabledByDefault;
  url = chamberConfig.url;

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> {
    await this.search("República Dominicana");
  }
  async search(query: string): Promise<InstitutionResult[]> {
    return chamberApi.scrapeActivity(query, false);
  }
  async getDocuments(): Promise<InstitutionDocument[]> {
    const docs = await chamberApi.scrapeActivity("", false);
    return docs.map(({ institution, ...d }) => d);
  }
  async healthCheck(): Promise<boolean> {
    const data = await fetchJson(`${SIL_API}?page=1&keyword=test&periodoId=0`);
    return !!data;
  }
  // Legislative capability (SIL).
  async getLaws(query: string): Promise<InstitutionLaw[]> {
    return chamberApi.getLaws(query, 0, chamberConfig.silContextMax);
  }
}

export const chamberService = new ChamberService();
export default chamberService;
