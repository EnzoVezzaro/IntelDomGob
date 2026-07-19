import type { InstitutionService, InstitutionResult, InstitutionDocument } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchText, extractLinks } from "../shared";

// Presidencia de la República — news + decrees/gaceta sections.

const PRES_HOST = "https://www.presidencia.gob.do";
const SECTIONS = [
  "https://www.presidencia.gob.do/noticias",
  "https://www.presidencia.gob.do/gaceta-oficial",
];

export const presidencyConfig = {
  id: "presidency",
  name: "Presidencia de la República",
  description: "Poder Ejecutivo — decretos, gaceta oficial y noticias.",
  url: PRES_HOST,
  enabledByDefault: true,
  maxResults: 30,
};

export const presidencyApi = {
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
        out.push({ title, url, engine: "portal-oficial", institution: presidencyConfig.name });
      }
    }
    return out.slice(0, presidencyConfig.maxResults);
  },
};

class PresidencyService implements InstitutionService {
  id = presidencyConfig.id;
  name = presidencyConfig.name;
  description = presidencyConfig.description;
  enabledByDefault = presidencyConfig.enabledByDefault;
  url = presidencyConfig.url;

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> { await this.search("República Dominicana"); }
  async search(query: string): Promise<InstitutionResult[]> { return presidencyApi.search(query); }
  async getDocuments(): Promise<InstitutionDocument[]> {
    const docs = await presidencyApi.search("");
    return docs.map(({ institution, ...d }) => d);
  }
  async healthCheck(): Promise<boolean> {
    const html = await fetchText(`${PRES_HOST}/noticias`);
    return html !== null;
  }
}

export const presidencyService = new PresidencyService();
export default presidencyService;
