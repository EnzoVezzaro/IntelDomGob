// apps/cli/src/interpreter.ts
//
// Turns a raw MCP tool result into a human-readable answer for the terminal.
//
// The INTEL.DOM.GOB MCP tools return structured intelligence (the `query`
// tool emits a full IntelligenceResult with summary, detailedAnalysis,
// confidenceLevel and citations). We never dump the raw JSON at the user —
// we render a clean, opencode-style answer. When an OpenAI-compatible model
// is configured (INTEL_LLM_*), we additionally ask it to rewrite the
// structured result into a fluent natural-language brief.

export interface InterpretedAnswer {
  title: string;
  summary: string;
  body: string;
  confidence?: string;
  citations: { title: string; url: string }[];
  sources: number;
}

/** Walk an MCP content block set and pull out the first usable payload. */
function extractPayload(result: any): any {
  if (!result) return null;
  // Already a structured object passed through.
  if (result.type === "result" && result.result) return result.result;
  if (result.result && typeof result.result === "object") return result.result;
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (typeof block?.text === "string") {
        try {
          const parsed = JSON.parse(block.text);
          if (parsed?.type === "result" && parsed.result) return parsed.result;
          if (parsed?.result) return parsed.result;
          if (parsed?.response || parsed?.summary) return parsed;
        } catch {
          // not JSON; keep raw text fallback below
          return { raw: block.text };
        }
      }
    }
  }
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      if (parsed?.result) return parsed.result;
      return parsed;
    } catch {
      return { raw: result };
    }
  }
  return result;
}

/** A field is usable prose if it's a non-trivial, non-JSON string. */
function isProse(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 40) return false; // too short to be a real answer (e.g. "User Safety: safe")
  if (t.startsWith("{") || t.startsWith("[")) return false; // model dumped a JSON blob
  return true;
}

/** Deterministic, dependency-free interpretation of a query/chat result. */
export function interpretResult(result: any): InterpretedAnswer {
  const payload = extractPayload(result);
  const response = payload?.response ?? payload ?? {};

  // The model sometimes returns the raw sources object as summary/detailedAnalysis
  // (malformed JSON). Prefer clean prose; otherwise compose from evidence facts.
  const proseSummary = isProse(response.summary) ? response.summary : isProse(payload?.summary) ? payload.summary : "";
  const proseBody =
    isProse(response.detailedAnalysis)
      ? response.detailedAnalysis
      : isProse(response.analysis)
        ? response.analysis
        : "";

  const evidenceFacts: string[] = [];
  if (Array.isArray(payload?.evidence)) {
    for (const e of payload.evidence) {
      const fact = e?.fact ?? e?.text;
      if (typeof fact === "string" && fact.trim().length > 20) evidenceFacts.push(fact.trim());
    }
  }

  // Build the rendered answer from whatever clean content is available.
  let summary = proseSummary;
  let body = proseBody;
  if (!summary && !body) {
    if (evidenceFacts.length) {
      summary = "Resumen basado en las fuentes recuperadas:";
      body = evidenceFacts.map((f, i) => `${i + 1}. ${f}`).join("\n\n");
    } else {
      summary = "(sin resumen disponible)";
    }
  }
  const confidence: string | undefined = response.confidenceLevel ?? payload?.confidenceLevel;

  const citations: { title: string; url: string }[] = [];
  const pushCitations = (list: any[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      if (c?.url && citations.length < 12) {
        citations.push({ title: c.title || c.url, url: c.url });
      }
    }
  };
  pushCitations(response.citations);
  pushCitations(payload?.citations);
  pushCitations(payload?.evidence);

  const sources = payload?.sources
    ? Object.values(payload.sources).filter(Array.isArray).reduce((n: number, a: any) => n + a.length, 0)
    : citations.length;

  const title = payload?.query ? `Consulta: ${payload.query}` : "Resultado de inteligencia";

  return { title, summary, body, confidence, citations, sources };
}

/**
 * Optional LLM rewrite: send the structured result to an OpenAI-compatible
 * chat endpoint and return a fluent brief. Uses fetch only (no new dep).
 * Returns null if no model is configured or the call fails.
 */
export async function llmRewrite(
  result: any,
  opts: { baseUrl?: string; apiKey?: string; model?: string },
): Promise<string | null> {
  const { baseUrl, apiKey, model } = opts;
  if (!baseUrl || !apiKey || !model) return null;
  const payload = extractPayload(result);
  const system =
    "Eres el asistente de INTEL.DOM.GOB. Recibes un resultado de inteligencia estructurado " +
    "(resumen, análisis detallado, citas). Redacta una respuesta clara y fluida en español para " +
    "un funcionario del Estado Dominicano, en base SOLO a los datos provistos. No inventes fuentes.";
  const user = "Resultado estructurado:\n" + JSON.stringify(payload ?? result, null, 2);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Intel-Client": "cli" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        stream: false,
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    return text?.trim() || null;
  } catch {
    return null;
  }
}
