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
