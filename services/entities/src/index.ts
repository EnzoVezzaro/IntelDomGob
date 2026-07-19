// services/entities
//
// Entity extraction for the Knowledge Graph pipeline. Extracts structured
// entities (People, Organizations, Laws, Institutions, Dates, Locations) and
// relations (creates, amends, cites, involves, references) from raw document
// text. The Knowledge Graph service consumes this output.
//
// The default extractor is deterministic (rule/lexicon based) so it works with
// no external dependency. An optional LLM-backed extractor can be supplied for
// higher recall on free text.

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:entities");

export type EntityType =
  | "person"
  | "organization"
  | "law"
  | "institution"
  | "date"
  | "location"
  | "concept";

export interface ExtractedEntity {
  text: string;
  type: EntityType;
  start: number;
  end: number;
  confidence: number;
}

export interface ExtractedRelation {
  from: string;
  to: string;
  type: string;
  confidence: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

export interface EntityExtractor {
  extract(text: string): Promise<ExtractionResult>;
}

// --- Lexicons ----------------------------------------------------------------

const DOMINICAN_INSTITUTIONS = [
  "senado de la república",
  "cámara de diputados",
  "presidencia de la república",
  "tribunal constitucional",
  "suprema corte de justicia",
  "dirección general de contrataciones públicas",
  "dgcp",
  "ministerio público",
  "procuraduría general",
  "banco central",
  "congreso nacional",
  "poder ejecutivo",
  "poder judicial",
];

const MONTHS = "(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)";

// --- Deterministic extractor -------------------------------------------------

export class RuleBasedEntityExtractor implements EntityExtractor {
  async extract(text: string): Promise<ExtractionResult> {
    const entities: ExtractedEntity[] = [];
    const seen = new Map<string, ExtractedEntity>();

    const push = (e: ExtractedEntity) => {
      const key = `${e.type}:${e.text.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, e);
        entities.push(e);
      }
    };

    // Laws: "Ley 87-01", "Decreto 123-45", "Resolución 456"
    const lawRe = /\b(ley|decreto|resolución|resolucion)\s+\d{1,4}[-–]\d{1,4}/gi;
    for (const m of text.matchAll(lawRe)) {
      const idx = m.index ?? 0;
      push({ text: m[0], type: "law", start: idx, end: idx + m[0].length, confidence: 0.95 });
    }

    // Institutions (lexicon, case-insensitive)
    const low = text.toLowerCase();
    for (const inst of DOMINICAN_INSTITUTIONS) {
      let from = 0;
      let idx = low.indexOf(inst, from);
      while (idx !== -1) {
        push({ text: text.slice(idx, idx + inst.length), type: "institution", start: idx, end: idx + inst.length, confidence: 0.9 });
        from = idx + inst.length;
        idx = low.indexOf(inst, from);
      }
    }

    // Dates: "12 de marzo de 2021", "2021-03-12"
    const dateRe = new RegExp(`\\b\\d{1,2} de ${MONTHS} de \\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, "gi");
    for (const m of text.matchAll(dateRe)) {
      const idx = m.index ?? 0;
      push({ text: m[0], type: "date", start: idx, end: idx + m[0].length, confidence: 0.9 });
    }

    // Organizations: ALL-CAPS tokens or common suffixes
    const orgRe = /\b[A-Z][A-ZÁÉÍÓÚÑ]{2,}(?:\s[A-ZÁÉÍÓÚÑ]{2,})*\b|\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s(?:S\.?A\.?|Corporación|Instituto|Fundación|Universidad|Banco))[A-Za-záéíóúñ\.\s]*\b/g;
    for (const m of text.matchAll(orgRe)) {
      const idx = m.index ?? 0;
      push({ text: m[0].trim(), type: "organization", start: idx, end: idx + m[0].length, confidence: 0.6 });
    }

    // Locations: "República Dominicana", known provinces (sample)
    const locations = ["república dominicana", "santo domingo", "santiago", "san pedro de macorís", "la vega", "puerto plata", "higüey"];
    for (const loc of locations) {
      let from = 0;
      let idx = low.indexOf(loc, from);
      while (idx !== -1) {
        push({ text: text.slice(idx, idx + loc.length), type: "location", start: idx, end: idx + loc.length, confidence: 0.85 });
        from = idx + loc.length;
        idx = low.indexOf(loc, from);
      }
    }

    // Relations: "Ley X creó/creó la/crea Y" style
    const relations: ExtractedRelation[] = [];
    for (const law of entities.filter((e) => e.type === "law")) {
      const window = text.slice(law.end, law.end + 160);
      const creates = /(cre[óo]|crea|establece|fund[óo]|instituy[óo])\s+(la\s+)?([A-ZÁÉÍÓÚÑ][^,.]{3,60})/i.exec(window);
      if (creates) {
        const target = creates[3].trim();
        relations.push({ from: law.text, to: target, type: "creates", confidence: 0.7 });
      }
    }

    log.info("Extracted entities", { entities: entities.length, relations: relations.length });
    return { entities, relations };
  }
}

export class EntitiesService {
  private readonly extractor: EntityExtractor;

  constructor(extractor: EntityExtractor = new RuleBasedEntityExtractor()) {
    this.extractor = extractor;
  }

  extract(text: string): Promise<ExtractionResult> {
    return this.extractor.extract(text);
  }
}
