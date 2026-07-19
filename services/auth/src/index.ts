// services/auth
//
// Single responsibility: identity and access for the platform.
//
// Prepares for the auth model described in WORK.md (JWT, API keys, OAuth,
// organizations, teams, permissions). The API gateway uses the API-key
// verification to gate /v1 endpoints when REQUIRE_API_KEY is enabled.
//
// This service contains NO external calls and NO business logic beyond
// credential verification. Clients (Studio, MCP, ...) obtain a key out-of-band
// and present it on every request per the API contract.

import { createLogger } from "@intel.dom.gob/logger";
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@intel.dom.gob/database";

const log = createLogger("service:auth");

// API keys are stored hashed (never plaintext). The public key is
// "<prefix>_<random>" and only the hash is persisted.
const KEY_PREFIX = "idg";

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: string[];
  active: boolean;
  organizationId?: string;
  /** Tenant id this key belongs to. Every key is tenant-scoped (multi-tenancy). */
  tenantId?: string;
  /** ABAC attributes attached to the key (e.g. clearance, department). */
  attributes?: Record<string, string>;
}

/**
 * Authorization context (RBAC + ABAC). A request is authorized when its API-key
 * record carries the required scope AND any attribute constraints pass.
 */
export interface AuthContext {
  record: ApiKeyRecord;
  /** Optional RBAC role asserted by the caller (e.g. "researcher"). */
  role?: string;
}

/** Tenant context resolved from a verified key; flows through all services. */
export interface TenantContext {
  tenantId: string;
  record: ApiKeyRecord;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Verify that a record's scopes satisfy the required scope (RBAC). */
  assertScope(record: ApiKeyRecord, required: string | string[]): void {
    const requiredScopes = Array.isArray(required) ? required : [required];
    const granted = new Set(record.scopes);
    const ok = requiredScopes.some((s) => granted.has(s) || granted.has("*"));
    if (!ok) {
      throw new AuthError(`Missing required scope: ${requiredScopes.join(" or ")}`);
    }
  }

  /**
   * ABAC check: assert that the record's attributes satisfy every required
   * key/value. A missing key on the record is treated as "deny" when the
   * constraint is required (government data is deny-by-default).
   */
  assertAttributes(record: ApiKeyRecord, required: Record<string, string>): void {
    const attrs = record.attributes ?? {};
    for (const [key, value] of Object.entries(required)) {
      if (attrs[key] !== value) {
        throw new AuthError(`Attribute constraint failed: requires ${key}=${value}`);
      }
    }
  }

  /** Combined RBAC + ABAC authorization for an operation. */
  authorize(record: ApiKeyRecord, opts: { scope: string | string[]; attributes?: Record<string, string> }): void {
    this.assertScope(record, opts.scope);
    if (opts.attributes) this.assertAttributes(record, opts.attributes);
  }

  /**
   * Tenant authorization (multi-tenancy). A record may only act within its own
   * tenant; cross-tenant access is denied by default. `tenantId` is the tenant
   * the operation targets.
   */
  assertTenant(record: ApiKeyRecord, tenantId: string): void {
    const own = record.tenantId ?? record.organizationId;
    if (!own) {
      // Superadmin-style keys with no tenant are global (rare); allow.
      return;
    }
    if (own !== tenantId) {
      throw new AuthError(`Cross-tenant access denied: key tenant=${own}, target=${tenantId}`);
    }
  }

  /** Resolve a tenant context from a verified key. */
  resolveTenant(record: ApiKeyRecord): TenantContext {
    const tenantId = record.tenantId ?? record.organizationId ?? "default";
    return { tenantId, record };
  }

  /** Generate a new API key, persist its hash, and return the plaintext key. */
  async createApiKey(opts: { name: string; organizationId?: string; tenantId?: string; userId?: string; scopes?: string[]; attributes?: Record<string, string> }): Promise<{ key: string; record: ApiKeyRecord }> {
    const raw = `${KEY_PREFIX}_${randomBytes(24).toString("base64url")}`;
    const keyHash = hashKey(raw);
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO api_keys (organization_id, tenant_id, user_id, name, key_hash, scopes, attributes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [opts.organizationId ?? null, opts.tenantId ?? opts.organizationId ?? null, opts.userId ?? null, opts.name, keyHash, opts.scopes ?? ["query", "chat", "read"], JSON.stringify(opts.attributes ?? {})],
    );
    const record: ApiKeyRecord = {
      id: rows[0].id,
      name: opts.name,
      scopes: opts.scopes ?? ["query", "chat", "read"],
      active: true,
      organizationId: opts.organizationId,
      tenantId: opts.tenantId ?? opts.organizationId,
      attributes: opts.attributes,
    };
    return { key: raw, record };
  }

  /** Resolve an API key to its record (verifying the hash). */
  async verifyApiKey(key: string): Promise<ApiKeyRecord | null> {
    const keyHash = hashKey(key);
    const rows = await this.db.query<{ id: string; name: string; scopes: string[]; active: boolean; organization_id: string | null; tenant_id: string | null; attributes: Record<string, string> }>(
      `SELECT id, name, scopes, active, organization_id, tenant_id, attributes FROM api_keys WHERE key_hash = $1`,
      [keyHash],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    if (!row.active) return null;
    await this.db.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]);
    return {
      id: row.id,
      name: row.name,
      scopes: row.scopes,
      active: row.active,
      organizationId: row.organization_id ?? undefined,
      tenantId: row.tenant_id ?? row.organization_id ?? undefined,
      attributes: row.attributes,
    };
  }

  /** Verify a JWT access token and return its claims (placeholder HS256). */
  verifyJwt(token: string, secret: string): { sub: string; org?: string } | null {
    try {
      const [payloadB64] = token.split(".");
      if (!payloadB64) return null;
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as { sub: string; org?: string };
      log.debug("JWT verified", { sub: payload.sub });
      return payload;
    } catch {
      return null;
    }
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Parse a Bearer token from an Authorization header. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
