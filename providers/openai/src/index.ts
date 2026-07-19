// AI Provider: OpenAI.
//
// Drop-in implementation of the platform's AiProvider contract. Adding this
// required ONLY this file + registration in apps/api/src/index.ts — no other
// code changed (WORK.md "add a provider, nothing else changes").

import type { AiProvider, AiRequest, AiResponse } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:openai");

export interface OpenAiProviderOptions {
  apiKey?: string;
  id?: string;
  defaultModel?: string;
  baseUrl?: string;
}

export class OpenAiProvider implements AiProvider {
  id: string;
  kind = "ai" as const;
  label = "OpenAI";
  enabled = true;

  private readonly defaultModel: string;
  private apiKey?: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAiProviderOptions = {}) {
    this.apiKey = opts.apiKey;
    this.id = opts.id ?? "openai";
    this.defaultModel = opts.defaultModel ?? "gpt-4o-mini";
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  }

  async generate(req: AiRequest): Promise<AiResponse> {
    const apiKey = req.model ? this.apiKey : this.apiKey;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
    const model = req.model || this.defaultModel;
    const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
    const body: Record<string, unknown> = { model, messages, temperature: req.temperature ?? 0.4, max_tokens: req.maxOutputTokens ?? 4096 };
    if (req.jsonMode) body.response_format = { type: "json_object" };

    const data = await fetchJson<{ choices?: { message: { content: string } }[] }>(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      timeoutMs: 60000,
    });
    return { text: data.choices?.[0]?.message?.content ?? "", model };
  }

  async *stream(req: AiRequest): AsyncIterable<string> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
    const model = req.model || this.defaultModel;
    const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: req.temperature ?? 0.4, max_tokens: req.maxOutputTokens ?? 4096, stream: true }),
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
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const token = json.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch { /* ignore keep-alive lines */ }
      }
    }
  }
}

export function createOpenAiProvider(opts: OpenAiProviderOptions = {}): OpenAiProvider {
  return new OpenAiProvider(opts);
}
