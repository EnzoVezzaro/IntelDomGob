// services/ocr
//
// Single responsibility: turn documents/images into structured text.
//
// Delegates the actual OCR to an OcrProvider (default: Unlimited-OCR). The rest
// of the platform calls this service and never knows which OCR engine runs.
// Implements the exact interface from WORK.md: extractText / extractMarkdown /
// extractTables / extractImages.

import { createLogger } from "@intel.dom.gob/logger";
import type { OcrProvider } from "@intel.dom.gob/providers";

const log = createLogger("service:ocr");

export class OcrService {
  private readonly provider: OcrProvider;
  constructor(provider: OcrProvider) {
    this.provider = provider;
  }

  extractText(file: Buffer | string): Promise<string> {
    return this.provider.extractText(file);
  }
  extractMarkdown(file: Buffer | string): Promise<string> {
    return this.provider.extractMarkdown(file);
  }
  extractTables(file: Buffer | string): Promise<string> {
    return this.provider.extractTables(file);
  }
  extractImages(file: Buffer | string): Promise<string[]> {
    return this.provider.extractImages(file);
  }
}
