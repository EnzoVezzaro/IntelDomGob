// Studio API client.
//
// The Studio is a pure client of the API gateway. It NEVER talks to services or
// providers directly. The base URL is derived from the current origin so that
// the same build works behind the reverse proxy (api.localhost / api.<domain>).
// An API key / bearer token may be supplied by the user (stored locally) and is
// forwarded on every request when the API enforces REQUIRE_API_KEY.

import { createClient, type IntelDomGobClient } from "@intel.dom.gob/sdk";

const TOKEN_KEY = "dr_gov_intel_apikey";

function resolveApiBaseUrl(): string {
  // In the browser we are served from studio.<domain>; the API is at api.<domain>.
  if (typeof window !== "undefined") {
    const host = window.location.host; // e.g. studio.localhost or studio.intel.dom.gob
    const dot = host.indexOf(".");
    if (dot > 0) {
      const domain = host.slice(dot + 1);
      return `${window.location.protocol}//api.${domain}`;
    }
    return "/api-proxy";
  }
  return process.env.API_BASE_URL || "http://api:4000";
}

export function getStoredToken(): string | undefined {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t || undefined;
  } catch {
    return undefined;
  }
}

export function setStoredToken(token: string | undefined): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export const apiClient: IntelDomGobClient = createClient({
  baseUrl: resolveApiBaseUrl(),
  token: getStoredToken(),
});
