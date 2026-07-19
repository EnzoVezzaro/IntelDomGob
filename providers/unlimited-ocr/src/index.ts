// providers/unlimited-ocr
//
// OCR Provider backed by baidu/Unlimited-OCR (or any OpenOCR-compatible HTTP
// endpoint). The rest of the platform never knows which OCR engine runs — it
// only sees the OcrProvider contract (WORK.md "Keep it replaceable").
//
// Configure UNLIMITED_OCR_URL to point at a running Unlimited-OCR instance.

import type { OcrProvider } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { fetchJson } from "@intel.dom.gob/utils";

const log = createLogger("provider:ocr");

export interface UnlimitedOcrOptions {
  /** Base URL of the Unlimited-OCR / OpenOCR HTTP service. */
  baseUrl: string;
  id?: string;
}

export class UnlimitedOcrProvider implements OcrProvider {
  id: string;
  kind = "ocr" as const;
  label = "Unlimited-OCR";
  enabled = true;

  private readonly baseUrl: string;
  constructor(opts: UnlimitedOcrOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.id = opts.id ?? "unlimited-ocr";
  }

  async extractText(file: Buffer | string): Promise<string> {
    return this.call("text", file);
  }
  async extractMarkdown(file: Buffer | string): Promise<string> {
    return this.call("markdown", file);
  }
  async extractTables(file: Buffer | string): Promise<string> {
    return this.call("tables", file);
  }
  async extractImages(file: Buffer | string): Promise<string[]> {
    const data = await fetchJson<{ images?: string[] }>(`${this.baseUrl}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "images", input: typeof file === "string" ? file : "" }),
      timeoutMs: 60000,
    });
    return data.images ?? [];
  }

  private async call(mode: string, file: Buffer | string): Promise<string> {
    const data = await fetchJson<{ text?: string; markdown?: string; tables?: string }>(`${this.baseUrl}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, input: typeof file === "string" ? file : "" }),
      timeoutMs: 60000,
    });
    return data.text || data.markdown || data.tables || "";
  }
}

export function createUnlimitedOcrProvider(opts: UnlimitedOcrOptions): UnlimitedOcrProvider {
  return new UnlimitedOcrProvider(opts);
}
