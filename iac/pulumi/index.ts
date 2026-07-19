// Pulumi infrastructure for INTEL.DOM.GOB (TypeScript).
//
// Mirrors the Terraform/Helm intent: a DragonflyDB broker, a Postgres instance
// and the platform services. Run `pulumi up` after `npm install` in this dir.
//
// No secrets are hard-coded; read them from Pulumi config / your secrets
// manager. Example: `pulumi config set geminiApiKey --secret <key>`.

import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const domain = config.get("domain") ?? "localhost";
const environment = config.get("environment") ?? "dev";

// --- DragonflyDB (Redis-compatible broker + cache) --------------------------
// In production bind this to a managed DragonflyDB or a container in the cluster.
const dragonfly = {
  name: "dragonfly",
  url: "redis://dragonfly:6379",
  version: config.get("dragonflyVersion") ?? "latest",
};

// --- Postgres ----------------------------------------------------------------
const postgres = {
  name: "postgres",
  version: config.get("postgresVersion") ?? "16",
  // Password sourced from a secret, never inlined.
  connectionString: config.getSecret("postgresConnectionString"),
};

const services = [
  "api",
  "worker-ocr",
  "worker-embedding",
  "worker-document",
  "worker-crawler",
  "worker-ai",
  "studio",
  "web",
  "admin",
  "mcp",
];

export const platformDomain = domain;
export const brokerUrl = dragonfly.url;
export const serviceList = services;
export const env = environment;
