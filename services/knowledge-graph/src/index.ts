// services/knowledge-graph
//
// Proposed differentiator: a Knowledge Graph over the intelligence produced by
// the platform. Entities (laws, institutions, people, events) and relations
// (references, cites, amends, involves) are extracted from IntelligenceResult
// packets and stored in a provider-independent graph store.
//
// It NEVER talks to an external system — the backing store is pluggable via
// the GraphStore interface (InMemoryGraphStore by default; swap for a DB/Graph
// DB later). The orchestrator can consult it to enrich future queries.

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:knowledge-graph");

export interface Entity {
  id: string;
  label: string;
  type: "law" | "institution" | "person" | "event" | "concept" | "document";
  sourceUrl?: string;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  type: string; // e.g. "cites", "amends", "involves", "references", "related_to"
  weight?: number;
}

export interface GraphNode {
  entity: Entity;
  degree: number;
}

export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

export interface GraphStore {
  all(): Promise<KnowledgeGraph>;
  merge(graph: KnowledgeGraph): Promise<void>;
  neighbors(entityId: string): Promise<GraphNode[]>;
  clear(): Promise<void>;
}

function uid(prefix: string, key: string): string {
  const norm = key.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 48);
  return `${prefix}:${norm}`;
}

/** In-memory graph store. Deterministic merge (dedupe by id). */
export class InMemoryGraphStore implements GraphStore {
  private entities = new Map<string, Entity>();
  private relations = new Map<string, Relation>();

  async all(): Promise<KnowledgeGraph> {
    return { entities: [...this.entities.values()], relations: [...this.relations.values()] };
  }

  async merge(graph: KnowledgeGraph): Promise<void> {
    for (const e of graph.entities) this.entities.set(e.id, e);
    for (const r of graph.relations) this.relations.set(r.id, r);
  }

  async neighbors(entityId: string): Promise<GraphNode[]> {
    const related = [...this.relations.values()].filter((r) => r.from === entityId || r.to === entityId);
    const ids = new Set<string>();
    for (const r of related) {
      ids.add(r.from === entityId ? r.to : r.from);
    }
    return [...ids].map((id) => ({
      entity: this.entities.get(id) as Entity,
      degree: [...this.relations.values()].filter((r) => r.from === id || r.to === id).length,
    })).filter((n) => n.entity);
  }

  async clear(): Promise<void> {
    this.entities.clear();
    this.relations.clear();
  }
}

export class KnowledgeGraphService {
  private readonly store: GraphStore;

  constructor(store: GraphStore = new InMemoryGraphStore()) {
    this.store = store;
  }

  get storeRef(): GraphStore {
    return this.store;
  }

  /**
   * Extract a KnowledgeGraph from an IntelligenceResult packet. Entities come
   * from citations, SIL laws, evidence items and per-institution sources;
   * relations are derived from co-occurrence in the same result.
   */
  extractFromResult(result: any): KnowledgeGraph {
    const entities: Entity[] = [];
    const seen = new Set<string>();
    const addEntity = (label: string, type: Entity["type"], sourceUrl?: string) => {
      const id = uid(type, label + (sourceUrl || ""));
      if (seen.has(id)) return;
      seen.add(id);
      entities.push({ id, label, type, sourceUrl });
    };

    // Institutions + documents from citations.
    const citations = result?.response?.citations || [];
    for (const c of citations) {
      if (c.institution) addEntity(c.institution, "institution", c.url);
      if (c.title) addEntity(c.title, "document", c.url);
    }
    // Laws from the SIL stream.
    const laws = result?.sources?.laws || [];
    for (const l of laws) {
      addEntity(`${l.numero || l.tipo || "Ley"}`, "law", l.url);
      if (l.materia) addEntity(l.materia, "concept");
    }
    // Evidence items as facts/events.
    const evidence = result?.evidence || [];
    for (const e of evidence) {
      if (e.institution) addEntity(e.institution, "institution");
      if (e.fact) addEntity(e.fact.slice(0, 80), "event");
    }

    // Relations: co-occurrence of entities within the same packet => related_to.
    const relations: Relation[] = [];
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];
        // Link laws to the institutions that produced them when inferable.
        if (a.type === "law" && b.type === "institution") {
          relations.push({ id: `rel:${a.id}:${b.id}`, from: a.id, to: b.id, type: "involves", weight: 1 });
        } else if (a.type !== b.type) {
          relations.push({ id: `rel:${a.id}:${b.id}`, from: a.id, to: b.id, type: "related_to", weight: 0.5 });
        }
      }
    }

    const graph: KnowledgeGraph = { entities, relations };
    log.info("Extracted knowledge graph from result", { entities: entities.length, relations: relations.length });
    return graph;
  }

  /** Convenience: extract + merge into the store in one call. */
  async ingest(result: any): Promise<KnowledgeGraph> {
    const graph = this.extractFromResult(result);
    await this.store.merge(graph);
    return graph;
  }

  async query(entityId?: string): Promise<{ graph: KnowledgeGraph; neighbors?: GraphNode[] }> {
    const graph = await this.store.all();
    if (entityId) {
      return { graph, neighbors: await this.store.neighbors(entityId) };
    }
    return { graph };
  }
}
