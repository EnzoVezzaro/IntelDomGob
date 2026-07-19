import type { InstitutionService } from "./types";

// Central registry. The application never imports a concrete institution module
// directly — it only interacts with the registry. New institutions are added by
// simply registering them in index.ts; no other file needs to change.

const registry = new Map<string, InstitutionService>();
const registrationOrder: string[] = [];

export function registerInstitution(service: InstitutionService): void {
  if (registry.has(service.id)) {
    console.warn(`[registry] Institution "${service.id}" already registered; overwriting.`);
  }
  registry.set(service.id, service);
  if (!registrationOrder.includes(service.id)) registrationOrder.push(service.id);
}

export function getInstitution(id: string): InstitutionService | undefined {
  return registry.get(id);
}

export function getAllInstitutions(): InstitutionService[] {
  return registrationOrder.map((id) => registry.get(id)!).filter(Boolean);
}

export function getEnabledByDefault(): InstitutionService[] {
  return getAllInstitutions().filter((s) => s.enabledByDefault);
}

export function getInstitutionByName(name: string): InstitutionService | undefined {
  const lower = name.toLowerCase();
  return getAllInstitutions().find((s) => s.name.toLowerCase() === lower);
}

/** Lightweight, serializable descriptor for the frontend. */
export interface InstitutionDescriptor {
  id: string;
  name: string;
  description?: string;
  url: string;
  enabledByDefault: boolean;
  hasLegislative: boolean;
}

export function describeAll(): InstitutionDescriptor[] {
  return getAllInstitutions().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    url: s.url,
    enabledByDefault: s.enabledByDefault,
    hasLegislative: typeof (s as any).getLaws === "function",
  }));
}
