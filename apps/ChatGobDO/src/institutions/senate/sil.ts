import type { InstitutionLaw, InstitutionResult } from "../types";
import { relevanceScore, tokenizeQuery } from "../shared";
import { chromium, type Browser, type BrowserContext } from "playwright";

// Senate SIL (Sistema de Información Legislativa) scraper.
//
// The Senado de la República exposes its legislative database through a legacy
// ASP.NET WebForms application at http://www.senado.gov.do/wfilemaster/. The
// public "Ingresar consultante" entry point authenticates as the read-only
// `ConsultaPublica` SQL user (its credentials are embedded in the login page's
// __VIEWSTATE and are used by every anonymous browser session). Once logged in,
// the following endpoints are available:
//
//   * colecciones.aspx                 -> list of collections (legislatures)
//   * lista_expedientes.aspx?coleccion=N
//                                     -> paged GridView of expedientes (50/page)
//   * Ficha.aspx?IdExpediente=N&numeropagina=1&ContExpedientes=M&Coleccion=K
//                                     -> full bill/iniciativa detail
//   * documentoasociado.aspx?codigoexpediente=N
//                                     -> public PDF viewer (no auth required)
//
// NOTE: server-side pagination and the `txtBuscar` search are POST WebForms
// callbacks that the server rejects for reconstructed payloads (HTTP 500). We
// therefore use GET navigation (which works reliably) and perform any search
// client-side by filtering the returned rows. Page 1 of each collection returns
// the most recent records, which is what matters for current legislative action.

const SENADO_HOST = "http://www.senado.gov.do";
const WF = `${SENADO_HOST}/wfilemaster`;

// Colecciones known to carry data (verified live). 53 = Iniciativas is the
// primary legislative source; the others expose sessions / legislators / etc.
export const SENATE_COLLECTIONS: { id: number; name: string; key: string }[] = [
  { id: 53, name: "Colección de Iniciativas", key: "iniciativas" },
  { id: 54, name: "Colección de Sesiones", key: "sesiones" },
  { id: 55, name: "Colección de Comisiones", key: "comisiones" },
  { id: 56, name: "Colección de Legisladores", key: "legisladores" },
  { id: 57, name: "Colección de Actividades de Comisiones", key: "actividades" },
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface Session {
  cookie: string;
  expires: number;
}

let cachedSession: Session | null = null;
const SESSION_TTL_MS = 5 * 60 * 1000;

// The public "Ingresar consultante" login is a legacy ASP.NET WebForms postback
// that rejects any reconstructed (raw-HTTP) POST via EventValidation. We therefore
// drive a real headless browser to click the button, capture the resulting
// `ASP.NET_SessionId` cookie (the "section token"), and then reuse it for fast
// plain-HTTP GET searches. The browser is only spun up to (re)issue the token.
let browserSingleton: Browser | null = null;
let browserCtx: BrowserContext | null = null;

async function getBrowserContext(): Promise<BrowserContext> {
  if (browserCtx) return browserCtx;
  browserSingleton = await chromium.launch();
  browserCtx = await browserSingleton.newContext({ userAgent: USER_AGENT });
  return browserCtx;
}

// ---- HTML helpers -------------------------------------------------------

const ENTITIES: Record<string, string> = {
  "&aacute;": "á", "&eacute;": "é", "&iacute;": "í", "&oacute;": "ó",
  "&uacute;": "ú", "&ntilde;": "ñ", "&Aacute;": "Á", "&Eacute;": "É",
  "&Iacute;": "Í", "&Oacute;": "Ó", "&Uacute;": "Ú", "&Ntilde;": "Ñ",
  "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">",
  "&#241;": "ñ", "&#209;": "Ñ", "&#243;": "ó", "&#211;": "Ó",
  "&#225;": "á", "&#233;": "é", "&#237;": "í", "&#250;": "ú",
  "&#193;": "Á", "&#201;": "É", "&#205;": "Í", "&#218;": "Ú",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&[a-záéíóúñAÉÍÓÚÑ]+;/g, (m) => ENTITIES[m] ?? m);
}

function stripHtml(s: string): string {
  return decodeEntities(
    s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  ).trim();
}

function foldAccents(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ---- HTTP ---------------------------------------------------------------
// All SIL requests MUST run inside the authenticated Playwright browser
// context. A raw Node `fetch` with the captured cookie is rejected by the
// server (it re-issues the login page), so we navigate via the live page and
// read its DOM instead. `cookie` is accepted for signature compatibility but
// the browser context is what actually carries the session.

let silPage: import("playwright").Page | null = null;

async function getSilPage(): Promise<import("playwright").Page> {
  const ctx = await getBrowserContext();
  if (silPage && !silPage.isClosed()) return silPage;
  // Ensure authenticated before reusing the page.
  await loginConsultaPublica();
  silPage = await ctx.newPage();
  return silPage;
}

async function getHtml(url: string, _cookie?: string): Promise<string> {
  const page = await getSilPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return await page.content();
}

async function postForm(url: string, cookie: string, body: Record<string, string>): Promise<{ html: string; setCookie?: string }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.append(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml",
        Cookie: cookie,
      },
      body: params.toString(),
    });
    const setCookie = resp.headers.get("set-cookie") ?? undefined;
    const html = await resp.text();
    return { html, setCookie };
  } finally {
    clearTimeout(t);
  }
}

function extractField(html: string, name: string): string | undefined {
  const re = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? m[1] : undefined;
}

// ---- Auth (public "Ingresar consultante") -------------------------------

export async function loginConsultaPublica(force = false): Promise<string> {
  if (!force && cachedSession && cachedSession.expires > Date.now()) {
    return cachedSession.cookie;
  }
  // Drive a real headless browser to click the "Ingresar consultante" image
  // button. A reconstructed HTTP POST is rejected by ASP.NET EventValidation, but
  // a genuine browser click succeeds and establishes the authenticated session.
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  try {
    await page.goto(`${WF}/login.aspx`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("#imgBtnIngresoAlternativo").click({ timeout: 20000 });
    // Wait for the post-login redirect to colecciones.aspx (DB context set).
    await page.waitForURL("**/colecciones.aspx**", { timeout: 20000 }).catch(() => {});
    const cookies = await ctx.cookies();
    const sess = cookies.find((c) => c.name === "ASP.NET_SessionId");
    if (!sess || !sess.value) throw new Error("No ASP.NET_SessionId after public login");
    cachedSession = { cookie: sess.value, expires: Date.now() + SESSION_TTL_MS };
    return sess.value;
  } finally {
    await page.close().catch(() => {});
  }
}

// ---- Parsing ------------------------------------------------------------

export interface SenateExpediente {
  idExpediente: number;
  numero: string;
  tipo: string;
  descripcion: string;
  fecha: string;
  estado: string;
  coleccion: number;
  fichaUrl: string;
}

interface RawRow {
  numero: string;
  tipo: string;
  descripcion: string;
  fecha: string;
  estado: string;
  idExpediente: number;
}

const FICHA_RE = /Ficha\.aspx\?IdExpediente=(\d+)/;
const TD_RE = /<td[^>]*>([\s\S]*?)<\/td>/gi;

function parseListRows(html: string, coleccion: number): SenateExpediente[] {
  const rows: SenateExpediente[] = [];
  const seen = new Set<number>();
  // Each data row is a <tr> containing 5 <td>s. The first three <td>s hold the
  // same Ficha.aspx link (número / tipo / descripción); the last two are the
  // fecha and estado text cells.
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html)) !== null) {
    const trHtml = tr[1];
    const ficha = trHtml.match(FICHA_RE);
    if (!ficha) continue;
    const id = parseInt(ficha[1], 10);
    if (seen.has(id)) continue;
    const cells = [...trHtml.matchAll(TD_RE)].map((c) => stripHtml(c[1]).replace(/\s+/g, " ").trim());
    if (cells.length < 3) continue;
    seen.add(id);
    rows.push({
      idExpediente: id,
      numero: cells[0],
      tipo: cells[1],
      descripcion: cells[2],
      fecha: cells[3] ?? "",
      estado: cells[4] ?? "",
      coleccion,
      fichaUrl: `${WF}/Ficha.aspx?IdExpediente=${id}&numeropagina=1&ContExpedientes=2486&Coleccion=${coleccion}`,
    });
  }
  return rows;
}

// ---- Public API ---------------------------------------------------------

/** Fetch colecciones (collections) metadata. */
export async function getColecciones(): Promise<{ id: number; name: string }[]> {
  const cookie = await loginConsultaPublica();
  const html = await getHtml(`${WF}/colecciones.aspx?_nc=${Date.now()}`, cookie);
  const out: { id: number; name: string }[] = [];
  const re = /lista_expedientes\.aspx\?coleccion=(\d+)/g;
  let m: RegExpExecArray | null;
  const seen = new Set<number>();
  while ((m = re.exec(html)) !== null) {
    const id = parseInt(m[1], 10);
    if (seen.has(id)) continue;
    seen.add(id);
    const known = SENATE_COLLECTIONS.find((c) => c.id === id);
    out.push({ id, name: known?.name ?? `Colección ${id}` });
  }
  return out;
}

/** Get the first page (most recent 50) of a collection's expedientes. */
export async function getListPage(coleccion: number): Promise<SenateExpediente[]> {
  const cookie = await loginConsultaPublica();
  const url = `${WF}/lista_expedientes.aspx?coleccion=${coleccion}&_nc=${Date.now()}`;
  const html = await getHtml(url, cookie);
  return parseListRows(html, coleccion);
}

/**
 * Search the Senate SIL for a query using the server-side `Busquedalibre`
 * parameter on `lista_expedientes.aspx`. This searches ALL records in the
 * collection (not just the newest 50), so a penal-reform bill from any
 * legislature surfaces.
 *
 * `Busquedalibre` does substring matching, so a multi-word phrase like
 * "reforma penal" returns nothing unless a record contains that exact
 * substring. We therefore query with the raw phrase AND individual meaningful
 * tokens (most-specific first), then rank every returned record against the
 * token that actually retrieved it and drop score-0 (off-topic) records via
 * relevanceScore().
 */
export async function searchExpedientes(
  query: string,
  opts: { colecciones?: number[]; maxResults?: number } = {}
): Promise<SenateExpediente[]> {
  const colecciones = opts.colecciones ?? [53];
  const byId = new Map<number, { exp: SenateExpediente; score: number }>();
  const cookie = await loginConsultaPublica();
  // Raw phrase first, then individual tokens (most-specific / longest first).
  // Also extract number-like patterns (e.g. "50-88") from the query so they are
  // searched with hyphens preserved — tokenizeQuery now keeps them, but adding
  // them explicitly as attempts guarantees the SIL gets the exact format.
  const tokens = tokenizeQuery(query);
  const numberPatterns = (query.match(/\d+\s*[-–]\s*\d+/g) || []).map((m) => m.replace(/\s+/g, ""));
  const attempts: string[] = Array.from(new Set([query, ...numberPatterns, ...tokens])).sort(
    (a, b) => b.length - a.length
  );
  for (const kw of attempts) {
    if (!kw || byId.size >= (opts.maxResults ?? 15) * 3) continue;
    for (const c of colecciones) {
      try {
        const url = `${WF}/lista_expedientes.aspx?coleccion=${c}&Busquedalibre=${encodeURIComponent(kw)}&_nc=${Date.now()}`;
        const html = await getHtml(url, cookie);
        const rows = parseListRows(html, c);
        const isRawQuery = kw === query;
        // Number-like patterns extracted from the query (e.g. "50-88") are
        // trusted the same way as the raw query — the SIL server matched them,
        // and their result text may not literally contain the hyphenated form.
        const isNumberPattern = /^\d+[-–]\d+$/.test(kw);
        for (const exp of rows) {
          if (byId.has(exp.idExpediente)) continue;
          const hay = `${exp.numero} ${exp.tipo} ${exp.descripcion} ${exp.estado} ${exp.fecha}`;
          // For the raw query the server already matched it, so trust the hit
          // (covers ID-like queries such as "50-88" whose result text may not
          // literally contain the digits). For token-based fallback attempts we
          // apply the relevance gate so only on-topic records survive.
          const s = (isRawQuery || isNumberPattern) ? 1 : relevanceScore(hay, kw);
          if (s > 0) byId.set(exp.idExpediente, { exp, score: s });
        }
      } catch {
        // skip unavailable collection / transient failure
      }
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .map((x) => x.exp)
    .slice(0, opts.maxResults ?? 15);
}

/** Full detail of a single expediente (Ficha). */
export async function getFicha(idExpediente: number, coleccion = 53): Promise<Record<string, string>> {
  const cookie = await loginConsultaPublica();
  const url = `${WF}/Ficha.aspx?IdExpediente=${idExpediente}&numeropagina=1&ContExpedientes=2486&Coleccion=${coleccion}`;
  const html = await getHtml(url, cookie);
  const fields: Record<string, string> = {};
  // Rows are: <td>LABEL</td><td>...<textarea/input/select>VALUE...</td>
  const rowRe = /<td[^>]*>\s*([^<][\s\S]*?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const key = stripHtml(m[1]).replace(/:$/, "").trim();
    if (!key) continue;
    // Pull the field value from a textarea/input/select, else the cell text.
    const valMatch = m[2].match(/<(?:textarea|input)[^>]*>([\s\S]*?)<\/(?:textarea)>/i)
      || m[2].match(/<input[^>]*value="([^"]*)"/i)
      || m[2].match(/<select[^>]*>[\s\S]*?<option[^>]*selected[^>]*>([\s\S]*?)<\/option>/i);
    const val = valMatch ? stripHtml(valMatch[1]) : stripHtml(m[2]);
    if (key && val && !fields[key]) fields[key] = val;
  }
  return fields;
}

/** Public PDF/document URL associated with an expediente (no auth needed). */
export async function getDocumento(codigoexpediente: number): Promise<string | null> {
  const url = `${WF}/documentoasociado.aspx?codigoexpediente=${codigoexpediente}`;
  const html = await getHtml(url);
  // The PDF src is assigned to the #pdfFrame iframe via JS; extract the literal.
  const m = html.match(/pdfFrame[^>]*src="([^"]+\.pdf[^"]*)"|src="([^"]+documento[^"]*)"|'(\/[^']+\.pdf)'/);
  if (m) return m[1] || m[2] || m[3] || null;
  // Fallback: any .pdf reference on the page.
  const pdf = html.match(/href="([^"]+\.pdf)"/) || html.match(/src="([^"]+\.pdf)"/);
  return pdf ? pdf[1] : null;
}

// ---- Adapters for the institution interface -----------------------------

export function expedienteToLaw(exp: SenateExpediente): InstitutionLaw {
  return {
    numero: exp.numero,
    tipo: exp.tipo,
    descripcion: exp.descripcion,
    estado: exp.estado,
    url: exp.fichaUrl,
    materia: "Senado SIL",
    fechaDeposito: exp.fecha,
  };
}

export function expedienteToResult(exp: SenateExpediente): InstitutionResult {
  return {
    title: `${exp.numero} — ${exp.descripcion}`.slice(0, 220),
    url: exp.fichaUrl,
    snippet: `Tipo: ${exp.tipo} | Estado: ${exp.estado} | Fecha: ${exp.fecha}`,
    engine: "senado-sil",
    institution: "Senado de la República",
  };
}
