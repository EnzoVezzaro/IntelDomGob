import type { InstitutionService, InstitutionResult, InstitutionDocument } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchText, extractLinks } from "../shared";

// Consultoría Jurídica del Poder Ejecutivo — news + legal consultations.

const CJ_HOST = "https://www.consultoria.gov.do";
const SECTIONS = [
  "https://www.consultoria.gov.do/News/NewsConsult",
  "https://www.consultoria.gov.do/consulta/",
];

export const consultoriaConfig = {
  id: "consultoria",
  name: "Consultoría Jurídica",
  description: "Órgano asesor jurídico del Poder Ejecutivo.",
  url: CJ_HOST,
  enabledByDefault: true,
  maxResults: 30,
};

export const consultoriaApi = {
  async search(query: string): Promise<InstitutionResult[]> {
    const out: InstitutionResult[] = [];
    const seen = new Set<string>();
    const toks = queryTokens(query);
    const needed = requiredOverlap(toks);
    for (const page of SECTIONS) {
      const html = await fetchText(page);
      if (!html) continue;
      for (const { url, title } of extractLinks(html, page, true)) {
        if (title.length < 5) continue;
        if (toks.length > 0 && tokenOverlap(title, toks) < needed) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url, engine: "portal-oficial", institution: consultoriaConfig.name });
      }
    }
    return out.slice(0, consultoriaConfig.maxResults);
  },
};

class ConsultoriaService implements InstitutionService {
  id = consultoriaConfig.id;
  name = consultoriaConfig.name;
  description = consultoriaConfig.description;
  enabledByDefault = consultoriaConfig.enabledByDefault;
  url = consultoriaConfig.url;

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> { await this.search("República Dominicana"); }
  async search(query: string): Promise<InstitutionResult[]> { return consultoriaApi.search(query); }
  async getDocuments(): Promise<InstitutionDocument[]> {
    const docs = await consultoriaApi.search("");
    return docs.map(({ institution, ...d }) => d);
  }
  async healthCheck(): Promise<boolean> {
    const html = await fetchText(`${CJ_HOST}/News/NewsConsult`);
    return html !== null;
  }
}

export const consultoriaService = new ConsultoriaService();
export default consultoriaService;
