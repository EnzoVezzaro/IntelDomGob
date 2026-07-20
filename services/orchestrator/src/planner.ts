import type { AiService } from "@intel.dom.gob/service-ai";
import type { PlatformConfig } from "@intel.dom.gob/config";
import { createLogger } from "@intel.dom.gob/logger";
import type { QueryPlan } from "@intel.dom.gob/types";

const log = createLogger("orchestrator:query-planner");

const PLANNER_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING" },
    entities: { type: "ARRAY", items: { type: "STRING" } },
    dateRange: {
      type: "OBJECT",
      properties: { from: { type: "STRING" }, to: { type: "STRING" } },
    },
    jurisdictions: { type: "ARRAY", items: { type: "STRING" } },
    documentTypes: { type: "ARRAY", items: { type: "STRING" } },
    searchStrategy: { type: "STRING" },
    queries: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["intent", "entities", "jurisdictions", "documentTypes", "searchStrategy", "queries"],
} as const;

const SYSTEM = `Eres el PLANIFICADOR DE CONSULTAS de INTEL.DOM.GOB, una plataforma de inteligencia sobre el Gobierno de la República Dominicana.
Tu única tarea es convertir la pregunta del usuario en un plan de búsqueda estructurado para recuperar fuentes oficiales (Congreso Nacional, Poder Ejecutivo, Tribunales, datos abiertos) y medios dominicanos.

Reglas:
- "jurisdictions" casi siempre incluye "República Dominicana".
- "documentTypes" usa términos como: ley, código, decreto, resolución, sentencia, acta, boletín, informe, estadística.
- "queries" debe contener 4-8 consultas cortas y diversas (2-5 palabras), mezclando: términos puros, "X República Dominicana", "X gob.do", y "X site:senado.gob.do" cuando aplique.
- No inventes fechas. Si no hay fecha, omite dateRange.
- Responde SOLO con JSON que cumpla el esquema.`;

/**
 * Model-agnostic Query Planner.
 *
 * Produces a structured {@link QueryPlan} (intent, entities, dates, jurisdictions,
 * document types, and expanded search queries) from a raw user question. The model
 * and provider are resolved entirely from configuration (`.env` `DEFAULT_AI_MODEL` /
 * `DEFAULT_AI_PROVIDER`), never hardcoded — so swapping to a local Ollama/Qwen or
 * DeepSeek model requires no code change.
 *
 * Designed to fail soft: callers fall back to deterministic concept extraction when
 * no model is configured or the call fails.
 */
export class QueryPlanner {
  constructor(
    private readonly ai: AiService,
    private readonly config: PlatformConfig,
  ) {}

  async plan(rawQuery: string, lang: string): Promise<QueryPlan | null> {
    const model = this.config.defaultAiModel;
    const provider = this.config.defaultAiProvider;
    if (!model && !provider) return null;
    try {
      const res = await this.ai.generateJson({
        model,
        systemInstruction: SYSTEM,
        responseSchema: PLANNER_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 1024,
        messages: [
          {
            role: "user",
            content: `Pregunta del usuario (${lang}): "${rawQuery}"\n\nGenera el plan de búsqueda.`,
          },
        ],
      });
      if (!res || !Array.isArray(res.queries) || res.queries.length === 0) return null;
      return {
        intent: String(res.intent || rawQuery),
        entities: Array.isArray(res.entities) ? res.entities.map(String) : [],
        dateRange: res.dateRange ? res.dateRange : undefined,
        jurisdictions: Array.isArray(res.jurisdictions) ? res.jurisdictions.map(String) : ["República Dominicana"],
        documentTypes: Array.isArray(res.documentTypes) ? res.documentTypes.map(String) : [],
        searchStrategy: String(res.searchStrategy || ""),
        queries: dedupeQueries(res.queries.map(String).filter(Boolean)),
      };
    } catch (err) {
      log.warn("Query Planner failed; falling back to deterministic extraction", {
        error: (err as Error).message,
      });
      return null;
    }
  }
}

function dedupeQueries(qs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of qs) {
    const k = q.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(q.trim());
    }
  }
  return out;
}
