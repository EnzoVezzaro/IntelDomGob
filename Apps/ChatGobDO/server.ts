import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// SearXNG instance URL (self-hosted or public). Configurable via env.
const SEARXNG_URL = process.env.SEARXNG_URL || "http://127.0.0.1:8081";

app.use(express.json());

// Helper to lazy-initialize the GoogleGenAI client to prevent crashing on startup if key is missing.
let aiClient: GoogleGenAI | null = null;

function getAiClient(requestKey?: string): GoogleGenAI {
  const apiKey = requestKey || process.env.GEMINI_API_KEY;
  // Rebuild client if a different key is supplied via the request.
  if (!aiClient || (requestKey && aiClient["apiKey"] !== requestKey)) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in the environment.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// SearXNG search helper - performs a real web search via a SearXNG instance
// and returns normalized results with title, url, snippet, and engine.
interface SearXNGResult {
  title: string;
  url: string;
  snippet: string;
  engine: string;
}

async function searxngSearch(
  query: string,
  maxResults = 10,
  opts: { lang?: string; category?: string; safe?: boolean; timeRange?: string; engines?: string } = {}
): Promise<SearXNGResult[]> {
  try {
    const params: Record<string, string> = {
      q: query,
      format: "json",
      language: opts.lang || "es",
      categories: opts.category || "general",
    };
    if (opts.safe) params.safesearch = "1";
    if (opts.timeRange) params.time_range = opts.timeRange;
    if (opts.engines) params.engines = opts.engines;

    const resp = await fetch(`${SEARXNG_URL}/search?${new URLSearchParams(params).toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      console.warn(`SearXNG returned ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    const results: any[] = data.results || [];
    return results.slice(0, maxResults).map((r) => ({
      title: r.title || "Untitled",
      url: r.url,
      snippet: r.content || "",
      engine: r.engine || "unknown",
    }));
  } catch (e) {
    console.error("SearXNG search failed:", e);
    return [];
  }
}

// Best-effort repair of a JSON string that was truncated by the model (ran out
// of output tokens). Closes any open braces/brackets/strings and parses.
function repairTruncatedJson(raw: string): any {
  let s = raw.trim();
  // Strip a trailing comma before a closing bracket.
  s = s.replace(/,\s*$/, "");
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}") stack.pop();
    else if (ch === "]") stack.pop();
  }
  // Close an unterminated string first.
  if (inString) s += '"';
  // Close open containers in reverse.
  while (stack.length) {
    const open = stack.pop();
    if (open === "{") s += "}";
    else if (open === "[") s += "]";
  }
  try {
    return JSON.parse(s);
  } catch {
    // Last resort: return whatever top-level fields we can salvage.
    return {};
  }
}

// Live query of the Diputados SIL laws API (Iniciativas / Proyectos de Ley) is
// now handled by the `chamber` institution service (src/institutions/chamber).
// Its structured legislative records are injected as grounding so the model can
// confirm what Congress is actually working on.

// FLUJO B: fetch Dominican news coverage directly. SearXNG's active engines
// (bing/mojeek) rarely index .do content, so we pull the official portals'
// news sections AND a few Dominican newspapers directly and extract the
// query-relevant in-domain links.
const DR_NEWS_SOURCES: { url: string; name: string }[] = [
  { url: "https://www.camaradediputados.gob.do/noticias/", name: "Cámara de Diputados (Noticias)" },
  { url: "https://www.senado.gob.do/noticias", name: "Senado de la República (Noticias)" },
  { url: "https://www.presidencia.gob.do/noticias", name: "Presidencia (Noticias)" },
  { url: "https://www.diariolibre.com/", name: "Diario Libre" },
  { url: "https://www.listindiario.com/", name: "Listín Diario" },
  { url: "https://www.hoy.com.do/", name: "Hoy" },
  { url: "https://www.elcaribe.com.do/", name: "El Caribe" },
];

async function fetchNewsActivity(
  query: string,
  isAllowed: (sourceLabel: string) => boolean,
  restricted = true
): Promise<{ url: string; title: string; source: string }[]> {
  const out: { url: string; title: string; source: string }[] = [];
  const seen = new Set<string>();
  const linkRe = /<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  for (const src of DR_NEWS_SOURCES) {
    if (!isAllowed(src.name)) continue;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const resp = await fetch(src.url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "ChatGobDO/1.0", Accept: "text/html" },
      });
      clearTimeout(t);
      if (!resp.ok) continue;
      const html = await resp.text();
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(html)) !== null) {
        const href = m[1];
        const text = stripTags(m[2]).slice(0, 180);
        if (!text || text.length < 8) continue;
        try {
          const abs = new URL(href, src.url).href;
          const host = new URL(abs).hostname.replace(/^www\./, "");
          const srcHost = new URL(src.url).hostname.replace(/^www\./, "");
          if (host !== srcHost && !host.endsWith("." + srcHost)) continue;
          if (seen.has(abs)) continue;
          if (restricted) {
            const toks = queryTokens(query);
            const needed = toks.length <= 2 ? 1 : 2;
            if (toks.length === 0 || tokenOverlap(text, toks) < needed) continue;
          }
          seen.add(abs);
          out.push({ url: abs, title: text, source: src.name });
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return out.slice(0, 30);
}

// The legacy Senate MasterLex system (wfilemaster/*) is login-gated and
// unreachable, so the Senate institution service (src/institutions/senate) uses
// the PUBLIC Senate WordPress REST API instead, surfacing initiatives/sessions.

// Shared Spanish stopwords for query tokenization.
const ES_STOP = new Set([
  "de", "la", "el", "los", "las", "y", "en", "a", "del", "por", "para", "con", "que", "su", "se", "un", "una",
  "proyecto", "ley", "reforma", "sobre", "al", "lo", "como", "o", "es", "dominicana", "republica",
  "propuestas", "debates", "cual", "este", "esta", "the", "of", "and", "to", "in", "for", "is", "on", "with",
  "del", "una", "unas", "los", "las", "que", "segun", "entre", "hacia", "desde", "hasta", "sin",
]);

// Extract meaningful query tokens (accent-stripped, stopword-filtered).
function queryTokens(query: string): string[] {
  return query
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/\s+/).map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 2 && !ES_STOP.has(t));
}

// Count how many meaningful query tokens appear in a piece of text. Enforces
// TOPICAL COHERENCE so off-topic items (e.g. "Código Penal" for an "acceso a la
// información" query) are rejected. Returns the match count.
function tokenOverlap(text: string, tokens: string[]): number {
  const low = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let n = 0;
  for (const t of tokens) {
    if (t.length >= 4 ? low.includes(t) : low.split(/\s+/).some((w) => w === t || w.startsWith(t))) n++;
  }
  return n;
}

// Datos Abiertos RD (datos.gob.do) — the official CKAN open-data portal — is now
// handled by the `datos` institution service (src/institutions/datos) via its
// package_search API.

// Map a URL to a known Dominican Republic government institution.
function classifyInstitution(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("camaradediputados.gob.do")) return "Cámara de Diputados";
  if (u.includes("senado.gob.do")) return "Senado de la República";
  if (u.includes("presidencia.gob.do")) return "Presidencia de la República";
  if (u.includes("consultoria.gov.do")) return "Consultoría Jurídica";
  if (u.includes("tribunalconstitucional.gob.do")) return "Tribunal Constitucional";
  if (u.includes("dgcp.gob.do")) return "DGCP";
  if (u.includes("datos.gob.do")) return "Datos Abiertos RD";
  if (u.includes("gob.do")) return "Portal Oficial Dominicano";
  return "Fuente Web";
}

// Health Check API
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!process.env.GEMINI_API_KEY
  });
});

// Institution Registry API — lets the frontend dynamically discover available
// institution plugins and their capabilities WITHOUT backend code changes.
app.get("/api/institutions", async (req, res) => {
  try {
    const { registerAllInstitutions, describeAll } = await import("./src/institutions");
    registerAllInstitutions();
    res.json({ institutions: describeAll() });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to load institutions", message: e.message });
  }
});

// Portal URL-tree API: builds (and caches) a recursive URL tree for each portal.
let urlTreeCache: any = null;
let urlTreeBuilding = false;

app.get("/api/url-tree", async (req, res) => {
  const force = req.query.refresh === "1";
  // Optional ?portals=Name1,Name2 filter (mirrors "Fijar Instituciones").
  const portalFilter = req.query.portals
    ? String(req.query.portals).split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  if (urlTreeCache && !force) {
    const portals = portalFilter
      ? urlTreeCache.portals.filter((p: any) => portalFilter.includes(p.name))
      : urlTreeCache.portals;
    res.json({ cached: true, generatedAt: urlTreeCache.generatedAt, portals });
    return;
  }
  if (urlTreeBuilding) {
    res.status(202).json({ status: "building", message: "URL tree is being generated. Try again shortly." });
    return;
  }
  urlTreeBuilding = true;
  try {
    const { buildCategorizedUrlTree } = await import("./src/crawler");
    const allPortals = await buildCategorizedUrlTree();
    urlTreeCache = { generatedAt: new Date().toISOString(), portals: allPortals };
    const portals = portalFilter
      ? allPortals.filter((p: any) => portalFilter.includes(p.name))
      : allPortals;
    res.json({ cached: false, generatedAt: urlTreeCache.generatedAt, portals });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to build URL tree", message: e.message });
  } finally {
    urlTreeBuilding = false;
  }
});

// Multi-Agent Reasoning Query API
app.post("/api/query", async (req, res) => {
  const { query, institutions, model, apiKey, search, responseLang } = req.body;
  const lang = responseLang || "es";
  const searchOpts = {
    lang: search?.lang,
    category: search?.category,
    safe: search?.safe,
    timeRange: search?.timeRange,
    engines: search?.engines || "bing,mojeek,wikipedia,duckduckgo_lite,wikidata",
  };

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "Missing or invalid query parameter" });
    return;
  }

  // Check if API key is configured (env or provided via settings)
  if (!process.env.GEMINI_API_KEY && !apiKey) {
    res.status(400).json({
      error: "Missing API Key",
      message: "The GEMINI_API_KEY is not configured. Please add your API key in the Settings panel (gear icon) before running a query."
    });
    return;
  }

  try {
    const ai = getAiClient(apiKey);
    
    // Build context-aware prompt guiding the multi-agent schema response
    const institutionContext = institutions && Array.isArray(institutions) && institutions.length > 0
      ? `Focus search strictly on these institutions: ${institutions.join(", ")}. `
      : `Dynamically decide which Dominican Republic government institutions are relevant. `;

    const LANG_NAMES: Record<string, string> = {
      es: "Spanish",
      en: "English",
      fr: "French",
      pt: "Portuguese",
      it: "Italian",
      de: "German",
    };

    const systemInstruction = `You are the lead intelligence architect for the Dominican Republic Government Intelligence Platform.
Your purpose is to run a query-driven multi-agent retrieval and reasoning loop to answer questions about legislation, decrees, budgets, legal rulings, and procurement.

You must simulate the following internal agents step-by-step in your reasoning, then output a JSON response matching the schema:
1. **Planner Agent**:
   - Understand the user's intent and decompose the request.
   - Determine which official Dominican Republic institutions are relevant.
   - Formulate targeted query strategies.
2. **Institution Agent**:
   - Limit searches only to relevant official domains (e.g., presidencia.gob.do, camaradediputados.gob.do, senado.gob.do, tribunalconstitucional.gob.do, dgcp.gob.do, datos.gob.do).
3. **Search Agent**:
   - Formulate exact search queries to retrieve relevant documents, laws, or news.
4. **Retrieval Agent**:
   - Analyze search results to extract clean readable details of official documents (HTML/PDF content).
5. **Evidence Agent**:
   - Pull specific facts, dates, citations, articles, names, or decrees.
6. **Validation Agent**:
   - Check for conflicting claims, duplicates, or outdated laws. Rank hierarchy: Constitutional Court rulings > Congressional Laws > Presidential Decrees > Ministerial Resolutions.
7. **Refinement Agent**:
   - Synthesize evidence, remove fluff, and merge duplicates into a high-density intelligence brief.
8. **Response Agent**:
   - Construct an executive summary, structured details, timeline of events, verified citations, and set a confidence score based on evidence completeness.

 IMPORTANT RULES:
- Never make up sources, document numbers, or dates.
- If no information is found on official sources, reflect this honestly and keep confidence low.
- Focus strictly on the Dominican Republic government context.
- Keep the tone objective, clinical, analytical, and professional.
- PRIMACÍA DEL CONGRESO NACIONAL (REGLA OBLIGATORIA): El enfoque analítico PRIMARIO de TODA la respuesta debe ser lo que está haciendo el CONGRESO NACIONAL — tanto el SENADO (senadores) como la CÁMARA DE DIPUTADOS (diputados): proyectos de ley, iniciativas, comisiones, sesiones, debates, vistas públicas y dictámenes. El enfoque SECUNDARIO es la PRESIDENCIA (decretos, políticas públicas) y, en orden de prioridad descendente, el Tribunal Constitucional, la DGCP y datos.gob.do. Cada sección (resumen ejecutivo, análisis detallado, cronología, matriz de evidencia y validación) DEBE liderar con la actividad del Congreso; la Presidencia y demás instituciones se tratan solo como complemento o contexto. Las leyes/iniciativas devueltas vía la API del SIL de la Cámara de Diputados son fuentes primarias autorizadas y DEBEN aparecer en la MATRIZ DE EVIDENCIA.
- Write the ENTIRE response (summary, detailed analysis, timeline events, validation notes, and any prose) in the following language: ${LANG_NAMES[lang] || "Spanish"}. Do not translate official institution names or legal document titles, but all explanatory text must be in ${LANG_NAMES[lang] || "Spanish"}.`;



    const userPrompt = `User Query: "${query}"
${institutionContext}
Conduct the full multi-agent search and reasoning process. Output the results strictly in JSON format. Provide the absolute maximum amount of accurate Dominican Republic legal, government, or policy details you can find.`;

    // Run real web searches through SearXNG before invoking the model.
    // Split the research by category: for each relevant institution we build a
    // query scoped to that department + category so news, legislative action, laws,
    // decrees, etc. are each searched against their most important pages.
    const { registerAllInstitutions, getAllInstitutions, getInstitutionByName, hasLegislativeCapability } =
      await import("./src/institutions");
    registerAllInstitutions();
    const ALL_INSTITUTIONS = getAllInstitutions();

    // Resolve which institution services to target. Selection may arrive as
    // display names (e.g. "Senado de la República") or ids (e.g. "senate").
    let targetServices = ALL_INSTITUTIONS;
    if (institutions && Array.isArray(institutions) && institutions.length > 0) {
      const resolved = institutions
        .map((inst: string) => getInstitutionByName(inst) || ALL_INSTITUTIONS.find((s) => s.id === inst))
        .filter(Boolean) as typeof ALL_INSTITUTIONS;
      targetServices = resolved.length > 0 ? resolved : ALL_INSTITUTIONS;
    }
    // Backwards-compatible `targetPortals` shape (name/url) for downstream code.
    const targetPortals = targetServices.map((s) => ({ name: s.name, url: s.url }));

    // When the user selected specific sources (via Árbol de URLs or Fijar
    // Instituciones), restrict ALL retrieval to those portals only. Empty
    // selection (or no institution filter) means "search everything".
    const restricted = !!(institutions && Array.isArray(institutions) && institutions.length > 0 && targetServices.length < ALL_INSTITUTIONS.length);
    const allowedPortalNames = new Set(targetServices.map((s) => s.name.toLowerCase()));
    // Aliases so the fetchers' source labels match the portal selection.
    const portalAliases: Record<string, string[]> = {
      "senado de la república": ["senado de la república", "senado"],
      "cámara de diputados": ["cámara de diputados", "diputados", "cámara"],
      "presidencia de la república": ["presidencia de la república", "presidencia"],
      "tribunal constitucional": ["tribunal constitucional"],
      "dgcp": ["dgcp", "dirección general de contrataciones públicas"],
      "datos abiertos rd": ["datos abiertos rd", "datos.gob.do", "datos abiertos"],
      "consultoría jurídica del poder ejecutivo": ["consultoría jurídica"],
    };
    const isPortalAllowed = (sourceLabel: string): boolean => {
      if (!restricted) return true;
      const lab = sourceLabel.toLowerCase();
      for (const name of allowedPortalNames) {
        if (lab.includes(name)) return true;
        const aliases = portalAliases[name] || [];
        if (aliases.some((a) => lab.includes(a))) return true;
      }
      return false;
    };

    // Build a host->portal lookup for the targeted institutions. We no longer use
    // the `site:` operator because the active engines (bing/mojeek) return 0
    // results for scoped queries; instead we run BROAD queries and filter by host.
    const hostToPortal = new Map<string, string>();
    for (const s of targetServices) {
      const host = s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      hostToPortal.set(host, s.name);
      // Also map common subdomains / alternate hosts.
      if (host === "camaradediputados.gob.do") hostToPortal.set("diputadosrd.gob.do", s.name);
      if (host === "senado.gob.do") hostToPortal.set("senadord.gob.do", s.name);
    }

    // Broad query variants (no site:/inurl: scope). In free search (no
    // institutions fixed) these run as-is and the result filter below accepts
    // ALL Dominican sources, so the query searches across every source.
    const searchQueries: string[] = [
      query,
      `${query} República Dominicana`,
      `${query} gob.do`,
      `${query} sitio oficial`,
    ];
    for (const portal of targetPortals) {
      const host = portal.url.replace(/^https?:\/\//, "");
      searchQueries.push(`${query} ${host}`);
    }
    for (const portal of targetPortals) {
      const host = portal.url.replace(/^https?:\/\//, "");
      searchQueries.push(`${query} ${host}`);
    }

    const searxResults: SearXNGResult[] = [];
    // Cap the number of SearXNG calls to keep the grounding context within the
    // model's output budget. Prioritize Congreso Nacional portals.
    const congressHosts = ["senado.gob.do", "senadord.gob.do", "camaradediputados.gob.do", "diputadosrd.gob.do"];
    const rankedQueries = [...searchQueries].sort((a, b) => {
      const ca = congressHosts.some((h) => a.includes(h)) ? 0 : 1;
      const cb = congressHosts.some((h) => b.includes(h)) ? 0 : 1;
      return ca - cb;
    });
    const MAX_SEARX_CALLS = 18;
    const queriesToRun = rankedQueries.slice(0, MAX_SEARX_CALLS);
    for (const sq of queriesToRun) {
      const r = await searxngSearch(sq, search?.maxResults || 8, searchOpts);
      searxResults.push(...r);
    }
    // Filter sources. When the user fixed specific institutions (restricted),
    // keep only those official portals. In FREE search (no filters fixed) we do
    // NOT filter by host: we return every result SearchXNG found, so the model
    // gets the broadest possible grounding. State/institutional sources are
    // prioritized downstream; news is the least relevant stream.
    const isOfficialHost = (host: string) => hostToPortal.has(host);
    const keepResult = (host: string) => !restricted || isOfficialHost(host);
    // Official-host results (Congreso stream). In free search this keeps every
    // official portal hit; in restricted mode only the selected portals.
    const filteredResults = searxResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        return keepResult(host);
      } catch {
        return false;
      }
    });
    // Dominican-relevant pool: official OR Dominican media, so FLUJO B is
    // populated with on-topic DR coverage instead of global search garbage.
    const DR_MEDIA = [
      "listin.com.do", "diariolibre.com", "hoy.com.do", "elmundo.com.do", "elnuevodiario.com.do",
      "almomento.net", "acento.com.do", "elcaribe.com.do", "eldeporte.com.do", "codetel.com.do",
      "cdn.com.do", "rtvc.gov.do", "presidencia.gob.do", "gob.do",
    ];
    const isDominicanSource = (host: string) =>
      host.endsWith(".do") || DR_MEDIA.some((m) => host === m || host.endsWith("." + m));
    const newsPool = searxResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        return isDominicanSource(host);
      } catch {
        return false;
      }
    });
    // Tag every result with its institution for traceability.
    const taggedResults = [...filteredResults, ...newsPool].map((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        return { ...r, institution: hostToPortal.get(host) || classifyInstitution(r.url) };
      } catch {
        return { ...r, institution: classifyInstitution(r.url) };
      }
    });
    // De-duplicate by URL
    const seen = new Set<string>();
    const uniqueResults = taggedResults.filter((r) => {
      const key = r.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Split into three streams (faithful to the older working version):
    //  (1) CONGRESO: the actual Congreso Nacional portals (Senado, Diputados,
    //      Presidencia, Tribunal, DGCP, Datos) — the PRIMARY grounding. This must
    //      stay NARROW so real Senate/Diputados hits are not crowded out.
    //  (2) OTRAS FUENTES OFICIALES: other .gob.do ministries (Hacienda, MEPrD,
    //      DGII, etc.) — shown as official context but NOT in the Congress stream.
    //  (3) NOTICIAS: Dominican media / press coverage (secondary context).
    const isCongressStream = (r: any) => {
      try {
        const h = new URL(r.url).hostname.replace(/^www\./, "");
        if (isOfficialHost(h)) return true;
      } catch {}
      const inst = (r.institution || "").toLowerCase();
      return inst.includes("senado") || inst.includes("diputados") || inst.includes("presidencia") ||
        inst.includes("cámara") || inst.includes("tribunal") || inst.includes("dgcp") || inst.includes("datos");
    };
    const isOtherOfficial = (r: any) => {
      try {
        const h = new URL(r.url).hostname.replace(/^www\./, "");
        // Any other Dominican government domain that is not already a Congress portal.
        if ((h.endsWith(".gob.do") || h === "gob.do") && !isOfficialHost(h)) return true;
      } catch {}
      return false;
    };
    const congressResults = uniqueResults.filter(isCongressStream);
    const otherOfficialResults = uniqueResults.filter(isOtherOfficial);
    const newsResults = uniqueResults.filter(
      (r) => !isCongressStream(r) && !isOtherOfficial(r)
    );

    // Hard cap on context size so small models don't truncate the JSON schema.
    const MAX_CONTEXT_RESULTS = 36;

    // Live query of the Diputados SIL laws API for directly-structured legislative records.
    // Cap to keep the grounding prompt within the model's budget. Skip if the
    // Cámara de Diputados is not among the selected sources.
    const SIL_CONTEXT_MAX = 12;
    const chamberSvc = targetServices.find((s) => s.id === "chamber");
    const silLaws = chamberSvc && hasLegislativeCapability(chamberSvc) && isPortalAllowed("Cámara de Diputados")
      ? (await chamberSvc.getLaws(query)).slice(0, SIL_CONTEXT_MAX)
      : [];

    // Run BOTH streams in parallel. FLUJO A (institutional: Congreso, Senado,
    // Presidencia, DGCP, Datos Abiertos) is the PRIMARY source and what the
    // answer must be grounded on. FLUJO B (news) is SECONDARY / extra context.
    //
    // Each institution is now an isolated plugin consumed only via the registry.
    // `officialActivity` aggregates every targeted institution's direct search;
    // `newsActivity` pulls Dominican press; Senate + Datos use their own services.
    const [
      officialActivity,
      newsActivity,
      senadoActivity,
      datosActivity,
    ] = await Promise.all([
      // Direct official-portal activity across all targeted institutions.
      (async () => {
        const acts = await Promise.all(
          targetServices
            .filter((s) => s.id !== "senate" && s.id !== "datos") // Senate/Datos handled separately
            .map((s) => s.search(query).catch(() => [] as any[]))
        );
        return acts.flat();
      })(),
      fetchNewsActivity(query, isPortalAllowed, restricted),
      (async () => {
        const sen = targetServices.find((s) => s.id === "senate");
        return sen ? (await sen.search(query).catch(() => [])) : [];
      })(),
      (async () => {
        const dat = targetServices.find((s) => s.id === "datos");
        return dat ? (await dat.search(query).catch(() => [])) : [];
      })(),
    ]);
    const officialAsResults = officialActivity.map((a) => ({
      title: a.title,
      url: a.url,
      snippet: "",
      engine: "portal-oficial",
      institution: a.institution,
    }));
    const congressMerged = [...officialAsResults, ...congressResults];
    const seenC = new Set<string>();
    const trimmedCongress = congressMerged.filter((r) => {
      const k = r.url.toLowerCase();
      if (seenC.has(k)) return false;
      seenC.add(k);
      return true;
    }).slice(0, MAX_CONTEXT_RESULTS);

    // Merge SearXNG results + direct news fetches + other official .gob.do for FLUJO B.
    const newsAsResults = newsActivity.map((a) => ({
      title: a.title,
      url: a.url,
      snippet: "",
      engine: "medio",
      institution: a.source,
    }));
    const newsMerged = [...newsResults, ...newsAsResults, ...otherOfficialResults];
    const seenN = new Set<string>();
    const trimmedNews = newsMerged.filter((r) => {
      const k = r.url.toLowerCase();
      if (seenN.has(k)) return false;
      seenN.add(k);
      return true;
    }).slice(0, 30);

    // Public Senate (WordPress REST API) — official Senate activity/coverage.
    const senadoAsResults = senadoActivity.map((a) => ({
      title: a.title,
      url: a.url,
      snippet: a.date || "",
      engine: "senado-api",
      institution: "Senado de la República",
    }));
    // Datos Abiertos RD — official open-data portal (FLUJO A).
    const datosAsResults = datosActivity.map((a) => ({
      title: a.title,
      url: a.url,
      snippet: a.snippet,
      engine: "datos-gob",
      institution: a.source,
    }));
    // PREPEND Senate + Datos Abiertos API results so they ALWAYS survive the
    // cap and are never crowded out by other official/portal hits.
    const congressFinal = [...senadoAsResults, ...datosAsResults, ...trimmedCongress];
    const seenCF = new Set<string>();
    const trimmedCongressFinal = congressFinal.filter((r) => {
      const k = r.url.toLowerCase();
      if (seenCF.has(k)) return false;
      seenCF.add(k);
      return true;
    }).slice(0, MAX_CONTEXT_RESULTS);
    // Also feed Senate + Datos Abiertos into FLUJO B (news/data context).
    const newsFinal = [...trimmedNews, ...senadoAsResults, ...datosAsResults];
    const seenNF = new Set<string>();
    const trimmedNewsFinal = newsFinal.filter((r) => {
      const k = r.url.toLowerCase();
      if (seenNF.has(k)) return false;
      seenNF.add(k);
      return true;
    }).slice(0, 30);

    const silContext = silLaws.length
      ? silLaws
          .map(
            (l, i) =>
              `[SIL-${i + 1}] (Cámara de Diputados - SIL API) ${l.numero} · ${l.tipo}\nEstado: ${l.estado || "N/A"}${
                l.materia ? " · Materia: " + l.materia : ""
              }${l.fechaDeposito ? " · Depositado: " + l.fechaDeposito : ""}\n${l.descripcion.slice(0, 400)}\nURL: ${l.url}`
          )
          .join("\n\n")
      : "";

    // Build two separate grounded context blocks (Congreso primero / noticias después).
    const congressContext = trimmedCongressFinal.length
      ? trimmedCongressFinal
          .map((r, i) => `[C-${i + 1}] (${r.institution || classifyInstitution(r.url)} - ${r.engine || "portal-oficial"}) ${r.title}\nURL: ${r.url}\n${r.snippet || ""}`)
          .join("\n\n")
      : "No se recuperaron fuentes oficiales del Congreso/Nacional.";
    const newsContext = trimmedNewsFinal.length
      ? trimmedNewsFinal
          .map((r, i) => `[N-${i + 1}] (${r.institution || classifyInstitution(r.url)} - ${r.engine}) ${r.title}\nURL: ${r.url}\n${r.snippet}`)
          .join("\n\n")
      : "No se recuperaron noticias desde SearXNG.";

    const groundedUserPrompt = `${userPrompt}

=== FLUJO A: ACTIVIDAD DEL CONGRESO NACIONAL (FUENTES OFICIALES) ===
Esto es lo que el Congreso (Senado y Cámara de Diputados), la Presidencia y demás organismos oficiales están haciendo, según portales oficiales. CÍTALO PRIMERO.

${congressContext}
${silContext ? `\n--- LEYES / INICIATIVAS LEGISLATIVAS (via Diputados SIL API) ---\n${silContext}` : ""}

=== FLUJO B: COBERTURA EN NOTICIAS / MEDIOS ===
Esto es la cobertura de prensa sobre el tema (contexto secundario, NO primario).

${newsContext}

REGLAS DE REDACCIÓN:
1. Basa la respuesta ESTRICTAMENTE en las fuentes anteriores. No inventes fuentes, números de ley ni fechas.
2. El enfoque PRIMARIO (FLUJO A) debe ser lo que está haciendo el CONGRESO NACIONAL (Senado y Cámara de Diputados): proyectos de ley, iniciativas, comisiones, sesiones. Las NOTICIAS (FLUJO B) son solo contexto secundario.
3. OBLIGATORIO: toda ley/iniciativa listada en "LEYES / INICIATIVAS LEGISLATIVAS (via Diputados SIL API)" debe incluirse como fila en la MATRIZ DE EVIDENCIA (campo "evidence"), con su URL, institución "Cámara de Diputados (SIL)" y confianza "High". Además, TODA fuente del Congreso en FLUJO A (C-, Senado, Datos Abiertos) debe aparecer en la MATRIZ DE EVIDENCIA antes que las noticias.
4. CITA EL CONGRESO PRIMERO en el resumen ejecutivo, análisis detallado y cada sección. Las noticias (FLUJO B) van al final como contexto secundario, nunca como fuente principal.
5. Si las fuentes carecen de información, indícalo honestamente y mantén la confianza baja.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        sources: {
          type: Type.OBJECT,
          properties: {
            congress: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "Title of the official congressional/government source." },
                  url: { type: Type.STRING, description: "URL of the official source." },
                  snippet: { type: Type.STRING, description: "Short description or excerpt." },
                  institution: { type: Type.STRING, description: "Publishing institution (e.g., Senado, Cámara de Diputados)." }
                },
                required: ["title", "url"]
              },
              description: "FLUJO A: official sources from the Congreso Nacional and government portals."
            },
            news: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "Headline of the news article." },
                  url: { type: Type.STRING, description: "URL of the article." },
                  snippet: { type: Type.STRING, description: "Short description or excerpt." },
                  source: { type: Type.STRING, description: "Media outlet / publisher name." }
                },
                required: ["title", "url"]
              },
              description: "FLUJO B: press / media coverage about the topic (secondary context)."
            },
            laws: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  numero: { type: Type.STRING },
                  tipo: { type: Type.STRING },
                  descripcion: { type: Type.STRING },
                  estado: { type: Type.STRING },
                  url: { type: Type.STRING }
                },
                required: ["numero", "url"]
              },
              description: "Laws / iniciativas from the Diputados SIL API (primary congressional activity)."
            }
          },
          required: ["congress", "news", "laws"]
        },
        planner: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING, description: "Detailed summary of the user's core question and legal intent." },
            institutionsSelected: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of relevant Dominican Republic institutions chosen for this query."
            },
            plan: { type: Type.STRING, description: "The retrieval and analysis plan created." }
          },
          required: ["intent", "institutionsSelected", "plan"]
        },
        institution: {
          type: Type.OBJECT,
          properties: {
            domainsSearched: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Official DR government domains targeted (e.g., presidencia.gob.do, senado.gob.do)."
            }
          },
          required: ["domainsSearched"]
        },
        search: {
          type: Type.OBJECT,
          properties: {
            queriesRun: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Specific keyword strings formulated to query the web."
            }
          },
          required: ["queriesRun"]
        },
        retrieval: {
          type: Type.OBJECT,
          properties: {
            documentsAnalyzed: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Titles or paths of official documents/pages parsed from the search results."
            },
            extractedCount: { type: Type.INTEGER, description: "Number of unique text snippets analyzed." }
          },
          required: ["documentsAnalyzed", "extractedCount"]
        },
        evidence: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              fact: { type: Type.STRING, description: "Specific verifiable fact, article summary, or bill status." },
              sourceUrl: { type: Type.STRING, description: "The exact URL where this fact was retrieved." },
              institution: { type: Type.STRING, description: "The Dominican Republic government institution hosting this source." },
              date: { type: Type.STRING, description: "The publication date or event date (e.g. YYYY-MM-DD)." },
              confidence: { type: Type.STRING, description: "Confidence level of this individual fact.", enum: ["High", "Medium", "Low"] }
            },
            required: ["fact", "sourceUrl", "institution", "confidence"]
          },
          description: "List of structured evidence chunks retrieved."
        },
        validation: {
          type: Type.OBJECT,
          properties: {
            conflictingStatements: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Conflicts or outdated references identified and how they were cross-referenced."
            },
            duplicateSourcesRemoved: { type: Type.INTEGER, description: "Count of redundant links filtered out." },
            statusMessage: { type: Type.STRING, description: "Brief report on data consistency and hierarchy checks." }
          },
          required: ["conflictingStatements", "duplicateSourcesRemoved", "statusMessage"]
        },
        refinement: {
          type: Type.OBJECT,
          properties: {
            coherenceScore: { type: Type.INTEGER, description: "A self-assessed rating of narrative cohesion from 1 to 100." },
            textLengthReduced: { type: Type.INTEGER, description: "Simulated characters of redundant or circular text removed." }
          },
          required: ["coherenceScore", "textLengthReduced"]
        },
        response: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "A high-density Executive Summary of the findings (1 paragraph)." },
            detailedAnalysis: { type: Type.STRING, description: "Full structured analytical response with Markdown subheadings, bullet points, legal citations, and context." },
            timeline: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING, description: "Date of the event (YYYY-MM-DD or Month YYYY)." },
                  event: { type: Type.STRING, description: "The main occurrence or bill status milestone." },
                  detail: { type: Type.STRING, description: "Brief details about the event." }
                },
                required: ["date", "event"]
              },
              description: "Chronological sequence of key events, bill progressions, or rulings."
            },
            confidenceLevel: { type: Type.STRING, description: "Overall intelligence confidence score.", enum: ["High", "Medium", "Low"] },
            citations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "Title of the webpage or document." },
                  url: { type: Type.STRING, description: "Fully-qualified URL of the official source." },
                  snippet: { type: Type.STRING, description: "Direct quote or description of content." },
                  institution: { type: Type.STRING, description: "Publishing official institution." },
                  date: { type: Type.STRING, description: "Publication date if known." }
                },
                required: ["title", "url"]
              },
              description: "Complete checklist of verified official sources used in the reasoning."
            }
          },
          required: ["summary", "detailedAnalysis", "timeline", "confidenceLevel", "citations"]
        }
      },
      required: [
        "sources",
        "planner",
        "institution",
        "search",
        "retrieval",
        "evidence",
        "validation",
        "refinement",
        "response"
      ]
    };

    // Call the model with retry + exponential backoff. When the model is
    // overloaded it returns a 503 / UNAVAILABLE ("high demand") error; we retry
    // waiting 5s, then 10s, then 15s, etc. (5 * attempt seconds).
    const MAX_MODEL_RETRIES = 5;
    let response: any;
    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_MODEL_RETRIES; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: model || "gemini-3.1-flash-lite",
          contents: groundedUserPrompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            maxOutputTokens: 8192,
            temperature: 0.4
          }
        });
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        const status = err?.status || err?.code || (typeof err?.message === "string" ? err.message : "");
        const isOverload =
          status === 503 ||
          status === "UNAVAILABLE" ||
          status === 429 ||
          /high demand|UNAVAILABLE|503|overload|try again later/i.test(String(status));
        if (!isOverload || attempt === MAX_MODEL_RETRIES) {
          throw err;
        }
        const waitMs = 5000 * attempt;
        console.warn(`Gemini overloaded (attempt ${attempt}/${MAX_MODEL_RETRIES}). Retrying in ${waitMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    if (!response) {
      throw lastErr || new Error("Gemini request failed after retries.");
    }

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini.");
    }

    // Parse the output as structured search result JSON. The model may run out
    // of output tokens (especially on small models), producing truncated JSON.
    // We repair incomplete JSON and backfill every required field so the UI
    // never breaks and the live SIL evidence is always present.
    let searchResult: any;
    try {
      searchResult = JSON.parse(text);
    } catch (parseErr) {
      console.warn("Gemini returned truncated JSON; attempting repair. Tail:", text.slice(-120));
      searchResult = repairTruncatedJson(text);
    }

    // Ensure the full object skeleton exists.
    searchResult = searchResult || {};
    searchResult.planner = searchResult.planner || { intent: query, institutionsSelected: [], plan: "" };
    searchResult.institution = searchResult.institution || { domainsSearched: [] };
    searchResult.search = searchResult.search || { queriesRun: [] };
    searchResult.retrieval = searchResult.retrieval || { documentsAnalyzed: 0, extractedCount: 0 };
    searchResult.evidence = Array.isArray(searchResult.evidence) ? searchResult.evidence : [];
    searchResult.validation = searchResult.validation || { conflictingStatements: [], duplicateSourcesRemoved: 0, statusMessage: "" };
    searchResult.refinement = searchResult.refinement || { coherenceScore: 0, textLengthReduced: 0 };
    searchResult.response = searchResult.response || {};
    searchResult.response.summary = searchResult.response.summary || "No se pudo completar la síntesis (respuesta truncada del modelo). Revise las fuentes en la MATRIZ DE EVIDENCIA.";
    searchResult.response.detailedAnalysis = searchResult.response.detailedAnalysis || "";
    searchResult.response.timeline = Array.isArray(searchResult.response.timeline) ? searchResult.response.timeline : [];
    searchResult.response.confidenceLevel = searchResult.response.confidenceLevel || "Low";
    searchResult.response.citations = Array.isArray(searchResult.response.citations) ? searchResult.response.citations : [];

    // Build the two parallel source streams (FLUJO A / FLUJO B) from the REAL
    // retrieved data so the UI always shows what was actually found, regardless
    // of what the model chose to summarize.
    const mapToSource = (r: any) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: r.snippet || "",
      institution: r.institution || classifyInstitution(r.url),
      source: r.institution || classifyInstitution(r.url),
    });
    const modelSources = searchResult.sources || {};
    searchResult.sources = {
      congress: Array.isArray(modelSources.congress) && modelSources.congress.length
        ? modelSources.congress
        : trimmedCongressFinal.map(mapToSource),
      news: Array.isArray(modelSources.news) && modelSources.news.length
        ? modelSources.news
        : trimmedNewsFinal.map(mapToSource),
      laws: Array.isArray(modelSources.laws) && modelSources.laws.length
        ? modelSources.laws
        : silLaws.map((l) => ({
            numero: l.numero,
            tipo: l.tipo,
            descripcion: l.descripcion,
            estado: l.estado || "",
            url: l.url,
          })),
    };

    // Inject the real SearXNG search queries that were executed
    if (searchResult.search) {
      const uniqueQueries = new Set([...(searchResult.search.queriesRun || []), ...searchQueries]);
      searchResult.search.queriesRun = Array.from(uniqueQueries);
    }

    // Build verified citations directly from the SearXNG results (real grounding).
    // Prioritize congressional/official sources over news.
    const searxSources = [...congressResults, ...newsResults].map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      institution: r.institution || classifyInstitution(r.url),
      date: "",
    }));

    if (searxSources.length > 0) {
      const existingUrls = new Set((searchResult.response.citations || []).map((c: any) => c.url.toLowerCase()));
      searchResult.response.citations = searchResult.response.citations || [];
      for (const src of searxSources) {
        if (!existingUrls.has(src.url.toLowerCase())) {
          searchResult.response.citations.push(src);
          existingUrls.add(src.url.toLowerCase());
        }
      }
    }

    // Inject the live SIL legislative records as verified citations too.
    if (silLaws.length > 0) {
      const existingUrls = new Set((searchResult.response.citations || []).map((c: any) => c.url.toLowerCase()));
      searchResult.response.citations = searchResult.response.citations || [];
      for (const l of silLaws) {
        if (!existingUrls.has(l.url.toLowerCase())) {
          searchResult.response.citations.push({
            title: `${l.numero} · ${l.tipo}${l.estado ? " (" + l.estado + ")" : ""}`,
            url: l.url,
            snippet: l.descripcion,
            institution: "Cámara de Diputados (SIL)",
            date: l.fechaDeposito || "",
          });
          existingUrls.add(l.url.toLowerCase());
        }
      }
    }

    // Also enrich the evidence array with source URLs where missing.
    if (Array.isArray(searchResult.evidence)) {
      const urlPool = uniqueResults.map((r) => ({ url: r.url, institution: classifyInstitution(r.url) }));
      searchResult.evidence = searchResult.evidence.map((ev: any, i: number) => {
        if (!ev.sourceUrl && urlPool[i]) {
          return { ...ev, sourceUrl: urlPool[i].url, institution: ev.institution || urlPool[i].institution };
        }
        return ev;
      });
    }

    // OBLIGATORIO: garantizar que TODA ley/iniciativa del SIL aparezca en la MATRIZ DE EVIDENCIA.
    // También inyectamos forzosamente las fuentes REALES del Congreso (Senado, Cámara,
    // Presidencia, Datos Abiertos) recuperadas en FLUJO A aunque el modelo cite poco,
    // para que docsAnalyzed / evidence nunca se queden vacíos.
    searchResult.evidence = searchResult.evidence || [];
    const existingEvUrls = new Set(
      searchResult.evidence.map((ev: any) => (ev.sourceUrl || "").toLowerCase())
    );

    // 1) Leyes / iniciativas SIL (siempre High, primacía máxima).
    for (const l of silLaws) {
      if (existingEvUrls.has(l.url.toLowerCase())) continue;
      const fact = `${l.numero} · ${l.tipo}${l.estado ? " — Estado: " + l.estado : ""}: ${l.descripcion}`;
      searchResult.evidence.push({
        fact,
        sourceUrl: l.url,
        institution: "Cámara de Diputados (SIL)",
        date: l.fechaDeposito || "",
        confidence: "High",
      });
      existingEvUrls.add(l.url.toLowerCase());
    }

    // 2) Fuentes oficiales del Congreso/Nacional recuperadas en FLUJO A (real grounding).
    for (const r of trimmedCongressFinal) {
      if (existingEvUrls.has(r.url.toLowerCase())) continue;
      searchResult.evidence.push({
        fact: `${r.title}${r.snippet ? " — " + r.snippet.slice(0, 200) : ""}`,
        sourceUrl: r.url,
        institution: r.institution || classifyInstitution(r.url),
        date: r.snippet && /\d{4}-\d{2}-\d{2}/.test(r.snippet) ? r.snippet.match(/\d{4}-\d{2}-\d{2}/)![0] : "",
        confidence: "High",
      });
      existingEvUrls.add(r.url.toLowerCase());
    }

    // 3) Noticias (FLUJO B) como contexto secundario, confianza Media.
    for (const r of trimmedNewsFinal) {
      if (existingEvUrls.has(r.url.toLowerCase())) continue;
      searchResult.evidence.push({
        fact: `${r.title}${r.snippet ? " — " + r.snippet.slice(0, 200) : ""}`,
        sourceUrl: r.url,
        institution: r.institution || classifyInstitution(r.url),
        date: "",
        confidence: "Medium",
      });
      existingEvUrls.add(r.url.toLowerCase());
    }

    // Ordenar la evidencia priorizando fuentes del Congreso (SIL + Senado + Cámara).
    const congressRank = (inst: string) => {
      const i = (inst || "").toLowerCase();
      if (i.includes("sil") || i.includes("cámara de diputados") || i.includes("diputados")) return 0;
      if (i.includes("senado")) return 1;
      if (i.includes("presidencia")) return 2;
      if (i.includes("tribunal") || i.includes("dgcp") || i.includes("datos")) return 3;
      return 4; // noticias / medios
    };
    searchResult.evidence.sort(
      (a: any, b: any) => congressRank(a.institution) - congressRank(b.institution)
    );

    // Forzar retrieval.documentsAnalyzed y extractedCount con las fuentes REALES
    // recuperadas, de modo que el UI nunca muestre "docsAnalyzed: 2" vacío.
    const realDocs = [
      ...trimmedCongressFinal.map((r) => r.title || r.url),
      ...trimmedNewsFinal.map((r) => r.title || r.url),
      ...silLaws.map((l) => `${l.numero} · ${l.tipo}`),
    ];
    searchResult.retrieval = searchResult.retrieval || { documentsAnalyzed: [], extractedCount: 0 };
    if (!Array.isArray(searchResult.retrieval.documentsAnalyzed) ||
        searchResult.retrieval.documentsAnalyzed.length === 0) {
      searchResult.retrieval.documentsAnalyzed = realDocs;
    }
    const realCount = trimmedCongressFinal.length + trimmedNewsFinal.length + silLaws.length;
    searchResult.retrieval.extractedCount =
      typeof searchResult.retrieval.extractedCount === "number" && searchResult.retrieval.extractedCount > 0
        ? searchResult.retrieval.extractedCount
        : realCount;

    // Add general metadata
    searchResult.query = query;
    searchResult.timestamp = new Date().toISOString();
    searchResult.searchEngine = "searxng";

    res.json(searchResult);

  } catch (err: any) {
    console.error("Error processing multi-agent query:", err);
    res.status(500).json({
      error: "Retrieval Processing Error",
      message: err.message || "An unexpected error occurred during multi-agent analysis."
    });
  }
});

// Configure Vite integration or Static delivery
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Dynamically import Vite only in development to keep production bundle clean
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Government Intelligence Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
