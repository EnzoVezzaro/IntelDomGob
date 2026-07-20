// AI Service.
//
// Single responsibility: talk to an AI Provider and return text. It owns the
// model-agnostic helpers (truncated-JSON repair, context-grounded chat) but no
// domain/business logic. The Orchestrator drives it.

import type { AiProvider, AiRequest, AiResponse } from "@intel.dom.gob/providers";
import { providerRegistry } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:ai");

export interface AiResolveOptions {
  /** Explicit provider id resolved from the provider registry. */
  provider?: string;
  /** Caller-supplied API key (e.g. Gemini) used to build an ad-hoc provider. */
  apiKey?: string;
  /** Default model when the request does not specify one. */
  defaultModel?: string;
}

/**
 * Resolve the AI provider to use for a given request.
 *
 * Precedence:
 *   1. explicit `provider` id from the registry
 *   2. ad-hoc provider built from an `apiKey` (Gemini)
 *   3. the service's default provider
 *
 * This is the single place that decides which provider handles a request, so
 * no route or orchestrator ever instantiates a provider directly.
 */
export async function resolveAiProvider(opts: AiResolveOptions = {}): Promise<AiProvider> {
  if (opts.provider) {
    const registered = providerRegistry.getAi(opts.provider);
    if (!registered) throw new Error(`AI provider "${opts.provider}" is not registered.`);
    return registered;
  }
  if (opts.apiKey) {
    // Lazy import avoids a hard dependency when this path is unused.
    const { createGeminiProvider } = await import("@intel.dom.gob/provider-gemini");
    return createGeminiProvider({ apiKey: opts.apiKey });
  }
  const fromRegistry = providerRegistry.listAi()[0];
  if (fromRegistry) return fromRegistry;
  throw new Error("No AI provider is available. Configure DEFAULT_AI_API_KEY or register a provider.");
}

export class AiService {
  private readonly defaultProvider: AiProvider;

  constructor(provider: AiProvider) {
    this.defaultProvider = provider;
  }

  get providerId(): string {
    return this.defaultProvider.id;
  }

  /** The service's default provider (used by the Orchestrator for streaming). */
  get provider(): AiProvider {
    return this.defaultProvider;
  }

  /** Human label of the default provider (e.g. "OpenAI", "Google Gemini"). */
  get providerLabel(): string {
    return this.defaultProvider.label;
  }

  /** Default model of the default provider. */
  get defaultModelName(): string {
    return (this.defaultProvider as { defaultModel?: string }).defaultModel ?? "";
  }

  /** Liveness probe the default provider (any OpenAI-compatible model/provider). */
  async health(): Promise<import("@intel.dom.gob/providers").AiProviderHealth | null> {
    if (!this.defaultProvider.health) return null;
    try {
      return await this.defaultProvider.health();
    } catch (e) {
      return { ok: false, model: this.defaultModelName, detail: String((e as Error).message ?? e) };
    }
  }

  /** Resolve the provider for a specific request (apiKey/provider override). */
  async resolveProvider(opts: AiResolveOptions = {}): Promise<AiProvider> {
    if (opts.provider || opts.apiKey) return resolveAiProvider(opts);
    return this.defaultProvider;
  }

  async generate(req: AiRequest): Promise<AiResponse> {
    return this.defaultProvider.generate(req);
  }

  /** Generate a JSON object, repairing truncated output from small models. */
  async generateJson(req: AiRequest): Promise<any> {
    const res = await this.provider.generate({ ...req, jsonMode: true });
    try {
      return JSON.parse(res.text);
    } catch {
      log.warn("AI returned truncated JSON; attempting repair", { tail: res.text.slice(-120) });
      return repairTruncatedJson(res.text);
    }
  }

  /** Context-grounded chat over a previously retrieved result. */
  async chat(opts: {
    systemInstruction: string;
    grounding: string;
    message: string;
    history?: { role: "user" | "assistant"; content: string }[];
    model?: string;
  }): Promise<string> {
    const convo: string[] = [];
    for (const h of opts.history ?? []) {
      convo.push(h.role === "user" ? `Usuario: ${h.content}` : `Asistente: ${h.content}`);
    }
    const fullPrompt = `${convo.join("\n")}
Usuario: ${opts.message}

=== CONTEXTO (AUDIT EVIDENCE PACKET) ===
${opts.grounding}

=== FIN DEL CONTEXTO ===
Asistente:`;

    const res = await this.defaultProvider.generate({
      model: opts.model,
      systemInstruction: opts.systemInstruction,
      messages: [{ role: "user", content: fullPrompt }],
      temperature: 0.3,
      maxOutputTokens: 2048,
    });
    return res.text;
  }

  /**
   * Context-grounded chat assembled from a previously retrieved IntelligenceResult
   * packet. This encapsulates the prompt-assembly logic that previously lived in
   * the API route so it is reusable and testable. Always answers strictly from
   * the provided context.
   */
  async chatFromContext(opts: {
    context: unknown;
    message: string;
    history?: { role: "user" | "assistant"; content: string }[];
    model?: string;
    apiKey?: string;
    provider?: string;
  }): Promise<string> {
    const ctx = typeof opts.context === "string" ? safeParse(opts.context) : opts.context;
    const parts: string[] = [];
    parts.push(`CONSULTA ORIGINAL: ${ctx?.query || ""}`);
    if (ctx?.response?.summary) parts.push(`RESUMEN EJECUTIVO:\n${ctx.response.summary}`);
    if (ctx?.response?.detailedAnalysis) parts.push(`ANÁLISIS DETALLADO:\n${ctx.response.detailedAnalysis}`);
    if (Array.isArray(ctx?.evidence)) parts.push("MATRIZ DE EVIDENCIA:\n" + ctx.evidence.map((e: any, i: number) => `[E${i + 1}] ${e.fact}\n    Fuente: ${e.institution || ""} — ${e.sourceUrl || ""} (${e.confidence || ""})`).join("\n"));
    if (Array.isArray(ctx?.sources?.congress)) parts.push("FUENTES DEL CONGRESO:\n" + ctx.sources.congress.map((s: any, i: number) => `[C${i + 1}] ${s.title} — ${s.url}`).join("\n"));
    if (Array.isArray(ctx?.sources?.news)) parts.push("MEDIOS:\n" + ctx.sources.news.map((s: any, i: number) => `[N${i + 1}] ${s.title} — ${s.url}`).join("\n"));
    if (Array.isArray(ctx?.sources?.laws)) parts.push("LEYES/SIL:\n" + ctx.sources.laws.map((l: any, i: number) => `[L${i + 1}] ${l.numero} · ${l.tipo} (${l.estado || ""}) — ${l.url}`).join("\n"));
    if (Array.isArray(ctx?.response?.citations)) parts.push("CITAS:\n" + ctx.response.citations.map((c: any, i: number) => `[X${i + 1}] ${c.title} — ${c.url}`).join("\n"));
    if (Array.isArray(ctx?.response?.timeline)) parts.push("CRONOLOGÍA:\n" + ctx.response.timeline.map((t: any, i: number) => `[T${i + 1}] ${t.date} — ${t.event}${t.detail ? ": " + t.detail : ""}`).join("\n"));

    const provider = await this.resolveProvider({ apiKey: opts.apiKey, provider: opts.provider });
    return this.chat({
      systemInstruction: `Eres el asistente de conversación de la Plataforma de Inteligencia del Gobierno Dominicano (INTEL.DOM.GOB).
Responde EXCLUSIVAMENTE con base en el CONTEXTO proporcionado. NO inventes leyes, números, fechas o fuentes.
Cita siempre las fuentes del contexto cuando des un dato fáctico. Mantén tono objetivo y profesional. Prioriza fuentes del Congreso Nacional.`,
      grounding: parts.join("\n\n"),
      message: opts.message,
      history: opts.history,
      model: opts.model,
    });
  }

  /** Stream a chat reply token-by-token, falling back to buffered generation. */
  async *streamChat(opts: {
    systemInstruction: string;
    grounding: string;
    message: string;
    history?: { role: "user" | "assistant"; content: string }[];
    model?: string;
    apiKey?: string;
    provider?: string;
  }): AsyncIterable<string> {
    const provider = await this.resolveProvider({ apiKey: opts.apiKey, provider: opts.provider });
    const convo: string[] = [];
    for (const h of opts.history ?? []) {
      convo.push(h.role === "user" ? `Usuario: ${h.content}` : `Asistente: ${h.content}`);
    }
    const fullPrompt = `${convo.join("\n")}
Usuario: ${opts.message}

=== CONTEXTO (AUDIT EVIDENCE PACKET) ===
${opts.grounding}

=== FIN DEL CONTEXTO ===
Asistente:`;

    if (!provider.stream) {
      const res = await provider.generate({
        model: opts.model,
        systemInstruction: opts.systemInstruction,
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.3,
        maxOutputTokens: 8192,
      });
      yield res.text;
      return;
    }
    for await (const token of provider.stream({
      model: opts.model,
      systemInstruction: opts.systemInstruction,
      messages: [{ role: "user", content: fullPrompt }],
      temperature: 0.3,
      maxOutputTokens: 8192,
    })) {
      yield token;
    }
  }
}

/**
 * Best-effort repair of a JSON string that was truncated by the model (ran out
 * of output tokens). Closes any open braces/brackets/strings and parses.
 */
export function repairTruncatedJson(raw: string): any {
  let s = raw.trim();
  s = s.replace(/,\s*$/, "");
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}") stack.pop();
    else if (ch === "]") stack.pop();
  }
  if (inString) s += '"';
  while (stack.length) {
    const open = stack.pop();
    if (open === "{") s += "}";
    else if (open === "[") s += "]";
  }
  try {
    return JSON.parse(s);
  } catch {
    // Last-resort salvage: the model streamed valid JSON up to a truncation
    // point. Pull out any fields we can via regex so the brief is never empty.
    const out: any = {};
    const grab = (key: string): string | undefined => {
      const m = s.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "s"));
      return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : undefined;
    };
    const summary = grab("summary");
    const detailed = grab("detailedAnalysis");
    out.response = {
      summary: summary || detailed?.slice(0, 600) || "",
      detailedAnalysis: detailed || summary || "",
      confidenceLevel: "Low",
      timeline: [],
      citations: [],
    };
    out.evidence = [];
    return out;
  }
}

/** Parse a JSON string without throwing (returns the input if it is not a string). */
function safeParse(input: unknown): any {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}
