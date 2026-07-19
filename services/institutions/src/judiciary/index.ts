import type { InstitutionService, InstitutionResult, InstitutionDocument } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchText, extractLinks } from "../shared";

// Tribunal Constitucional — jurisprudence / decisions + press room.

const TC_HOST = "https://www.tribunalconstitucional.gob.do";
const SECTIONS = [
  "https://www.tribunalconstitucional.gob.do/sala-de-prensa/noticias/",
  "https://www.tribunalconstitucional.gob.do/jurisprudencia",
  "https://www.tribunalconstitucional.gob.do/decisiones",
];

export const judiciaryConfig = {
  id: "judiciary",
  name: "Tribunal Constitucional",
  description: "Sala constitucional — jurisprudencia, decisiones y sentencias.",
  url: TC_HOST,
  enabledByDefault: true,
  maxResults: 30,
};

export const judiciaryApi = {
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
        out.push({ title, url, engine: "portal-oficial", institution: judiciaryConfig.name });
      }
    }
    return out.slice(0, judiciaryConfig.maxResults);
  },
};

class JudiciaryService implements InstitutionService {
  id = judiciaryConfig.id;
  name = judiciaryConfig.name;
  description = judiciaryConfig.description;
  enabledByDefault = judiciaryConfig.enabledByDefault;
  url = judiciaryConfig.url;

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> { await this.search("República Dominicana"); }
  async search(query: string): Promise<InstitutionResult[]> { return judiciaryApi.search(query); }
  async getDocuments(): Promise<InstitutionDocument[]> {
    const docs = await judiciaryApi.search("");
    return docs.map(({ institution, ...d }) => d);
  }
  async healthCheck(): Promise<boolean> {
    const html = await fetchText(`${TC_HOST}/jurisprudencia`);
    return html !== null;
  }
}

export const judiciaryService = new JudiciaryService();
export default judiciaryService;
