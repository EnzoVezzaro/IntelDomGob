// Prompt construction + response schema for the multi-agent intelligence query.
// Kept separate from the orchestration flow so prompts are easy to tune.

export const LANG_NAMES: Record<string, string> = {
  es: "Spanish",
  en: "English",
  fr: "French",
  pt: "Portuguese",
  it: "Italian",
  de: "German",
};

export function buildSystemInstruction(lang: string): string {
  const langName = LANG_NAMES[lang] || "Spanish";
  return `You are the lead intelligence architect for the Dominican Republic Government Intelligence Platform.
Your purpose is to run a query-driven multi-agent retrieval and reasoning loop to answer questions about legislation, decrees, budgets, legal rulings, and procurement.

You must simulate the following internal agents step-by-step in your reasoning, then output a JSON response matching the schema:
1. **Planner Agent**: Understand the user's intent and decompose the request. Determine which official Dominican Republic institutions are relevant. Formulate targeted query strategies.
2. **Institution Agent**: Limit searches only to relevant official domains (e.g., presidencia.gob.do, camaradediputados.gob.do, senado.gob.do, tribunalconstitucional.gob.do, dgcp.gob.do, datos.gob.do).
3. **Search Agent**: Formulate exact search queries to retrieve relevant documents, laws, or news.
4. **Retrieval Agent**: Analyze search results to extract clean readable details of official documents (HTML/PDF content).
5. **Evidence Agent**: Pull specific facts, dates, citations, articles, names, or decrees.
6. **Validation Agent**: Check for conflicting claims, duplicates, or outdated laws. Rank hierarchy: Constitutional Court rulings > Congressional Laws > Presidential Decrees > Ministerial Resolutions.
7. **Refinement Agent**: Synthesize evidence, remove fluff, and merge duplicates into a high-density intelligence brief.
8. **Response Agent**: Construct an executive summary, structured details, timeline of events, verified citations, and set a confidence score based on evidence completeness.

 IMPORTANT RULES:
- Never make up sources, document numbers, or dates.
- If no information is found on official sources, reflect this honestly and keep confidence low.
- Focus strictly on the Dominican Republic government context.
- Keep the tone objective, clinical, analytical, and professional.
- PRIMACÍA DEL CONGRESO NACIONAL (REGLA OBLIGATORIA): El enfoque analítico PRIMARIO de TODA la respuesta debe ser lo que está haciendo el CONGRESO NACIONAL — tanto el SENADO (senadores) como la CÁMARA DE DIPUTADOS (diputados): proyectos de ley, iniciativas, comisiones, sesiones, debates, vistas públicas y dictámenes. El enfoque SECUNDARIO es la PRESIDENCIA (decretos, políticas públicas) y, en orden de prioridad descendente, el Tribunal Constitucional, la DGCP y datos.gob.do. Cada sección (resumen ejecutivo, análisis detallado, cronología, matriz de evidencia y validación) DEBE liderar con la actividad del Congreso; la Presidencia y demás instituciones se tratan solo como complemento o contexto. Las leyes/iniciativas devueltas vía la API del SIL de la Cámara de Diputados son fuentes primarias autorizadas y DEBEN aparecer en la MATRIZ DE EVIDENCIA.
- Write the ENTIRE response (summary, detailed analysis, timeline events, validation notes, and any prose) in the following language: ${langName}. Do not translate official institution names or legal document titles, but all explanatory text must be in ${langName}.
- The "detailedAnalysis" field MUST be a COMPREHENSIVE, in-depth analytical report (at least 600 words), not a short summary. Structure it with clear Markdown sections and subheadings covering: (a) Contexto y Marco Normativo; (b) Análisis del Congreso Nacional (Senado y Cámara de Diputados, with specific bill/iniciativa numbers and statuses); (c) Poder Ejecutivo y demás instituciones; (d) Implicaciones Jurídicas y Políticas; (e) Brechas, Riesgos y Recomendaciones. Cite concrete numbers, dates, articles and source institutions throughout. Do NOT truncate or summarize the analysis into a few lines — expand each section with the available evidence.`;
}

export function buildUserPrompt(query: string, institutionContext: string): string {
  return `User Query: "${query}"
${institutionContext}
Conduct the full multi-agent search and reasoning process. Output the results strictly in JSON format. Provide the absolute maximum amount of accurate Dominican Republic legal, government, or policy details you can find.`;
}

/** Build the response JSON schema (ported from the original server). */
export function buildResponseSchema(): any {
  return {
    type: "OBJECT",
    properties: {
      sources: {
        type: "OBJECT",
        properties: {
          congress: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                url: { type: "STRING" },
                snippet: { type: "STRING" },
                institution: { type: "STRING" },
              },
              required: ["title", "url"],
            },
            description: "FLUJO A: official sources from the Congreso Nacional and government portals.",
          },
          news: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                url: { type: "STRING" },
                snippet: { type: "STRING" },
                source: { type: "STRING" },
              },
              required: ["title", "url"],
            },
            description: "FLUJO D: press / media coverage about the topic (quaternary context).",
          },
          laws: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                numero: { type: "STRING" },
                tipo: { type: "STRING" },
                descripcion: { type: "STRING" },
                estado: { type: "STRING" },
                url: { type: "STRING" },
              },
              required: ["numero", "url"],
            },
            description: "Laws / iniciativas from the Diputados SIL API (primary congressional activity).",
          },
          bulletins: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                url: { type: "STRING" },
                date: { type: "STRING" },
                tipo: { type: "STRING" },
                snippet: { type: "STRING" },
              },
              required: ["title", "url"],
            },
            description: "Boletines, actas and year-based legislative documents from the Senado DSpace (FLUJO E).",
          },
        },
        required: ["congress", "news", "laws", "bulletins"],
      },
      planner: {
        type: "OBJECT",
        properties: {
          intent: { type: "STRING" },
          institutionsSelected: { type: "ARRAY", items: { type: "STRING" } },
          plan: { type: "STRING" },
        },
        required: ["intent", "institutionsSelected", "plan"],
      },
      institution: {
        type: "OBJECT",
        properties: { domainsSearched: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["domainsSearched"],
      },
      search: {
        type: "OBJECT",
        properties: { queriesRun: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["queriesRun"],
      },
      retrieval: {
        type: "OBJECT",
        properties: {
          documentsAnalyzed: { type: "ARRAY", items: { type: "STRING" } },
          extractedCount: { type: "INTEGER" },
        },
        required: ["documentsAnalyzed", "extractedCount"],
      },
      evidence: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            fact: { type: "STRING" },
            sourceUrl: { type: "STRING" },
            institution: { type: "STRING" },
            date: { type: "STRING" },
            confidence: { type: "STRING", enum: ["High", "Medium", "Low"] },
          },
          required: ["fact", "sourceUrl", "institution", "confidence"],
        },
        description: "List of structured evidence chunks retrieved.",
      },
      validation: {
        type: "OBJECT",
        properties: {
          conflictingStatements: { type: "ARRAY", items: { type: "STRING" } },
          duplicateSourcesRemoved: { type: "INTEGER" },
          statusMessage: { type: "STRING" },
        },
        required: ["conflictingStatements", "duplicateSourcesRemoved", "statusMessage"],
      },
      refinement: {
        type: "OBJECT",
        properties: {
          coherenceScore: { type: "INTEGER" },
          textLengthReduced: { type: "INTEGER" },
        },
        required: ["coherenceScore", "textLengthReduced"],
      },
      response: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          detailedAnalysis: { type: "STRING" },
          timeline: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                date: { type: "STRING" },
                event: { type: "STRING" },
                detail: { type: "STRING" },
              },
              required: ["date", "event"],
            },
          },
          confidenceLevel: { type: "STRING", enum: ["High", "Medium", "Low"] },
          citations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                url: { type: "STRING" },
                snippet: { type: "STRING" },
                institution: { type: "STRING" },
                date: { type: "STRING" },
              },
              required: ["title", "url"],
            },
          },
        },
        required: ["summary", "detailedAnalysis", "timeline", "confidenceLevel", "citations"],
      },
    },
    required: ["sources", "planner", "institution", "search", "retrieval", "evidence", "validation", "refinement", "response"],
  };
}
