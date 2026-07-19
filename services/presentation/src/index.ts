// services/presentation
//
// Single responsibility: turn an intelligence summary into a shareable
// presentation artifact. Delegates rendering to a PresentationProvider
// (e.g. HyperFrames). Optional plugin invoked by the orchestrator when a
// workflow requires it (WORK.md: keep presentation out of the orchestrator).

import { createLogger } from "@intel.dom.gob/logger";
import type { PresentationProvider } from "@intel.dom.gob/providers";
import type { IntelligenceResult } from "@intel.dom.gob/types";

const log = createLogger("service:presentation");

export class PresentationService {
  private readonly provider: PresentationProvider;
  constructor(provider: PresentationProvider) {
    this.provider = provider;
  }

  /** Build a shareable microsite/video brief from an IntelligenceResult. */
  async present(result: IntelligenceResult): Promise<{ url: string; format: string }> {
    const content = [
      `# ${result.query}`,
      result.response.summary,
      result.response.detailedAnalysis,
      "## Fuentes",
      ...result.response.citations.map((c) => `- [${c.title}](${c.url})`),
    ].join("\n\n");
    return this.provider.render({ title: result.query, content });
  }
}
