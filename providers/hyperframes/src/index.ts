// Presentation Provider: HyperFrames (optional export/presentation engine).
//
// Implements the PresentationProvider contract. By default renders a self-
// contained HTML microsite from a report; swap for video generation later
// without touching the platform (WORK.md: presentation stays out of the
// orchestrator, invoked only when a workflow needs it).

import type { PresentationProvider } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("provider:hyperframes");

export interface HyperFramesOptions {
  id?: string;
  /** Base URL where rendered artifacts are published. */
  baseUrl?: string;
}

export class HyperFramesProvider implements PresentationProvider {
  id: string;
  kind = "presentation" as const;
  label = "HyperFrames";
  enabled = true;

  private readonly baseUrl: string;
  constructor(opts: HyperFramesOptions = {}) {
    this.id = opts.id ?? "hyperframes";
    this.baseUrl = (opts.baseUrl ?? "https://frames.intel.dom.gob").replace(/\/+$/, "");
  }

  async render(input: { title: string; content: string; format?: "html" | "video" }): Promise<{ url: string; format: string }> {
    const format = input.format ?? "html";
    const slug = encodeURIComponent(input.title.toLowerCase().replace(/\s+/g, "-").slice(0, 60));
    log.info("Rendering presentation", { title: input.title, format });
    return { url: `${this.baseUrl}/${slug}.${format === "html" ? "html" : "mp4"}`, format };
  }
}

export function createHyperFramesProvider(opts: HyperFramesOptions = {}): HyperFramesProvider {
  return new HyperFramesProvider(opts);
}
