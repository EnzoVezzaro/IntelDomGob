import { DR_PORTALS, CATEGORY_LABELS } from "./portals";

// Builds a CATEGORIZED URL tree: for each department (portal) and each research
// category (news, legislative action, laws, ...), it crawls the curated seed pages
// (and follows same-host links a short distance) and records every URL found.
// The result is grouped department -> category -> list of URLs, so the search
// agent can target the most relevant pages per research type.

const FETCH_TIMEOUT = 12000;
const MAX_PAGES_PER_SECTION = 40;
const MAX_DEPTH = 2;
const CONCURRENCY = 6;

function sameHost(url: string, host: string): boolean {
  try {
    return new URL(url).host === host;
  } catch {
    return false;
  }
}

const NOISE_EXT = /\.(css|js|json|xml|ico|png|jpg|jpeg|gif|svg|mp4|webp|woff2?|ttf|eot|pdf)(\?|$)/i;
const NOISE_PATH = /(\/(feed|xmlrpc\.php|wp-json|wp-admin|cdn-cgi)\b|favicon|reset\.css|bootstrap\.min|owl\.carousel|ckan\.ico)/i;

function normalize(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    u.hash = "";
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    const clean = `${u.protocol}//${u.host}${path}${u.search}`;
    if (NOISE_EXT.test(clean) || NOISE_PATH.test(clean)) return null;
    return clean;
  } catch {
    return null;
  }
}

function extractLinks(html: string, base: string): string[] {
  const links = new Set<string>();
  const re = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = normalize(base, m[1]);
    if (n) links.add(n);
  }
  return [...links];
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "ChatGobDO-URLTree-Crawler/1.0",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

interface UrlEntry {
  url: string;
  title?: string;
}

// Fetch a JSON API endpoint and turn result items into URL entries.
async function fetchApiEntries(url: string): Promise<UrlEntry[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "ChatGobDO-URLTree-Crawler/1.0", Accept: "application/json" },
    });
    clearTimeout(t);
    if (!resp.ok) return [];
    const data = await resp.json();
    const results: any[] = Array.isArray(data) ? data : data.results || [];
    return results.slice(0, MAX_PAGES_PER_SECTION).map((r: any) => {
      const id = r.id ?? r.legisladorId ?? r.expedienteId;
      if (url.includes("/iniciativa/")) {
        const numero = r.numero || "";
        const tipo = r.tipo || "Iniciativa";
        const desc = (r.descripcion || "").replace(/\s+/g, " ").trim().slice(0, 140);
        return {
          url: `https://www.diputadosrd.gob.do/sil/api/iniciativa/getIniciativas?id=${id}`,
          title: `${numero} · ${tipo}${desc ? " — " + desc : ""}`,
        };
      }
      if (url.includes("/sesion/")) {
        return {
          url: `https://www.diputadosrd.gob.do/sil/sesion/${id}`,
          title: r.titulo || r.nombre || `Sesión ${id}`,
        };
      }
      if (url.includes("/comision/")) {
        return {
          url: `https://www.diputadosrd.gob.do/sil/api/comision/comisiones?id=${id}`,
          title: r.nombre || `Comisión ${id}`,
        };
      }
      return { url: String(id), title: JSON.stringify(r).slice(0, 140) };
    });
  } catch {
    return [];
  }
}

async function crawlSection(
  host: string,
  section: { seeds: string[]; isApi?: boolean }
): Promise<UrlEntry[]> {
  if (section.isApi) {
    const entries: UrlEntry[] = [];
    for (const seed of section.seeds) {
      const apiEntries = await fetchApiEntries(seed);
      for (const e of apiEntries) entries.push(e);
    }
    return entries;
  }

  // Seed URLs may contain a <KEYTERM> placeholder (e.g. Tribunal Constitucional
  // search endpoint). The live runtime replaces it with the user query; for the
  // static URL-tree build we substitute a representative example term so the
  // crawler can resolve and follow the real result pages.
  const resolvedSeeds = section.seeds.map((s) =>
    s.includes("<KEYTERM>") ? s.replace("<KEYTERM>", encodeURIComponent(section.apiKeyword || "República Dominicana")) : s
  );

  const visited = new Map<string, string | undefined>();
  const queue: { url: string; depth: number }[] = resolvedSeeds.map((s) => ({ url: s.replace(/\/+$/, ""), depth: 0 }));
  let processed = 0;

  while (queue.length > 0 && processed < MAX_PAGES_PER_SECTION) {
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(
      batch.map(async ({ url, depth }) => {
        if (visited.has(url)) return;
        visited.set(url, undefined);
        processed++;
        if (depth >= MAX_DEPTH) return;
        const html = await fetchHtml(url);
        if (!html) return;
        const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
        if (titleMatch) visited.set(url, titleMatch[1].trim().slice(0, 140));
        const links = extractLinks(html, url).filter((l) => sameHost(l, host));
        for (const l of links) {
          if (!visited.has(l)) queue.push({ url: l, depth: depth + 1 });
        }
      })
    );
  }

  return [...visited.entries()].map(([url, title]) => ({ url, title }));
}

export interface CategorizedPortalTree {
  name: string;
  url: string;
  refId: string;
  sections: { category: string; label: string; count: number; urls: UrlEntry[] }[];
  total: number;
}

export async function buildCategorizedUrlTree(): Promise<CategorizedPortalTree[]> {
  const results: CategorizedPortalTree[] = [];
  for (const portal of DR_PORTALS) {
    const host = new URL(portal.url).host;
    const sections: CategorizedPortalTree["sections"] = [];
    let total = 0;
    for (const section of portal.sections) {
      // eslint-disable-next-line no-console
      console.error(`[${portal.name}] ${section.label} (${section.category})...`);
      const urls = await crawlSection(host, section);
      total += urls.length;
      sections.push({
        category: section.category,
        label: section.label,
        count: urls.length,
        urls,
      });
    }
    results.push({
      name: portal.name,
      url: portal.url,
      refId: portal.refId,
      sections,
      total,
    });
  }
  return results;
}

export { CATEGORY_LABELS };

// CLI: node build-url-tree.ts > url-tree.json
if (import.meta.url === `file://${process.argv[1]}`) {
  buildCategorizedUrlTree()
    .then((r) => process.stdout.write(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
