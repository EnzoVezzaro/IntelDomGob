#!/usr/bin/env node
/**
 * discover-senate-dspace.ts
 *
 * Crawls the Senado DSpace 7.x REST API tree starting from a community UUID,
 * discovers every available endpoint, and classifies each as:
 *   - LIST: paginated collection endpoint (returns multiple items)
 *   - SINGLE: single-object retrieval (returns one item by UUID)
 *
 * Usage:
 *   npx tsx scripts/discover-senate-dspace.ts
 *   npx tsx scripts/discover-senate-dspace.ts --community <uuid>
 */

const DSPACE_HOST = "https://memoriahistorica.senadord.gob.do";
const BASE = `${DSPACE_HOST}/server/api`;

const TARGET_COMMUNITY = "fc1aa418-1f3f-46ee-a300-6d6047e53d01";
const REQUEST_TIMEOUT = 15_000;
const MAX_ITEMS_PER_LIST = 5; // sample size per list endpoint

interface EndpointInfo {
  path: string;
  url: string;
  type: "LIST" | "SINGLE" | "ACTION";
  description: string;
  sampleResponse?: any;
  itemCount?: number;
  fields?: string[];
}

const endpoints: EndpointInfo[] = [];

// ── Fetch helpers ──────────────────────────────────────────────────────────

async function fetchJson(path: string): Promise<any | null> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "DSpaceDiscover/1.0" },
    });
    clearTimeout(timer);
    if (!resp.ok) {
      console.error(`  ✗ ${resp.status} ${url}`);
      return null;
    }
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      console.error(`  ✗ Non-JSON response from ${url}`);
      return null;
    }
  } catch (e: any) {
    clearTimeout(timer);
    console.error(`  ✗ ${e?.name || e} for ${url}`);
    return null;
  }
}

// ── Classification ─────────────────────────────────────────────────────────

function classify(path: string, data: any): "LIST" | "SINGLE" | "ACTION" {
  if (!data) return "ACTION";
  // DSpace 7 paginated lists: { page: { ... }, _embedded: { ... } }
  if (data.page && typeof data.page === "object" && "totalElements" in data.page) return "LIST";
  if (data._embedded && typeof data._embedded === "object") {
    const keys = Object.keys(data._embedded);
    if (keys.length === 1 && Array.isArray(data._embedded[keys[0]])) return "LIST";
  }
  // Single objects have an `id` field (UUID) and `_links`
  if (data.id && typeof data.id === "string" && data._links) return "SINGLE";
  if (data.id && typeof data.id === "string" && data.metadata) return "SINGLE";
  // Arrays at top level = list
  if (Array.isArray(data)) return "LIST";
  return "SINGLE";
}

function extractFields(data: any): string[] {
  if (!data) return [];
  if (data.metadata && typeof data.metadata === "object") return Object.keys(data.metadata);
  if (data._embedded) {
    const keys = Object.keys(data._embedded);
    if (keys.length === 1 && Array.isArray(data._embedded[keys[0]])) {
      const arr = data._embedded[keys[0]];
      if (arr.length > 0 && arr[0].metadata) return Object.keys(arr[0].metadata);
      return arr.length > 0 ? Object.keys(arr[0]) : [];
    }
  }
  if (Array.isArray(data) && data.length > 0) {
    return data[0].metadata ? Object.keys(data[0].metadata) : Object.keys(data[0]);
  }
  return Object.keys(data);
}

// ── Discovery functions ────────────────────────────────────────────────────

async function discoverCommunity(uuid: string): Promise<void> {
  console.log(`\n▸ Community: ${uuid}`);
  const data = await fetchJson(`/core/communities/${uuid}`);
  if (!data) return;

  endpoints.push({
    path: `/core/communities/{uuid}`,
    url: `${BASE}/core/communities/${uuid}`,
    type: "SINGLE",
    description: "Community metadata (name, handle, logo, metadata)",
    fields: extractFields(data),
  });

  // Sub-communities
  await discoverList(`/core/communities/${uuid}/subcommunities`, "Sub-communities of community");
  // Collections
  await discoverList(`/core/communities/${uuid}/collections`, "Collections in community");
  // Metadata
  await discoverList(`/core/communities/${uuid}/metadata`, "Metadata fields of community");
  // Parent community
  await discoverParentCommunity(`/core/communities/${uuid}/parentCommunity`, "Parent community");
  // All metadata
  await discoverList(`/core/communities/${uuid}/allMetadata`, "All metadata of community");
}

async function discoverCollection(uuid: string, label?: string): Promise<void> {
  console.log(`\n▸ Collection: ${uuid}${label ? ` (${label})` : ""}`);
  const data = await fetchJson(`/core/collections/${uuid}`);
  if (!data) return;

  endpoints.push({
    path: `/core/collections/{uuid}`,
    url: `${BASE}/core/collections/${uuid}`,
    type: "SINGLE",
    description: `Collection metadata${label ? ` — ${label}` : ""}`,
    fields: extractFields(data),
  });

  // Items
  await discoverList(`/core/collections/${uuid}/items`, `Items in collection${label ? ` (${label})` : ""}`);
  // Metadata
  await discoverList(`/core/collections/${uuid}/metadata`, "Metadata fields of collection");
  // Source
  await discoverList(`/core/collections/${uuid}/source`, "Source of collection");
  // All metadata
  await discoverList(`/core/collections/${uuid}/allMetadata`, "All metadata of collection");
  // License
  await discoverList(`/core/collections/${uuid}/license`, "License of collection");
}

async function discoverItem(uuid: string, label?: string): Promise<void> {
  console.log(`\n▸ Item: ${uuid}${label ? ` (${label})` : ""}`);
  const data = await fetchJson(`/core/items/${uuid}`);
  if (!data) return;

  endpoints.push({
    path: `/core/items/{uuid}`,
    url: `${BASE}/core/items/${uuid}`,
    type: "SINGLE",
    description: `Item metadata${label ? ` — ${label}` : ""}`,
    fields: extractFields(data),
  });

  // Bitstreams
  await discoverList(`/core/items/${uuid}/bitstreams`, "Bitstreams (files) of item");
  // Metadata
  await discoverList(`/core/items/${uuid}/metadata`, "Metadata fields of item");
  // Relationships
  await discoverList(`/core/items/${uuid}/relationships`, "Relationships of item");
  // All metadata
  await discoverList(`/core/items/${uuid}/allMetadata`, "All metadata of item");
}

async function discoverList(path: string, description: string): Promise<void> {
  const url = `${path}?page=0&size=${MAX_ITEMS_PER_LIST}`;
  console.log(`  → ${description} (list)`);
  const data = await fetchJson(url);
  if (!data) return;

  const type = classify(path, data);
  let itemCount: number | undefined;
  if (type === "LIST") {
    itemCount = data.page?.totalElements ?? (Array.isArray(data) ? data.length : undefined);
  }

  endpoints.push({
    path,
    url: `${BASE}${url}`,
    type,
    description,
    itemCount,
    fields: extractFields(data),
  });
}

async function discoverParentCommunity(path: string, description: string): Promise<void> {
  console.log(`  → ${description} (single)`);
  const data = await fetchJson(path);
  if (!data) return;

  endpoints.push({
    path,
    url: `${BASE}${path}`,
    type: "SINGLE",
    description,
    fields: extractFields(data),
  });
}

async function discoverSearchEndpoint(scope: string, query: string): Promise<void> {
  const searchPath = `/discover/search/objects?query=${encodeURIComponent(query)}&scope=${scope}&dsoType=ITEM&page=0&size=2`;
  console.log(`  → Search (discover) scoped to ${scope}`);
  const data = await fetchJson(searchPath);
  if (!data) return;

  const objects = data?._embedded?.searchResult?._embedded?.objects ?? [];
  endpoints.push({
    path: `/discover/search/objects?query={q}&scope={scope}&dsoType={type}&page={p}&size={s}`,
    url: `${BASE}${searchPath}`,
    type: "LIST",
    description: `Full-text search within scope (dsoType filter, pagination)`,
    itemCount: data?._embedded?.searchResult?.page?.totalElements,
    fields: objects.length > 0 ? extractFields(objects[0]._embedded?.indexableObject) : [],
  });

  // Discover/search/objects WITHOUT scope (global)
  const globalPath = `/discover/search/objects?query=${encodeURIComponent(query)}&dsoType=ITEM&page=0&size=2`;
  const globalData = await fetchJson(globalPath);
  if (globalData) {
    const globalObjects = globalData?._embedded?.searchResult?._embedded?.objects ?? [];
    endpoints.push({
      path: `/discover/search/objects?query={q}&dsoType={type}&page={p}&size={s}`,
      url: `${BASE}${globalPath}`,
      type: "LIST",
      description: "Full-text search across ALL communities (global, no scope)",
      itemCount: globalData?._embedded?.searchResult?.page?.totalElements,
      fields: globalObjects.length > 0 ? extractFields(globalObjects[0]._embedded?.indexableObject) : [],
    });
  }

  // Discover/search/objects with configurationName
  const configPath = `/discover/search/objects?query=${encodeURIComponent(query)}&scope=${scope}&configurationName=search&dsoType=ITEM&page=0&size=2`;
  const configData = await fetchJson(configPath);
  if (configData) {
    const configObjects = configData?._embedded?.searchResult?._embedded?.objects ?? [];
    endpoints.push({
      path: `/discover/search/objects?query={q}&scope={scope}&configurationName={config}&dsoType={type}&page={p}&size={s}`,
      url: `${BASE}${configPath}`,
      type: "LIST",
      description: "Full-text search with named configuration (e.g., 'search')",
      itemCount: configData?._embedded?.searchResult?.page?.totalElements,
      fields: configObjects.length > 0 ? extractFields(configObjects[0]._embedded?.indexableObject) : [],
    });
  }
}

async function discoverStatistics(uuid: string): Promise<void> {
  // View events for a specific item
  const path = `/statistics/viewevents`;
  console.log(`  → Statistics: viewevents`);
  // Don't actually POST (write), just document
  endpoints.push({
    path: `/statistics/viewevents`,
    url: `${BASE}/statistics/viewevents`,
    type: "ACTION",
    description: "Record view events (POST body: resource UUID + target)",
  });

  // Search statistics endpoint
  const statsPath = `/statistics`;
  const statsData = await fetchJson(statsPath);
  if (statsData) {
    endpoints.push({
      path: `/statistics`,
      url: `${BASE}${statsPath}`,
      type: "LIST",
      description: "Statistics overview",
    });
  }
}

async function discoverHarvest(uuid: string): Promise<void> {
  // Harvest sets / source
  const paths = [
    `/harvest/sources`,
    `/harvest/harvestedItems`,
  ];
  for (const p of paths) {
    const data = await fetchJson(p);
    if (data) {
      endpoints.push({
        path: p,
        url: `${BASE}${p}`,
        type: classify(p, data),
        description: `Harvesting: ${p.split("/").pop()}`,
        fields: extractFields(data),
      });
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  Senado DSpace 7.x REST API Discovery");
  console.log(`  Target: ${DSPACE_HOST}`);
  console.log(`  Community: ${TARGET_COMMUNITY}`);
  console.log("═══════════════════════════════════════════════════════════════════");

  // 1. Discover the root community
  await discoverCommunity(TARGET_COMMUNITY);

  // 2. Find collections inside the community
  console.log("\n── Discovering collections ──");
  const communityData = await fetchJson(`/core/communities/${TARGET_COMMUNITY}/collections?page=0&size=100`);
  const collectionUuids: { uuid: string; name: string }[] = [];
  if (communityData) {
    const collections = communityData?._embedded?.collections ?? communityData?.page?._embedded?.collections ?? [];
    // Handle DSpace 7.x _embedded.page format
    if (communityData._embedded?.searchResult?._embedded?.objects) {
      for (const obj of communityData._embedded.searchResult._embedded.objects) {
        const col = obj._embedded?.indexableObject;
        if (col?.id) collectionUuids.push({ uuid: col.id, name: col.name || "Unknown" });
      }
    } else if (communityData._embedded?.collections) {
      for (const col of communityData._embedded.collections) {
        if (col.id) collectionUuids.push({ uuid: col.id, name: col.name || "Unknown" });
      }
    }
    // The response might also be a direct array
    if (Array.isArray(communityData)) {
      for (const col of communityData) {
        if (col.id) collectionUuids.push({ uuid: col.id, name: col.name || "Unknown" });
      }
    }
  }

  console.log(`  Found ${collectionUuids.length} collections`);
  for (const { uuid, name } of collectionUuids.slice(0, 5)) {
    await discoverCollection(uuid, name);
  }

  // 3. Find sub-communities
  console.log("\n── Discovering sub-communities ──");
  const subCommData = await fetchJson(`/core/communities/${TARGET_COMMUNITY}/subcommunities?page=0&size=100`);
  const subCommunityUuids: { uuid: string; name: string }[] = [];
  if (subCommData) {
    if (subCommData._embedded?.searchResult?._embedded?.objects) {
      for (const obj of subCommData._embedded.searchResult._embedded.objects) {
        const com = obj._embedded?.indexableObject;
        if (com?.id) subCommunityUuids.push({ uuid: com.id, name: com.name || "Unknown" });
      }
    } else if (subCommData._embedded?.subcommunities) {
      for (const com of subCommData._embedded.subcommunities) {
        if (com.id) subCommunityUuids.push({ uuid: com.id, name: com.name || "Unknown" });
      }
    }
    if (Array.isArray(subCommData)) {
      for (const com of subCommData) {
        if (com.id) subCommunityUuids.push({ uuid: com.id, name: com.name || "Unknown" });
      }
    }
  }

  console.log(`  Found ${subCommunityUuids.length} sub-communities`);
  for (const { uuid, name } of subCommunityUuids.slice(0, 5)) {
    await discoverCommunity(uuid);
    // For each sub-community, discover its collections too
    const subCols = await fetchJson(`/core/communities/${uuid}/collections?page=0&size=100`);
    if (subCols) {
      const subColUuids: { uuid: string; name: string }[] = [];
      if (subCols._embedded?.searchResult?._embedded?.objects) {
        for (const obj of subCols._embedded.searchResult._embedded.objects) {
          const col = obj._embedded?.indexableObject;
          if (col?.id) subColUuids.push({ uuid: col.id, name: col.name || "Unknown" });
        }
      } else if (subCols._embedded?.collections) {
        for (const col of subCols._embedded.collections) {
          if (col.id) subColUuids.push({ uuid: col.id, name: col.name || "Unknown" });
        }
      }
      console.log(`    Found ${subColUuids.length} collections in sub-community ${name}`);
      for (const { uuid: cuuid, name: cname } of subColUuids.slice(0, 3)) {
        await discoverCollection(cuuid, cname);
      }
    }
  }

  // 4. Discover sample items from the first collection
  if (collectionUuids.length > 0) {
    console.log("\n── Discovering sample items ──");
    const itemsData = await fetchJson(`/core/collections/${collectionUuids[0].uuid}/items?page=0&size=2`);
    const itemUuids: string[] = [];
    if (itemsData) {
      if (itemsData._embedded?.searchResult?._embedded?.objects) {
        for (const obj of itemsData._embedded.searchResult._embedded.objects) {
          const item = obj._embedded?.indexableObject;
          if (item?.id) itemUuids.push(item.id);
        }
      } else if (itemsData._embedded?.items) {
        for (const item of itemsData._embedded.items) {
          if (item.id) itemUuids.push(item.id);
        }
      }
    }

    console.log(`  Found ${itemUuids.length} sample items`);
    for (const uuid of itemUuids.slice(0, 2)) {
      await discoverItem(uuid);
    }
  }

  // 5. Discover search endpoints
  console.log("\n── Discovering search endpoints ──");
  await discoverSearchEndpoint(TARGET_COMMUNITY, "leyes");
  await discoverSearchEndpoint(TARGET_COMMUNITY, "boletin");

  // 6. Discover statistics endpoints
  console.log("\n── Discovering statistics endpoints ──");
  await discoverStatistics(TARGET_COMMUNITY);

  // 7. Discover harvesting endpoints
  console.log("\n── Discovering harvesting endpoints ──");
  await discoverHarvest(TARGET_COMMUNITY);

  // ── Deduplicate & output ────────────────────────────────────────────────
  const seen = new Set<string>();
  const unique: EndpointInfo[] = [];
  for (const ep of endpoints) {
    const key = ep.path.split("?")[0]; // dedupe by path template
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ep);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log(`  DISCOVERY COMPLETE — ${unique.length} unique endpoints found`);
  console.log("═══════════════════════════════════════════════════════════════════\n");

  // Classify
  const lists = unique.filter((e) => e.type === "LIST");
  const singles = unique.filter((e) => e.type === "SINGLE");
  const actions = unique.filter((e) => e.type === "ACTION");

  console.log(`\n── LIST ENDPOINTS (${lists.length}) ──\n`);
  for (const ep of lists) {
    console.log(`  ${ep.path}`);
    console.log(`    URL: ${ep.url}`);
    console.log(`    ${ep.description}`);
    if (ep.itemCount !== undefined) console.log(`    Total items: ${ep.itemCount}`);
    if (ep.fields && ep.fields.length > 0) console.log(`    Metadata fields: [${ep.fields.slice(0, 10).join(", ")}${ep.fields.length > 10 ? "..." : ""}]`);
    console.log();
  }

  console.log(`\n── SINGLE ENDPOINTS (${singles.length}) ──\n`);
  for (const ep of singles) {
    console.log(`  ${ep.path}`);
    console.log(`    URL: ${ep.url}`);
    console.log(`    ${ep.description}`);
    if (ep.fields && ep.fields.length > 0) console.log(`    Metadata fields: [${ep.fields.slice(0, 10).join(", ")}${ep.fields.length > 10 ? "..." : ""}]`);
    console.log();
  }

  console.log(`\n── ACTION ENDPOINTS (${actions.length}) ──\n`);
  for (const ep of actions) {
    console.log(`  ${ep.path}`);
    console.log(`    URL: ${ep.url}`);
    console.log(`    ${ep.description}`);
    console.log();
  }

  // Output JSON
  const outputPath = new URL("./discover-senate-dspace-results.json", import.meta.url).pathname;
  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify({ discoveredAt: new Date().toISOString(), community: TARGET_COMMUNITY, host: DSPACE_HOST, endpoints: unique }, null, 2));
  console.log(`\n  Results saved to: scripts/discover-senate-dspace-results.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
