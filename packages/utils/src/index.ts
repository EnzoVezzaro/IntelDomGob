// General-purpose utilities shared across the platform.
//
// This package intentionally has ZERO runtime dependencies so it can be safely
// imported by any service, provider, or client.

import { ES_STOP } from "./lang";

/** Normalize a string: lowercase, strip accents, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract meaningful tokens (accent-stripped, stopword-filtered). */
export function queryTokens(query: string): string[] {
  return normalizeText(query)
    .split(/\s+/)
    .map((t) => (/^\d+[-–]\d+$/.test(t) ? t : t.replace(/[^a-z0-9]/g, "")))
    .filter((t) => t.length > 2 && !ES_STOP.has(t));
}

/**
 * Count how many query tokens appear in a piece of text. Enforces topical
 * coherence so off-topic items are rejected.
 */
export function tokenOverlap(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const low = normalizeText(text);
  let n = 0;
  for (const t of tokens) {
    if (t.length >= 4 ? low.includes(t) : low.split(/\s+/).some((w) => w === t || w.startsWith(t))) n++;
  }
  return n;
}

/** Number of overlapping tokens required for a text to be considered on-topic. */
export function requiredOverlap(tokens: string[]): number {
  return tokens.length <= 2 ? 1 : 2;
}

/** Normalize a URL to a comparable key (strip protocol + trailing slash). */
export function normUrl(u: string): string {
  return (u || "").toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\//, "");
}

/** Best-effort decode of a redirect URL (?uddg= / ?u=). */
export function decodeRedirect(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const r = u.searchParams.get("uddg") || u.searchParams.get("u");
    return r ? decodeURIComponent(r) : href;
  } catch {
    return href;
  }
}

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetch JSON with timeout + abort. */
export async function fetchJson<T = any>(
  url: string,
  opts: { method?: string; timeoutMs?: number; headers?: Record<string, string>; body?: string } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12000);
  try {
    const resp = await fetch(url, {
      method: opts.method ?? "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json", ...(opts.headers ?? {}) },
      body: opts.body,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`fetchJson ${opts.method ?? "GET"} ${url} failed (${resp.status}): ${text.slice(0, 200)}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Fetch HTML/text with timeout + abort. */
export async function fetchText(url: string, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: opts.headers ?? {} });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** De-duplicate an array of items by a key derived from each item. */
export function dedupeByKey<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Generate a short request/correlation id. */
export function requestId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Fetch an arbitrary web page and return its cleaned text plus lightweight
 * metadata. Used to answer "what does this URL say?" questions — the platform
 * otherwise only does keyword search and never reads page bodies.
 *
 * The HTML is stripped to readable text: scripts/styles/links removed, tags
 * collapsed to spaces, whitespace collapsed. A sensible max length keeps the
 * payload safe for downstream LLM prompts.
 *
 * Returns null on any transport/parse failure so callers can degrade gracefully.
 */
export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  /** Best-effort published/filed date if recoverable from meta tags. */
  publishedDate: string | null;
  /** True when the host is a Dominican Republic government/official domain. */
  dominican: boolean;
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;

/** Extract the first plausible http(s) URL from arbitrary text (a query). */
export function firstUrlInText(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? m[0].replace(/[.,;:]+$/, "") : null;
}

function isDominicanHost(host: string): boolean {
  return host.endsWith(".do") || host.endsWith(".gob.do");
}

export async function fetchWebpage(
  url: string,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<FetchedPage | null> {
  const maxChars = opts.maxChars ?? 16000;
  const html = await fetchText(url, { timeoutMs: opts.timeoutMs ?? 15000, headers: { "User-Agent": "ChatGobDO/1.0" } });
  if (!html) return null;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }

  // Title: <title> tag, else first <h1>.
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleM ? titleM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";

  // Best-effort published date from common meta tags / JSON-LD.
  let publishedDate: string | null = null;
  const dateM =
    html.match(/<meta[^>]+(?:property|name)=(?:["'])article:published_time(?:["'])[^>]*content=(?:["'])([^"']+)/i) ||
    html.match(/<meta[^>]+itemprop=(?:["'])datePublished(?:["'])[^>]*content=(?:["'])([^"']+)/i) ||
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (dateM) publishedDate = dateM[1].slice(0, 32);

  // Strip scripts / styles / head / noscript / svg.
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // Collapse tags to a single space (keep text only).
  body = body.replace(/<[^>]+>/g, " ");
  // Decode the most common HTML entities.
  body = body
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  body = body.replace(/\s+/g, " ").replace(/\n{2,}/g, "\n").trim();

  if (!title) {
    const h1 = body.match(/([^\n]{8,200})/);
    title = h1 ? h1[1].trim() : url;
  }

  const text = body.slice(0, maxChars);
  return { url, title: title.slice(0, 300), text, publishedDate, dominican: isDominicanHost(host) };
}
