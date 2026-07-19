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
