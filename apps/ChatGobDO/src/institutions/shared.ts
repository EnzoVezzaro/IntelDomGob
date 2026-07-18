// Shared retrieval utilities reused by institution modules. Kept here so each
// institution module stays self-contained but does not re-implement plumbing.

export const ES_STOP = new Set([
  "de", "la", "el", "los", "las", "y", "en", "a", "del", "por", "para", "con", "que", "su", "se", "un", "una",
  "proyecto", "ley", "reforma", "sobre", "al", "lo", "como", "o", "es", "dominicana", "republica",
  "propuestas", "debates", "cual", "este", "esta", "the", "of", "and", "to", "in", "for", "is", "on", "with",
  "del", "una", "unas", "los", "las", "que", "segun", "entre", "hacia", "desde", "hasta", "sin",
]);

/** Accent-stripped, stopword-filtered meaningful query tokens. */
export function queryTokens(query: string): string[] {
  return query
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/\s+/).map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 2 && !ES_STOP.has(t));
}

/** Count how many meaningful tokens appear in a piece of text (topical coherence). */
export function tokenOverlap(text: string, tokens: string[]): number {
  const low = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let n = 0;
  for (const t of tokens) {
    if (t.length >= 4 ? low.includes(t) : low.split(/\s+/).some((w) => w === t || w.startsWith(t))) n++;
  }
  return n;
}

/** Required token matches given a token list. */
export function requiredOverlap(tokens: string[]): number {
  return tokens.length <= 2 ? 1 : 2;
}

/**
 * Score how topically relevant a legislative record is to a user query.
 * Generic and query-agnostic: it does NOT encode any specific subject (no
 * hardcoded topic lists), so it works for EVERY query.
 *
 * Method: weighted token overlap with inverse-frequency-style weighting.
 *   - Query tokens are matched (substring) against the record's text.
 *   - Rare / specific tokens (longer, less common in legislative boilerplate)
 *     contribute more; very common filler ("ley", "proyecto", "reforma",
 *     articles/prepositions) contributes ~0 so a record that merely contains a
 *     generic word does not rank as relevant.
 *   - A record must contain at least one non-generic query token to score > 0,
 *     which naturally excludes "parcela Reformada" / "reforma curricular" type
 *     noise while keeping "Código Penal" / "reforma fiscal" when those tokens
 *     are actually present in the query AND the record.
 *
 * Returns 0 when the record shares no specific topical token with the query.
 */
const GENERIC_TOKENS = new Set([
  "ley", "leyes", "proyecto", "proyectos", "del", "la", "el", "las", "los", "y", "de",
  "para", "con", "sobre", "por", "en", "a", "al", "lo", "que", "se", "su", "un", "una",
  "reforma", "reformas", "modifica", "modificacion", "modificando", "num", "numero",
  "codigo", "código", "articulo", "articulos", "orgánica", "organica", "sistema",
  "republica", "dominicana", "fecha", "crea", "crear", "establece", "establece",
  "mediante", "cual", "este", "esta", "dicta", "dicta",
]);

export function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .map((t) => (/^\d+[-–]\d+$/.test(t) ? t : t.replace(/[^a-z0-9]/g, "")))
    .filter((t) => t.length >= 3);
}

export function relevanceScore(text: string, query: string): number {
  const q = (query || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const t = (text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!q.trim() || !t.trim()) return 0;

  const qTokens = tokenizeQuery(q);
  if (qTokens.length === 0) return 0;

  let score = 0;
  let specificHits = 0;
  for (const tk of qTokens) {
    if (!t.includes(tk)) continue;
    if (GENERIC_TOKENS.has(tk)) {
      // Filler/subtype tokens barely move the needle.
      score += 0.15;
    } else {
      // Specific tokens are the real signal; longer = rarer = stronger.
      specificHits++;
      score += tk.length >= 6 ? 3 : tk.length >= 5 ? 2 : 1.2;
    }
  }
  // Require at least 2 specific tokens to match when the query is complex
  // (≥4 specific tokens). This prevents single-word false positives like
  // "posesión de nacionalidad" matching "drogas 50-88 posesión".
  const totalSpecific = qTokens.filter((tk) => !GENERIC_TOKENS.has(tk)).length;
  const minRequired = totalSpecific >= 4 ? 2 : 1;
  if (specificHits < minRequired) return 0;
  return score;
}

/**
 * Detect an expediente-number-like query (e.g. "50-88", "05088", "50-88-2024").
 * Such queries must match an expediente's `numero` field as a number token,
 * not as a loose substring — otherwise "50-88" wrongly matches "05088" inside
 * "05088-2024-2028-CD". Returns the normalized query digits for comparison.
 */
/**
 * Matches expediente-style number queries: digit groups separated by hyphens,
 * optionally followed by a hyphen-separated alpha suffix like "PLO-SE", "SLO-SE".
 * Examples: "01749-2014-PLO-SE", "50-88", "02257-2015". Does NOT match queries
 * with trailing keywords like "50-88 drogas".
 */
const NUMBER_QUERY_RE = /^[\d]{1,6}(-[\d]{1,6}){0,3}(-[A-Za-z]{2,8}){0,2}$/;

export function isNumberQuery(q: string): boolean {
  const s = (q || "").trim();
  if (!s) return false;
  const digits = s.replace(/[^\d]/g, "");
  // Require at least one hyphen/dash or 4+ digits to avoid matching words like
  // "ley 99" — the query must clearly look like an expediente reference.
  return NUMBER_QUERY_RE.test(s) && (s.includes("-") || digits.length >= 4);
}

/**
 * True when an expediente `numero` actually contains the number-query as a
 * whole number token (e.g. "50-88" matches "050-88-S-SE" but NOT "05088-...").
 * Substring false-positives (05088 matching "50-88") are rejected.
 *
 * Matching is done on digit groups with leading-zero equivalence: "50-88" ->
 * groups [50, 88] matches numero groups [050, 88] (same groups, zero-padded),
 * while "50-88" does NOT match [05088, ...] because the groups differ.
 */
export function numeroMatchesQuery(numero: string, query: string): boolean {
  if (!numero || !query) return false;
  const numGroups = numero.split(/[^\d]+/).filter(Boolean).map((g) => String(parseInt(g, 10)));
  const qGroups = query.split(/[^\d]+/).filter(Boolean).map((g) => String(parseInt(g, 10)));
  if (qGroups.length === 0) return false;
  if (qGroups.length === 1) {
    // Single number: match if any group equals it (handles "05088" vs "5088").
    return numGroups.includes(qGroups[0]);
  }
  // Multi-group (e.g. "50-88"): the query group sequence must appear as a
  // contiguous run at the START of the numero's groups (expediente numbers list
  // their identity groups first), or anywhere contiguously.
  for (let i = 0; i + qGroups.length <= numGroups.length; i++) {
    let ok = true;
    for (let j = 0; j < qGroups.length; j++) {
      if (numGroups[i + j] !== qGroups[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

export async function fetchText(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "ChatGobDO/1.0", Accept: "text/html" },
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export async function fetchJson(url: string, timeoutMs = 15000): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "ChatGobDO/1.0", Accept: "application/json" },
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

const LINK_RE = /<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
export function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Extract in-domain links from an HTML blob as {url,title}. */
export function extractLinks(html: string, base: string, sameHostOnly = true): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(html)) !== null) {
    const href = m[1];
    const title = stripTags(m[2]).slice(0, 180);
    if (!title || title.length < 4) continue;
    try {
      const abs = new URL(href, base).href;
      if (sameHostOnly) {
        const host = new URL(abs).hostname.replace(/^www\./, "");
        const baseHost = new URL(base).hostname.replace(/^www\./, "");
        if (host !== baseHost && !host.endsWith("." + baseHost)) continue;
      }
      const key = abs.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: abs, title });
    } catch {
      continue;
    }
  }
  return out;
}

/** Map a URL to a known Dominican Republic government institution. */
export function classifyInstitution(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("camaradediputados.gob.do")) return "Cámara de Diputados";
  if (u.includes("senado.gob.do")) return "Senado de la República";
  if (u.includes("presidencia.gob.do")) return "Presidencia de la República";
  if (u.includes("consultoria.gov.do")) return "Consultoría Jurídica";
  if (u.includes("tribunalconstitucional.gob.do")) return "Tribunal Constitucional";
  if (u.includes("dgcp.gob.do")) return "DGCP";
  if (u.includes("datos.gob.do")) return "Datos Abiertos RD";
  if (u.includes("gob.do")) return "Portal Oficial Dominicano";
  return "Fuente Web";
}
