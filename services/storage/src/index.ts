// services/storage
//
// Single responsibility: object/blob storage abstraction for documents, exports
// and attachments. Pluggable backend behind the StorageBackend interface
// (default: local filesystem; swap for S3/GCS later).

import { createLogger } from "@intel.dom.gob/logger";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const log = createLogger("service:storage");

export interface StorageBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class LocalStorageBackend implements StorageBackend {
  constructor(private readonly root: string) {}
  async put(key: string, data: Buffer) {
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, key), data);
  }
  async get(key: string) {
    return readFile(join(this.root, key));
  }
}

export class StorageService {
  private readonly backend: StorageBackend;
  constructor(backend: StorageBackend = new LocalStorageBackend("/data/storage")) {
    this.backend = backend;
  }
  put(key: string, data: Buffer): Promise<void> {
    return this.backend.put(key, data);
  }
  get(key: string): Promise<Buffer> {
    return this.backend.get(key);
  }
}
