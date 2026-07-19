// Centralized environment configuration.
//
// Every package/service reads configuration through this module so that the
// exact same code path runs in development (subdomains) and production
// (real domains) — only the values change. Configuration is validated at
// startup; missing required values fail fast.
//
// The platform follows a "develop exactly like production" philosophy: the only
// difference between environments is the values in `.env`.

export interface PlatformConfig {
  env: "development" | "production" | "test";
  domain: string;
  /** Internal docker service name for the orchestrator, e.g. "orchestrator". */
  orchestratorUrl: string;
  /** Internal docker service name for searxng, e.g. "searxng". */
  searxngUrl: string;
  /** Comma-separated list of enabled AI provider ids. */
  enabledAiProviders: string[];
  /** Comma-separated list of enabled search provider ids. */
  enabledSearchProviders: string[];
  defaultAiProvider: string;
  defaultSearchProvider: string;
  logFormat: "development" | "production";
  /** Public-facing CORS origins (comma separated). */
  corsOrigins: string[];
  apiPort: number;
  studioPort: number;
  requestTimeoutMs: number;
  /** PostgreSQL connection string for the persistence layer. */
  databaseUrl: string;
  /** Redis connection string for cache / rate-limit state. */
  redisUrl: string;
  /** When true, /v1 endpoints require a valid API key. Dev defaults to false. */
  requireApiKey: boolean;
}

const BOOLEAN_TRUE = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["0", "false", "no", "off"]);

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (BOOLEAN_TRUE.has(value.toLowerCase())) return true;
  if (BOOLEAN_FALSE.has(value.toLowerCase())) return false;
  return fallback;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function required(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    throw new Error(`Missing required configuration: ${key}`);
  }
  return v;
}

export function loadConfig(): PlatformConfig {
  const env = (process.env.NODE_ENV as PlatformConfig["env"]) ?? "development";
  const domain = process.env.DOMAIN ?? (env === "production" ? "intel.dom.gob" : "localhost");

  const config: PlatformConfig = {
    env,
    domain,
    orchestratorUrl: process.env.ORCHESTRATOR_URL ?? "http://orchestrator:4000",
    searxngUrl: process.env.SEARXNG_URL ?? "http://searxng:8080",
    enabledAiProviders: list(process.env.AI_PROVIDERS, ["gemini"]),
    enabledSearchProviders: list(process.env.SEARCH_PROVIDERS, ["searxng"]),
    defaultAiProvider: process.env.DEFAULT_AI_PROVIDER ?? "gemini",
    defaultSearchProvider: process.env.DEFAULT_SEARCH_PROVIDER ?? "searxng",
    logFormat: (process.env.LOG_FORMAT as PlatformConfig["logFormat"]) ?? (env === "production" ? "production" : "development"),
    corsOrigins: list(process.env.CORS_ORIGINS, [`https://studio.${domain}`, `https://admin.${domain}`]),
    apiPort: Number(process.env.API_PORT ?? 4000),
    studioPort: Number(process.env.STUDIO_PORT ?? 5173),
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30000),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://intel:intel@postgres:5432/inteldomgob",
    redisUrl: process.env.REDIS_URL ?? "redis://dragonfly:6379",
    requireApiKey: bool(process.env.REQUIRE_API_KEY, env === "production"),
  };

  // Lazily validate only what production strictly requires.
  if (env === "production") {
    required("DOMAIN");
  }

  return config;
}

// Load once per process so validation happens a single time.
export const config: PlatformConfig = loadConfig();
