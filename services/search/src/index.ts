// Search Service.
//
// Responsibilities (single responsibility per WORK.md):
//   * Run web/news search through the configured Search Provider (SearXNG).
//   * Fan out across declarative engines for Dominican press coverage (FLUJO D).
//   * De-duplicate, classify and tag every result by institution.
//
// It knows NOTHING about AI, prompts, or orchestration.

import type { SearchProvider } from "@intel.dom.gob/providers";
import { createLogger } from "@intel.dom.gob/logger";
import { queryTokens, tokenOverlap, decodeRedirect, fetchJson, fetchText, normUrl } from "@intel.dom.gob/utils";

const log = createLogger("service:search");

export interface SearchServiceOptions {
  provider: SearchProvider;
  /** Optional extra news engines beyond the provider (DDG HTML, Google News RSS). */
  enableNewsEngines?: boolean;
}

export class SearchService {
  private readonly provider: SearchProvider;
  private readonly enableNewsEngines: boolean;

  constructor(opts: SearchServiceOptions) {
    this.provider = opts.provider;
    this.enableNewsEngines = opts.enableNewsEngines ?? true;
  }

  /** Run a single web search via the underlying provider. */
  async webSearch(query: string, maxResults = 10, engines?: string) {
    return this.provider.search(query, { maxResults, engines });
  }

  /**
   * FLUJO D — multi-engine Dominican press/news retrieval.
   * Mirrors the declarative engine registry from the original server.
   */
  async newsActivity(query: string, isAllowed: (sourceLabel: string) => boolean, restricted = true): Promise<{ url: string; title: string; source: string; snippet: string }[]> {
    if (!this.enableNewsEngines) return [];
    const out: { url: string; title: string; source: string; snippet: string }[] = [];
    const seen = new Set<string>();
    const toks = queryTokens(query);

    const batches = await Promise.all(
      NEWS_ENGINES.filter((e) => isAllowed(e.label)).map(async (e) => {
        try {
          return await e.fetch(query);
        } catch (err) {
          log.warn("news engine failed", { engine: e.id, error: String(err) });
          return [] as { url: string; title: string; snippet: string }[];
        }
      })
    );

    batches.forEach((results, idx) => {
      const engine = NEWS_ENGINES.filter((e) => isAllowed(e.label))[idx];
      for (const r of results) {
        if (seen.has(r.url)) continue;
        const isNewsRss = r.url.includes("news.google.com");
        if (!isNewsRss && !looksLikeArticle(r.url)) continue;
        const host = (() => {
          try {
            return new URL(r.url).hostname.replace(/^www\./, "");
          } catch {
            return "";
          }
        })();
        const loose = engine?.kind === "news" || isNewsRss;
        const minOverlap = loose ? 0 : 1;
        if (toks.length > 0 && tokenOverlap(`${r.title} ${r.snippet}`, toks) < minOverlap) continue;
        const dr = isDominicanSource(host) || isNewsRss || engine?.kind === "official";
        if (!dr && restricted) continue;
        seen.add(r.url);
        out.push({ url: r.url, title: r.title, source: engine?.label || "Web", snippet: r.snippet || "" });
      }
    });

    return out.slice(0, 30);
  }
}

// ---------------------------------------------------------------------------
// News engine registry (declarative — add a kind + fetch to extend).
// ---------------------------------------------------------------------------

type NewsEngineKind = "general" | "news" | "legal" | "official";
interface NewsEngine {
  id: string;
  label: string;
  kind: NewsEngineKind;
  fetch: (q: string) => Promise<{ url: string; title: string; snippet: string }[]>;
}

async function fetchGoogleNewsRss(q: string): Promise<{ url: string; title: string; snippet: string }[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=DO&ceid=DO:es`;
  const xml = await fetchText(url, { timeoutMs: 12000, headers: { "User-Agent": "Mozilla/5.0" } });
  if (!xml) return [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, 20).map((it) => {
    const pick = (f: string) => {
      const m = it.match(new RegExp(`<${f}[^>]*>([\\s\\S]*?)</${f}>`));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    };
    const srcM = it.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    return {
      url: pick("link"),
      title: pick("title"),
      snippet: (srcM ? srcM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() + " — " : "") + pick("pubDate"),
    };
  }).filter((r) => r.title && r.url);
}

async function fetchDuckDuckGoHtml(q: string): Promise<{ url: string; title: string; snippet: string }[]> {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    timeoutMs: 12000,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (!html) return [];
  const out: { url: string; title: string; snippet: string }[] = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = decodeRedirect(m[1]);
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const snippet = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (u && title) out.push({ url: u, title, snippet });
  }
  return out;
}

async function fetchSearxngEngine(q: string, engine: string): Promise<{ url: string; title: string; snippet: string }[]> {
  const params = new URLSearchParams({ q, format: "json", language: "es", engines: engine, limit: "15" });
  const data = await fetchJson<{ results?: { url: string; title?: string; content?: string }[] }>(
    `${SEARXNG_BASE_URL}/search?${params.toString()}`,
    { timeoutMs: 12000 }
  );
  return (data.results || [])
    .map((r) => ({ url: r.url, title: r.title || "", snippet: r.content || "" }))
    .filter((r) => r.url && r.title);
}

const NEWS_ENGINES: NewsEngine[] = [
  { id: "ddg", label: "DuckDuckGo", kind: "general", fetch: fetchDuckDuckGoHtml },
  { id: "bing", label: "Bing", kind: "general", fetch: (q) => fetchSearxngEngine(q, "bing") },
  { id: "mojeek", label: "Mojeek", kind: "general", fetch: (q) => fetchSearxngEngine(q, "mojeek") },
  { id: "gnews", label: "Google News", kind: "news", fetch: fetchGoogleNewsRss },
  { id: "bingnews", label: "Bing News", kind: "news", fetch: (q) => fetchSearxngEngine(q, "bing_news") },
  { id: "ddg-legal", label: "DuckDuckGo", kind: "legal", fetch: fetchDuckDuckGoHtml },
  { id: "wikipedia", label: "Wikipedia", kind: "legal", fetch: (q) => fetchSearxngEngine(q, "wikipedia") },
  { id: "wikidata", label: "Wikidata", kind: "official", fetch: (q) => fetchSearxngEngine(q, "wikidata") },
  { id: "wikipedia-o", label: "Wikipedia", kind: "official", fetch: (q) => fetchSearxngEngine(q, "wikipedia") },
];

// The SearXNG base URL for the engine fan-out is injected at runtime by the
// service factory (setSearxngBaseUrl) so the news engines can reuse it.
let SEARXNG_BASE_URL = "http://searxng:8080";
export function setSearxngBaseUrl(url: string): void {
  SEARXNG_BASE_URL = url.replace(/\/+$/, "");
}

const INFO_SECTIONS =
  /^(quienes-somos|nosotros|historia|organigrama|marco-legal|plan-estrategico|despacho|comisiones?|sesiones|agenda|ordenes?-del-dia|debates|documentos|informes|funciones|estructura|visita|bufete|bloques|fiscalizacion|contacto|transparencia|memorias|atribuciones|listado|actas|boletines|oasep|author|tag|page|wp-|category|search|inicio|home|a-proposito|aviso|privacidad|terminos)/i;
function looksLikeArticle(absUrl: string): boolean {
  try {
    const path = new URL(absUrl).pathname.replace(/^\/+|\/+$/g, "");
    if (/\.pdf($|\?)/i.test(path) || /\/uploads?\//i.test(path) || /\/(FileManagement|Consulta|documento|doc)/i.test(path)) return true;
    const segs = path.split("/").filter(Boolean);
    const first = segs[0] || "";
    if (INFO_SECTIONS.test(first)) return false;
    const hasDate = /\/\d{4}\/\d{2}(\/\d{2})?/.test(path);
    const hasId = /\/\d{4,}\//.test(path) || /\/(node|post|articles?)\/\d+/.test(path);
    const longSlug = segs.length >= 1 && segs[segs.length - 1].split("-").length >= 3 && segs[segs.length - 1].length >= 12;
    const isNewsPath = /^(noticias?|news|articulo|articulos|post|posts|story|stories|seccional|suplemento)/i.test(first);
    return Boolean(hasDate || hasId || longSlug || isNewsPath);
  } catch {
    return false;
  }
}

const DR_MEDIA_HOSTS = [
  "listindiario.com", "diariolibre.com", "hoy.com.do", "elnacional.com.do", "acento.com.do",
  "elcaribe.com.do", "almomento.net", "eldia.com.do", "elmundo.com.do", "elnuevodiario.com.do",
  "cdn.com.do", "rtvc.gov.do", "presidencia.gob.do",
  "drlawyer.com", "do.vlex.com", "arlegalrd.com", "abogadom.net",
];
function isDominicanSource(host: string): boolean {
  return host.endsWith(".do") || DR_MEDIA_HOSTS.some((m) => host === m || host.endsWith("." + m));
}
