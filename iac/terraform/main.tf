# Terraform configuration for INTEL.DOM.GOB platform infrastructure.
#
# Provisions: a managed Postgres instance, a DragonflyDB (Redis-compatible)
# cache/broker, and the compute to run the API + workers. Designed to be
# environment-agnostic via variables (DOMAIN differs per env). No hardcoded
# secrets — use a secrets manager / tfvars that is git-ignored.

terraform {
  required_version = ">= 1.5"
  required_providers {
    # Pin to your cloud provider, e.g. aws / gcp / azure.
    # provider "aws" { source = "hashicorp/aws" }
  }
}

variable "domain" {
  type        = string
  description = "Platform domain. localhost locally, intel.dom.gob in prod."
  default     = "localhost"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "postgres_version" {
  type    = string
  default = "16"
}

variable "dragonfly_version" {
  type    = string
  default = "latest"
}

# --- Networking / compute placeholders ---------------------------------------
# In production replace the locals below with real resource definitions
# (e.g. ECS services, GKE deployments, VM instance groups).

locals {
  services = [
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
  ]
}

# --- DragonflyDB (Redis-compatible broker + cache) ---------------------------
resource "null_resource" "dragonfly" {
  # In practice: a managed DragonflyDB instance or a container in the cluster.
  # Documented here as the single broker the platform depends on.
  triggers = {
    version = var.dragonfly_version
    url     = "redis://dragonfly:6379"
  }
}

# --- Postgres ----------------------------------------------------------------
resource "null_resource" "postgres" {
  triggers = {
    version = var.postgres_version
    url     = "postgresql://intel:CHANGE_ME@postgres:5432/intel"
  }
}

output "domain" {
  value = var.domain
}

output "broker_url" {
  value = "redis://dragonfly:6379"
}

output "services" {
  value = local.services
}
