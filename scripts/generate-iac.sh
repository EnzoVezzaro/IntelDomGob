#!/usr/bin/env bash
# scripts/generate-iac.sh
#
# Scaffold per-environment IaC values for INTEL.DOM.GOB. Generates a Helm
# values file and a Terraform tfvars file for a given environment (dev|staging|
# prod). Keeps infrastructure identical across environments — only DOMAIN and
# replica counts differ, per AGENTS.md ("Identical stack. Only DOMAIN differs").
#
# Usage: ./scripts/generate-iac.sh <env> [domain]
set -euo pipefail

ENV="${1:-dev}"
DOMAIN="${2:-localhost}"
OUT_DIR="iac/generated/${ENV}"

case "$ENV" in
  dev|staging|prod) ;;
  *) echo "Unknown env '$ENV' (use dev|staging|prod)" >&2; exit 1 ;;
esac

REPLICAS_API=1
[[ "$ENV" == "prod" ]] && REPLICAS_API=3
[[ "$ENV" == "staging" ]] && REPLICAS_API=2

mkdir -p "$OUT_DIR"

cat > "${OUT_DIR}/values.yaml" <<EOF
# Generated for env=$ENV (domain=$DOMAIN). Do not edit by hand.
domain: ${DOMAIN}
environment: ${ENV}

dragonfly:
  enabled: true
  image: docker.dragonflydb.io/dragonflydb/dragonfly:latest
  port: 6379

postgres:
  enabled: true
  image: postgres:16
  port: 5432
  database: intel
  existingSecret: inteldg-secrets

services:
  api:        { replicas: ${REPLICAS_API}, port: 4000, memory: "1Gi" }
  worker-ocr: { replicas: 1, memory: "1Gi" }
  worker-embedding: { replicas: 1, memory: "1Gi" }
  worker-document: { replicas: 1, memory: "1Gi" }
  worker-crawler: { replicas: 1, memory: "512Mi" }
  worker-ai: { replicas: 1, memory: "1Gi" }
  studio:     { replicas: 1, port: 3000 }
  web:        { replicas: 1, port: 8080 }
  admin:      { replicas: 1, port: 8081 }
  mcp:        { replicas: 1, port: 4100 }
EOF

cat > "${OUT_DIR}/terraform.tfvars" <<EOF
# Generated for env=$ENV (domain=$DOMAIN). Do not edit by hand.
domain       = "${DOMAIN}"
environment  = "${ENV}"
region       = "us-east-1"
postgres_version = "16"
dragonfly_version = "latest"
EOF

echo "Wrote ${OUT_DIR}/values.yaml and ${OUT_DIR}/terraform.tfvars"
