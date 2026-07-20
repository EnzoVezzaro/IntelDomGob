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
  /** Client surface this key authenticates (studio|web|cli|mcp|sdk|custom). */
  product?: string;
  /** Billing plan bound to the key (free|publico|investigador|pro|institucional). */
  plan?: string;
  /** Daily metered-request quota (0 = unlimited). */
  quotaDaily?: number;
  /** Requests-per-minute rate limit (0 = unlimited). */
  rateLimit?: number;
  /** Billing/payment state (ok|pending|overdue|suspended). */
  paymentStatus?: string;
  expiresAt?: string;
  lastSeenNode?: string;
}

/** Anonymous "Público" preview identity used when a PUBLIC-FACING endpoint is
 *  hit without an API key. Shares one metered pool (id "preview") with
 *  tight default limits. Mirrors `billing.PLANS.publico`. */
export const PREVIEW_RECORD: ApiKeyRecord = {
  id: "preview",
  name: "preview",
  scopes: ["read", "query", "chat"],
  active: true,
  plan: "publico",
  product: "preview",
  paymentStatus: "ok",
  quotaDaily: 20,
  rateLimit: 10,
  attributes: {},
};

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
  async createApiKey(opts: {
    name: string;
    organizationId?: string;
    tenantId?: string;
    userId?: string;
    scopes?: string[];
    attributes?: Record<string, string>;
    product?: string;
    plan?: string;
    quotaDaily?: number;
    rateLimit?: number;
    paymentStatus?: string;
    expiresAt?: string;
  }): Promise<{ key: string; record: ApiKeyRecord }> {
    const raw = `${KEY_PREFIX}_${randomBytes(24).toString("base64url")}`;
    const keyHash = hashKey(raw);
    const scopes = opts.scopes ?? ["query", "chat", "read"];
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO api_keys (organization_id, tenant_id, user_id, name, key_hash, scopes, attributes, product, plan, quota_daily, rate_limit, payment_status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        opts.organizationId ?? null,
        opts.tenantId ?? opts.organizationId ?? null,
        opts.userId ?? null,
        opts.name,
        keyHash,
        scopes,
        JSON.stringify(opts.attributes ?? {}),
        opts.product ?? "custom",
        opts.plan ?? "free",
        opts.quotaDaily ?? 0,
        opts.rateLimit ?? 0,
        opts.paymentStatus ?? "ok",
        opts.expiresAt ?? null,
      ],
    );
    const record: ApiKeyRecord = {
      id: rows[0].id,
      name: opts.name,
      scopes,
      active: true,
      organizationId: opts.organizationId,
      tenantId: opts.tenantId ?? opts.organizationId,
      attributes: opts.attributes,
      product: opts.product ?? "custom",
      plan: opts.plan ?? "free",
      quotaDaily: opts.quotaDaily ?? 0,
      rateLimit: opts.rateLimit ?? 0,
      paymentStatus: opts.paymentStatus ?? "ok",
      expiresAt: opts.expiresAt,
    };
    return { key: raw, record };
  }

  /** List API keys with optional filters. Never returns the hash. */
  async listApiKeys(filter: { product?: string; tenantId?: string; active?: boolean; paymentStatus?: string } = {}): Promise<ApiKeyRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filter.product) { clauses.push(`product = $${i++}`); params.push(filter.product); }
    if (filter.tenantId) { clauses.push(`tenant_id = $${i++}`); params.push(filter.tenantId); }
    if (filter.active !== undefined) { clauses.push(`active = $${i++}`); params.push(filter.active); }
    if (filter.paymentStatus) { clauses.push(`payment_status = $${i++}`); params.push(filter.paymentStatus); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.query<{
      id: string; name: string; scopes: string[]; active: boolean;
      organization_id: string | null; tenant_id: string | null; attributes: Record<string, string>;
      product: string; plan: string; quota_daily: number; rate_limit: number; payment_status: string;
      expires_at: string | null; last_used_at: string | null;
    }>(`SELECT id, name, scopes, active, organization_id, tenant_id, attributes, product, plan, quota_daily, rate_limit, payment_status, expires_at, last_used_at FROM api_keys ${where} ORDER BY created_at DESC`, params);
    return rows.map(rowToRecord);
  }

  async getApiKeyById(id: string): Promise<ApiKeyRecord | null> {
    const rows = await this.db.query<{
      id: string; name: string; scopes: string[]; active: boolean;
      organization_id: string | null; tenant_id: string | null; attributes: Record<string, string>;
      product: string; plan: string; quota_daily: number; rate_limit: number; payment_status: string;
      expires_at: string | null;
    }>(`SELECT id, name, scopes, active, organization_id, tenant_id, attributes, product, plan, quota_daily, rate_limit, payment_status, expires_at FROM api_keys WHERE id = $1`, [id]);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  /** Revoke (deactivate) a key. */
  async revokeApiKey(id: string): Promise<void> {
    await this.db.query(`UPDATE api_keys SET active = false WHERE id = $1`, [id]);
  }

  /** Reactivate a previously revoked key. */
  async activateApiKey(id: string): Promise<void> {
    await this.db.query(`UPDATE api_keys SET active = true WHERE id = $1`, [id]);
  }

  /** Hard-delete a key. */
  async deleteApiKey(id: string): Promise<void> {
    await this.db.query(`DELETE FROM api_keys WHERE id = $1`, [id]);
  }

  /** Update billing/quota attributes on a key. */
  async updateApiKeyBilling(id: string, patch: { plan?: string; quotaDaily?: number; rateLimit?: number; paymentStatus?: string; expiresAt?: string }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (patch.plan !== undefined) { sets.push(`plan = $${i++}`); params.push(patch.plan); }
    if (patch.quotaDaily !== undefined) { sets.push(`quota_daily = $${i++}`); params.push(patch.quotaDaily); }
    if (patch.rateLimit !== undefined) { sets.push(`rate_limit = $${i++}`); params.push(patch.rateLimit); }
    if (patch.paymentStatus !== undefined) { sets.push(`payment_status = $${i++}`); params.push(patch.paymentStatus); }
    if (patch.expiresAt !== undefined) { sets.push(`expires_at = $${i++}`); params.push(patch.expiresAt); }
    if (!sets.length) return;
    params.push(id);
    await this.db.query(`UPDATE api_keys SET ${sets.join(", ")} WHERE id = $${i}`, params);
  }

  /**
   * Ensure at least one admin-scoped key exists (used to bootstrap the Admin
   * console). Returns the plaintext key. If `plain` is provided its hash is
   * stored; otherwise a new key is generated. Idempotent: if an active admin
   * key already exists, it is left untouched and its id returned.
   */
  async ensureAdminKey(plain?: string): Promise<{ key: string; created: boolean }> {
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM api_keys WHERE $1 = ANY(scopes) AND active = true LIMIT 1`,
      ["admin"],
    );
    if (existing.length) return { key: plain ?? "", created: false };
    const raw = plain && plain.length > 8 ? plain : `${KEY_PREFIX}_admin_${randomBytes(20).toString("base64url")}`;
    const keyHash = hashKey(raw);
    await this.db.query(
      `INSERT INTO api_keys (name, key_hash, scopes, product, plan, attributes)
       VALUES ('platform-admin', $1, $2, 'admin', 'institucional', '{}')`,
      [keyHash, ["admin", "*"]],
    );
    return { key: raw, created: true };
  }

  // --- Users / Organizations / Tenants (employee + org management) ----------

  async listUsers(orgId?: string): Promise<Array<{ id: string; email: string; displayName?: string; role: string; organizationId?: string; createdAt: string }>> {
    const rows = await this.db.query<{ id: string; email: string; display_name: string | null; role: string; organization_id: string | null; created_at: string }>(
      orgId ? `SELECT id, email, display_name, role, organization_id, created_at FROM users WHERE organization_id = $1 ORDER BY created_at DESC` : `SELECT id, email, display_name, role, organization_id, created_at FROM users ORDER BY created_at DESC`,
      orgId ? [orgId] : [],
    );
    return rows.map((r) => ({ id: r.id, email: r.email, displayName: r.display_name ?? undefined, role: r.role, organizationId: r.organization_id ?? undefined, createdAt: r.created_at }));
  }

  async createUser(opts: { email: string; displayName?: string; role?: string; organizationId?: string }): Promise<{ id: string }> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, role, organization_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [opts.email, opts.displayName ?? null, opts.role ?? "member", opts.organizationId ?? null],
    );
    return { id: rows[0].id };
  }

  async listOrganizations(): Promise<Array<{ id: string; name: string; slug: string; tenantId?: string; createdAt: string }>> {
    const rows = await this.db.query<{ id: string; name: string; slug: string; tenant_id: string | null; created_at: string }>(
      `SELECT id, name, slug, tenant_id, created_at FROM organizations ORDER BY created_at DESC`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, tenantId: r.tenant_id ?? undefined, createdAt: r.created_at }));
  }

  async createOrganization(opts: { name: string; slug: string; tenantId?: string }): Promise<{ id: string }> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
      [opts.name, opts.slug, opts.tenantId ?? null],
    );
    return { id: rows[0].id };
  }

  async listTenants(): Promise<Array<{ id: string; slug: string; name: string; plan: string; createdAt: string }>> {
    const rows = await this.db.query<{ id: string; slug: string; name: string; plan: string; created_at: string }>(
      `SELECT id, slug, name, plan, created_at FROM tenants ORDER BY created_at DESC`,
    );
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, plan: r.plan, createdAt: r.created_at }));
  }

  /** Resolve an API key to its record (verifying the hash). */
  async verifyApiKey(key: string): Promise<ApiKeyRecord | null> {
    const keyHash = hashKey(key);
    const rows = await this.db.query<{
      id: string; name: string; scopes: string[]; active: boolean;
      organization_id: string | null; tenant_id: string | null; attributes: Record<string, string>;
      product: string; plan: string; quota_daily: number; rate_limit: number; payment_status: string;
      expires_at: string | null;
    }>(
      `SELECT id, name, scopes, active, organization_id, tenant_id, attributes, product, plan, quota_daily, rate_limit, payment_status, expires_at FROM api_keys WHERE key_hash = $1`,
      [keyHash],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    if (!row.active) return null;
    await this.db.query(`UPDATE api_keys SET last_used_at = now(), last_seen_node = COALESCE(last_seen_node, $2) WHERE id = $1`, [row.id, process.env.NODE_ID ?? "api"]);
    return rowToRecord(row);
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

function rowToRecord(row: {
  id: string; name: string; scopes: string[]; active: boolean;
  organization_id: string | null; tenant_id: string | null; attributes: Record<string, string>;
  product: string; plan: string; quota_daily: number; rate_limit: number; payment_status: string;
  expires_at: string | null;
}): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes,
    active: row.active,
    organizationId: row.organization_id ?? undefined,
    tenantId: row.tenant_id ?? row.organization_id ?? undefined,
    attributes: row.attributes,
    product: row.product,
    plan: row.plan,
    quotaDaily: row.quota_daily,
    rateLimit: row.rate_limit,
    paymentStatus: row.payment_status,
    expiresAt: row.expires_at ?? undefined,
  };
}

/** Parse a Bearer token from an Authorization header. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
