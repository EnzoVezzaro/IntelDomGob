export enum Institution {
  CHAMBER_OF_DEPUTIES = "Cámara de Diputados",
  SENATE = "Senado de la República",
  PRESIDENCY = "Presidencia de la República",
  CONSULTORIA_JURIDICA = "Consultoría Jurídica del Poder Ejecutivo",
  OFFICIAL_GAZETTE = "Gaceta Oficial",
  CONSTITUTIONAL_COURT = "Tribunal Constitucional",
  SUPREME_COURT = "Suprema Corte de Justicia",
  ATTORNEY_GENERAL = "Procuraduría General de la República",
  DGCP = "Dirección General de Contrataciones Públicas (DGCP)",
  DATOS_GOB = "datos.gob.do",
  DIGEIG = "DIGEIG (Ética e Integridad Gubernamental)",
  BUDGET = "Dirección General de Presupuesto",
}

export interface AgentStage {
  name: string;
  label: string;
  status: "idle" | "running" | "completed" | "failed";
  description: string;
}

export interface Source {
  title: string;
  url: string;
  snippet?: string;
  institution?: string;
  date?: string;
}

export interface TimelineEvent {
  date: string;
  event: string;
  detail?: string;
}

export interface Evidence {
  fact: string;
  sourceUrl: string;
  institution: string;
  date?: string;
  confidence: "High" | "Medium" | "Low";
}

export interface SourceStreamItem {
  title: string;
  url: string;
  snippet?: string;
  institution?: string;
  source?: string;
}

export interface LawItem {
  numero: string;
  tipo: string;
  descripcion: string;
  estado?: string;
  url: string;
  materia?: string;
  fechaDeposito?: string;
  pdfUrl?: string;
}

export interface BulletinItem {
  title: string;
  url: string;
  date?: string;
  tipo?: string;
  snippet?: string;
}

export interface SourceStreams {
  congress: SourceStreamItem[];
  tribunal: SourceStreamItem[];
  datos: SourceStreamItem[];
  news: SourceStreamItem[];
  laws: LawItem[];
  bulletins: BulletinItem[];
  /** One stream per institution plugin (each service shows in its own FLUJO). */
  perInstitution?: Record<string, SourceStreamItem[]>;
}

export interface SearchResult {
  query: string;
  timestamp: string;
  sources?: SourceStreams;
  planner: {
    intent: string;
    institutionsSelected: string[];
    plan: string;
  };
  institution: {
    domainsSearched: string[];
  };
  search: {
    queriesRun: string[];
  };
  retrieval: {
    documentsAnalyzed: string[];
    extractedCount: number;
  };
  evidence: Evidence[];
  validation: {
    conflictingStatements: string[];
    duplicateSourcesRemoved: number;
    statusMessage: string;
  };
  refinement: {
    coherenceScore: number;
    textLengthReduced: number;
  };
  response: {
    summary: string;
    detailedAnalysis: string;
    timeline: TimelineEvent[];
    confidenceLevel: "High" | "Medium" | "Low";
    citations: Source[];
  };
}

export interface SavedTopic {
  id: string;
  title: string;
  keywords: string[];
  lastChecked: string;
  institutionFilter?: string[];
  status?: string;
  alertsCount?: number;
  lastResult?: any;
}
