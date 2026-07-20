// AI Provider: DeepSeek.
//
// DeepSeek exposes an OpenAI-compatible chat completions API. Registered only
// when DEEPSEEK_API_KEY is present. Implements generate() and stream().

import type { AiProvider, AiRequest, AiResponse } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:deepseek");

export interface DeepSeekProviderOptions {
  apiKey?: string;
  id?: string;
  defaultModel?: string;
  baseUrl?: string;
}

interface RawChoice {
  message?: { content?: string };
  delta?: { content?: string };
}

export class DeepSeekAiProvider implements AiProvider {
  id: string;
  kind = "ai" as const;
  label = "DeepSeek";
  enabled = true;

  private apiKey?: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(opts: DeepSeekProviderOptions = {}) {
    this.apiKey = opts.apiKey || process.env.DEEPSEEK_API_KEY;
    this.baseUrl = (opts.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
    this.defaultModel = opts.defaultModel || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }

  private toMessages(req: AiRequest) {
    const out: { role: string; content: string }[] = [];
    if (req.systemInstruction) out.push({ role: "system", content: req.systemInstruction });
    for (const m of req.messages) out.push({ role: m.role, content: m.content });
    return out;
  }

  async generate(req: AiRequest): Promise<AiResponse> {
    const key = this.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!key) {
      log.warn("DeepSeek generate skipped: DEEPSEEK_API_KEY not configured");
      throw new Error("DEEPSEEK_API_KEY is not configured.");
    }
    const model = req.model || this.defaultModel;
    const body = {
      model,
      messages: this.toMessages(req),
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxOutputTokens ?? 8192,
      stream: false,
    };
    try {
      const data = await fetchJson<{ choices?: RawChoice[] }>(`${this.baseUrl}/chat/completions`, {
        timeoutMs: 60000,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      return { text: data.choices?.[0]?.message?.content ?? "", model };
    } catch (e) {
      log.warn("DeepSeek generate failed", { model, error: String(e) });
      throw e;
    }
  }

  async *stream(req: AiRequest): AsyncIterable<string> {
    const key = this.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DEEPSEEK_API_KEY is not configured.");
    const model = req.model || this.defaultModel;
    const body = {
      model,
      messages: this.toMessages(req),
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxOutputTokens ?? 8192,
      stream: true,
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.body) throw new Error("DeepSeek stream: no response body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch { /* partial, skip */ }
      }
    }
  }

  /** Liveness probe (OpenAI-compatible): list models (no token cost). */
  async health(): Promise<import("@intel.dom.gob/providers").AiProviderHealth> {
    const key = this.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!key) return { ok: false, model: this.defaultModel, detail: "sin API key" };
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) return { ok: false, model: this.defaultModel, detail: `HTTP ${res.status}` };
      return { ok: true, model: this.defaultModel, detail: `modelo ${this.defaultModel}` };
    } catch (e) {
      return { ok: false, model: this.defaultModel, detail: String((e as Error).message ?? e) };
    }
  }
}

export function createDeepSeekProvider(opts: DeepSeekProviderOptions = {}): DeepSeekAiProvider {
  return new DeepSeekAiProvider(opts);
}
