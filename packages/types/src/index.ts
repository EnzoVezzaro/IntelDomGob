// Shared domain types for the INTEL.DOM.GOB platform.
//
// These types are the contract between every layer of the architecture:
//   Clients → API → Orchestrator → Services → Providers → External Systems
//
// They are intentionally framework-agnostic and dependency-free so that any
// package (API, Studio, ClI, SDK, services) can import them without pulling in
// a runtime.

// ---------------------------------------------------------------------------
// Core intelligence result contract (the "Audit Evidence Packet")
// ---------------------------------------------------------------------------

export type Confidence = "High" | "Medium" | "Low";

/** Result of fetching a single web page. Returned by /v1/fetch endpoint. */
export interface FetchedPage {
  url: string;
  title: string;
  /** Cleaned, deduped body text (truncated to maxChars). */
  text: string;
  /** Best-effort published/filed date from meta tags or JSON-LD. */
  publishedDate: string | null;
  /** True when the host is a Dominican Republic government/official domain. */
  dominican: boolean;
}

export interface SourceRef {
  title: string;
  url: string;
  snippet?: string;
  /** Publishing institution, e.g. "Senado de la República". */
  institution?: string;
  source?: string;
  date?: string;
}

export interface LawRef {
  numero: string;
  tipo: string;
  descripcion: string;
  estado?: string;
  url: string;
  materia?: string;
  fechaDeposito?: string;
  pdfUrl?: string;
}

export interface BulletinRef {
  title: string;
  url: string;
  date?: string;
  tipo?: string;
  snippet?: string;
}

export interface PerInstitutionStream {
  [institutionId: string]: SourceRef[];
}

export interface SourceStreams {
  /** FLUJO A — Congreso Nacional + official portals (primary grounding). */
  congress: SourceRef[];
  /** FLUJO B — Tribunal Constitucional decisions / jurisprudence. */
  tribunal: SourceRef[];
  /** FLUJO C — Datos Abiertos datasets. */
  datos: SourceRef[];
  /** FLUJO D — Dominican press / media coverage (quaternary context). */
  news: SourceRef[];
  /** Structured legislative records (SIL API). Backwards-compatible aggregate. */
  laws: LawRef[];
  /** Senado bulletins / actas / year-based documents. Backwards-compatible aggregate. */
  bulletins: BulletinRef[];
  /** One stream per institution plugin. */
  perInstitution?: PerInstitutionStream;
  /** SIL iniciativas legislativas — Senado (HIGHEST PRIORITY). */
  senadoIniciativas: LawRef[];
  /** SIL resoluciones / aprobadas — Senado. */
  senadoResoluciones: LawRef[];
  /** Boletines informativos — Senado. */
  senadoBoletines: BulletinRef[];
  /** Actas de sesiones — Senado. */
  senadoActas: BulletinRef[];
  /** Informes / discursos / rendición de cuentas — Senado. */
  senadoInformes: BulletinRef[];
  /** SIL iniciativas legislativas — Cámara de Diputados (HIGHEST PRIORITY). */
  camaraIniciativas: LawRef[];
  /** Comisiones de la Cámara de Diputados. */
  camaraComisiones: SourceRef[];
  /** Sesiones de la Cámara de Diputados. */
  camaraSesiones: SourceRef[];
  /** Grupos parlamentarios de la Cámara de Diputados. */
  camaraGrupos: SourceRef[];
  /** Per-diputado profiles (Cámara SIL legislador endpoint). */
  diputados: SourceRef[];
}

export interface PlannerResult {
  intent: string;
  institutionsSelected: string[];
  plan: string;
}

/**
 * Retrieval-facing query plan produced by the model-agnostic Query Planner.
 * Drives the SearXNG fan-out with intent-aware, expanded search queries.
 */
export interface QueryPlan {
  intent: string;
  entities: string[];
  dateRange?: { from?: string; to?: string };
  jurisdictions: string[];
  documentTypes: string[];
  searchStrategy: string;
  queries: string[];
}

export interface EvidenceItem {
  fact: string;
  sourceUrl: string;
  institution: string;
  date?: string;
  confidence: Confidence;
}

export interface TimelineEvent {
  date: string;
  event: string;
  detail?: string;
}

export interface IntelligenceResult {
  query: string;
  timestamp: string;
  searchEngine: string;
  sources: SourceStreams;
  planner: PlannerResult;
  institution: { domainsSearched: string[] };
  search: { queriesRun: string[] };
  retrieval: { documentsAnalyzed: string[]; extractedCount: number };
  evidence: EvidenceItem[];
  validation: {
    conflictingStatements: string[];
    duplicateSourcesRemoved: number;
    statusMessage: string;
  };
  refinement: { coherenceScore: number; textLengthReduced: number };
  response: {
    summary: string;
    detailedAnalysis: string;
    timeline: TimelineEvent[];
    confidenceLevel: Confidence;
    citations: SourceRef[];
  };
}

// ---------------------------------------------------------------------------
// Institutions
// ---------------------------------------------------------------------------

export interface InstitutionDocument {
  title: string;
  url: string;
  snippet?: string;
  engine?: string;
  date?: string;
  category?: string;
}

export interface InstitutionResult extends InstitutionDocument {
  institution: string;
}

export interface InstitutionLaw {
  numero: string;
  tipo: string;
  descripcion: string;
  estado?: string;
  url: string;
  materia?: string;
  fechaDeposito?: string;
  condicion?: string;
  grupo?: string;
  origen?: string;
  legislatura?: string;
  numPromulgacion?: string;
  pdfUrl?: string;
}

export interface BulletinDoc {
  title: string;
  url: string;
  date: string;
  tipo: string;
  snippet?: string;
}

export interface InstitutionDescriptor {
  id: string;
  name: string;
  description?: string;
  url: string;
  enabledByDefault: boolean;
  hasLegislative: boolean;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export type ProviderKind = "search" | "ai" | "ocr" | "presentation";

export interface ProviderDescriptor {
  id: string;
  kind: ProviderKind;
  label: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// API / request envelope
// ---------------------------------------------------------------------------

export interface QueryRequest {
  query: string;
  institutions?: string[];
  model?: string;
  /** AI provider id to use (e.g. "gemini", "openai", "ollama"). Defaults to the registered default. */
  provider?: string;
  apiKey?: string;
  /**
   * Intent-based source scope. When omitted the orchestrator auto-detects it
   * from the query ("iniciativa" → sil, "noticias del senado" → senate-news,
   * "diputado" → diputado, …). Explicit values:
   *   all          — full multi-agent retrieval (default)
   *   sil          — only Congress legislative records (Cámara + Senado SIL)
   *   legislativo  — alias for 'sil' (Congress legislative records)
   *   senate       — Senado only (iniciativas + portal news)
   *   camara       — Cámara only (iniciativas + portal news + legisladores)
   *   senate-news  — only Senado press/blog + Senado-filtered web search
   *   camara-news  — only Cámara portal news + Cámara-filtered web search
   *   diputado     — only Cámara legislador profile + authored iniciativas
   */
  scope?: "all" | "sil" | "legislativo" | "legislative_search" | "legislative" | "senate" | "camara" | "senate-news" | "camara-news" | "diputado";
  search?: {
    lang?: string;
    category?: string;
    safe?: boolean;
    timeRange?: string;
    engines?: string;
    maxResults?: number;
  };
  responseLang?: string;
}

export interface ChatRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: string | any;
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  apiKey?: string;
  provider?: string;
  model?: string;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  service: string;
  details?: Record<string, unknown>;
}
