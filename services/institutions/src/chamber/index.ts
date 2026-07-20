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
    // The SIL keyword search matches ACCENTED substrings in numero + descripcion +
    // tipo + materia (e.g. searching "codigo" returns 0 but "código" returns 53).
    // So we must search with the ORIGINAL accented text, never accent-stripped.
    // We also search meaningful multi-word phrases (bigrams) first — the API does
    // phrase matching, so "código penal" returns the right iniciativas directly.
    const attempts = buildSilSearchAttempts(raw);
    const numberPatterns = (raw.match(/\d+\s*[-–]\s*\d+/g) || []).map((m) => m.replace(/\s+/g, ""));
    for (const n of numberPatterns) if (!attempts.includes(n)) attempts.push(n);

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

const SIL_STOP = new Set([
  "de", "la", "el", "los", "las", "y", "en", "a", "del", "por", "para", "con", "que", "su", "se",
  "un", "una", "uno", "lo", "al", "es", "son", "sobre", "cual", "este", "esta", "estado", "estados",
  "republica", "dominicana", "dominicano", "modificacion", "modificación", "the", "of", "and", "to",
  "in", "for", "is", "on", "with",
]);

/**
 * Build Cámara SIL search keywords from a raw user query.
 *
 * The SIL keyword endpoint does ACCENTED substring matching, so we keep the
 * original accents and never strip diacritics. We emit the most-specific probes
 * first: the full phrase, then meaningful bigrams ("código penal", "causales
 * aborto"), then individual meaningful words. Stopwords and very short tokens
 * are dropped, but multi-word phrases are preserved so the API's phrase matcher
 * returns the right iniciativas instead of nothing.
 */
function buildSilSearchAttempts(raw: string): string[] {
  const cleaned = (raw || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!cleaned) return [];
  const words = cleaned.split(" ").filter((w) => w.length > 1 && !SIL_STOP.has(w));
  const attempts: string[] = [];
  // Full phrase (most specific, keeps accents).
  if (words.length >= 2) attempts.push(words.join(" "));
  // Bigrams of consecutive meaningful words.
  for (let i = 0; i + 1 < words.length; i++) attempts.push(`${words[i]} ${words[i + 1]}`);
  // Single meaningful words (accented, as typed).
  for (const w of words) attempts.push(w);
  return Array.from(new Set(attempts)).sort((a, b) => b.length - a.length);
}

// ---- Comisiones (structured JSON) --------------------------------------
// Endpoint returns { page, pageSize, total, results }. Each item has `comision`
// (e.g. "03313-2024-2028-CD Comisión especial ..."), `tipo`, `fecha`, etc.

interface CamaraComision {
  id?: number;
  comision?: string;
  tipo?: string;
  fecha?: string;
  fechaDesignacion?: string;
  estado?: string;
  presidente?: string;
  [k: string]: any;
}

export async function getComisiones(periodoId = 0): Promise<CamaraComision[]> {
  const url = `${SIL_HOST}/sil/api/comision/comisiones?page=1&keyword=&periodoId=${periodoId}`;
  const data = await fetchJson(url);
  if (Array.isArray(data)) return data as CamaraComision[];
  return ((data && (data as any).results) || []) as CamaraComision[];
}

// ---- Comisiones: tipo listing + filtered ----------------------------------
// /sil/api/comision/tipo?periodoId=0 → [{id, descripcion, icono}]
// /sil/api/comision/comisiones?tipoId=X&periodoId=0 → committees of that type

interface CamaraComisionTipo {
  id: number;
  descripcion: string;
  icono?: string;
}

export async function getComisionTipos(periodoId = 0): Promise<CamaraComisionTipo[]> {
  const url = `${SIL_HOST}/sil/api/comision/tipo?periodoId=${periodoId}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? (data as CamaraComisionTipo[]) : [];
}

export async function getComisionesByTipo(tipoId: number, periodoId = 0): Promise<CamaraComision[]> {
  const url = `${SIL_HOST}/sil/api/comision/comisiones?tipoId=${tipoId}&periodoId=${periodoId}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? (data as CamaraComision[]) : [];
}

// ---- Iniciativas: count, grupos, materias, filtered search ----------------
// /sil/api/iniciativa/CountIniciativas?periodoId=0 → number (total)
// /sil/api/iniciativa/Grupos?periodoId=0 → [{id, descripcion, icono}] (15 topic groups)
// /sil/api/iniciativa/Materias?grupo=X&periodoId=0 → [{id, descripcion}]
// /sil/api/iniciativa/iniciativas?page=X&grupo=X&tipo=true&perimidas=false&keyword=X&periodoId=0

interface CamaraIniciativaGrupo {
  id: number;
  descripcion: string;
  icono?: string;
}

interface CamaraIniciativaMateria {
  id: number;
  descripcion: string;
}

export async function getIniciativaCount(periodoId = 0): Promise<number> {
  const url = `${SIL_HOST}/sil/api/iniciativa/CountIniciativas?periodoId=${periodoId}`;
  const data = await fetchJson(url);
  return typeof data === "number" ? data : 0;
}

export async function getIniciativaGrupos(periodoId = 0): Promise<CamaraIniciativaGrupo[]> {
  const url = `${SIL_HOST}/sil/api/iniciativa/Grupos?periodoId=${periodoId}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? (data as CamaraIniciativaGrupo[]) : [];
}

export async function getIniciativaMaterias(grupo: number, periodoId = 0): Promise<CamaraIniciativaMateria[]> {
  const url = `${SIL_HOST}/sil/api/iniciativa/Materias?grupo=${grupo}&periodoId=${periodoId}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? (data as CamaraIniciativaMateria[]) : [];
}

export async function getIniciativasFiltered(opts: {
  page?: number;
  grupo?: number;
  tipo?: boolean;
  perimidas?: boolean;
  keyword?: string;
  periodoId?: number;
} = {}): Promise<{ total: number; results: SilRaw[] }> {
  const params = new URLSearchParams({
    page: String(opts.page ?? 1),
    periodoId: String(opts.periodoId ?? 0),
  });
  if (opts.grupo != null) params.set("grupo", String(opts.grupo));
  if (opts.tipo != null) params.set("tipo", String(opts.tipo));
  if (opts.perimidas != null) params.set("perimidas", String(opts.perimidas));
  if (opts.keyword) params.set("keyword", opts.keyword);
  const url = `${SIL_HOST}/sil/api/iniciativa/iniciativas?${params}`;
  const data = (await fetchJson(url)) as SilPage | null;
  return { total: data?.total ?? 0, results: data?.results ?? [] };
}

// ---- Iniciativa detalle (single initiative by ID) -------------------------
// /sil/api/iniciativa/iniciativa/{id}?periodoId=0 → full initiative object
// (tipo, numero, descripcion, estado, condicion, materia, grupo, fechas,
// legislatura, promulgación, origen, etc.). Returns null on 404/error.

export async function getIniciativaDetalle(
  id: number,
  periodoId = 0,
): Promise<SilRaw | null> {
  const url = `${SIL_HOST}/sil/api/iniciativa/iniciativa/${id}?periodoId=${periodoId}`;
  const data = (await fetchJson(url)) as SilRaw | null;
  // A valid detail response always carries an id; guard against empty/error bodies.
  if (!data || typeof (data as any).id !== "number") return null;
  return data;
}

// ---- Iniciativa completa (detail + related sub-resources) -----------------
// The SIL detail view (public page /sil/iniciativa/{id}) loads the base object
// PLUS several related sub-resources, each paginated as ?page=N&id={id}:
//   /sil/api/iniciativa/proponentes  → authors/sponsors (diputado, party, prov)
//   /sil/api/iniciativa/historicos   → status history / trámites
//   /sil/api/iniciativa/comisiones   → committees it was sent to
//   /sil/api/iniciativa/Actividades  → committee activities / sesiones
//   /sil/api/iniciativa/documentos   → attached documents (PDFs)
//   /sil/api/iniciativa/votaciones   → votes
// Document download URLs are NOT present in the documento records (ruta is null);
// they are assembled from comun/GetRutaDocumento/?periodoId=0 + the documento id.
// (Endpoint names reverse-engineered from the SIL Angular bundle's
//  iniciativaService.getProponentes/getHistoricos/getComisiones/... methods.)

/** Memoized base path for downloading SIL documents (per periodoId). */
const rutaDocumentoCache = new Map<number, string>();
async function getRutaDocumento(periodoId = 0): Promise<string> {
  const cached = rutaDocumentoCache.get(periodoId);
  if (cached !== undefined) return cached;
  const url = `${SIL_HOST}/sil/api/comun/GetRutaDocumento/?periodoId=${periodoId}`;
  const data = (await fetchJson(url)) as string | null;
  const ruta = typeof data === "string" && data ? data : "";
  rutaDocumentoCache.set(periodoId, ruta);
  return ruta;
}

export type IniciativaSubRecurso =
  | "proponentes"
  | "historicos"
  | "comisiones"
  | "actividades"
  | "documentos"
  | "votaciones";

export const INICIATIVA_SUB_RECURSOS: IniciativaSubRecurso[] = [
  "proponentes",
  "historicos",
  "comisiones",
  "actividades",
  "documentos",
  "votaciones",
];

/**
 * Fetch a paginated SIL sub-resource and follow pages until the full `total`
 * is collected (the API caps each page at SIL_PAGE_SIZE=10). Failures on a
 * page degrade to whatever was collected so far rather than throwing.
 */
export async function getIniciativaSubRecurso(
  sub: IniciativaSubRecurso,
  id: number,
  periodoId = 0,
): Promise<any[]> {
  const action = sub === "actividades" ? "Actividades" : sub;
  const collected: any[] = [];
  let page = 1;
  const MAX_PAGES = 20; // hard cap to avoid runaway loops
  while (page <= MAX_PAGES) {
    const url = `${SIL_HOST}/sil/api/iniciativa/${action}?page=${page}&id=${id}&periodoId=${periodoId}`;
    const data = (await fetchJson(url)) as SilPage | null;
    if (!data || !Array.isArray(data.results)) break;
    collected.push(...data.results);
    const total = typeof data.total === "number" ? data.total : collected.length;
    if (collected.length >= total || data.results.length === 0) break;
    page++;
  }
  return collected;
}

/**
 * Fetch ONE related sub-resource of an initiative by its ID (e.g. only the
 * documentos, or only the votaciones) — without pulling the whole bundle.
 * For "documentos" each item is annotated with a resolved `urlDescarga`.
 * Returns null if the sub type is unknown.
 */
export async function getIniciativaSub(
  sub: IniciativaSubRecurso,
  id: number,
  periodoId = 0,
): Promise<any[] | null> {
  if (!INICIATIVA_SUB_RECURSOS.includes(sub)) return null;
  const items = await getIniciativaSubRecurso(sub, id, periodoId);
  if (sub === "documentos") {
    const ruta = await getRutaDocumento(periodoId);
    return items.map((doc) => ({
      ...doc,
      urlDescarga: doc.id != null && ruta ? `${ruta}${doc.id}` : undefined,
    }));
  }
  return items;
}

export interface IniciativaCompleta extends SilRaw {
  proponentes: any[];
  historicos: any[];
  comisiones: any[];
  actividades: any[];
  documentos: (any & { urlDescarga?: string })[];
  votaciones: any[];
}

/**
 * Fetch the FULL detail of an initiative: the base object plus all related
 * sub-resources (proponentes, historicos, comisiones, actividades, documentos,
 * votaciones) in a single combined object. Each documento is annotated with a
 * resolved `urlDescarga`. Returns null if the base initiative is not found.
 * Sub-resource failures degrade to empty arrays rather than failing.
 */
export async function getIniciativaCompleta(
  id: number,
  periodoId = 0,
): Promise<IniciativaCompleta | null> {
  const detalle = await getIniciativaDetalle(id, periodoId);
  if (!detalle) return null;
  const [proponentes, historicos, comisiones, actividades, documentos, votaciones] =
    await Promise.all([
      getIniciativaSubRecurso("proponentes", id, periodoId),
      getIniciativaSubRecurso("historicos", id, periodoId),
      getIniciativaSubRecurso("comisiones", id, periodoId),
      getIniciativaSubRecurso("actividades", id, periodoId),
      getIniciativaSubRecurso("documentos", id, periodoId),
      getIniciativaSubRecurso("votaciones", id, periodoId),
    ]);
  const rutaDocumento = await getRutaDocumento(periodoId);
  const documentosConUrl = documentos.map((doc) => ({
    ...doc,
    urlDescarga: doc.id != null && rutaDocumento ? `${rutaDocumento}${doc.id}` : undefined,
  }));
  return { ...detalle, proponentes, historicos, comisiones, actividades, documentos: documentosConUrl, votaciones };
}

// ---- Grupos Parlamentarios (structured JSON) -----------------------------
// Endpoint: /sil/api/GruposParlamentarios/Index?periodoId=0

interface CamaraGrupo {
  id?: string;
  nombreGrupo?: string;
  descripcionActividad?: string;
  fechaDesignacion?: string;
  presidente?: string;
  [k: string]: any;
}

export async function getGruposParlamentarios(periodoId = 0, keyword = ""): Promise<CamaraGrupo[]> {
  const params = new URLSearchParams({ periodoId: String(periodoId) });
  if (keyword) params.set("keyword", keyword);
  const url = `${SIL_HOST}/sil/api/GruposParlamentarios/Index?${params}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? (data as CamaraGrupo[]) : [];
}

// ---- Sesiones (structured JSON) -----------------------------------------
// Endpoint returns { page, pageSize, total, results }. Each sesion has
// numeroSesion, fecha, tipo, estado, lugar, legislatura.

interface CamaraSesion {
  sesionId?: string;
  numeroSesion?: string;
  fecha?: string;
  tipo?: string;
  estado?: string;
  lugar?: string;
  legislatura?: string;
  [k: string]: any;
}

export async function getSesiones(keyword = "", periodoId = 0, page = 1): Promise<CamaraSesion[]> {
  const url = `${SIL_HOST}/sil/api/sesion/sesiones?page=${page}&keyword=${encodeURIComponent(keyword)}&periodoId=${periodoId}`;
  const data = await fetchJson(url);
  return (data && Array.isArray((data as any).results) ? (data as any).results : []) as CamaraSesion[];
}

// ---- Legislador (per-diputado profile, structured JSON) -----------------
// Endpoint: /sil/api/legislador/legisladores?page=&keyword=&periodoId=0

interface CamaraLegislador {
  legisladorId?: string;
  nombreCompleto?: string;
  nombres?: string;
  apellidos?: string;
  partido?: string | { nombre?: string };
  provincia?: string;
  circunscripcion?: string;
  cargo?: string;
  funcion?: string;
  correoInstitucional?: string;
  telefonoOficina?: string;
  [k: string]: any;
}

function partidoNombre(p: CamaraLegislador["partido"]): string {
  if (!p) return "";
  if (typeof p === "string") return p;
  return p.nombre || "";
}

export async function getLegislador(keyword: string, periodoId = 0, page = 1): Promise<CamaraLegislador[]> {
  const kw = extractLegisladorName(keyword);
  if (!kw) return [];
  const url = `${SIL_HOST}/sil/api/legislador/legisladores?page=${page}&keyword=${encodeURIComponent(kw)}&periodoId=${periodoId}`;
  const data = await fetchJson(url);
  return (data && Array.isArray((data as any).results) ? (data as any).results : []) as CamaraLegislador[];
}

const LEGISLADOR_FILLER = new Set([
  "hablame", "habla", "hablame", "dime", "cuente", "informacion", "sobre", "del",
  "de", "la", "el", "los", "las", "y", "un", "una", "por", "para", "con",
  "diputado", "diputada", "legislador", "legisladora", "representante", "senador", "senadora",
  "que", "es", "escribe", "busca", "encuentra", "quien", "quién",
]);

/**
 * Extract the meaningful name tokens from a "hablame del diputado XXX" query,
 * stripping filler words so the legislador endpoint gets a clean keyword.
 */
function extractLegisladorName(query: string): string {
  const words = (query || "")
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 1 && !LEGISLADOR_FILLER.has(w));
  return words.join(" ").trim();
}

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
    description: law.descripcion.slice(0, 400).replace(/\s+/g, " ").trim(),
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

  /**
   * Broad Cámara SIL scrape, separated by concept. SIL iniciativas are the
   * highest-priority concept; comisiones and sesiones are supplementary and
   * are returned only when the query is topical (not a bare number lookup).
   * `iniciativas` comes from the (accent-aware) SIL keyword search; comisiones
   * and sesiones are pulled from their own structured endpoints.
   */
  async getConcepts(query: string): Promise<{
    iniciativas: InstitutionLaw[];
    comisiones: InstitutionResult[];
    sesiones: InstitutionResult[];
    legisladores: InstitutionResult[];
    gruposParlamentarios: InstitutionResult[];
  }> {
    const iniciativas = await chamberApi.getLaws(query, 0, chamberConfig.silContextMax).catch(() => [] as InstitutionLaw[]);

    const isNum = isNumberQuery(query);
    let comisiones: InstitutionResult[] = [];
    let sesiones: InstitutionResult[] = [];
    let legisladores: InstitutionResult[] = [];
    let gruposParlamentarios: InstitutionResult[] = [];

    if (!isNum) {
      const [coms, sess, legs, grupos] = await Promise.all([
        getComisiones(0).catch(() => [] as CamaraComision[]),
        getSesiones("", 0, 1).catch(() => [] as CamaraSesion[]),
        getLegislador(query, 0, 1).catch(() => [] as CamaraLegislador[]),
        getGruposParlamentarios(0).catch(() => [] as CamaraGrupo[]),
      ]);
      comisiones = coms.slice(0, 12).map((c) => ({
        title: (c.comision || "Comisión").replace(/\s+/g, " ").trim(),
        url: `${CHAMBER_HOST}/sil/comision`,
        snippet: [c.tipo ? `Tipo: ${c.tipo}` : "", c.fechaDesignacion ? `Designada: ${c.fechaDesignacion.slice(0, 10)}` : "", c.estado ? `Estado: ${c.estado}` : ""]
          .filter(Boolean).join(" | "),
        engine: "camara-comision",
        institution: chamberConfig.name,
      }));
      sesiones = sess.slice(0, 12).map((s) => ({
        title: `Sesión ${s.numeroSesion || s.sesionId || ""}`.trim(),
        url: `${CHAMBER_HOST}/sil/sesion`,
        snippet: [s.tipo ? `Tipo: ${s.tipo}` : "", s.fecha ? `Fecha: ${s.fecha.slice(0, 10)}` : "", s.estado ? `Estado: ${s.estado}` : ""]
          .filter(Boolean).join(" | "),
        engine: "camara-sesion",
        institution: chamberConfig.name,
      }));
      legisladores = legs.slice(0, 8).map((l) => ({
        title: l.nombreCompleto || `${l.nombres || ""} ${l.apellidos || ""}`.trim(),
        url: `${CHAMBER_HOST}/sil/legislador`,
        snippet: [
          l.partido ? `Partido: ${partidoNombre(l.partido)}` : "",
          l.provincia ? `Prov: ${l.provincia}` : "",
          l.circunscripcion || "",
          l.cargo || l.funcion || "",
        ].filter(Boolean).join(" | "),
        engine: "camara-legislador",
        institution: chamberConfig.name,
      }));
      gruposParlamentarios = grupos.slice(0, 10).map((g) => ({
        title: g.nombreGrupo || "Grupo Parlamentario",
        url: `${CHAMBER_HOST}/sil/gruposparlamentarios`,
        snippet: [g.descripcionActividad || "", g.fechaDesignacion ? `Designado: ${g.fechaDesignacion.slice(0, 10)}` : ""]
          .filter(Boolean).join(" | "),
        engine: "camara-grupo-parlamentario",
        institution: chamberConfig.name,
      }));
    }
    return { iniciativas, comisiones, sesiones, legisladores, gruposParlamentarios };
  }
}

export const chamberService = new ChamberService();
export default chamberService;
