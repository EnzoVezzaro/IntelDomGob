import type { InstitutionService, InstitutionResult, InstitutionDocument } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchText, extractLinks } from "../shared";

// Dirección General de Contrataciones Públicas (DGCP) — laws, decrees, resolutions.

const DGCP_HOST = "https://www.dgcp.gob.do";
const SECTIONS = [
  "https://www.dgcp.gob.do/new_dgcp/documentos/ley/",
  "https://www.dgcp.gob.do/new_dgcp/documentos/politicas_normas_y_procedimientos/leyes_y_decretos/",
  "https://www.dgcp.gob.do/new_dgcp/documentos/politicas_normas_y_procedimientos/resoluciones_de_politicas/",
  "https://www.dgcp.gob.do/noticias/",
];

export const dgcpConfig = {
  id: "dgcp",
  name: "Contrataciones Públicas (DGCP)",
  description: "Leyes, decretos y resoluciones de contrataciones públicas (Ley 340-06).",
  url: DGCP_HOST,
  enabledByDefault: true,
  maxResults: 30,
};

export const dgcpApi = {
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
        out.push({ title, url, engine: "portal-oficial", institution: dgcpConfig.name });
      }
    }
    return out.slice(0, dgcpConfig.maxResults);
  },
};

class DgcpService implements InstitutionService {
  id = dgcpConfig.id;
  name = dgcpConfig.name;
  description = dgcpConfig.description;
  enabledByDefault = dgcpConfig.enabledByDefault;
  url = dgcpConfig.url;

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> { await this.search("República Dominicana"); }
  async search(query: string): Promise<InstitutionResult[]> { return dgcpApi.search(query); }
  async getDocuments(): Promise<InstitutionDocument[]> {
    const docs = await dgcpApi.search("");
    return docs.map(({ institution, ...d }) => d);
  }
  async healthCheck(): Promise<boolean> {
    const html = await fetchText(`${DGCP_HOST}/noticias/`);
    return html !== null;
  }
}

export const dgcpService = new DgcpService();
export default dgcpService;
