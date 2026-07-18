import type { InstitutionService, InstitutionResult, InstitutionDocument } from "../types";
import { queryTokens, tokenOverlap, requiredOverlap, fetchText } from "../shared";

// Comunidad de Compras Dominicanas — portal de contrataciones públicas
// (avisos de licitación / contract notices de la DGCP).
//
// El portal es ASP.NET WebForms y NO expone JSON. El único endpoint utilizable
// es QuickSearchAjax, que devuelve un grid HTML. El parámetro `mkey` es un
// token de sesión que debe extraerse previamente de la página Index.
//
//   GET /Public/Tendering/ContractNoticeManagement/Index
//     -> extrae mkey = <guid> (patrón 8-4-4-4-12 hex)
//   GET /Public/Tendering/ContractNoticeManagement/QuickSearchAjax
//     ?perspective=All&initAction=Index&allWords2Search=<q>
//     &displayAdvancedParams=false&mkey=<guid>&_=<epoch>
//     -> grid HTML con filas: spnMatchingResult{AuthorityName,Reference,
//        Description,PhaseCode,ContractNoticeState}_<i> y noticeUID=DO1.NTC.<n>

const BASE = "https://comunidad.comprasdominicana.gob.do";
const INDEX_URL = `${BASE}/Public/Tendering/ContractNoticeManagement/Index`;
const SEARCH_URL = `${BASE}/Public/Tendering/ContractNoticeManagement/QuickSearchAjax`;
const MKEY_RE = /[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}/i;
// Fallback por si el Index no entrega mkey (observado en la reversa: rotativo).
const FALLBACK_MKEY = "a815364c_6564_440c_acba_535e86474912";

export const comprasConfig = {
  id: "compras",
  name: "Comunidad de Compras Dominicanas",
  description: "Avisos de contratación pública / licitaciones (DGCP).",
  url: BASE,
  enabledByDefault: true,
  maxResults: 20,
};

/** Extrae el mkey de sesión desde la página Index (con caché en proceso). */
let cachedMkey: string | null = null;
let cachedAt = 0;
async function getMkey(): Promise<string> {
  const now = Date.now();
  if (cachedMkey && now - cachedAt < 5 * 60_000) return cachedMkey;
  const html = await fetchText(INDEX_URL);
  const m = html ? html.match(MKEY_RE) : null;
  cachedMkey = m ? m[0] : FALLBACK_MKEY;
  cachedAt = now;
  return cachedMkey;
}

function extractField(html: string, field: string, i: number): string {
  const m = html.match(
    new RegExp(`spnMatchingResult${field}_${i}"[^>]*>([^<]*)<`),
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function extractBasePrice(html: string, i: number): string {
  const m = html.match(
    new RegExp(`divBasePriceColElements_${i}"[^>]*>[^<]*<[^>]*>([^<]*)<`),
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

interface ComprasRow {
  uid: string;
  authority: string;
  reference: string;
  description: string;
  phase: string;
  state: string;
  basePrice: string;
}

function parseGrid(html: string): ComprasRow[] {
  const rows: ComprasRow[] = [];
  const uids = Array.from(html.matchAll(/DO1\.NTC\.\d+/g)).map((m) => m[0]);
  let idx = 0;
  // El grid repite el header; nos quedamos con las filas de datos (las que
  // tienen lnkDetailLink_N). Iteramos mientras existan coincidencias.
  while (html.includes(`lnkDetailLink_${idx}`)) {
    const authority = extractField(html, "AuthorityName", idx);
    const reference = extractField(html, "Reference", idx);
    const description = extractField(html, "Description", idx);
    if (!authority && !reference && !description) break;
    rows.push({
      uid: uids[idx] || "",
      authority,
      reference,
      description,
      phase: extractField(html, "PhaseCode", idx),
      state: extractField(html, "ContractNoticeState", idx),
      basePrice: extractBasePrice(html, idx),
    });
    idx++;
  }
  return rows;
}

export const comprasApi = {
  async search(query: string): Promise<InstitutionResult[]> {
    const out: InstitutionResult[] = [];
    const seen = new Set<string>();
    const mkey = await getMkey();
    const url =
      `${SEARCH_URL}?perspective=All&initAction=Index` +
      `&externalId=&logicalId=&fromMarketplace=&authorityVat=` +
      `&allWords2Search=${encodeURIComponent(query)}` +
      `&displayAdvancedParams=false&mkey=${mkey}&_=${Date.now()}`;
    const html = await fetchText(url);
    if (!html) return out;
    const rows = parseGrid(html);
    const toks = queryTokens(query);
    const needed = requiredOverlap(toks);
    for (const r of rows) {
      if (!r.uid) continue;
      const detailUrl = `${BASE}/Public/Tendering/OpportunityDetail/Index?noticeUID=${r.uid}&isModal=true&asPopupView=true`;
      if (seen.has(detailUrl)) continue;
      const hay = `${r.authority} ${r.reference} ${r.description}`.toLowerCase();
      if (toks.length > 0 && tokenOverlap(hay, toks) < needed) continue;
      seen.add(detailUrl);
      const metaBits = [r.reference, r.state, r.phase, r.basePrice]
        .filter(Boolean)
        .join(" · ");
      out.push({
        title: r.description || r.reference,
        url: detailUrl,
        snippet: `${r.authority}${metaBits ? " — " + metaBits : ""}`,
        engine: "compras-publicas",
        institution: comprasConfig.name,
      });
      if (out.length >= comprasConfig.maxResults) break;
    }
    return out;
  },
};

class ComprasService implements InstitutionService {
  id = comprasConfig.id;
  name = comprasConfig.name;
  description = comprasConfig.description;
  enabledByDefault = comprasConfig.enabledByDefault;
  url = comprasConfig.url;

  async initialize(): Promise<void> {}
  async seed(): Promise<void> {}
  async sync(): Promise<void> {
    await this.search("República Dominicana");
  }
  async search(query: string): Promise<InstitutionResult[]> {
    return comprasApi.search(query).catch(() => []);
  }
  async getDocuments(): Promise<InstitutionDocument[]> {
    const docs = (await this.search("").catch(() => [])) as InstitutionResult[];
    return docs.map(({ institution, ...d }) => d as InstitutionDocument);
  }
  async healthCheck(): Promise<boolean> {
    const html = await fetchText(INDEX_URL);
    return !!html && html.includes("ContractNoticeManagement");
  }
}

export const comprasService = new ComprasService();
export default comprasService;
