import type { InstitutionService, InstitutionResult, InstitutionDocument } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchJson } from "../shared";

// Datos Abiertos RD — official CKAN open-data portal (package_search API).

const DATOS_API = "https://datos.gob.do/api/3/action/package_search";

export const datosConfig = {
  id: "datos",
  name: "Datos Abiertos RD",
  description: "Portal CKAN de datos abiertos del gobierno dominicano.",
  url: "https://datos.gob.do",
  enabledByDefault: true,
  rows: 8,
  maxResults: 20,
};

export const datosApi = {
  async search(query: string): Promise<InstitutionResult[]> {
    const out: InstitutionResult[] = [];
    const seen = new Set<string>();
    const toks = queryTokens(query);
    const queries = Array.from(new Set([query, ...toks]));
    for (const q of queries) {
      if (!q) continue;
      const ep = `${DATOS_API}?q=${encodeURIComponent(q)}&rows=${datosConfig.rows}`;
      const data = await fetchJson(ep);
      const results: any[] = data?.result?.results || [];
      for (const ds of results) {
        const url: string = ds.url || `https://datos.gob.do/dataset/${ds.name}`;
        const title: string = (ds.title || "").toString().trim();
        const notes: string = (ds.notes || "").toString().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
        if (!url || !title || seen.has(url)) continue;
        const needed = requiredOverlap(toks);
        if (toks.length > 0 && tokenOverlap(`${title} ${notes}`, toks) < needed) continue;
        seen.add(url);
        out.push({ title, url, snippet: notes, engine: "datos-gob", institution: datosConfig.name });
      }
      if (out.length >= datosConfig.maxResults) break;
    }
    return out.slice(0, datosConfig.maxResults);
  },
};

class DatosService implements InstitutionService {
  id = datosConfig.id;
  name = datosConfig.name;
  description = datosConfig.description;
  enabledByDefault = datosConfig.enabledByDefault;
  url = datosConfig.url;

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> { await this.search("República Dominicana"); }
  async search(query: string): Promise<InstitutionResult[]> { return datosApi.search(query); }
  async getDocuments(): Promise<InstitutionDocument[]> {
    const docs = await datosApi.search("");
    return docs.map(({ institution, ...d }) => d);
  }
  async healthCheck(): Promise<boolean> {
    const data = await fetchJson(`${DATOS_API}?q=test&rows=1`);
    return !!data?.result;
  }
}

export const datosService = new DatosService();
export default datosService;
