// AI Provider: Anthropic Claude.
//
// Drop-in implementation of the platform's AiProvider contract. Registered like
// any other provider — nothing else in the platform changes.

import type { AiProvider, AiRequest, AiResponse } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:anthropic");

export interface AnthropicProviderOptions {
  apiKey?: string;
  id?: string;
  defaultModel?: string;
  baseUrl?: string;
}

export class AnthropicProvider implements AiProvider {
  id: string;
  kind = "ai" as const;
  label = "Anthropic";
  enabled = true;

  private readonly defaultModel: string;
  private apiKey?: string;
  private readonly baseUrl: string;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.apiKey = opts.apiKey;
    this.id = opts.id ?? "anthropic";
    this.defaultModel = opts.defaultModel ?? "claude-3-5-haiku-latest";
    this.baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  }

  async generate(req: AiRequest): Promise<AiResponse> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
    const model = req.model || this.defaultModel;
    const sys = req.systemInstruction;
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    const body: Record<string, unknown> = {
      model,
      system: sys,
      messages,
      max_tokens: req.maxOutputTokens ?? 4096,
      temperature: req.temperature ?? 0.4,
    };
    if (req.jsonMode) body.system = `${sys}\n\nRespond ONLY with valid JSON.`;

    const data = await fetchJson<{ content?: { text?: string }[] }>(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      timeoutMs: 60000,
    });
    return { text: data.content?.map((c) => c.text ?? "").join("") ?? "", model };
  }

  async *stream(req: AiRequest): AsyncIterable<string> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
    const model = req.model || this.defaultModel;
    const messages = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, system: req.systemInstruction, messages, max_tokens: req.maxOutputTokens ?? 4096, temperature: req.temperature ?? 0.4, stream: true }),
    });
    if (!res.body) return;
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
        try {
          const json = JSON.parse(payload);
          if (json.type === "content_block_delta" && json.delta?.text) yield json.delta.text;
        } catch { /* ignore */ }
      }
    }
  }

  /** Liveness probe: a minimal message (Anthropic has no models list). */
  async health(): Promise<import("@intel.dom.gob/providers").AiProviderHealth> {
    if (!this.apiKey) return { ok: false, model: this.defaultModel, detail: "sin API key" };
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: this.defaultModel, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
      });
      if (res.status === 200 || res.status === 429) return { ok: true, model: this.defaultModel, detail: `modelo ${this.defaultModel}` };
      if (res.status === 401) return { ok: false, model: this.defaultModel, detail: "API key inválida" };
      return { ok: false, model: this.defaultModel, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, model: this.defaultModel, detail: String((e as Error).message ?? e) };
    }
  }
}

export function createAnthropicProvider(opts: AnthropicProviderOptions = {}): AnthropicProvider {
  return new AnthropicProvider(opts);
}
