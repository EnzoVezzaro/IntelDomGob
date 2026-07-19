// Result assembly: turns raw retrieved data + the model's JSON into the final
// IntelligenceResult (the "Audit Evidence Packet"). This is fully deterministic
// post-processing — the model's output is merged with the REAL retrieved data so
// the UI never shows hallucinated or missing sources.

import type { IntelligenceResult, SourceRef, LawRef, BulletinRef, EvidenceItem, InstitutionResult } from "@intel.dom.gob/types";
import {
  isTribunalSource,
  isDatosSource,
  classifyInstitution,
  isCongressStream,
  isOtherOfficial,
  isDominicanSource,
} from "./classify";
import { queryTokens, tokenOverlap, normUrl, dedupeByKey } from "@intel.dom.gob/utils";

export interface RetrievalBundle {
  query: string;
  congressResults: InstitutionResult[];
  otherOfficialResults: InstitutionResult[];
  newsResults: InstitutionResult[];
  silLaws: LawRef[];
  senadoBulletins: BulletinRef[];
  perInstitution: Record<string, InstitutionResult[]>;
  searchQueries: string[];
}

const mapToSource = (r: InstitutionResult): SourceRef => ({
  title: r.title || r.url,
  url: r.url,
  snippet: r.snippet || "",
  institution: r.institution || classifyInstitution(r.url),
  source: r.institution || classifyInstitution(r.url),
});

export function buildResult(modelJson: any, bundle: RetrievalBundle): IntelligenceResult {
  const model = modelJson || {};
  model.planner = model.planner || { intent: bundle.query, institutionsSelected: [], plan: "" };
  model.institution = model.institution || { domainsSearched: [] };
  model.search = model.search || { queriesRun: [] };
  model.retrieval = model.retrieval || { documentsAnalyzed: [], extractedCount: 0 };
  model.evidence = Array.isArray(model.evidence) ? model.evidence : [];
  model.validation = model.validation || { conflictingStatements: [], duplicateSourcesRemoved: 0, statusMessage: "" };
  model.refinement = model.refinement || { coherenceScore: 0, textLengthReduced: 0 };
  model.response = model.response || {};
  model.response.summary = model.response.summary || "No se pudo completar la síntesis (respuesta truncada del modelo). Revise las fuentes en la MATRIZ DE EVIDENCIA.";
  model.response.detailedAnalysis = model.response.detailedAnalysis || "";
  model.response.timeline = Array.isArray(model.response.timeline) ? model.response.timeline : [];
  model.response.confidenceLevel = model.response.confidenceLevel || "Low";
  model.response.citations = Array.isArray(model.response.citations) ? model.response.citations : [];

  // Split congress into tribunal / datos / congress-only.
  const tribunalResults = bundle.congressResults.filter(isTribunalSource);
  const datosResults = bundle.congressResults.filter(isDatosSource);
  const congressOnlyResults = bundle.congressResults.filter((r) => !isTribunalSource(r) && !isDatosSource(r));

  // Build FLUJO streams from the real retrieved data (authoritative).
  const congressStream = dedupeByKey(
    [...congressOnlyResults, ...tribunalResults, ...datosResults].map(mapToSource),
    (s) => normUrl(s.url)
  ).slice(0, 36);

  const newsStream = dedupeByKey(bundle.newsResults.map(mapToSource), (s) => normUrl(s.url)).slice(0, 30);

  const perInstitutionStream: Record<string, SourceRef[]> = {};
  for (const [id, items] of Object.entries(bundle.perInstitution)) {
    perInstitutionStream[id] = dedupeByKey(items.map(mapToSource), (s) => normUrl(s.url));
  }

  const sources = {
    congress: congressStream.filter((r) => !isTribunalSource(r) && !isDatosSource(r)),
    tribunal: congressStream.filter(isTribunalSource),
    datos: congressStream.filter(isDatosSource),
    news: newsStream,
    laws: bundle.silLaws,
    bulletins: bundle.senadoBulletins,
    perInstitution: perInstitutionStream,
  };

  // Citations from real retrieved sources (priority: congress/official > news).
  const citations: SourceRef[] = [];
  const citationSeen = new Set<string>();
  const pushCitation = (c: SourceRef) => {
    const k = normUrl(c.url);
    if (!k || citationSeen.has(k)) return;
    citationSeen.add(k);
    citations.push(c);
  };
  [...bundle.congressResults, ...bundle.newsResults].map(mapToSource).forEach(pushCitation);
  bundle.silLaws.forEach((l) =>
    pushCitation({
      title: `${l.numero} · ${l.tipo}${l.estado ? " (" + l.estado + ")" : ""}`,
      url: l.url,
      snippet: l.descripcion,
      institution: `${l.url.includes("senado") ? "Senado de la República" : "Cámara de Diputados"} (SIL)`,
      date: l.fechaDeposito || "",
    })
  );
  bundle.senadoBulletins.forEach((b) =>
    pushCitation({
      title: b.title,
      url: b.url,
      snippet: b.snippet || "",
      institution: "Senado de la República (DSpace)",
      date: b.date || "",
    })
  );
  // Merge model citations that are not already present.
  for (const c of model.response.citations as SourceRef[]) pushCitation(c);

  // Evidence assembly — deterministic, prioritized by Congress > Tribunal >
  // Datos > News.
  const evidence: EvidenceItem[] = [];
  const evSeen = new Set<string>();
  const pushEvidence = (e: EvidenceItem) => {
    const k = normUrl(e.sourceUrl);
    if (!k || evSeen.has(k)) return;
    evSeen.add(k);
    evidence.push(e);
  };

  for (const l of bundle.silLaws) {
    pushEvidence({
      fact: `${l.numero} · ${l.tipo}${l.estado ? " — Estado: " + l.estado : ""}: ${l.descripcion}`,
      sourceUrl: l.url,
      institution: `${l.url.includes("senado") ? "Senado de la República" : "Cámara de Diputados"} (SIL)`,
      date: l.fechaDeposito || "",
      confidence: "High",
    });
  }
  for (const r of congressStream) {
    pushEvidence({
      fact: `${r.title}${r.snippet ? " — " + r.snippet.slice(0, 200) : ""}`,
      sourceUrl: r.url,
      institution: r.institution || classifyInstitution(r.url),
      date: r.snippet && /\d{4}-\d{2}-\d{2}/.test(r.snippet) ? r.snippet.match(/\d{4}-\d{2}-\d{2}/)![0] : "",
      confidence: isTribunalSource(r) ? "High" : "High",
    });
  }
  for (const r of newsStream) {
    pushEvidence({
      fact: `${r.title}${r.snippet ? " — " + r.snippet.slice(0, 200) : ""}`,
      sourceUrl: r.url,
      institution: r.institution || classifyInstitution(r.url),
      date: "",
      confidence: "Medium",
    });
  }

  // Merge model evidence (if it carries new source URLs).
  for (const ev of model.evidence as EvidenceItem[]) pushEvidence(ev);

  const timeline = buildTimeline(bundle, model.response.timeline);

  const realDocs = [
    ...congressStream.map((r) => r.title || r.url),
    ...newsStream.map((r) => r.title || r.url),
    ...bundle.silLaws.map((l) => `${l.numero} · ${l.tipo}`),
  ];

  return {
    query: bundle.query,
    timestamp: new Date().toISOString(),
    searchEngine: "searxng",
    sources,
    planner: model.planner,
    institution: model.institution,
    search: {
      queriesRun: Array.from(new Set([...(model.search.queriesRun || []), ...bundle.searchQueries])),
    },
    retrieval: {
      documentsAnalyzed: realDocs,
      extractedCount: congressStream.length + newsStream.length + bundle.silLaws.length + bundle.senadoBulletins.length,
    },
    evidence,
    validation: model.validation,
    refinement: model.refinement,
    response: {
      summary: model.response.summary,
      detailedAnalysis: model.response.detailedAnalysis,
      timeline,
      confidenceLevel: model.response.confidenceLevel,
      citations,
    },
  };
}

function normDate(d: string): string {
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const parsed = new Date(d);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function buildTimeline(bundle: RetrievalBundle, modelTimeline: any[]): IntelligenceResult["response"]["timeline"] {
  const seen = new Set<string>();
  const events: { date: string; sortKey: string; event: string; detail: string }[] = [];
  const push = (date: string, event: string, detail: string) => {
    const key = `${date}::${event}`;
    if (seen.has(key) || !date) return;
    seen.add(key);
    events.push({ date, sortKey: date, event, detail });
  };

  const validNumero = /^\d{3,5}[-–]\d{4}|^\d{4,6}$/;
  for (const l of bundle.silLaws) {
    const d = normDate(l.fechaDeposito || "");
    if (!d || !l.numero || !validNumero.test(l.numero)) continue;
    const silHost = l.url.includes("senado") ? "Senado" : "Cámara";
    push(d, `${l.numero} · ${l.tipo}${l.estado ? " (" + l.estado + ")" : ""}`, `${silHost}: ${l.descripcion.slice(0, 160)}`);
  }

  const legislativeRe = /\bley(es|\b)|proyecto|\bc[oó]digo|\breforma|\bart[ií]culo|\bdecreto|\bresoluci[oó]n|\bdiputad|\bcongres|\bsil\b|\biniciativa|\bcomisi[oó]n\s+bicameral|\bcomisi[oó]n\s+especial|\baprueba|\bderoga|\bsanciona|\bvet[oa]/i;
  for (const r of bundle.congressResults) {
    const fullText = `${r.title || ""} ${r.snippet || ""}`;
    if (!legislativeRe.test(fullText)) continue;
    const dm = fullText.match(/(\d{4}-\d{2}-\d{2})/);
    const d = normDate(dm ? dm[1] : "");
    if (!d) continue;
    push(d, `${r.institution || classifyInstitution(r.url)}: ${r.title}`, r.snippet || "");
  }

  for (const b of bundle.senadoBulletins) {
    const d = normDate(b.date || "");
    if (!d) continue;
    push(d, `Boletín/Acta: ${b.title.slice(0, 120)}`, b.snippet || b.tipo || "");
  }

  const qTokens = bundle.query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter((t) => t.length > 3);
  for (const r of bundle.newsResults) {
    const fullText = `${r.title || ""} ${r.snippet || ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const matchCount = qTokens.filter((t) => fullText.includes(t)).length;
    if (matchCount < 2) continue;
    const dm = fullText.match(/(\d{4}-\d{2}-\d{2})/);
    const d = normDate(dm ? dm[1] : "");
    if (!d) continue;
    push(d, `Noticia: ${r.title.slice(0, 120)}`, r.snippet || "");
  }

  return events
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .slice(0, 30)
    .map(({ date, event, detail }) => ({ date, event, detail }));
}

// Re-export helpers used by the orchestrator flow.
export { isCongressStream, isOtherOfficial, isDominicanSource, queryTokens, tokenOverlap };
