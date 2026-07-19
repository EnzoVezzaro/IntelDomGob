// packages/database
//
// Minimal, ORM-free persistence layer for the platform.
//
// This package is intentionally small: it provides a lazy PostgreSQL pool plus
// an idempotent migration runner. The schema is structured so future features
// (users, organizations, API keys, conversations, prompts, agents, workflows,
// usage, billing, MCP servers, tool registry) fit naturally without schema
// churn. No business logic lives here — services own that.

import { Pool } from "pg";
import { createLogger } from "@intel.dom.gob/logger";
import type { PlatformConfig } from "@intel.dom.gob/config";

const log = createLogger("database");

// Schema for the entities described in WORK.md "DATABASE" section. Each table is
// created IF NOT EXISTS so migrations are safe to re-run.
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS tenants (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     slug TEXT UNIQUE NOT NULL,
     name TEXT NOT NULL,
     plan TEXT NOT NULL DEFAULT 'free',
     settings JSONB NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS organizations (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     slug TEXT UNIQUE NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
     email TEXT UNIQUE NOT NULL,
     display_name TEXT,
     role TEXT NOT NULL DEFAULT 'member',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
   `CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes TEXT[] NOT NULL DEFAULT '{"query","chat","read"}',
      attributes JSONB NOT NULL DEFAULT '{}',
      active BOOLEAN NOT NULL DEFAULT true,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  `CREATE TABLE IF NOT EXISTS providers (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     enabled BOOLEAN NOT NULL DEFAULT true,
     config JSONB NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS conversations (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
     user_id UUID REFERENCES users(id) ON DELETE SET NULL,
     title TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS prompts (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     body TEXT NOT NULL,
     variables TEXT[] NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS agents (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     description TEXT,
     config JSONB NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS workflows (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     definition JSONB NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS usage (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
     user_id UUID REFERENCES users(id) ON DELETE SET NULL,
     kind TEXT NOT NULL,
     tokens INTEGER NOT NULL DEFAULT 0,
     cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS billing (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
     plan TEXT NOT NULL DEFAULT 'free',
     period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
     period_end TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS mcp_servers (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     url TEXT NOT NULL,
     enabled BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS tool_registry (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     name TEXT NOT NULL UNIQUE,
     description TEXT,
     service TEXT NOT NULL,
     enabled BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];

export class Database {
  private pool: Pool | null = null;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  /** Lazily create the pool so the package can be imported without a DB. */
  getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: this.connectionString, max: 10 });
    }
    return this.pool;
  }

  /** Idempotently apply all migrations. Safe to call on startup. */
  async migrate(): Promise<void> {
    const pool = this.getPool();
    for (const sql of MIGRATIONS) {
      await pool.query(sql);
    }
    log.info("Database migrations applied", { tables: MIGRATIONS.length });
  }

  async query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.getPool().query(text, params);
    return result.rows as T[];
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }
}

export function createDatabase(config: PlatformConfig): Database {
  return new Database(config.databaseUrl);
}
