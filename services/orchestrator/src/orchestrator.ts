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
import { queryTokens, dedupeByKey, normUrl } from "@intel.dom.gob/utils";
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

const log = createLogger("orchestrator");

export interface OrchestratorOptions {
  ai: AiService;
  search: SearchService;
}

export class Orchestrator {
  private readonly ai: AiService;
  private readonly search: SearchService;

  constructor(opts: OrchestratorOptions) {
    this.ai = opts.ai;
    this.search = opts.search;
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

    // Build broad + Dominican-scoped news queries.
    const searchQueries: string[] = [req.query, `${req.query} República Dominicana`, `${req.query} gob.do`, `${req.query} sitio oficial`];
    for (const portal of targetPortals) {
      const host = portal.url.replace(/^https?:\/\//, "");
      searchQueries.push(`${req.query} ${host}`);
    }
    const DR_NEWS_HOSTS = [
      "listindiario.com", "diariolibre.com", "hoy.com.do", "elnacional.com.do", "acento.com.do",
      "elcaribe.com.do", "almomento.net", "eldia.com.do",
      "presidencia.gob.do", "camaradediputados.gob.do", "senado.gob.do",
      "tribunalconstitucional.gob.do", "dgcp.gob.do", "consultoria.gov.do", "datos.gob.do",
    ];
    for (const host of DR_NEWS_HOSTS) searchQueries.push(`${req.query} site:${host}`);

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
    const filteredResults = searxResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        return keepResult(host);
      } catch {
        return false;
      }
    });
    const newsPool = searxResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        if (!isDominicanSource(host)) return false;
        const toks = queryTokens(req.query);
        if (toks.length === 0) return true;
        const needed = toks.length <= 2 ? 1 : 2;
        return tokenOverlapLocal(`${r.title} ${r.snippet}`, toks) >= needed;
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
      const toks = queryTokens(req.query);
      if (toks.length === 0) return true;
      const needed = toks.length <= 2 ? 1 : 2;
      return tokenOverlapLocal(`${r.title} ${r.snippet}`, toks) >= needed;
    });

    // SIL legislative records (Cámara + Senado).
    const SIL_MAX = 12;
    const chamberSvc = targetServices.find((s) => s.id === "chamber");
    const chamberLaws = chamberSvc && hasLegislativeCapability(chamberSvc) && isPortalAllowed("Cámara de Diputados")
      ? (await chamberSvc.getLaws(req.query)).slice(0, SIL_MAX)
      : [];
    const senateSvc = targetServices.find((s) => s.id === "senate");
    const senateLaws = senateSvc && hasLegislativeCapability(senateSvc) && isPortalAllowed("Senado de la República")
      ? (await senateSvc.getLaws(req.query)).slice(0, SIL_MAX)
      : [];
    const silLaws: LawRef[] = [...chamberLaws, ...senateLaws];

    const BULLETIN_MAX = 10;
    const senadoBulletins = senateSvc && hasBulletinCapability(senateSvc) && isPortalAllowed("Senado de la República")
      ? (await senateSvc.getBulletins!(req.query)).slice(0, BULLETIN_MAX)
      : [];

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

    const searchQueries: string[] = [req.query, `${req.query} República Dominicana`, `${req.query} gob.do`, `${req.query} sitio oficial`];
    for (const portal of targetPortals) {
      const host = portal.url.replace(/^https?:\/\//, "");
      searchQueries.push(`${req.query} ${host}`);
    }
    const DR_NEWS_HOSTS = [
      "listindiario.com", "diariolibre.com", "hoy.com.do", "elnacional.com.do", "acento.com.do",
      "elcaribe.com.do", "almomento.net", "eldia.com.do",
      "presidencia.gob.do", "camaradediputados.gob.do", "senado.gob.do",
      "tribunalconstitucional.gob.do", "dgcp.gob.do", "consultoria.gov.do", "datos.gob.do",
    ];
    for (const host of DR_NEWS_HOSTS) searchQueries.push(`${req.query} site:${host}`);

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
    const filteredResults = searxResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        return keepResult(host);
      } catch {
        return false;
      }
    });
    const newsPool = searxResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        if (!isDominicanSource(host)) return false;
        const toks = queryTokens(req.query);
        if (toks.length === 0) return true;
        const needed = toks.length <= 2 ? 1 : 2;
        return tokenOverlapLocal(`${r.title} ${r.snippet}`, toks) >= needed;
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
      const toks = queryTokens(req.query);
      if (toks.length === 0) return true;
      const needed = toks.length <= 2 ? 1 : 2;
      return tokenOverlapLocal(`${r.title} ${r.snippet}`, toks) >= needed;
    });

    const SIL_MAX = 12;
    const chamberSvc = targetServices.find((s) => s.id === "chamber");
    const chamberLaws = chamberSvc && hasLegislativeCapability(chamberSvc) && isPortalAllowed("Cámara de Diputados")
      ? (await chamberSvc.getLaws(req.query)).slice(0, SIL_MAX)
      : [];
    const senateSvc = targetServices.find((s) => s.id === "senate");
    const senateLaws = senateSvc && hasLegislativeCapability(senateSvc) && isPortalAllowed("Senado de la República")
      ? (await senateSvc.getLaws(req.query)).slice(0, SIL_MAX)
      : [];
    const silLaws: LawRef[] = [...chamberLaws, ...senateLaws];

    const BULLETIN_MAX = 10;
    const senadoBulletins = senateSvc && hasBulletinCapability(senateSvc) && isPortalAllowed("Senado de la República")
      ? (await senateSvc.getBulletins!(req.query)).slice(0, BULLETIN_MAX)
      : [];

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
      perInstitution,
      searchQueries,
    };

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

function tokenOverlapLocal(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const low = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let n = 0;
  for (const t of tokens) {
    if (t.length >= 4 ? low.includes(t) : low.split(/\s+/).some((w) => w === t || w.startsWith(t))) n++;
  }
  return n;
}
