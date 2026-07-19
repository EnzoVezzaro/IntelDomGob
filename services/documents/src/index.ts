// services/documents
//
// Single responsibility: normalize and chunk government documents (PDFs,
// scanned gazettes, HTML) into text units ready for embedding/indexing.
//
// This is the document PREP layer. The actual OCR is delegated to the OCR
// service/provider. No external system is touched here.

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:documents");

export interface DocumentChunk {
  index: number;
  text: string;
  source: string;
  page?: number;
}

export class DocumentsService {
  /** Split raw text into overlapping chunks suitable for embedding. */
  chunk(text: string, source: string, size = 1200, overlap = 200): DocumentChunk[] {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return [];
    const chunks: DocumentChunk[] = [];
    let i = 0;
    let idx = 0;
    while (i < clean.length) {
      const slice = clean.slice(i, i + size);
      chunks.push({ index: idx++, text: slice, source });
      i += Math.max(size - overlap, 1);
    }
    return chunks;
  }

  /** Strip common boilerplate noise from government HTML/text. */
  clean(raw: string): string {
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }
}
