// Common contract that every institution plugin must implement.
// Institutions are fully isolated modules: business logic, API integration,
// data models, seeds, config, scrapers, transformation and validation all live
// inside each institution's own folder. The app only ever talks to this interface
// via the registry (src/institutions/registry.ts) — never importing a concrete
// institution directly.

export type DocConfidence = "High" | "Medium" | "Low";

/** A single retrieved document / source produced by an institution. */
export interface InstitutionDocument {
  title: string;
  url: string;
  snippet?: string;
  /** Source engine / mechanism that produced it (e.g. "senado-api", "sil-api"). */
  engine?: string;
  /** Publication date if known (YYYY-MM-DD or any parseable string). */
  date?: string;
  /** Topical category this document belongs to. */
  category?: string;
}

/** A normalized search result returned by institution.search(). */
export interface InstitutionResult extends InstitutionDocument {
  /** Human-readable institution name (used for tagging/grounding). */
  institution: string;
}

/** Structured legislative record (laws / iniciativas). */
export interface InstitutionLaw {
  numero: string;
  tipo: string;
  descripcion: string;
  estado?: string;
  url: string;
  /** Optional legislative metadata surfaced by some sources (e.g. SIL). */
  materia?: string;
  fechaDeposito?: string;
  /** Extra SIL metadata (Cámara / Senado). */
  condicion?: string;
  grupo?: string;
  origen?: string;
  legislatura?: string;
  numPromulgacion?: string;
  pdfUrl?: string;
}

export interface InstitutionService {
  /** Stable machine id, e.g. "senate", "chamber". */
  id: string;
  /** Display name, e.g. "Senado de la República". */
  name: string;
  description?: string;
  /** Whether the institution is active when no explicit selection is made. */
  enabledByDefault: boolean;
  /** Base portal URL. */
  url: string;
  /** Called once at boot. Use for warm-up / validation. */
  initialize(): Promise<void>;
  /** Populate any local cache / seed data. */
  seed(): Promise<void>;
  /** Pull latest data from the source. */
  sync(): Promise<void>;
  /** Topical web/news search over this institution's domain. */
  search(query: string): Promise<InstitutionResult[]>;
  /** Return all documents this institution can surface. */
  getDocuments(): Promise<InstitutionDocument[]>;
  /** Liveness check. */
  healthCheck(): Promise<boolean>;
}

/** Extra capabilities some institutions expose (optional). */
export interface LegislativeCapability {
  /** Return structured laws/iniciativas for a keyword (e.g. SIL API). */
  getLaws?(query: string): Promise<InstitutionLaw[]>;
}

export function hasLegislativeCapability(
  svc: InstitutionService
): svc is InstitutionService & LegislativeCapability {
  return typeof (svc as InstitutionService & LegislativeCapability).getLaws === "function";
}

/** Boletín / acta / año-based items from a DSpace-like source. */
export interface BulletinDoc {
  title: string;
  url: string;
  date: string;
  tipo: string; // "Boletín" | "Acta" | "Año" | "Proyecto"
  snippet?: string;
}

/** Institution that can also return bulletins / session records. */
export interface BulletinCapability {
  getBulletins?(query: string): Promise<BulletinDoc[]>;
}

export function hasBulletinCapability(
  svc: InstitutionService
): svc is InstitutionService & BulletinCapability {
  return typeof (svc as InstitutionService & BulletinCapability).getBulletins === "function";
}
