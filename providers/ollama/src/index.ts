// AI Provider: Ollama (local models).
//
// Runs models locally via the Ollama HTTP API. Registered only when
// OLLAMA_BASE_URL is present. Implements both generate() and stream().

import type { AiProvider, AiRequest, AiResponse } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:ollama");

export interface OllamaProviderOptions {
  baseUrl?: string;
  id?: string;
  defaultModel?: string;
}

export class OllamaAiProvider implements AiProvider {
  id: string;
  kind = "ai" as const;
  label = "Ollama (local)";
  enabled = true;

  private baseUrl: string;
  private defaultModel: string;

  constructor(opts: OllamaProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl || process.env.OLLAMA_BASE_URL || "http://ollama:11434").replace(/\/+$/, "");
    this.defaultModel = opts.defaultModel || process.env.OLLAMA_MODEL || "llama3.1";
  }

  private toPrompt(req: AiRequest): string {
    const sys = req.systemInstruction ? `System: ${req.systemInstruction}\n` : "";
    const chat = req.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    return `${sys}${chat}`;
  }

  async generate(req: AiRequest): Promise<AiResponse> {
    const model = req.model || this.defaultModel;
    const body = {
      model,
      prompt: this.toPrompt(req),
      stream: false,
      options: { temperature: req.temperature ?? 0.4, num_predict: req.maxOutputTokens ?? 8192 },
    };
    try {
      const data = await fetchJson<{ response?: string }>(`${this.baseUrl}/api/generate`, {
        timeoutMs: 60000,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { text: data.response ?? "", model };
    } catch (e) {
      log.warn("Ollama generate failed", { model, error: String(e) });
      throw e;
    }
  }

  async *stream(req: AiRequest): AsyncIterable<string> {
    const model = req.model || this.defaultModel;
    const body = {
      model,
      prompt: this.toPrompt(req),
      stream: true,
      options: { temperature: req.temperature ?? 0.4, num_predict: req.maxOutputTokens ?? 8192 },
    };
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.body) throw new Error("Ollama stream: no response body");
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
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.response) yield json.response as string;
        } catch { /* partial line, skip */ }
      }
    }
  }
}

export function createOllamaProvider(opts: OllamaProviderOptions = {}): OllamaAiProvider {
  return new OllamaAiProvider(opts);
}
