// Orchestrator helpers: classify, tag, and split retrieved results into the
// FLUJO streams. Pure functions, no I/O.

import type { InstitutionResult } from "@intel.dom.gob/types";

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  engine: string;
}

// Curated Dominican media + official hosts used to scope `site:` queries.
export const DR_NEWS_HOSTS: string[] = [
  "listindiario.com", "diariolibre.com", "hoy.com.do", "elnacional.com.do", "acento.com.do",
  "elcaribe.com.do", "almomento.net", "eldia.com.do",
  "presidencia.gob.do", "camaradediputados.gob.do", "senado.gob.do",
  "tribunalconstitucional.gob.do", "dgcp.gob.do", "consultoria.gov.do", "datos.gob.do",
];

const DR_MEDIA = [
  "listin.com.do", "diariolibre.com", "hoy.com.do", "elmundo.com.do", "elnuevodiario.com.do",
  "almomento.net", "acento.com.do", "elcaribe.com.do", "eldeporte.com.do", "codetel.com.do",
  "cdn.com.do", "rtvc.gov.do", "presidencia.gob.do", "gob.do",
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isDominicanSource(host: string): boolean {
  return host.endsWith(".do") || DR_MEDIA.some((m) => host === m || host.endsWith("." + m));
}

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

export function isTribunalSource(item: { institution?: string; url?: string }): boolean {
  const inst = (item.institution || "").toLowerCase();
  const url = (item.url || "").toLowerCase();
  return inst.includes("tribunal") || url.includes("tribunalconstitucional");
}

export function isDatosSource(item: { institution?: string; url?: string }): boolean {
  const inst = (item.institution || "").toLowerCase();
  const url = (item.url || "").toLowerCase();
  return inst.includes("datos") || url.includes("datos.gob.do");
}

export function isCongressStream(item: { institution?: string; url?: string }): boolean {
  try {
    const h = hostOf(item.url ?? "");
    void h;
  } catch {}
  const inst = (item.institution || "").toLowerCase();
  return inst.includes("senado") || inst.includes("diputados") || inst.includes("presidencia") ||
    inst.includes("cámara") || inst.includes("tribunal") || inst.includes("dgcp") || inst.includes("datos");
}

export function isOtherOfficial(item: { institution?: string; url?: string }): boolean {
  const h = hostOf(item.url ?? "");
  if ((h.endsWith(".gob.do") || h === "gob.do") && !isCongressStream(item)) return true;
  return false;
}

export function tagResult(r: SearchResultItem, hostToPortal: Map<string, string>): InstitutionResult {
  const host = hostOf(r.url);
  return { ...r, institution: hostToPortal.get(host) || classifyInstitution(r.url) };
}

export function buildHostToPortal(targetServices: { url: string; name: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of targetServices) {
    const host = s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    map.set(host, s.name);
    if (host === "camaradediputados.gob.do") map.set("diputadosrd.gob.do", s.name);
    if (host === "senado.gob.do") map.set("senadord.gob.do", s.name);
  }
  return map;
}
