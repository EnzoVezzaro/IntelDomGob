// services/memory
//
// Single responsibility: structured, queryable memory of the codebase &
// architecture (the "codebase-memory-mcp" idea from WORK.md).
//
// Keeps facts as typed records and answers "what/where/how" questions about the
// repository. Optional but first-class: the orchestrator can consult it when a
// workflow needs repo context. It never talks to an external memory server
// directly — plug a backing store via the MemoryStore interface.

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:memory");

export interface MemoryFact {
  id: string;
  category: "architecture" | "service" | "provider" | "convention" | "decision";
  subject: string;
  detail: string;
  source?: string;
}

export interface MemoryStore {
  all(): Promise<MemoryFact[]>;
  add(fact: MemoryFact): Promise<void>;
}

/** In-memory store (seed with facts at boot; swap for a DB-backed store later). */
export class InMemoryStore implements MemoryStore {
  private facts: MemoryFact[] = [];
  async all() {
    return this.facts;
  }
  async add(fact: MemoryFact) {
    if (!this.facts.find((f) => f.id === fact.id)) this.facts.push(fact);
  }
}

export class MemoryService {
  private readonly store: MemoryStore;
  constructor(store: MemoryStore = new InMemoryStore()) {
    this.store = store;
  }

  async remember(fact: MemoryFact): Promise<void> {
    await this.store.add(fact);
  }

  async query(text: string): Promise<MemoryFact[]> {
    const q = text.toLowerCase();
    const facts = await this.store.all();
    return facts.filter((f) => (f.subject + " " + f.detail).toLowerCase().includes(q));
  }

  async snapshot(): Promise<MemoryFact[]> {
    return this.store.all();
  }
}
