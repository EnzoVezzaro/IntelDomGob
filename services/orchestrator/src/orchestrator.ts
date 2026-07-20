// Orchestrator — the heart of the platform.
//
// Every intelligence request passes through here. Responsibilities:
//   * Resolve which institution services to target.
//   * Fan out SearXNG + institution searches + Dominican press in parallel.
//   * Build the grounded prompt and call the AI service.
//   * Assemble the deterministic IntelligenceResult (FLUJOs, evidence, timeline).
//
// It contains the business logic. It delegates I/O to the AI / Search /
// Institutions services and never talks to external systems directly.

import type { IntelligenceResult, QueryRequest, LawRef, BulletinRef, InstitutionResult, PlannerResult } from "@intel.dom.gob/types";
import { createLogger } from "@intel.dom.gob/logger";
import { queryTokens, dedupeByKey, normUrl, fetchWebpage, firstUrlInText } from "@intel.dom.gob/utils";
import type { AiService } from "@intel.dom.gob/service-ai";
import type { SearchService } from "@intel.dom.gob/service-search";
import {
  registerAllInstitutions,
  getAllInstitutions,
  getInstitutionByName,
  hasLegislativeCapability,
  hasBulletinCapability,
  type InstitutionService,
} from "@intel.dom.gob/service-institutions";

import {
  buildSystemInstruction,
  buildUserPrompt,
  buildResponseSchema,
} from "./prompt";
import {
  buildResult,
  type RetrievalBundle,
} from "./build";
import {
  classifyInstitution,
  tagResult,
  buildHostToPortal,
  isCongressStream,
  isOtherOfficial,
  isDominicanSource,
  type SearchResultItem,
} from "./classify";
import { QueryPlanner } from "./planner";
import { config } from "@intel.dom.gob/config";

const log = createLogger("orchestrator");

/**
 * Detect the query scope from the user's natural language intent.
 * If an explicit scope is already set in the request, use it.
 * Otherwise, classify the query text to determine which tools to activate.
 */
const VALID_SCOPES = new Set(["all", "sil", "legislativo", "legislative_search", "legislative", "senate", "camara", "senate-news", "camara-news", "diputado"]);

function detectScope(query: string, explicit?: string): string {
  if (explicit && explicit !== "all") {
    // Normalize aliases so downstream checks (scope === "sil") always match.
    if (explicit === "legislativo" || explicit === "legislative_search" || explicit === "legislative") return "sil";
    if (!VALID_SCOPES.has(explicit)) {
      log.warn("Unknown scope, defaulting to 'all'", { explicit, query: query.slice(0, 80) });
      return "all";
    }
    return explicit;
  }
  const q = (query || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Specific intent patterns (order matters: more specific first).
  if (/\b(diputado|legislador|representante)\b/.test(q)) return "diputado";
  if (/\b(noticias?\s+del?\s+senado|senado\s+noticias?|prensa\s+senado|blog\s+senado)\b/.test(q)) return "senate-news";
  if (/\b(noticias?\s+de[l]?\s+c[aá]mara|c[aá]mara\s+noticias?|prensa\s+c[aá]mara)\b/.test(q)) return "camara-news";
  if (/\b(iniciativa|proyecto\s+de\s+ley|expediente|SIL|codigo\s+penal|ley\s+org[aá]nica)\b/.test(q)) return "sil";
  if (/\bsenado\b/.test(q) && !/\bc[aá]mara\b/.test(q)) return "senate";
  if (/\bc[aá]mara\b/.test(q) && !/\bsenado\b/.test(q)) return "camara";
  return "all";
}

export interface OrchestratorOptions {
  ai: AiService;
  search: SearchService;
  defaultAiModel?: string;
}

export class Orchestrator {
  private readonly ai: AiService;
  private readonly search: SearchService;
  private readonly planner: QueryPlanner;

  constructor(opts: OrchestratorOptions) {
    this.ai = opts.ai;
    this.search = opts.search;
    this.planner = new QueryPlanner(this.ai, config);
    registerAllInstitutions();
  }

  /** Exposed so the API gateway can reuse the platform's AI service (chat, etc.). */
  get aiService(): AiService {
    return this.ai;
  }

  async runQuery(req: QueryRequest): Promise<IntelligenceResult> {
    const lang = req.responseLang || "es";
    const searchOpts = {
      lang: req.search?.lang,
      category: req.search?.category,
      safe: req.search?.safe,
      timeRange: req.search?.timeRange,
      engines: req.search?.engines || "bing,mojeek,wikipedia,duckduckgo_lite,wikidata",
    };

    if (!req.query || typeof req.query !== "string") {
      throw new Error("Missing or invalid query parameter");
    }

    const ALL = getAllInstitutions();

    // Resolve which institution services to target.
    let targetServices: InstitutionService[] = ALL;
    if (req.institutions && Array.isArray(req.institutions) && req.institutions.length > 0) {
      const resolved = req.institutions
        .map((inst) => getInstitutionByName(inst) || ALL.find((s) => s.id === inst))
        .filter(Boolean) as InstitutionService[];
      targetServices = resolved.length > 0 ? resolved : ALL;
    }

    const targetPortals = targetServices.map((s) => ({ name: s.name, url: s.url }));
    const restricted = !!(req.institutions && Array.isArray(req.institutions) && req.institutions.length > 0 && targetServices.length < ALL.length);
    const allowedPortalNames = new Set(targetServices.map((s) => s.name.toLowerCase()));
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
        if ((portalAliases[name] || []).some((a) => lab.includes(a))) return true;
      }
      return false;
    };

    const hostToPortal = buildHostToPortal(targetServices);

    // Decompose the query into its principal search concepts (deterministic) so
    // SearXNG targets the real sub-topics instead of the whole sentence as one blob.
    const { concepts, tokens: conceptTokens } = extractSearchConcepts(req.query);
    const conceptNeeded = conceptTokens.length <= 2 ? 1 : 2;

    // Build the SearXNG fan-out from the extracted concepts.
    const searchQueries: string[] = [];
    for (const c of concepts) {
      searchQueries.push(c, `${c} República Dominicana`, `${c} gob.do`, `${c} sitio oficial`);
    }
    for (const portal of targetPortals) {
      const host = portal.url.replace(/^https?:\/\//, "");
      for (const c of concepts) searchQueries.push(`${c} ${host}`);
    }
    const DR_NEWS_HOSTS = [
      "listindiario.com", "diariolibre.com", "hoy.com.do", "elnacional.com.do", "acento.com.do",
      "elcaribe.com.do", "almomento.net", "eldia.com.do",
      "presidencia.gob.do", "camaradediputados.gob.do", "senado.gob.do",
      "tribunalconstitucional.gob.do", "dgcp.gob.do", "consultoria.gov.do", "datos.gob.do",
    ];
    for (const host of DR_NEWS_HOSTS) for (const c of concepts) searchQueries.push(`${c} site:${host}`);

    // Run SearXNG fan-out (prioritize Congreso hosts).
    const congressHosts = ["senado.gob.do", "senadord.gob.do", "camaradediputados.gob.do", "diputadosrd.gob.do"];
    const rankedQueries = [...searchQueries].sort((a, b) => {
      const ca = congressHosts.some((h) => a.includes(h)) ? 0 : 1;
      const cb = congressHosts.some((h) => b.includes(h)) ? 0 : 1;
      return ca - cb;
    });
    const MAX_SEARX_CALLS = 28;
    const searxResults: SearchResultItem[] = [];
    for (const sq of rankedQueries.slice(0, MAX_SEARX_CALLS)) {
      const r = await this.search.webSearch(sq, req.search?.maxResults || 8, searchOpts.engines).catch(() => []);
      searxResults.push(...r);
    }

    const keepResult = (host: string) => !restricted || hostToPortal.has(host);
    // Relevance gate: keep official/congress results only if they share concepts
    // with the query. Fallback to host-only if the gate empties the pool (never
    // return zero official sources on a sparse retrieval).
    const gateOk = (r: SearchResultItem): boolean => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        if (!keepResult(host)) return false;
        if (conceptTokens.length === 0) return true;
        return tokenOverlapLocal(`${r.title} ${r.snippet}`, conceptTokens) >= conceptNeeded;
      } catch {
        return false;
      }
    };
    const gated = searxResults.filter(gateOk);
    const filteredResults =
      gated.length > 0
        ? gated
        : searxResults.filter((r) => {
            try {
              return keepResult(new URL(r.url).hostname.replace(/^www\./, ""));
            } catch {
              return false;
            }
          });
    const newsPool = searxResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        if (!isDominicanSource(host)) return false;
        if (conceptTokens.length === 0) return true;
        return tokenOverlapLocal(`${r.title} ${r.snippet}`, conceptTokens) >= conceptNeeded;
      } catch {
        return false;
      }
    });

    const tagged = [...filteredResults, ...newsPool]
      .map((r) => tagResult(r, hostToPortal))
      .filter((r, i, arr) => arr.findIndex((x) => normUrl(x.url) === normUrl(r.url)) === i);

    const congressResults = tagged.filter(isCongressStream);
    const otherOfficialResults = tagged.filter(isOtherOfficial);
    const newsResults = tagged.filter((r) => {
      if (isCongressStream(r) || isOtherOfficial(r)) return false;
      try {
        const h = new URL(r.url).hostname.replace(/^www\./, "");
        if (!isDominicanSource(h)) return false;
      } catch {
        return false;
      }
      const toks = conceptTokens;
      if (toks.length === 0) return true;
      const needed = conceptNeeded;
      return tokenOverlapLocal(`${r.title} ${r.snippet}`, toks) >= needed;
    });

    // SIL legislative records (Cámara + Senado), separated by concept.
    const SIL_MAX = 12;
    const chamberSvc = targetServices.find((s) => s.id === "chamber");
    const senateSvc = targetServices.find((s) => s.id === "senate");
    const chamberConcepts = chamberSvc && isPortalAllowed("Cámara de Diputados")
      ? await (chamberSvc as any).getConcepts?.(req.query).catch(() => null)
      : null;
    const senateConcepts = senateSvc && isPortalAllowed("Senado de la República")
      ? await (senateSvc as any).getConcepts?.(req.query).catch(() => null)
      : null;
    const chamberLaws = chamberConcepts?.iniciativas ?? [];
    const senateLaws = senateConcepts?.iniciativas ?? [];
    const silLaws: LawRef[] = [...chamberLaws, ...senateLaws];

    const BULLETIN_MAX = 10;
    const senadoBulletins = senateConcepts?.boletines ?? [];

    // Parallel institution searches.
    const [
      officialActivity,
      newsActivity,
      senadoActivity,
      datosActivity,
      perInstitutionResults,
    ] = await Promise.all([
      Promise.all(
        targetServices.filter((s) => s.id !== "senate" && s.id !== "datos").map((s) => s.search(req.query).catch(() => [] as any[]))
      ).then((a) => a.flat()),
      this.search.newsActivity(req.query, () => true, restricted),
      (async () => {
        const sen = targetServices.find((s) => s.id === "senate");
        return sen ? (await sen.search(req.query).catch(() => [])) : [];
      })(),
      (async () => {
        const dat = targetServices.find((s) => s.id === "datos");
        return dat ? (await dat.search(req.query).catch(() => [])) : [];
      })(),
      Promise.all(
        targetServices.map(async (s) => [s.id, (await s.search(req.query).catch(() => [] as any[]))] as const)
      ).then((e) => Object.fromEntries(e)),
    ]);

    const officialAsResults: InstitutionResult[] = officialActivity.map((a) => ({
      title: a.title, url: a.url, snippet: (a as any).snippet || "", engine: (a as any).engine || "portal-oficial", institution: a.institution,
    }));
    const senadoAsResults: InstitutionResult[] = senadoActivity.map((a) => ({
      title: a.title, url: a.url, snippet: (a as any).date || "", engine: "senado-api", institution: "Senado de la República",
    }));
    const datosAsResults: InstitutionResult[] = datosActivity.map((a) => ({
      title: a.title, url: a.url, snippet: a.snippet, engine: "datos-gob", institution: (a as any).source,
    }));
    const newsAsResults: InstitutionResult[] = newsActivity.map((a) => ({
      title: a.title, url: a.url, snippet: a.snippet || "", engine: "medio", institution: a.source,
    }));

    const congressMerged = dedupeByKey([...officialAsResults, ...congressResults, ...senadoAsResults, ...datosAsResults], (r) => normUrl(r.url)).slice(0, 36);
    const newsMerged = dedupeByKey([...newsResults, ...newsAsResults, ...otherOfficialResults], (r) => normUrl(r.url)).slice(0, 30);

    const perInstitution: Record<string, InstitutionResult[]> = {};
    for (const s of targetServices) {
      perInstitution[s.id] = dedupeByKey((perInstitutionResults[s.id] || []).map((r) => tagResult(r, hostToPortal)), (r) => normUrl(r.url));
    }

    const bundle: RetrievalBundle = {
      query: req.query,
      congressResults: congressMerged,
      otherOfficialResults,
      newsResults: newsMerged,
      silLaws,
      senadoBulletins,
      camaraIniciativas: (chamberConcepts?.iniciativas ?? []).slice(0, SIL_MAX),
      senadoIniciativas: (senateConcepts?.iniciativas ?? []).slice(0, SIL_MAX),
      senadoResoluciones: (senateConcepts?.resoluciones ?? []).slice(0, BULLETIN_MAX),
      senadoActas: (senateConcepts?.actas ?? []).slice(0, BULLETIN_MAX),
      senadoInformes: (senateConcepts?.informes ?? []).slice(0, BULLETIN_MAX),
      camaraComisiones: (chamberConcepts?.comisiones ?? []).slice(0, BULLETIN_MAX),
      camaraSesiones: (chamberConcepts?.sesiones ?? []).slice(0, BULLETIN_MAX),
      camaraGrupos: (chamberConcepts?.gruposParlamentarios ?? []).slice(0, BULLETIN_MAX),
      diputados: (chamberConcepts?.legisladores ?? []).slice(0, BULLETIN_MAX),
      perInstitution,
      searchQueries,
    };

    // Build grounded user prompt.
    const institutionContext = req.institutions && Array.isArray(req.institutions) && req.institutions.length > 0
      ? `Focus search strictly on these institutions: ${req.institutions.join(", ")}. `
      : `Dynamically decide which Dominican Republic government institutions are relevant. `;

    const groundedUserPrompt = `${buildUserPrompt(req.query, institutionContext)}

=== FLUJO A: ACTIVIDAD DEL CONGRESO NACIONAL (FUENTES OFICIALES) ===
${congressMerged.length ? congressMerged.map((r, i) => `[C-${i + 1}] (${r.institution || classifyInstitution(r.url)} - ${r.engine || "portal-oficial"}) ${r.title}\nURL: ${r.url}\n${r.snippet || ""}`).join("\n\n") : "No se recuperaron fuentes oficiales del Congreso/Nacional."}
${silLaws.length ? `\n--- LEYES / INICIATIVAS LEGISLATIVAS (via Diputados SIL API) ---\n${silLaws.map((l, i) => `[SIL-${i + 1}] (${l.url.includes("senado") ? "Senado de la República" : "Cámara de Diputados"} - SIL API) ${l.numero} · ${l.tipo}\nEstado: ${l.estado || "N/A"}${l.materia ? " · Materia: " + l.materia : ""}${l.fechaDeposito ? " · Depositado: " + l.fechaDeposito : ""}\n${l.descripcion.slice(0, 400)}\nURL: ${l.url}`).join("\n\n")}` : ""}

=== FLUJO D: COBERTURA EN NOTICIAS / MEDIOS ===
${newsMerged.length ? newsMerged.map((r, i) => `[N-${i + 1}] (${r.institution || classifyInstitution(r.url)} - ${r.engine}) ${r.title}\nURL: ${r.url}\n${r.snippet}`).join("\n\n") : "No se recuperaron noticias desde SearXNG."}

=== FLUJO E: BOLETINES, ACTAS Y DOCUMENTOS LEGISLATIVOS (Senado DSpace) ===
${senadoBulletins.length ? senadoBulletins.map((b, i) => `[B-${i + 1}] (${b.tipo || "Boletín"}) ${b.title}\nURL: ${b.url}\nFecha: ${b.date || "s/f"}${b.snippet ? `\n${b.snippet}` : ""}`).join("\n\n") : "No se encontraron boletines/actas relevantes."}

REGLAS DE REDACCIÓN:
1. Basa la respuesta ESTRICTAMENTE en las fuentes anteriores. No inventes fuentes, números de ley ni fechas.
2. El enfoque PRIMARIO (FLUJO A) debe ser lo que está haciendo el CONGRESO NACIONAL. Las NOTICIAS (FLUJO D) son solo contexto cuaternario.
3. OBLIGATORIO: toda ley/iniciativa del SIL debe incluirse como fila en la MATRIZ DE EVIDENCIA.
4. CITA EL CONGRESO PRIMERO en el resumen ejecutivo, análisis detallado y cada sección.
5. Si las fuentes carecen de información, indícalo honestamente y mantén la confianza baja.
6. PROHIBIDO ALUCINAR FUENTES en FLUJO D y FLUJO E. Cada entrada de "news" debe usar EXACTAMENTE una URL que aparezca en FLUJO D. Si FLUJO D está vacío, devuelve "news" VACÍO ([]).
7. INCLUYE TODAS las notas del FLUJO D que sean claramente relevantes (hasta ~10 entradas distintas).`;

    const modelJson = await this.ai.generateJson({
      model: req.model,
      systemInstruction: buildSystemInstruction(lang),
      messages: [{ role: "user", content: groundedUserPrompt }],
      temperature: 0.4,
      maxOutputTokens: 32768,
      responseSchema: buildResponseSchema(),
    }).catch((err) => {
      log.error("AI generation failed", { error: String(err) });
      return {};
    });

    // Lightweight planner step (DeerFlow-style) — decide institution focus and
    // decompose the question into sub-questions before any retrieval. The plan
    // is attached to the result for full traceability.
    const plan = this.planQuery(req, targetServices, restricted);
    modelJson.planner = {
      intent: plan.intent,
      institutionsSelected: plan.institutionsSelected,
      plan: plan.plan,
    };

    return buildResult(modelJson, bundle);
  }

  /**
   * Streaming variant of runQuery. Emits Server-Sent-Events style progress:
   *   { type: "plan" } -> { type: "search" } -> { type: "token", text }* -> { type: "result", result }
   * The structured IntelligenceResult is assembled from the authoritative
   * retrieval bundle plus the streamed prose as the narrative.
   */
  async runQueryStream(
    req: QueryRequest,
    emit: (event: { type: string; [k: string]: unknown }) => void,
  ): Promise<void> {
    if (!req.query || typeof req.query !== "string") {
      throw new Error("Missing or invalid query parameter");
    }
    const searchPhase = await this.retrieve(req);
    emit({ type: "plan", intent: searchPhase.plan.intent, institutionsSelected: searchPhase.plan.institutionsSelected, plan: searchPhase.plan.plan });
    emit({ type: "search", queriesRun: searchPhase.bundle.searchQueries.length });

    const model = req.model || "gemini-3.1-flash-lite";
    // Resolve the AI provider through the AI service (never instantiate a
    // provider directly here).
    const aiProvider = await this.ai.resolveProvider({ apiKey: req.apiKey, provider: req.provider });

    let raw = "";
    try {
      for await (const token of aiProvider.stream?.({
        model,
        systemInstruction: buildSystemInstruction(req.responseLang || "es"),
        messages: [{ role: "user", content: searchPhase.groundedUserPrompt }],
        temperature: 0.4,
        maxOutputTokens: 32768,
        jsonMode: true,
        responseSchema: buildResponseSchema(),
      }) ?? []) {
        raw += token;
        emit({ type: "token", text: token });
      }
    } catch (err) {
      log.warn("Streaming generation failed; falling back to buffered generation", { error: String(err) });
    }

    // The stream is JSON-constrained, so `raw` is a (possibly partial) JSON
    // object matching the response schema. Prefer it as the authoritative
    // structured result; only fall back to buffered generation if empty.
    let modelJson: any = {};
    if (raw.trim()) {
      try {
        modelJson = JSON.parse(raw);
      } catch {
        // Partial/truncated JSON from the stream — repair best-effort.
        modelJson = (this.ai as any).repairTruncatedJson
          ? (this.ai as any).repairTruncatedJson(raw)
          : {};
        if (!modelJson?.response) {
          modelJson = {
            response: {
              summary: raw.slice(0, 600),
              detailedAnalysis: raw,
              confidenceLevel: "Medium",
            },
            evidence: [],
            citations: [],
          };
        }
      }
    }

    if (!modelJson?.response) {
      const buffered = await this.ai.generateJson({
        model,
        systemInstruction: buildSystemInstruction(req.responseLang || "es"),
        messages: [{ role: "user", content: searchPhase.groundedUserPrompt }],
        temperature: 0.4,
        maxOutputTokens: 32768,
        responseSchema: buildResponseSchema(),
      }).catch(() => ({}));
      modelJson = buffered && buffered.response ? buffered : modelJson;
    }

    modelJson.planner = modelJson.planner ?? {
      intent: searchPhase.plan.intent,
      institutionsSelected: searchPhase.plan.institutionsSelected,
      plan: searchPhase.plan.plan,
    };
    const result = buildResult(modelJson, searchPhase.bundle);
    emit({ type: "result", result });
  }

  /**
   * Shared retrieval phase (SearXNG fan-out + institution search). Extracted so
   * both the synchronous and streaming query paths share identical logic.
   */
  private async retrieve(req: QueryRequest): Promise<{
    bundle: RetrievalBundle;
    groundedUserPrompt: string;
    targetServiceIds: string[];
    plan: PlannerResult;
  }> {
    const lang = req.responseLang || "es";
    const searchOpts = {
      lang: req.search?.lang,
      category: req.search?.category,
      safe: req.search?.safe,
      timeRange: req.search?.timeRange,
      engines: req.search?.engines || "bing,mojeek,wikipedia,duckduckgo_lite,wikidata",
    };

    const ALL = getAllInstitutions();
    let targetServices: InstitutionService[] = ALL;
    if (req.institutions && Array.isArray(req.institutions) && req.institutions.length > 0) {
      const resolved = req.institutions
        .map((inst) => getInstitutionByName(inst) || ALL.find((s) => s.id === inst))
        .filter(Boolean) as InstitutionService[];
      targetServices = resolved.length > 0 ? resolved : ALL;
    }

    // Intent-based scope: auto-detect from query or use explicit request scope.
    const scope = detectScope(req.query, req.scope);

    // Apply scope restrictions: narrow targetServices to the relevant chambers.
    if (scope === "senate" || scope === "senate-news") {
      targetServices = targetServices.filter((s) => s.id === "senate");
    } else if (scope === "camara" || scope === "camara-news" || scope === "diputado") {
      targetServices = targetServices.filter((s) => s.id === "chamber");
    } else if (scope === "sil") {
      targetServices = targetServices.filter((s) => s.id === "chamber" || s.id === "senate");
    }

    const targetPortals = targetServices.map((s) => ({ name: s.name, url: s.url }));
    const restricted = !!(req.institutions && Array.isArray(req.institutions) && req.institutions.length > 0 && targetServices.length < ALL.length);
    const allowedPortalNames = new Set(targetServices.map((s) => s.name.toLowerCase()));
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
        if ((portalAliases[name] || []).some((a) => lab.includes(a))) return true;
      }
      return false;
    };

    const hostToPortal = buildHostToPortal(targetServices);

    // Decompose the query into its principal search concepts (deterministic) so
    // SearXNG targets the real sub-topics instead of the whole sentence as one blob.
    const { concepts, tokens: conceptTokens } = extractSearchConcepts(req.query);
    const conceptNeeded = conceptTokens.length <= 2 ? 1 : 2;

    // Model-agnostic Query Planner: produces intent-aware, expanded search queries
    // driven entirely by `.env` (LLM_MODEL / DEFAULT_AI_PROVIDER). Falls back to the
    // deterministic concept decomposition when no model is configured or the call fails.
    const plan = await this.planner.plan(req.query, req.responseLang || "es");
    const plannerQueries = plan?.queries ?? [];

    // Build the SearXNG fan-out. Prefer the planner's queries; when the planner is
    // unavailable, fall back to the deterministic concept expansion below.
    // Scope-based restrictions: skip SearXNG for pure SIL lookups; restrict news
    // hosts for chamber-specific news scopes.
    const searchQueries: string[] = [];
    const skipSearx = scope === "sil";
    if (!skipSearx) {
      if (plannerQueries.length > 0) {
        searchQueries.push(...plannerQueries);
      } else {
        for (const c of concepts) {
          searchQueries.push(c, `${c} República Dominicana`, `${c} gob.do`, `${c} sitio oficial`);
        }
        for (const portal of targetPortals) {
          const host = portal.url.replace(/^https?:\/\//, "");
          for (const c of concepts) searchQueries.push(`${c} ${host}`);
        }
        const DR_NEWS_HOSTS = scope === "senate-news"
          ? ["senado.gob.do", "senadord.gob.do"]
          : scope === "camara-news" || scope === "diputado"
            ? ["camaradediputados.gob.do", "diputadosrd.gob.do"]
            : [
                "listindiario.com", "diariolibre.com", "hoy.com.do", "elnacional.com.do", "acento.com.do",
                "elcaribe.com.do", "almomento.net", "eldia.com.do",
                "presidencia.gob.do", "camaradediputados.gob.do", "senado.gob.do",
                "tribunalconstitucional.gob.do", "dgcp.gob.do", "consultoria.gov.do", "datos.gob.do",
              ];
        for (const host of DR_NEWS_HOSTS) for (const c of concepts) searchQueries.push(`${c} site:${host}`);
      }
    }

    const congressHosts = ["senado.gob.do", "senadord.gob.do", "camaradediputados.gob.do", "diputadosrd.gob.do"];
    const rankedQueries = [...searchQueries].sort((a, b) => {
      const ca = congressHosts.some((h) => a.includes(h)) ? 0 : 1;
      const cb = congressHosts.some((h) => b.includes(h)) ? 0 : 1;
      return ca - cb;
    });
    const MAX_SEARX_CALLS = 28;
    const searxResults: SearchResultItem[] = [];
    for (const sq of rankedQueries.slice(0, MAX_SEARX_CALLS)) {
      const r = await this.search.webSearch(sq, req.search?.maxResults || 8, searchOpts.engines).catch(() => []);
      searxResults.push(...r);
    }

    const keepResult = (host: string) => !restricted || hostToPortal.has(host);
    // Relevance gate: keep official/congress results only if they share concepts
    // with the query. Fallback to host-only if the gate empties the pool (never
    // return zero official sources on a sparse retrieval).
    const gateOk = (r: SearchResultItem): boolean => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        if (!keepResult(host)) return false;
        if (conceptTokens.length === 0) return true;
        return tokenOverlapLocal(`${r.title} ${r.snippet}`, conceptTokens) >= conceptNeeded;
      } catch {
        return false;
      }
    };
    const gated = searxResults.filter(gateOk);
    const filteredResults =
      gated.length > 0
        ? gated
        : searxResults.filter((r) => {
            try {
              return keepResult(new URL(r.url).hostname.replace(/^www\./, ""));
            } catch {
              return false;
            }
          });
    const newsPool = searxResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        if (!isDominicanSource(host)) return false;
        if (conceptTokens.length === 0) return true;
        return tokenOverlapLocal(`${r.title} ${r.snippet}`, conceptTokens) >= conceptNeeded;
      } catch {
        return false;
      }
    });

    const tagged = [...filteredResults, ...newsPool]
      .map((r) => tagResult(r, hostToPortal))
      .filter((r, i, arr) => arr.findIndex((x) => normUrl(x.url) === normUrl(r.url)) === i);

    const congressResults = tagged.filter(isCongressStream);
    const otherOfficialResults = tagged.filter(isOtherOfficial);
    const newsResults = tagged.filter((r) => {
      if (isCongressStream(r) || isOtherOfficial(r)) return false;
      try {
        const h = new URL(r.url).hostname.replace(/^www\./, "");
        if (!isDominicanSource(h)) return false;
      } catch {
        return false;
      }
      const toks = conceptTokens;
      if (toks.length === 0) return true;
      const needed = conceptNeeded;
      return tokenOverlapLocal(`${r.title} ${r.snippet}`, toks) >= needed;
    });

    const SIL_MAX = 12;
    const chamberSvc = targetServices.find((s) => s.id === "chamber");
    const senateSvc = targetServices.find((s) => s.id === "senate");

    // Broad legislative scrape, separated by concept. SIL iniciativas are the
    // highest-priority source; comisiones/sesiones (Cámara) and
    // resoluciones/boletines/actas/informes (Senado) are supplementary.
    const chamberConcepts = chamberSvc && isPortalAllowed("Cámara de Diputados")
      ? await (chamberSvc as any).getConcepts?.(req.query).catch(() => null)
      : null;
    const senateConcepts = senateSvc && isPortalAllowed("Senado de la República")
      ? await (senateSvc as any).getConcepts?.(req.query).catch(() => null)
      : null;

    const chamberLaws = chamberConcepts?.iniciativas ?? [];
    const senateLaws = senateConcepts?.iniciativas ?? [];
    const silLaws: LawRef[] = [...chamberLaws, ...senateLaws];

    const BULLETIN_MAX = 10;
    const senadoBulletins = senateConcepts?.boletines ?? [];

    const [
      officialActivity,
      newsActivity,
      senadoActivity,
      datosActivity,
      perInstitutionResults,
    ] = await Promise.all([
      Promise.all(
        targetServices.filter((s) => s.id !== "senate" && s.id !== "datos").map((s) => s.search(req.query).catch(() => [] as any[])),
      ).then((a) => a.flat()),
      this.search.newsActivity(req.query, () => true, restricted),
      (async () => {
        const sen = targetServices.find((s) => s.id === "senate");
        return sen ? (await sen.search(req.query).catch(() => [])) : [];
      })(),
      (async () => {
        const dat = targetServices.find((s) => s.id === "datos");
        return dat ? (await dat.search(req.query).catch(() => [])) : [];
      })(),
      Promise.all(
        targetServices.map(async (s) => [s.id, (await s.search(req.query).catch(() => [] as any[]))] as const),
      ).then((e) => Object.fromEntries(e)),
    ]);

    const officialAsResults: InstitutionResult[] = officialActivity.map((a) => ({
      title: a.title, url: a.url, snippet: (a as any).snippet || "", engine: (a as any).engine || "portal-oficial", institution: a.institution,
    }));
    const senadoAsResults: InstitutionResult[] = senadoActivity.map((a) => ({
      title: a.title, url: a.url, snippet: a.date || "", engine: "senado-api", institution: "Senado de la República",
    }));
    const datosAsResults: InstitutionResult[] = datosActivity.map((a) => ({
      title: a.title, url: a.url, snippet: a.snippet, engine: "datos-gob", institution: (a as any).source,
    }));
    const newsAsResults: InstitutionResult[] = newsActivity.map((a) => ({
      title: a.title, url: a.url, snippet: a.snippet || "", engine: "medio", institution: a.source,
    }));

    const congressMerged = dedupeByKey([...officialAsResults, ...congressResults, ...senadoAsResults, ...datosAsResults], (r) => normUrl(r.url)).slice(0, 36);
    const newsMerged = dedupeByKey([...newsResults, ...newsAsResults, ...otherOfficialResults], (r) => normUrl(r.url)).slice(0, 30);

    const perInstitution: Record<string, InstitutionResult[]> = {};
    for (const s of targetServices) {
      perInstitution[s.id] = dedupeByKey((perInstitutionResults[s.id] || []).map((r) => tagResult(r, hostToPortal)), (r) => normUrl(r.url));
    }

const bundle: RetrievalBundle = {
      query: req.query,
      congressResults: congressMerged,
      otherOfficialResults,
      newsResults: newsMerged,
      silLaws,
      senadoBulletins,
      camaraIniciativas: (chamberConcepts?.iniciativas ?? []).slice(0, SIL_MAX),
      senadoIniciativas: (senateConcepts?.iniciativas ?? []).slice(0, SIL_MAX),
      senadoResoluciones: (senateConcepts?.resoluciones ?? []).slice(0, BULLETIN_MAX),
      senadoActas: (senateConcepts?.actas ?? []).slice(0, BULLETIN_MAX),
      senadoInformes: (senateConcepts?.informes ?? []).slice(0, BULLETIN_MAX),
      camaraComisiones: (chamberConcepts?.comisiones ?? []).slice(0, BULLETIN_MAX),
      camaraSesiones: (chamberConcepts?.sesiones ?? []).slice(0, BULLETIN_MAX),
      camaraGrupos: (chamberConcepts?.gruposParlamentarios ?? []).slice(0, BULLETIN_MAX),
      diputados: (chamberConcepts?.legisladores ?? []).slice(0, BULLETIN_MAX),
      perInstitution,
      searchQueries,
    };

    // URL fetch integration: if the query contains a URL, fetch it and include
    // its content as a high-priority "FUENTE DIRECTA" block in the prompt.
    let directSourceBlock = "";
    const url = firstUrlInText(req.query);
    if (url) {
      const fetched = await this.search.fetchWebpage(url, { maxChars: 12000 }).catch(() => null);
      if (fetched) {
        const dominicanBadge = fetched.dominican ? " 🇩🇴" : "";
        directSourceBlock = `\n=== FUENTE DIRECTA (URL provista por el usuario${dominicanBadge}) ===\nTítulo: ${fetched.title}\nURL: ${fetched.url}${fetched.publishedDate ? `\nFecha de publicación: ${fetched.publishedDate}` : ""}\n\n${fetched.text}\n`;
      }
    }

    const institutionContext = req.institutions && Array.isArray(req.institutions) && req.institutions.length > 0
      ? `Focus search strictly on these institutions: ${req.institutions.join(", ")}. `
      : `Dynamically decide which Dominican Republic government institutions are relevant. `;

    const groundedUserPrompt = `${buildUserPrompt(req.query, institutionContext)}${directSourceBlock}

=== FLUJO A: ACTIVIDAD DEL CONGRESO NACIONAL (FUENTES OFICIALES) ===
${congressMerged.length ? congressMerged.map((r, i) => `[C-${i + 1}] (${r.institution || classifyInstitution(r.url)} - ${r.engine || "portal-oficial"}) ${r.title}\nURL: ${r.url}\n${r.snippet || ""}`).join("\n\n") : "No se recuperaron fuentes oficiales del Congreso/Nacional."}
${silLaws.length ? `\n--- LEYES / INICIATIVAS LEGISLATIVAS (via Diputados SIL API) ---\n${silLaws.map((l, i) => `[SIL-${i + 1}] (${l.url.includes("senado") ? "Senado de la República" : "Cámara de Diputados"} - SIL API) ${l.numero} · ${l.tipo}\nEstado: ${l.estado || "N/A"}${l.materia ? " · Materia: " + l.materia : ""}${l.fechaDeposito ? " · Depositado: " + l.fechaDeposito : ""}\n${l.descripcion.slice(0, 400)}\nURL: ${l.url}`).join("\n\n")}` : ""}

=== FLUJO D: COBERTURA EN NOTICIAS / MEDIOS ===
${newsMerged.length ? newsMerged.map((r, i) => `[N-${i + 1}] (${r.institution || classifyInstitution(r.url)} - ${r.engine}) ${r.title}\nURL: ${r.url}\n${r.snippet}`).join("\n\n") : "No se recuperaron noticias desde SearXNG."}

=== FLUJO E: BOLETINES, ACTAS Y DOCUMENTOS LEGISLATIVOS (Senado DSpace) ===
${senadoBulletins.length ? senadoBulletins.map((b, i) => `[B-${i + 1}] (${b.tipo || "Boletín"}) ${b.title}\nURL: ${b.url}\nFecha: ${b.date || "s/f"}${b.snippet ? `\n${b.snippet}` : ""}`).join("\n\n") : "No se encontraron boletines/actas relevantes."}

REGLAS DE REDACCIÓN:
1. Basa la respuesta ESTRICTAMENTE en las fuentes anteriores. No inventes fuentes, números de ley ni fechas.
2. El enfoque PRIMARIO (FLUJO A) debe ser lo que está haciendo el CONGRESO NACIONAL. Las NOTICIAS (FLUJO D) son solo contexto cuaternario.
3. OBLIGATORIO: toda ley/iniciativa del SIL debe incluirse como fila en la MATRIZ DE EVIDENCIA.
4. CITA EL CONGRESO PRIMERO en el resumen ejecutivo, análisis detallado y cada sección.
5. Si las fuentes carecen de información, indícalo honestamente y mantén la confianza baja.
6. PROHIBIDO ALUCINAR FUENTES en FLUJO D y FLUJO E. Cada entrada de "news" debe usar EXACTAMENTE una URL que aparezca en FLUJO D. Si FLUJO D está vacío, devuelve "news" VACÍO ([]).
7. INCLUYE TODAS las notas del FLUJO D que sean claramente relevantes (hasta ~10 entradas distintas).`;

    const planResult = this.planQuery(req, targetServices, restricted);
    return { bundle, groundedUserPrompt, targetServiceIds: targetServices.map((s) => s.id), plan: planResult };
  }

  /**
   * Lightweight planner step (DeerFlow-style). Before any retrieval, decompose
   * the user's question into sub-questions and decide which institutions to
   * prioritize. This is deterministic (no extra LLM call) so it adds zero
   * latency, but it makes the orchestration strategy explicit and traceable.
   */
  private planQuery(
    req: QueryRequest,
    targetServices: InstitutionService[],
    restricted: boolean,
  ): PlannerResult {
    const tokens = queryTokens(req.query);
    // Decompose into sub-questions by DR-government angles.
    const angles = [
      "actividad legislativa (Congreso Nacional)",
      "marco legal y reglamentario",
      "posición del Poder Ejecutivo",
      "cobertura en medios dominicanos",
      "datos abiertos y transparencia",
    ];
    const subQuestions = angles.map((a) => `¿Qué dice ${a} sobre "${req.query}"?`);
    const focus = restricted
      ? `Restringido a: ${targetServices.map((s) => s.name).join(", ")}.`
      : `Selección dinámica de instituciones relevantes según la pregunta.`;
    const plan = [
      `INTENCIÓN: ${req.query}`,
      `ESTRATEGIA: ${focus}`,
      `SUB-PREGUNTAS:`,
      ...subQuestions.map((q, i) => `  ${i + 1}. ${q}`),
      `Fuente primaria obligatoria: Congreso Nacional (Cámara de Diputados + Senado).`,
    ].join("\n");
    return {
      intent: req.query,
      institutionsSelected: targetServices.map((s) => s.name),
      plan,
    };
  }
}

/**
 * Deterministic query → concept decomposition (zero-latency, no LLM call).
 *
 * Strips command/filler phrases ("busca en el mcp", "por donde va", …) and
 * splits the question on coordinating conjunctions / prepositions so the
 * SearXNG fan-out targets the *real* sub-topics instead of the whole sentence
 * as one blob. For
 *   "…las 3 causales del aborto en el proceso de modificación del código penal…"
 * this yields ["<full query>", "3 causales del aborto", "modificación del código penal"].
 * The original full query is always kept first as the broadest concept.
 */
const FILLER_PHRASES = [
  "busca en intel dom gob", "busca en el mcp", "busca en mcp", "busca en intel dom",
  "por donde va", "por favor", "quiero saber", "dime", "consulta sobre",
  "investiga", "investiga sobre", "necesito saber", "me puedes decir",
  "cual es", "cuál es", "encuentra", "busca", "hay que buscar",
];

// Remove command/filler phrases (case- and accent-insensitive) while keeping the
// original casing/accents so the resulting string stays a good search query.
function stripFiller(q: string): string {
  let s = q;
  for (const f of FILLER_PHRASES) {
    const re = new RegExp(f.normalize("NFD").replace(/[̀-ͯ]/g, ""), "gi");
    s = s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(re, " ");
  }
  return s.normalize("NFC").replace(/\s+/g, " ").replace(/^[,;|]+/, "").trim();
}

export function extractSearchConcepts(rawQuery: string): { concepts: string[]; tokens: string[] } {
  const cleaned = stripFiller(rawQuery);
  // Delimiters that separate independent search intents.
  const segments = cleaned
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/,|;|\||\by\s+|\ben el proceso de\b|\bsobre\b|\bacerca de\b|\brespecto a\b|\ben cuanto a\b|\bdurante\b|\bpara\b/)
    .map((s) => s.trim())
    .filter(Boolean);

  const cleanSeg = (s: string): string =>
    s.replace(/^(la|las|el|los|de|del|en|a|por|una|un|para|con|y\s+)+/g, "").replace(/[?¿.!]+$/g, "").trim();

  const seen = new Set<string>();
  const concepts: string[] = [];
  const push = (c: string) => {
    const cc = cleanSeg(c);
    if (cc.length < 6) return; // ignore tiny fragments
    const key = cc.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    concepts.push(cc);
  };

  // Full cleaned query first (broadest), then each extracted concept.
  push(cleaned);
  for (const seg of segments) push(seg);

  const capped = concepts.slice(0, 4); // stay within the SearXNG call budget
  const tokSet = new Set<string>();
  for (const c of capped) for (const t of queryTokens(c)) tokSet.add(t);
  return { concepts: capped, tokens: [...tokSet] };
}

function tokenOverlapLocal(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const low = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let n = 0;
  for (const t of tokens) {
    if (t.length >= 4 ? low.includes(t) : low.split(/\s+/).some((w) => w === t || w.startsWith(t))) n++;
  }
  return n;
}
