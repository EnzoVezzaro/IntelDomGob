import type { InstitutionLaw, InstitutionResult, BulletinDoc } from "../types";
import { relevanceScore, isNumberQuery, numeroMatchesQuery } from "../shared";

// Senado DSpace REST API — structured legislative records.
//
// The Senado de la República hosts its legislative database on a DSpace 7.x
// instance at memoriahistorica.senadord.gob.do.  The REST API is public (no
// auth needed) and exposes full-text search across ~44k items with structured
// metadata (govdoc number, estado, tipo, fecha, description, PDF bitstreams).
//
// KEY API CAPABILITIES (reverse-engineered):
//   GET /server/api/discover/search/objects
//     - dsoType=ITEM           : drops communities/collections (32k→3.3k)
//     - scope=<communityUUID>  : scopes to a subtree (Iniciativas Legislativas)
//     - sort=dc.date.issued,DESC : chronological ordering
//     - query=dc.identifier.govdoc:<val> : exact field-scoped match (precision tool)
//     - size capped at 100 returned objects
//     - filter/fq/appliedFilters: IGNORED by this server
//
// COMMUNITY TREE (discovered 2026-07-19):
//   fc1aa418 — Memoria Histórica del Senado (root, ~32k items)
//   ├── 23b462cd — Cronológico de Senadores (direct collection)
//   ├── dfb768ab — Cronológico de Senadores (sub-community)
//   │   └── 9dbd1125 — Documentos Institucionales
//   │       ├── 11e2a6b9 — Boletín Informativo El Amanecer del Senado
//   │       ├── 89fc04ee — Informe Actas de Comisiones
//   │       └── 2b70d40c — Libros
//   ├── 78245c69 — Documentos Legislativos
//   │   ├── b610c353 — Actas Asamblea Nacional
//   │   ├── 71941293 — Colección de Leyes, Decretos y Resoluciones
//   │   └── 8ad172cc — Constitución Dominicana
//   ├── 9799f9b1 — Iniciativas Legislativas  ← PRIMARY SCOPE (current code)
//   │   ├── e6547d61 — Acuerdos internacionales
//   │   ├── 21ba5374 — Contratos: préstamos, financiamientos
//   │   └── 7e7fa91f — Contratos: venta de inmuebles, enmiendas
//   └── 8b07cd61 — Rendición de Cuentas (empty)
//
// WORKING ENDPOINTS (200 OK):
//   SINGLE  /core/communities/{uuid}
//   LIST    /core/communities/{uuid}/subcommunities?page=0&size=N
//   LIST    /core/communities/{uuid}/collections?page=0&size=N
//   SINGLE  /core/communities/{uuid}/parentCommunity
//   SINGLE  /core/collections/{uuid}
//   SINGLE  /core/collections/{uuid}/license
//   LIST    /discover/search/objects?query={q}&scope={uuid}&dsoType=ITEM&page=0&size=N
//   ACTION  /statistics/viewevents (POST)
//
// 404 (not available on this instance):
//   /core/collections/{uuid}/items  ← items only via /discover/search/objects
//   /core/collections/{uuid}/metadata
//   /core/communities/{uuid}/metadata
//   /harvest/*

const DSPACE_HOST = "https://memoriahistorica.senadord.gob.do";
const SEARCH_URL = `${DSPACE_HOST}/server/api/discover/search/objects`;

// Scope: Iniciativas Legislativas community (Proyectos de Ley, Resoluciones,
// Contratos, Acuerdos internacionales). Highest precision for legislation.
export const SENATE_SCOPE_INICIATIVAS = "9799f9b1-556e-4dc5-82a7-c3f52454749b";

// Scope: Root community (Memoria Histórica del Senado). Contains ALL items
// across all sub-communities (~32k). Use for broader searches that need to
// cover Boletines, Actas, Libros, Documentos Institucionales, etc.
export const SENATE_SCOPE_ROOT = "fc1aa418-1f3f-46ee-a300-6d6047e53d01";

// ---- In-memory cache (5-minute TTL) --------------------------------------
// Keyed by normalized query string. Prevents redundant DSpace calls within
// the same server process lifetime (e.g. getLaws + search both called for
// the same query in one /api/query request).
const CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { ts: number; data: SenateExpediente[] }>();

function cacheKey(q: string, scope?: string): string {
  return `${(q || "").trim().toLowerCase()}::${scope || ""}`;
}

function getCached(q: string, scope?: string): SenateExpediente[] | null {
  const key = cacheKey(q, scope);
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) { searchCache.delete(key); return null; }
  return hit.data;
}

function setCache(q: string, scope: string | undefined, data: SenateExpediente[]): void {
  const key = cacheKey(q, scope);
  // Evict oldest if cache grows beyond 128 entries.
  if (searchCache.size > 128) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { ts: Date.now(), data });
}

// ---- Metadata extraction helpers ----------------------------------------

function getMeta(meta: Record<string, any[]>, key: string): string {
  const arr = meta[key];
  return (Array.isArray(arr) && arr.length > 0 && arr[0]?.value) || "";
}

// Map DSpace dc.type.initiative or govdoc prefix to a legible tipo.
function deriveTipo(meta: Record<string, any[]>): string {
  const raw = getMeta(meta, "dc.type.initiative");
  if (raw) return raw;
  const gov = getMeta(meta, "dc.identifier.govdoc");
  const m = gov.match(/-(SLO|PLO|APL|RES)-/);
  if (!m) return "Iniciativa";
  const map: Record<string, string> = {
    SLO: "Proyecto de Ley",
    PLO: "Proyecto de Ley",
    APL: "Aprobada / Ley",
    RES: "Resolución",
  };
  return map[m[1]] ?? "Iniciativa";
}

// ---- Search --------------------------------------------------------------

interface DSpaceObject {
  id: string;
  name: string;
  metadata: Record<string, any[]>;
  _links?: { self?: { href: string } };
}

interface SenateExpediente {
  idExpediente: string;
  numero: string;
  tipo: string;
  descripcion: string;
  fecha: string;
  estado: string;
  url: string;
  materia: string;
  quadrennium: string;
  pdfUrl?: string;
}

function dspaceToExpediente(obj: DSpaceObject): SenateExpediente {
  const md = obj.metadata || {};
  const numero = getMeta(md, "dc.identifier.govdoc");
  const tipo = deriveTipo(md);
  const estado = getMeta(md, "dc.format");
  const descripcion = getMeta(md, "dc.description") || getMeta(md, "dc.title") || obj.name;
  const fecha = getMeta(md, "dc.date.issued");
  const materia = getMeta(md, "dc.publisher");
  const quadrennium = getMeta(md, "dc.date.quadrennium");
  const uri = getMeta(md, "dc.identifier.uri");
  const selfLink = obj._links?.self?.href || "";
  const handleUrl = uri || (obj.id ? `${DSPACE_HOST}/handle/123456789/${obj.id}` : selfLink);
  return {
    idExpediente: obj.id,
    numero,
    tipo,
    descripcion: descripcion.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    fecha,
    estado,
    url: handleUrl,
    materia,
    quadrennium,
  };
}

/**
 * Build DSpace search attempts — field-scoped govdoc query (if number query)
 * + full-text query. Scoped to Iniciativas Legislativas, ITEMS only, sorted
 * by date descending.
 */
function buildAttempts(query: string): string[] {
  const attempts: string[] = [];
  // Tier A: field-scoped exact number family (e.g. dc.identifier.govdoc:01749)
  if (isNumberQuery(query)) {
    const digits = query.replace(/[^\d]/g, "");
    if (digits.length >= 3) {
      // Use the raw number (with hyphens) for field-scoped match.
      attempts.push(`dc.identifier.govdoc:${query}`);
      // Also try digit-only prefix (catches "5088" matching "050-88-..." via group).
      if (digits !== query.replace(/\s/g, "")) attempts.push(`dc.identifier.govdoc:${digits}`);
    }
  }
  // Tier B: full-text (always included — covers topic/keyword queries).
  attempts.push(query);
  return Array.from(new Set(attempts));
}

/**
 * Fetch a single page from DSpace discover endpoint.
 */
async function fetchDSpacePage(
  query: string,
  size: number,
  scope?: string,
): Promise<DSpaceObject[]> {
  const params = new URLSearchParams({
    query,
    page: "0",
    size: String(Math.min(size, 100)),
    dsoType: "ITEM",
    sort: "dc.date.issued,DESC",
  });
  if (scope) params.set("scope", scope);
  const url = `${SEARCH_URL}?${params}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (
      data?._embedded?.searchResult?._embedded?.objects?.map(
        (o: any) => o._embedded?.indexableObject,
      ) ?? []
    );
  } catch {
    clearTimeout(timer);
    return [];
  }
}

/**
 * Rank and deduplicate Senado DSpace expedientes.
 *
 * Ranking tiers:
 *   Tier A (exact number match) — priority 0, base score 1000 + relevance
 *   Tier B (topical/related)   — priority 1, score = relevanceScore
 *
 * The matching expediente (or its related amendments) always appears first.
 * Deduplicated by govdoc number; sorted by (priority, score, fecha desc).
 */
function rankExpedientes(
  query: string,
  results: SenateExpediente[],
  maxResults: number,
): SenateExpediente[] {
  const isNumQuery = isNumberQuery(query);
  const byNumero = new Map<string, { exp: SenateExpediente; priority: number; score: number }>();
  for (const exp of results) {
    const hay = `${exp.numero} ${exp.tipo} ${exp.descripcion} ${exp.estado} ${exp.fecha}`;
    const rel = relevanceScore(hay, query);
    const exactNum = isNumQuery && numeroMatchesQuery(exp.numero, query);
    const priority = exactNum ? 0 : 1;
    const score = exactNum ? 1000 + rel : rel;
    if (score <= 0) continue;
    const existing = byNumero.get(exp.numero);
    if (existing && existing.priority <= priority && existing.score >= score) continue;
    byNumero.set(exp.numero, { exp, priority, score });
  }
  return Array.from(byNumero.values())
    .sort((a, b) => a.priority - b.priority || b.score - a.score)
    .slice(0, maxResults)
    .map((x) => x.exp);
}

/**
 * Search the Senado DSpace repository for legislative records matching a query.
 *
 * Uses the reverse-engineered DSpace 7.x discover API:
 *   - dsoType=ITEM to filter out communities/collections
 *   - scope=Iniciativas Legislativas to focus on legislative content
 *   - sort=dc.date.issued,DESC for chronological ordering
 *   - field-scoped query (dc.identifier.govdoc:<val>) for exact number matches
 *
 * Results are ranked using TIER_A/TIER_B system:
 *   Tier A: exact expediente number match → always first
 *   Tier B: topical/related text matches → ranked by relevance
 *
 * Cached in-memory for 5 minutes to avoid redundant calls within a request.
 */
export async function searchExpedientes(
  query: string,
  opts: { maxResults?: number; scope?: string } = {},
): Promise<SenateExpediente[]> {
  const maxResults = opts.maxResults ?? 15;
  const scope = opts.scope ?? SENATE_SCOPE_INICIATIVAS;

  // Check cache first.
  const cached = getCached(query, scope);
  if (cached) return cached.slice(0, maxResults);

  const byId = new Map<string, SenateExpediente>();
  const attempts = buildAttempts(query);

  // Phase 1: scoped search (Iniciativas Legislativas).
  for (const q of attempts) {
    if (!q || byId.size >= maxResults * 3) continue;
    const objects = await fetchDSpacePage(q, Math.min(maxResults * 3, 100), scope);
    for (const obj of objects) {
      if (!obj?.id || byId.has(obj.id)) continue;
      byId.set(obj.id, dspaceToExpediente(obj));
    }
  }

  // Phase 2: if scoped search returned too few results for a number query,
  // retry WITHOUT scope. The Iniciativas community doesn't contain all items —
  // many expedientes live in the year-based Boletines/Actas collections.
  if (byId.size < maxResults && (isNumberQuery(query) || /\d{4,}/.test(query))) {
    for (const q of attempts) {
      if (!q || byId.size >= maxResults * 3) continue;
      const objects = await fetchDSpacePage(q, Math.min(maxResults * 3, 100));
      for (const obj of objects) {
        if (!obj?.id || byId.has(obj.id)) continue;
        byId.set(obj.id, dspaceToExpediente(obj));
      }
    }
  }

  const ranked = rankExpedientes(query, Array.from(byId.values()), maxResults);
  setCache(query, scope, ranked);
  return ranked;
}

// ---- Bulletin fetch (non-Iniciativas: Boletines/Actas/Año) ---------------

/**
 * Fetch recent Senado bulletins, session records, and year-based content.
 * This queries the DSpace repository WITHOUT the Iniciativas scope, so it
 * picks up Boletines del Senado, Actas de Sesiones, and year-based collections
 * (1992-2024).
 */
export async function fetchBulletins(
  query: string,
  opts: { maxResults?: number } = {},
): Promise<BulletinDoc[]> {
  const maxResults = opts.maxResults ?? 10;
  // Query WITHOUT scope (gets all communities including Boletines/Actas/Año).
  const objects = await fetchDSpacePage(query || "boletin sesion acta", maxResults);
  return objects
    .map((obj) => {
      const md = obj.metadata || {};
      const title = getMeta(md, "dc.title") || obj.name || "";
      const uri = getMeta(md, "dc.identifier.uri");
      const url = uri || (obj.id ? `${DSPACE_HOST}/handle/123456789/${obj.id}` : "");
      const date = getMeta(md, "dc.date.issued");
      const tipo = getMeta(md, "dc.type.initiative") || deriveTipo(md);
      const desc = getMeta(md, "dc.description") || "";
      if (!title || !url) return null;
      return {
        title: title.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        url,
        date,
        tipo,
        snippet: desc.slice(0, 200).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      };
    })
    .filter(Boolean)
    .slice(0, maxResults) as BulletinDoc[];
}

// ---- Adapters for the institution interface ----------------------------

export function expedienteToLaw(exp: SenateExpediente): InstitutionLaw {
  return {
    numero: exp.numero,
    tipo: exp.tipo,
    descripcion: exp.descripcion,
    estado: exp.estado,
    url: exp.url,
    materia: exp.materia || "Senado DSpace",
    fechaDeposito: exp.fecha,
    pdfUrl: exp.pdfUrl,
  };
}

export function expedienteToResult(exp: SenateExpediente): InstitutionResult {
  return {
    title: `${exp.numero} — ${exp.descripcion}`.slice(0, 220),
    url: exp.url,
    snippet: `Tipo: ${exp.tipo} | Estado: ${exp.estado} | Fecha: ${exp.fecha}`,
    description: exp.descripcion.slice(0, 400).replace(/\s+/g, " ").trim(),
    engine: "senado-dspace",
    institution: "Senado de la República",
  };
}

export function expedienteToBulletin(exp: SenateExpediente): BulletinDoc {
  return {
    title: (exp.descripcion || exp.numero || "Documento del Senado").slice(0, 200),
    url: exp.url,
    date: exp.fecha,
    tipo: exp.tipo || "Senado",
    snippet: [exp.numero ? `Núm: ${exp.numero}` : "", exp.estado ? `Estado: ${exp.estado}` : ""]
      .filter(Boolean).join(" | "),
  };
}

// ---- Concept classification --------------------------------------------

export type SenateConcept =
  | "iniciativas"
  | "resoluciones"
  | "boletines"
  | "actas"
  | "informes";

/**
 * Classify a Senado DSpace item into a legislative concept, strictly by signal:
 *   - govdock number prefix (PLO/SLO → iniciativas, RES/APL → resoluciones)
 *   - dc.type.initiative ("Proyectos De Ley" → iniciativas, "Resolución" → resoluciones)
 *   - title keywords (Boletín → boletines, Acta → actas, Discurso/Informe → informes)
 * Falls back to "informes" for anything unrecognized so nothing is dropped.
 */
export function classifyConcept(exp: SenateExpediente): SenateConcept {
  const num = (exp.numero || "").toUpperCase();
  if (/-PLO-SE$/.test(num) || /-SLO-SE$/.test(num) || num.endsWith("-CD")) return "iniciativas";
  if (/-RES-SE$/.test(num) || /-APL-SE$/.test(num)) return "resoluciones";
  const tipo = (exp.tipo || "").toLowerCase();
  if (tipo.includes("proyecto")) return "iniciativas";
  if (tipo.includes("resolución") || tipo.includes("resolucion") || tipo.includes("aprobada")) return "resoluciones";
  const title = (exp.descripcion || "").toLowerCase();
  if (title.startsWith("boletín") || title.startsWith("boletin")) return "boletines";
  if (title.startsWith("acta")) return "actas";
  if (title.startsWith("discurso") || title.startsWith("informe")) return "informes";
  if (num) return "iniciativas";
  return "informes";
}

export type SenateConceptMap = Record<SenateConcept, SenateExpediente[]>;

/**
 * Search the full Senado DSpace repository (all communities, not just
 * Iniciativas) and separate results by legislative concept. The Iniciativas
 * community is searched first (scoped, highest precision) and the rest come
 * from an unscoped full-text pass that is then classified. Iniciativas are
 * always surfaced with priority; the other concepts are supplementary.
 */
export async function searchSenadoConcepts(
  query: string,
  opts: { maxPerConcept?: number } = {},
): Promise<SenateConceptMap> {
  const maxPerConcept = opts.maxPerConcept ?? 8;
  const map: SenateConceptMap = {
    iniciativas: [],
    resoluciones: [],
    boletines: [],
    actas: [],
    informes: [],
  };

  // Phase 1 — scoped Iniciativas (precision): reuse the ranked expedientes.
  const iniciativas = await searchExpedientes(query, { maxResults: maxPerConcept * 2 });
  for (const exp of iniciativas) {
    if (map.iniciativas.length < maxPerConcept * 2) map.iniciativas.push(exp);
  }

  // Phase 2 — unscoped full-text across all communities (Boletines/Actas/etc).
  const objects = await fetchDSpacePage(query, 100);
  const seen = new Set<string>(map.iniciativas.map((e) => e.idExpediente));
  const buckets: Record<SenateConcept, SenateExpediente[]> = {
    iniciativas: [],
    resoluciones: [],
    boletines: [],
    actas: [],
    informes: [],
  };
  for (const obj of objects) {
    if (!obj?.id || seen.has(obj.id)) continue;
    seen.add(obj.id);
    const exp = dspaceToExpediente(obj);
    const concept = classifyConcept(exp);
    if (buckets[concept].length < maxPerConcept * 2) buckets[concept].push(exp);
  }

  // Merge supplementary buckets (avoid duplicating scoped iniciativas).
  for (const concept of ["resoluciones", "boletines", "actas", "informes"] as const) {
    for (const exp of buckets[concept]) {
      if (map[concept].length < maxPerConcept) map[concept].push(exp);
    }
  }
  // Allow a few extra iniciativas from the unscoped pass if scoped was thin.
  for (const exp of buckets.iniciativas) {
    if (map.iniciativas.length < maxPerConcept * 2) map.iniciativas.push(exp);
  }

  return map;
}

// ===========================================================================
// CRONOLÓGICO DE SENADORES (Senator directory)
// ===========================================================================
//
// The "Cronológico de Senadores" community groups senators by constitutional
// period. Each senator is a DSpace ITEM (not a Person entity) with rich
// metadata: dc.title (name), local.politicalparty, local.province,
// dc.date.quadrennium, dc.identifier.uri (handle), plus a thumbnail photo.
//
//   Community (Cronológico de Senadores): dfb768ab-841a-40ec-9edd-6cf9b2c5490a
//     ├─ Collection "Período constitucional, 2010-2016": 98dc3b59-0df6-4923-976e-ff61d7b9f9dc
//     ├─ Collection "Período constitucional, 2016-2020": 452151f5-e01a-42b8-b5da-668582346ce9
//     ├─ Collection "Período constitucional, 2020-2024": 221e3a37-a431-4366-aa58-606bf1ab14cc
//     └─ Collection "Período constitucional, 2024-2028": cd9b2852-2b16-448b-a409-306adb857e1f
//
// Search across all periods uses scope = the community UUID; a single period
// uses scope = the collection UUID.

/** Scope: Cronológico de Senadores community (all senators, all periods). */
export const SENATE_SCOPE_SENADORES = "dfb768ab-841a-40ec-9edd-6cf9b2c5490a";

/** Constitutional period → collection UUID. Ordered oldest → newest. */
export const SENATE_PERIODOS: Array<{ periodo: string; collectionId: string }> = [
  { periodo: "2010-2016", collectionId: "98dc3b59-0df6-4923-976e-ff61d7b9f9dc" },
  { periodo: "2016-2020", collectionId: "452151f5-e01a-42b8-b5da-668582346ce9" },
  { periodo: "2020-2024", collectionId: "221e3a37-a431-4366-aa58-606bf1ab14cc" },
  { periodo: "2024-2028", collectionId: "cd9b2852-2b16-448b-a409-306adb857e1f" },
];

export interface Senador {
  id: string;
  nombre: string;
  partido: string;
  provincia: string;
  periodo: string;
  uri: string;
  foto: string;
}

/** Map a DSpace senator ITEM (with optional embedded thumbnail) to a Senador. */
function dspaceToSenador(obj: any): Senador {
  const meta: Record<string, any[]> = obj?.metadata ?? {};
  const thumbHref =
    obj?._embedded?.thumbnail?._links?.content?.href ?? "";
  return {
    id: obj?.id ?? "",
    nombre: getMeta(meta, "dc.title") || obj?.name || "",
    partido: getMeta(meta, "local.politicalparty"),
    provincia: getMeta(meta, "local.province"),
    periodo: getMeta(meta, "dc.date.quadrennium"),
    uri: getMeta(meta, "dc.identifier.uri"),
    foto: thumbHref,
  };
}

/**
 * Fetch a page of senator ITEMs from DSpace discover, embedding thumbnails so
 * each result carries a photo URL. Unlike fetchDSpacePage this sorts by score
 * (relevance) for name queries and by title for browsing, and always embeds
 * the thumbnail bitstream.
 */
async function fetchSenadoresPage(
  scope: string,
  query = "",
  size = 40,
  page = 0,
): Promise<{ objects: any[]; total: number }> {
  const params = new URLSearchParams({
    page: String(page),
    size: String(Math.min(size, 100)),
    dsoType: "ITEM",
    scope,
    embed: "thumbnail",
    sort: query ? "score,DESC" : "dc.title,ASC",
  });
  if (query) params.set("query", query);
  const url = `${SEARCH_URL}?${params}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return { objects: [], total: 0 };
    const data = await resp.json();
    const sr = data?._embedded?.searchResult;
    const objects =
      sr?._embedded?.objects?.map((o: any) => o._embedded?.indexableObject) ?? [];
    const total = sr?.page?.totalElements ?? objects.length;
    return { objects, total };
  } catch {
    clearTimeout(timer);
    return { objects: [], total: 0 };
  }
}

/**
 * Search senators by name across all periods (or within one period when a
 * collectionId scope is given). Returns senators with party, province,
 * quadrennium and photo.
 */
export async function searchSenadores(
  query: string,
  opts: { periodo?: string; maxResults?: number } = {},
): Promise<Senador[]> {
  const max = Math.min(opts.maxResults ?? 20, 100);
  const scope = opts.periodo
    ? SENATE_PERIODOS.find((p) => p.periodo === opts.periodo)?.collectionId ??
      SENATE_SCOPE_SENADORES
    : SENATE_SCOPE_SENADORES;
  const { objects } = await fetchSenadoresPage(scope, query, max, 0);
  return objects.filter((o) => o?.id).map(dspaceToSenador);
}

/**
 * List all senators for a given constitutional period (e.g. "2020-2024"),
 * paginated. Returns { periodo, total, results }.
 */
export async function listSenadoresByPeriodo(
  periodo: string,
  opts: { page?: number; size?: number } = {},
): Promise<{ periodo: string; total: number; results: Senador[] }> {
  const entry = SENATE_PERIODOS.find((p) => p.periodo === periodo);
  if (!entry) return { periodo, total: 0, results: [] };
  const { objects, total } = await fetchSenadoresPage(
    entry.collectionId,
    "",
    opts.size ?? 40,
    opts.page ?? 0,
  );
  return {
    periodo,
    total,
    results: objects.filter((o) => o?.id).map(dspaceToSenador),
  };
}

/**
 * List the available constitutional periods with a senator count for each.
 */
export async function listSenadoresPeriodos(): Promise<
  Array<{ periodo: string; collectionId: string; total: number }>
> {
  return Promise.all(
    SENATE_PERIODOS.map(async (p) => {
      const { total } = await fetchSenadoresPage(p.collectionId, "", 1, 0);
      return { periodo: p.periodo, collectionId: p.collectionId, total };
    }),
  );
}

/**
 * Fetch a single senator's full record by DSpace item UUID, including photo.
 */
export async function getSenador(itemId: string): Promise<Senador | null> {
  const base = `${DSPACE_HOST}/server/api`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(
      `${base}/core/items/${encodeURIComponent(itemId)}?embed=thumbnail`,
      {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: ctrl.signal,
      },
    );
    clearTimeout(timer);
    if (!resp.ok) return null;
    const obj = await resp.json();
    if (!obj?.id) return null;
    return dspaceToSenador(obj);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ---- Single expediente fetch (granular: one item by UUID) -----------------
// The Senado DSpace has no SIL-style sub-resource endpoints (no separate
// proponentes / historicos / votaciones calls). A single item already carries
// all its metadata; the related resources we enrich with are:
//   - owningCollection (+ parentCommunity chain) → legislative classification
//   - bundles → bitstreams (the PDFs), with a canDownload check per bitstream
//   - relationships / mappedCollections → related items (usually empty)
// This mirrors the Cámara "granular tool": ask about ONE specific record →
// hit one endpoint, not a broad search.

export interface SenadoExpedienteDocumento {
  nombre: string;
  formato: string;
  sizeBytes: number;
  url: string;
  canDownload: boolean;
}

export interface SenadoExpediente {
  id: string;
  numero: string | null;
  tipo: string;
  descripcion: string;
  estado: string | null;
  fecha: string | null;
  materia: string | null;
  url: string;
  coleccion: string | null;
  comunidad: string | null;
  repositorio: string | null;
  documentos: SenadoExpedienteDocumento[];
  relaciones: any[];
  coleccionesMapeadas: string[];
}

async function dspaceGetJson(url: string, timeoutMs = 15000): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** Fetch the PDF bitstreams of an item by walking its bundles. Tolerant. */
async function fetchItemBitstreams(itemId: string): Promise<SenadoExpedienteDocumento[]> {
  const base = `${DSPACE_HOST}/server/api`;
  const bundlesData = await dspaceGetJson(`${base}/core/items/${encodeURIComponent(itemId)}/bundles`);
  const bundles: any[] = bundlesData?._embedded?.bundles ?? [];
  const out: SenadoExpedienteDocumento[] = [];
  for (const bundle of bundles) {
    const bundleId = bundle?.uuid;
    if (!bundleId) continue;
    const bitsData = await dspaceGetJson(
      `${base}/core/bundles/${encodeURIComponent(bundleId)}/bitstreams?page=0&size=20`,
    );
    const bits: any[] = bitsData?._embedded?.bitstreams ?? [];
    for (const b of bits) {
      const bsId = b?.uuid ?? b?.id;
      const href = b?._links?.content?.href ?? "";
      if (!href || !bsId) continue;
      // DSpace leaves bitstream.format/mimeType null; derive a label from the
      // file extension so the consumer knows what kind of document this is.
      const fname: string = b?.name ?? "";
      const ext = fname.includes(".") ? fname.split(".").pop()!.toUpperCase() : "DESCONOCIDO";
      // canDownload: the authorization endpoint returns a row when granted.
      const auth = await dspaceGetJson(
        `${base}/authz/authorizations/search/object?uri=${encodeURIComponent(`${base}/core/bitstreams/${bsId}`)}&feature=canDownload&embed=feature`,
      );
      const canDownload = Array.isArray(auth?._embedded?.authorizations)
        ? auth!._embedded!.authorizations.length > 0
        : false;
      out.push({
        nombre: fname || bundle?.name || "documento",
        formato: ext,
        sizeBytes: typeof b?.sizeBytes === "number" ? b.sizeBytes : 0,
        url: href,
        canDownload,
      });
    }
  }
  return out;
}

/** Resolve the owning collection chain (collection → community → community). */
async function fetchItemProvenance(itemId: string): Promise<{
  coleccion: string | null;
  comunidad: string | null;
  repositorio: string | null;
}> {
  const base = `${DSPACE_HOST}/server/api`;
  const col = await dspaceGetJson(
    `${base}/core/items/${encodeURIComponent(itemId)}/owningCollection?embed=parentCommunity/parentCommunity`,
  );
  if (!col) return { coleccion: null, comunidad: null, repositorio: null };
  const coleccion = col?.name ?? null;
  const comunidad = col?._embedded?.parentCommunity?.name ?? null;
  const repositorio = col?._embedded?.parentCommunity?._embedded?.parentCommunity?.name ?? null;
  return { coleccion, comunidad, repositorio };
}

/**
 * Fetch a SINGLE Senado DSpace expediente by its item UUID — full metadata plus
 * its collection provenance, attached PDFs (each with a canDownload flag), and
 * related items, with no broad search. Returns null if not found.
 */
export async function getExpediente(itemId: string): Promise<SenadoExpediente | null> {
  if (!itemId) return null;
  const base = `${DSPACE_HOST}/server/api`;
  const obj = await dspaceGetJson(
    `${base}/core/items/${encodeURIComponent(itemId)}?embed=thumbnail`,
  );
  if (!obj?.id) return null;
  const md = obj.metadata ?? {};
  const numero = getMeta(md, "dc.identifier.govdoc");
  const tipo = deriveTipo(md);
  const estado = getMeta(md, "dc.format");
  const descripcion = getMeta(md, "dc.description") || getMeta(md, "dc.title") || obj.name || "";
  const fecha = getMeta(md, "dc.date.issued");
  const materia = getMeta(md, "dc.publisher");
  const uri = getMeta(md, "dc.identifier.uri");
  const handleUrl = uri || `${DSPACE_HOST}/handle/123456789/${obj.id}`;

  const [documentos, provenance, relData, mappedData] = await Promise.all([
    fetchItemBitstreams(itemId),
    fetchItemProvenance(itemId),
    dspaceGetJson(`${base}/core/items/${encodeURIComponent(itemId)}/relationships`),
    dspaceGetJson(`${base}/core/items/${encodeURIComponent(itemId)}/mappedCollections?page=0&size=5`),
  ]);
  const relaciones = relData?._embedded?.relationships ?? [];
  const coleccionesMapeadas = (mappedData?._embedded?.collections ?? []).map((c: any) => c.name).filter(Boolean);

  return {
    id: obj.id,
    numero: numero || null,
    tipo,
    descripcion: descripcion.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    estado: estado || null,
    fecha: fecha || null,
    materia: materia || null,
    url: handleUrl,
    coleccion: provenance.coleccion,
    comunidad: provenance.comunidad,
    repositorio: provenance.repositorio,
    documentos,
    relaciones,
    coleccionesMapeadas,
  };
}
