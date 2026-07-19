// services/tenancy
//
// Multi-tenancy support. Provides:
//   - TenantResolver: resolves the active tenant for a request from the API key
//     record (authoritative) or an explicit X-Tenant-Id header (validated
//     against the key's tenant to prevent spoofing).
//   - withTenant: a helper that stamps a tenant id onto persisted records and
//     filters queries, so every tenant's data is isolated by construction.
//
// The platform is deny-by-default: a key can only ever resolve to its own
// tenant. A key without a tenant is treated as global/superadmin.

import { createLogger } from "@intel.dom.gob/logger";
import type { ApiKeyRecord, TenantContext } from "@intel.dom.gob/service-auth";

const log = createLogger("service:tenancy");

export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantError";
  }
}

export class TenantResolver {
  /** Resolve the tenant context for a request. */
  resolve(record: ApiKeyRecord, headerTenantId?: string | null): TenantContext {
    const own = record.tenantId ?? record.organizationId;
    if (headerTenantId && headerTenantId !== own) {
      // Never allow a key to act outside its own tenant, even via header.
      throw new TenantError(`Tenant header ${headerTenantId} does not match key tenant ${own ?? "global"}`);
    }
    return { tenantId: own ?? "default", record };
  }

  /** True when the record is global (no tenant scoping). */
  isGlobal(record: ApiKeyRecord): boolean {
    return !(record.tenantId ?? record.organizationId);
  }
}

/** Stamp a tenant id onto a record being persisted (isolation by construction). */
export function withTenant<T extends Record<string, unknown>>(tenantId: string, record: T): T & { tenantId: string } {
  return { ...record, tenantId };
}

/** Build a WHERE clause fragment + params isolating a query to a tenant. */
export function tenantFilter(tenantId: string, column = "tenant_id"): { clause: string; param: string } {
  return { clause: `${column} = $1`, param: tenantId };
}
