import type { InstitutionService, InstitutionResult, InstitutionDocument } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchText, extractLinks } from "../shared";
import { fetchWebpage } from "@intel.dom.gob/utils";

// Tribunal Constitucional — jurisprudence / decisions + press room.
//
// The TC site (Umbraco) has a live search endpoint that returns sentencia
// results for topical queries. The old listing pages (/jurisprudencia,
// /decisiones) are now 404. We use the search endpoint for all topical
// queries and keep the press page for fresh news.

const TC_HOST = "https://www.tribunalconstitucional.gob.do";
const TC_SEARCH_URL = "https://www.tribunalconstitucional.gob.do/consultas/secretar%C3%ADa/sentencias";
const PRESS_SECTION = "https://www.tribunalconstitucional.gob.do/sala-de-prensa/noticias/";

// Derive a short, human-readable description for a TC sentencia result from its
// URL/title when no page text is available. The TC URLs encode the sentencia id
// (e.g. .../sentencias/tc053526), which we surface as the reference.
function describeSentencia(rawHref: string, title: string): string {
  const m = rawHref.match(/tc\d+/i);
  const ref = m ? `Sentencia ${m[0].toUpperCase().replace(/(\d{2})(\d{2})(\d{2})/, "TC/$1/$2/$3")}` : "Sentencia del Tribunal Constitucional";
  const clean = title.replace(/\s+/g, " ").trim();
  return clean ? `${ref} — ${clean}` : ref;
}

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

    // Detect if the query contains a TC sentencia URL or ID (e.g., tc057526, TC-05-2026-0024)
    const urlMatch = query.match(/https?:\/\/www\.tribunalconstitucional\.gob\.do\/[^\s]+/i);
    const idMatch = query.match(/\b(tc|TC)[-/]?\d{5,}/i) || query.match(/\bTC-\d{2}-\d{4}-\d{4}\b/i);

    // If a specific sentencia URL or ID is in the query, try to fetch that detail page directly
    if (urlMatch || idMatch) {
      let detailUrl = urlMatch ? urlMatch[0] : null;
      if (!detailUrl && idMatch) {
        const id = idMatch[0].replace(/[^\d]/g, "");
        if (id.length >= 6) {
          detailUrl = `${TC_HOST}/consultas/secretar%C3%ADa/sentencias/tc${id.toLowerCase()}`;
        }
      }
      if (detailUrl) {
        const fetched = await fetchWebpage(detailUrl, { maxChars: 16000 });
        if (fetched && fetched.text.length > 200) {
          return [{
            title: fetched.title,
            url: fetched.url,
            snippet: fetched.text.slice(0, 800),
            description: fetched.text.slice(0, 800).replace(/\s+/g, " ").trim(),
            engine: "portal-oficial",
            institution: judiciaryConfig.name,
          }];
        }
      }
    }

    // Use the TC search endpoint for topical queries — the endpoint does
    // server-side relevance matching so we accept all hits it returns.
    //
    // NOTE: extractLinks (shared.ts) uses a [^"#]+ character class for href
    // values, but the TC site encodes accented characters as HTML entities
    // like &#237; which contain a '#' and break the match. We parse sentencia
    // links directly instead.
    const searchTerms = toks.length > 0 ? toks.join(" ") : query;
    const searchUrl = `${TC_SEARCH_URL}?searchString=${encodeURIComponent(searchTerms)}&size=50&criteriay=all&filtery=all`;
    const html = await fetchText(searchUrl);
    if (html) {
      // Match <a> tags whose href contains /sentencias/tc + digits
      const sentenciaRe = /<a[^>]+href="([^"]+sentencias\/tc\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = sentenciaRe.exec(html)) !== null) {
        const rawHref = m[1];
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        if (title.length < 5) continue;
        try {
          const abs = new URL(rawHref, TC_HOST).href;
          if (seen.has(abs)) continue;
          seen.add(abs);
          out.push({
            title,
            url: abs,
            description: describeSentencia(rawHref, title),
            engine: "portal-oficial",
            institution: judiciaryConfig.name,
          });
        } catch { continue; }
      }
    }

    // Also scrape the press page for fresh news/press articles.
    const pressHtml = await fetchText(PRESS_SECTION);
    if (pressHtml) {
      for (const { url, title } of extractLinks(pressHtml, PRESS_SECTION, true)) {
        if (title.length < 5) continue;
        // For press articles, apply token overlap only if we have specific tokens
        if (toks.length > 0 && tokenOverlap(title, toks) < requiredOverlap(toks)) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({
          title,
          url,
          description: `Noticia de prensa del Tribunal Constitucional — ${title}`,
          engine: "portal-oficial",
          institution: judiciaryConfig.name,
        });
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
    const html = await fetchText(`${TC_HOST}/sala-de-prensa/noticias/`);
    return html !== null;
  }
}

export const judiciaryService = new JudiciaryService();
export default judiciaryService;
