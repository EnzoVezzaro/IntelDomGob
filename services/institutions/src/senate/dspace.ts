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

const DSPACE_HOST = "https://memoriahistorica.senadord.gob.do";
const SEARCH_URL = `${DSPACE_HOST}/server/api/discover/search/objects`;

// Scope to Iniciativas Legislativas community (contains Proyectos de Ley,
// Resoluciones, Contratos, etc.) — excludes Boletines/Actas/Año.
const SENATE_SCOPE_INICIATIVAS = "9799f9b1-556e-4dc5-82a7-c3f52454749b";

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
