# INTEL.DOM.GOB — Complete Platform Architecture Refactor

## ROLE

You are the Lead Software Architect, Principal Engineer and Open Source Maintainer for this project.

You are **NOT** performing a refactor.

You are designing the long-term architecture of an AI platform that should remain maintainable for the next decade.

Every decision should prioritize:

* Maintainability
* Extensibility
* Clean Architecture
* Separation of Concerns
* Testability
* Open Source
* Future AI Agent Contributions

Never optimize for writing less code.

Optimize for an architecture another engineer (or AI agent) can immediately understand.

---

# PROJECT VISION

INTEL.DOM.GOB is an open-source AI platform for Government Intelligence.

The platform is API-first.

The API is the product.

Everything else is simply another client.

* Studio (Web Intelligence Workspace) — the actual application
* CLI Agent (Terminal AI Agent)
* MCP Server
* Website (Public Website only — marketing/documentation, NOT a product)
* Admin Dashboard
* External API Consumers

Future clients:

* Mobile Apps
* Browser Extension
* SDKs
* Third-party Applications
* Government Integrations

Every client MUST consume the same API.

No client should directly access services.

No client should directly access providers.

---

# CORE PRINCIPLE

The architecture revolves around the API.

Everything flows through:

Client Applications

↓

API Platform

↓

Orchestrator

↓

Services

↓

Providers

↓

External Systems

This rule should never be violated.

The Studio and CLI Agent are independent clients.

They are not the platform.

They do not contain intelligence logic.

They only consume the API.

---

# EXISTING INFRASTRUCTURE

The project already contains working infrastructure.

DO NOT replace it.

DO NOT remove it.

Refactor it into the new architecture.

Current stack:

* React
* Express
* TypeScript
* Vite
* Google Gemini SDK
* Docker
* SearXNG

Current SearXNG Docker container:

* Anonymous JSON API
* Docker Compose
* Local only
* No authentication

Preserve it exactly.

Turn it into the default Search Provider.

Current Gemini implementation:

Turn it into the default AI Provider.

---

# UI REQUIREMENTS

IMPORTANT

Keep the current UI design language.

Do NOT redesign the application.

Do NOT change the visual identity.

Do NOT introduce a completely different UI framework.

Preserve:

* Colors
* Typography
* Layout
* Spacing
* Components
* Overall style
* Branding

The UI may be reorganized internally but should still feel like the current application.

Improve usability without changing the identity.

Think "evolution", not "redesign".

---

# STUDIO (WEB APPLICATION)

The Studio is the primary user-facing web application.

The Studio is the actual application where users work.

The Studio is a frontend product, equivalent to a ChatGPT interface, Claude Projects, or a Palantir-style workspace.

The Studio is NOT the intelligence layer.

The Studio is NOT the agent runtime.

The Studio does not execute providers, tools, MCP servers, or workflows.

The Studio communicates exclusively with the INTEL.DOM.GOB API.

## WEBSITE (PUBLIC SITE — NOT A PRODUCT)

`apps/website` (formerly `apps/web`) is the public website only.

It contains marketing, documentation links, news, public information, and API docs.

It is NOT a product and must NOT contain application logic.

It is equivalent to `intel.dom.gob` while Studio is `studio.intel.dom.gob`.


The Studio should be built using a customized version of:

https://github.com/odysseus-dev/odysseus


Odysseus is used as the frontend workspace foundation.

Do NOT tightly couple the entire platform architecture to Odysseus.

The Studio must remain replaceable in the future.


Responsibilities:

* Chat Interface
* Intelligence Workspace
* Cases / Projects
* Conversations
* Prompt Library
* Prompt Variables
* Agent Selection
* Workflow Visualization
* Document Viewer
* Search Visualization
* OCR Visualization
* Knowledge Graph Visualization
* MCP Browser
* Provider Selection
* Model Selection
* Settings
* Authentication
* Organizations
* Usage Dashboard
* Reports


The Studio MUST NOT:

* Call AI providers directly
* Call search providers directly
* Access databases directly
* Execute workflows locally
* Contain business logic


Architecture:

Studio

↓

INTEL.DOM.GOB API

↓

Orchestrator

---

# CLI AGENT (TERMINAL APPLICATION)

The CLI Agent is a separate product from the Studio.

It is inspired by:

* OpenCode
* Claude Code
* Cursor CLI
* Aider


The CLI Agent is designed for:

* Developers
* Researchers
* Power users
* Automation
* AI agent workflows


Repository:

apps/cli


Responsibilities:

* Terminal interface
* Agent interaction
* Streaming responses
* Tool execution
* MCP interaction
* Automation workflows
* Developer workflows


The CLI Agent MUST NOT:

* Contain business logic
* Implement providers
* Implement search
* Access databases directly


The CLI Agent communicates through the same API as every other client.


Architecture:

CLI Agent

↓

INTEL.DOM.GOB API

↓

Orchestrator

↓

Services

↓

Providers

# CLI AGENT FRAMEWORK

The CLI Agent should use a mature terminal framework.

Recommended stack:

TypeScript

Node.js

Commander.js or oclif

Ink (React for CLI interfaces)

Ora (terminal loading states)

Chalk (terminal formatting)

Zod (validation)


The CLI should provide:

* Interactive mode
* Command mode
* Streaming output
* Tool visualization
* Agent execution logs
* MCP connection management


Example:

intel chat

intel agent run research-case

intel tools list

intel mcp list

intel workflow execute analysis


The CLI should feel similar to:

* OpenCode
* Claude Code
* Cursor CLI

# AGENT RUNTIME

The Agent Runtime is responsible for executing AI agents.

The Agent Runtime is separate from:

* Studio
* CLI
* MCP


Recommended architecture:

Agent Runtime

↓

Planner

↓

Task Graph

↓

Tool Execution

↓

Memory

↓

Final Response


The Agent Runtime should support:

* Planning
* Multi-step execution
* Tool calling
* MCP tools
* Memory
* Context management
* Streaming events
* Human approval steps


Possible frameworks to evaluate:

* DeerFlow
* LangGraph
* Mastra
* Pydantic AI
* OpenAI Agents SDK


The architecture must keep the runtime replaceable.

Do not tightly couple the platform to one framework.

# AGENT EVENTS

All agent executions should emit events.

Example:

agent.started

planning.started

tool.called

search.started

document.processed

ocr.completed

response.streaming

agent.completed


Events should be consumable by:

* Studio
* CLI
* API clients
* Logs
* Monitoring systems


# PLATFORM SDK

Create a shared SDK package:

packages/sdk/


The SDK should allow:

* Studio
* CLI
* External developers
* MCP integrations


to communicate with the API consistently.


The SDK should include:

* Authentication
* API Client
* Streaming client
* Type definitions
* Tool definitions
* Agent interfaces


The SDK should be generated or synchronized with OpenAPI.

# AI TOOL CALLING

Tool execution must use a unified interface.

Tools should be compatible with:

* AI SDK tool calling
* MCP tools
* Internal platform tools


A tool should be defined once.

Example:

Tool Registry

↓

AI SDK Tool Definition

↓

MCP Tool Definition

↓

CLI Tool

↓

Studio Tool


The same tool should work everywhere.

# AI FRAMEWORK REQUIREMENT

Use a mature AI orchestration SDK.

Preferred:

Vercel AI SDK

Reasons:

* Provider abstraction
* Streaming support
* Tool calling
* Structured generation
* React integration
* OpenAI compatibility
* Production maturity


The implementation should avoid custom LLM wrappers unless absolutely necessary.

---

# API

The API is the core product.

Everything consumes the API.

## API GATEWAY

At scale, the API should sit behind an API Gateway.

```
Clients
↓
API Gateway
↓
API Services
```

The Gateway handles:

* auth
* rate limits
* API keys
* routing

Could be Kong, Traefik, or Envoy.

Responsibilities:

* REST API
* Streaming (SSE)
* WebSockets
* Authentication
* Authorization
* API Keys
* Rate Limiting
* OpenAPI Documentation
* Validation
* Versioning
* Request Routing

No business logic.

No provider logic.

No search logic.

No AI logic.

Everything delegates to the Orchestrator.

# OPENAI COMPATIBLE API

INTEL.DOM.GOB should expose an OpenAI-compatible API layer.

Supported endpoints:

/v1/chat/completions

/v1/models

/v1/embeddings

/v1/images (future)

/v1/audio (future)


Any OpenAI-compatible client should be able to connect without modification.

The platform extends OpenAI compatibility with:

* MCP tools
* Government data sources
* Intelligence workflows
* Document processing
* RAG
* Knowledge graph capabilities

---

# ORCHESTRATOR

This is the heart of the platform.

Every request passes through it.

Responsibilities:

* Agent execution
* Planning
* Search orchestration
* AI orchestration
* Prompt execution
* Tool execution
* Workflow execution
* MCP routing
* Result merging
* Context management

This should contain the application's business logic.

---

# SERVICES

Each service has exactly one responsibility.

Examples:

Search

AI

Workflow

Agents

Tools

MCP

Documents

Document Intelligence

Storage

OCR

Crawler

Embeddings

RAG

Knowledge Graph

Entities

Evaluation

Observability

Prompts

Authentication

Scheduler

Each service should be independently testable.

No service should know implementation details of another service.

## WORKFLOW ENGINE

A dedicated Workflow Service is required. The platform mentions agents and workflows but has no actual workflow runtime.

Responsibilities:

* DAG execution
* Long running tasks
* Retries
* Checkpoints
* Approvals
* Scheduling
* Human-in-the-loop

Example:

```
Research Case
↓
Workflow
↓
Step 1 Search Senate
↓
Step 2 Download documents
↓
Step 3 OCR
↓
Step 4 Extract entities
↓
Step 5 Generate report
↓
Human approval
↓
Publish
```

## EVENT / QUEUE ARCHITECTURE

The current synchronous chain `API → Orchestrator → Services` does not scale to heavy government intelligence workloads (e.g. OCR 10,000 PDFs). You cannot wait on HTTP.

Add an Event Bus:

```
API
↓
Orchestrator
↓
Event Bus
↓
Workers
↓
Services
```

Recommended: DragonflyDB (Redis-compatible, drop-in) using Redis Streams initially, later NATS or Kafka. DragonflyDB speaks the Redis protocol exactly, so the `ioredis` client and all Streams commands (XADD / XREAD) work unchanged, while being significantly faster and more memory-efficient than Redis.

Add `services/events` (or `packages/events`).

Events:

* document.uploaded
* ocr.started
* ocr.completed
* embedding.completed
* entity.extracted
* workflow.completed

## WORKER ARCHITECTURE

Services are synchronous; heavy work must be offloaded to workers.

Add:

```
workers/
    ai-worker
    document-worker
    ocr-worker
    crawler-worker
    embedding-worker
```

Example:

```
OCR Service
↓
OCR Worker
↓
Unlimited OCR
```

This avoids blocking services.

## STORAGE ARCHITECTURE

Government intelligence requires files, PDFs, images, videos, datasets.

Add `services/storage` with an abstraction over:

* S3
* MinIO
* Google Cloud Storage
* Azure Blob
* Local filesystem

The platform should never know which backend is used.

## DOCUMENT INTELLIGENCE PIPELINE

Documents, OCR, RAG, and Embeddings must become a single pipeline rather than separate services.

Add a Document Intelligence Service:

```
Upload document
↓
Storage
↓
OCR
↓
Text extraction
↓
Classification
↓
Metadata extraction
↓
Entity extraction
↓
Embedding
↓
Knowledge Graph
↓
Available for AI
```

## ENTITY EXTRACTION SERVICE

The Knowledge Graph depends on entity extraction.

Add `services/entities`.

Responsibilities: Extract People, Organizations, Laws, Institutions, Dates, Locations, Relationships.

Example:

Document: "Law 87-01 created the Dominican Social Security System"

Extracts:

```
Law 87-01
creates
Dominican Social Security System
```

## KNOWLEDGE GRAPH SERVICE

Add `services/knowledge-graph`.

Possible technologies: Neo4j, ArangoDB, PostgreSQL + Apache AGE.

Do NOT rely on a pure vector database. Combine:

* Vector Search
* Graph Search
* Full Text Search

Hybrid intelligence.

## EVALUATION SYSTEM

AI platforms need quality measurement.

Add `services/evaluation`:

* Prompt evaluation
* Agent evaluation
* Retrieval evaluation
* Hallucination checks
* Regression testing

Compatible with LangSmith concepts, DeepEval, Ragas.

## OBSERVABILITY

Production AI needs tracing.

Add `services/observability` using OpenTelemetry, Prometheus, Grafana, Loki.

Track: user request → agent → tool → model → response.

Measure: token usage, latency, failures, costs, tool success rates.

## PROMPT MANAGEMENT SYSTEM

Add `services/prompts`:

* versioning
* variables
* templates
* permissions
* experiments

## AGENT REGISTRY

Agents are first-class objects.

Add `services/agents`:

```
{
  name: "Legal Research Agent",
  tools: [search, OCR, KG],
  model_policy: { reasoning: true, context: "large" },
  permissions: []
}
```


# TOOL SYSTEM

Tools are first-class platform capabilities.

A Tool is not tied to:

* Studio
* CLI
* MCP
* A specific model


A Tool is a reusable capability exposed through the platform.

## TOOL REGISTRY

MCP is only one consumer of tools. Add `services/tool-registry` as the canonical registry.

Architecture:

```
Tool Registry
       │
 ┌─────┼─────────────┐
 MCP   API   CLI
                │
            Studio
            AI Tools
```

Every tool is registered once and consumed by MCP, API, CLI, Studio, and AI Tools.


Examples:

Search Tool

OCR Tool

Document Extraction Tool

Legal Analysis Tool

Knowledge Graph Tool

Database Query Tool

Report Generation Tool

Web Research Tool


Every Tool should have:

* Name
* Description
* Input Schema
* Output Schema
* Permissions
* Authentication requirements
* Version
* Execution metadata


Tools should use JSON Schema definitions.

Example:

{
  name: "search_government_documents",
  description: "Search government sources",
  inputSchema: {},
  outputSchema: {}
}


Tools should be discoverable dynamically.

Adding a new Tool should not require modifying:

* API core
* Studio
* CLI
* MCP server

---

# PROVIDERS

Everything external is abstracted behind Providers.

Search Providers:

* SearXNG
* Brave
* Exa
* Tavily
* Google

# AI PROVIDER ARCHITECTURE

The AI layer must be model-provider agnostic.

The platform must NOT be coupled to a specific AI SDK or vendor.

The default interface should follow OpenAI-compatible standards.

The platform should support any provider exposing an OpenAI-compatible API.

Examples:

* OpenAI
* Azure OpenAI
* Google Gemini OpenAI-compatible endpoint
* Anthropic through adapters
* DeepSeek
* Groq
* Together AI
* Fireworks
* OpenRouter
* Ollama
* vLLM
* Local Models


The AI Service should use a unified SDK abstraction.

Recommended:

Vercel AI SDK

https://sdk.vercel.ai/


The AI SDK should handle:

* Chat completion
* Streaming responses
* Tool calling
* Structured outputs
* Generations
* Embeddings

Model routing and provider switching are NOT the AI SDK's responsibility. They belong to a separate Model Registry Service.

Architecture:

Application

↓

AI Service

↓

Vercel AI SDK

↓

Provider Adapters

↓

Models

Separate:

Model Registry Service

for:

* availability
* cost
* permissions
* routing


The rest of the platform should never know:

* Which model is being used
* Which provider is running
* Where the model is hosted

# MODEL ROUTING AND MANAGEMENT

The platform should include a Model Management layer.

Responsibilities:

* Register models
* Configure providers
* Select default models
* Manage capabilities
* Track usage
* Track costs
* Apply limits
* Route requests


Example model registry:

{
  "provider": "openai",
  "model": "gpt-5",
  "capabilities": [
      "chat",
      "tools",
      "vision",
      "structured-output"
  ],
  "context_window": 128000
}


The Orchestrator should request capabilities, not specific models.


Example:

BAD:

use gpt-5


GOOD:

use a model capable of:

{
  reasoning: true,
  tools: true,
  context: "large"
}

---

# MCP

The MCP server is another client of the platform.

It should communicate with the API exactly like any other client.

It should never directly invoke Providers or Services.

Future MCP tools should be pluggable.

Adding a Tool should not require modifying core infrastructure.

MCP is independent from both Studio and CLI Agent.

Studio, CLI Agent, and MCP are different clients.

They share the same API but have different purposes.

# MCP TOOLING ARCHITECTURE

The MCP implementation must follow the official Model Context Protocol specification.

MCP is not just an endpoint.

It is the standardized tool interface of the platform.

The MCP layer should expose:

* Tools
* Resources
* Prompts
* Context
* Capabilities


Recommended implementation:

Use the official MCP SDK.

For TypeScript:

https://github.com/modelcontextprotocol/typescript-sdk


The MCP server should be implemented as an independent service:

services/mcp/


Architecture:

MCP Client

↓

MCP Server

↓

INTEL.DOM.GOB API

↓

Orchestrator

↓

Services

↓

Providers


The MCP server MUST NOT:

* Implement AI logic
* Implement search logic
* Access providers directly
* Access databases directly


The MCP server is a bridge between external AI clients and the INTEL.DOM.GOB platform.

---

# REPOSITORY STRUCTURE

Design something similar to:

```text
intel.dom.gob/

apps/

    api/
        Core API Platform

    studio/
        Main Intelligence Workspace
        Odysseus-based frontend

    cli/
        Terminal Agent
        OpenCode-inspired interface

    admin/
        Platform Administration

    docs/
        Public Documentation Portal

    website/
        Public Website (marketing/docs only)

services/

    orchestrator/
    workflow/
    agents/
    tools/
    ai/
    search/
    documents/
    document-intelligence/
    storage/
    ocr/
    crawler/
    embeddings/
    rag/
    knowledge-graph/
    entities/
    evaluation/
    observability/
    prompts/
    auth/
    scheduler/
    mcp/

workers/

    ai-worker/
    document-worker/
    ocr-worker/
    crawler-worker/
    embedding-worker/

providers/

    ai/
    search/
    storage/
    ocr/

packages/

    sdk/
    ai/
        AI SDK abstraction
        Provider adapters
        Model registry
        Tool definitions
        Streaming utilities
    events/
        document.uploaded
        ocr.started
        ocr.completed
        embedding.completed
        entity.extracted
        workflow.completed
    types/
    database/
    logger/
    config/
    ui/
    shared/
    utils/

plugins/

    senate/
    laws/
    judiciary/
    customs/

infra/

    docker/
    terraform/
    ansible/

scripts/
docs/
tests/
examples/
```

This exact structure is not mandatory.

The architecture should be equally clean.

API

↓

Orchestrator

↓

Event Bus

↓

Workers

↓

Services

Example Workers: 

OCR Service

↓

OCR Worker

↓

Unlimited OCR


## PLUGIN ARCHITECTURE

This project will grow. Add a `plugins/` directory for domain modules.

Examples:

```
plugins/
    dominican-laws/
    senate/
    customs/
    judiciary/
    cannabis-regulation/
```

A government intelligence platform should allow domain modules to extend it without changing core services.

## INFRASTRUCTURE AS CODE

Add an `infra/` directory with:

```
infra/
    terraform/
    ansible/
```

Future:

```
terraform apply
```

creates server, database, storage, DNS, SSL automatically.

---

# DOCKER

Docker Compose is the canonical development environment.

Everything starts with:

docker compose up

or

./scripts/up.sh

Every service should also run independently.

Example:

apps/api

npm run dev

apps/studio

npm run dev

services/search

npm run dev

No manual setup.

No hidden dependencies.

---

# SCRIPTS

Every operational script belongs in:

scripts/

Examples:

setup.sh

start.sh

stop.sh

restart.sh

logs.sh

doctor.sh

backup.sh

restore.sh

lint.sh

format.sh

test.sh

clean.sh

update.sh

Preserve the current logo from start.sh.

Improve the implementation if needed.

Scripts should:

* validate prerequisites
* print friendly output
* fail gracefully
* be reusable
* be idempotent

---

# SHARED PACKAGES

Move all reusable code into packages.

Examples:

Logger

Config

Database

Types

Validation

Utilities

SDK

Shared Components

Never duplicate logic.

---

# CONFIGURATION

Everything uses environment variables.

Provide:

.env.example

Validate configuration during startup.

Never commit secrets.

---

# LOGGING

Centralized logging.

Every log should include:

timestamp

service

level

request id

message

Support:

Development

Production JSON

---

# DATABASE

Create a clean database abstraction.

Prepare for:

Users

Organizations

API Keys

Providers

Conversations

Prompts

Agents

Workflows

Usage

Billing

MCP Servers

Tool Registry

Do not over-engineer, but structure it so future features fit naturally.

---

# AUTHENTICATION

Prepare for:

JWT

API Keys

OAuth

Organizations

Teams

Permissions

## PERMISSION MODEL

Government systems need strong authorization. JWT, API Keys, Organizations, Teams, Permissions are not enough.

Add RBAC + ABAC.

Example role:

```
Researcher
```

Can: read public documents

Cannot: access classified documents

Attribute:

```
department=justice
clearance=level3
```

## MULTI-TENANCY

Government platforms almost always need separation.

Add a Tenant Architecture. Everything should support:

```
Organization
↓
Projects
↓
Users
↓
Resources
```

## SECRETS MANAGEMENT

`.env` is fine for development, not production.

Add support for:

* Vault
* AWS Secrets Manager
* Doppler
* SOPS

---

# OPENAPI comparable api with opensource library / sdk

The API should automatically generate OpenAPI documentation.

Every endpoint should be documented.

The API should be versioned.

Example:

/v1

/v2

---

# STREAMING

Support:

SSE

WebSockets

Streaming AI responses

Streaming tool execution

Streaming search progress

---

# TESTING

Prepare for:

Unit Tests

Integration Tests

End-to-End Tests

Use dependency injection where appropriate.

---

# DOCUMENTATION

Create:

README.md

AGENTS.md

CONTRIBUTING.md

CHANGELOG.md

docs/

README should explain:

Vision

Architecture

Repository Layout

Quick Start

Docker

Scripts

Development

Providers

Services

API

MCP

Studio

Deployment

Roadmap

FAQ

Contributing

License

---

# AGENTS.md

This document is specifically for AI coding agents.

Document:

Architecture

Folder responsibilities

Dependency rules

Naming conventions

Coding conventions

Import rules

Provider architecture

Service architecture

API architecture

How to add Providers

How to add Services

How to add Endpoints

How to add MCP Tools

How to add AI Providers

How to add Search Providers

How to add Docker Services

Rules that must NEVER be broken.

---

# OPEN SOURCE

Prepare this repository as a flagship open-source project.

Remove:

Dead code

Commented code

Unused dependencies

Temporary files

Experimental code

Debug artifacts

Organize everything consistently.

---

# Unlimited-OCR ⭐⭐⭐⭐⭐ (Definitely integrate)

**Repository:** `https://github.com/baidu/Unlimited-OCR`

**Verdict:** **Yes.**

This is exactly the kind of capability that belongs as an independent service.

Use cases for INTEL.DOM.GOB:

* Government PDFs
* Scanned gazettes
* Historical laws
* Images
* Senate scans
* Camera photos
* Handwritten documents (where supported)

Architecture:

```
API

↓

Orchestrator

↓

OCR Service

↓

Unlimited-OCR

↓

Extracted text

```

The OCR service should expose a clean internal interface like:

```
extractText(file)

extractMarkdown(file)

extractTables(file)

extractImages(file)

```

The rest of the platform should never know which OCR engine is being used.

**Recommendation:**

* ✔ Integrate as a provider-backed OCR service.
* ✔ Keep it replaceable (future support for Tesseract, Azure OCR, Google Vision, etc.).

---

# HyperFrames ⭐⭐⭐⭐☆ 

**Repository:** `https://github.com/heygen-com/hyperframes`

**Verdict:** **Useful, but not core.**

This is more of a **presentation/export** capability.

Potential uses:

* Generate explainer videos from government reports.
* Convert AI summaries into shareable HTML microsites.
* Produce visual presentations for policy analysis.

This should **not** live inside the Orchestrator.

Architecture:

```
Presentation Service

↓

HyperFrames

```

I would keep this as an optional plugin that the Orchestrator can invoke when a workflow requires it.

---

# DeerFlow ⭐⭐⭐⭐⭐ (Very interesting)

**Repository:** `https://github.com/bytedance/deer-flow`

**Verdict:** **Probably the most valuable of the four.**

DeerFlow focuses on structured, multi-step AI workflows.

That's exactly where INTEL.DOM.GOB is heading.

Instead of:

```
User

↓

LLM

```

You get:

```
User

↓

Planner

↓

Search

↓

Reason

↓

Verify

↓

Summarize

↓

Return

```

This aligns extremely well with your platform's need to search government sources, cross-reference documents, and reason over them.

I would not copy its implementation directly, but I would study:

* workflow engine
* planning
* task decomposition
* execution graph
* retry logic
* observability

Those ideas belong in your **Orchestrator**.

---

# codebase-memory-mcp ⭐⭐⭐⭐⭐

**Repository:** `https://github.com/DeusData/codebase-memory-mcp`

**Verdict:** **Absolutely.**

This fits your vision perfectly.

As your platform grows, you'll want AI agents to understand:

* repository structure
* architecture
* previous decisions
* documentation
* code relationships

Instead of repeatedly parsing the codebase, agents can query a structured memory.

Architecture:

```
Studio

↓

API

↓

Orchestrator

↓

Memory Service

↓

Codebase Memory MCP

```

I would make it optional but first-class.

---

# My recommended platform architecture

```
Clients
────────────────────────

Studio
(Web Intelligence Workspace)

CLI Agent
(Terminal AI Interface)

MCP Server

Admin Dashboard

External Applications

SDKs

Website
(Public site only)


↓

API Gateway

↓

INTEL.DOM.GOB API


↓

Orchestrator


↓

Event Bus
(workers consume async work)


↓

Core Services
(workflow, agents, tools, ai, search, documents,
 document-intelligence, storage, ocr, crawler, embeddings,
 rag, knowledge-graph, entities, evaluation, observability,
 prompts, auth, scheduler, mcp)


↓

Providers


↓

External Systems

```

---

# One thing I'd add that isn't on your list

If the goal is to build **the best open-source AI platform**, I'd strongly consider adding a **Knowledge Graph Service**.

Instead of only storing text and embeddings, model relationships between entities:

```
Law 87-01
        │
        ├── modifies
        │
Law 42-01
        │
        ├── cited by
        │
Supreme Court Decision
        │
        ├── references
        │
Senate Bill

```

That unlocks capabilities like:

* impact analysis
* dependency tracing
* legal relationship discovery
* visualization
* advanced reasoning beyond vector search

It would be a unique differentiator for a government intelligence platform and would complement your search, RAG, and orchestration layers extremely well.

# DELIVERABLES

At the end of the refactor provide:

1. Repository tree

2. Architecture diagram

3. Migration report

4. Architectural decisions

5. Future extension points

6. Remaining technical debt

7. Recommendations for production deployment

# PRODUCT SEPARATION PRINCIPLE

INTEL.DOM.GOB is composed of multiple independent products.

The Studio and CLI Agent are different interfaces for different users.

Studio:

Designed for:
* Analysts
* Researchers
* Policy teams
* Organizations


CLI Agent:

Designed for:
* Developers
* Automation
* Power users


Both consume the same API.

Neither owns intelligence.

The API and Orchestrator are the actual platform.

---

# IMPORTANT

Do NOT simply make the project compile.

Instead, design the architecture as if this project will become the open-source reference implementation for AI-powered Government Intelligence.

The API must become the foundation of the entire ecosystem.

Every future feature should naturally integrate into the architecture rather than requiring architectural changes.

Think like the CTO of a company building a long-term AI platform, not like a developer completing a refactor.

I completely agree, and I think this should become a **core architectural requirement**, not an afterthought.

One thing I would **not** do is have everything under different ports like:

```
localhost:3000
localhost:3001
localhost:3002
localhost:8080

```

That's fine for development, but it's not how a production platform should behave.

Instead, I'd build the platform as if it were already deployed.

---

# I would add a Reverse Proxy layer

The architecture becomes:

```
                Internet
                    │
            Caddy (or Traefik)
                    │
    ┌───────────────┼────────────────┐
    │               │                │
studio.intel.dom.gob api.intel.dom.gob mcp.intel.dom.gob
    │               │                │
    └───────────────┼────────────────┘
                    │
             Internal Docker Network
                    │
      ┌─────────────┼────────────────────┐
      │             │                    │
 Orchestrator   Search Service     AI Service
      │             │                    │
      └─────────────┼────────────────────┘
                    │
               Providers

```

No service should ever expose ports publicly except the reverse proxy.

---

# During development

The exact same setup should work.

Example:

```
studio.localhost

api.localhost

mcp.localhost

admin.localhost

docs.localhost

```

or

```
studio.local

api.local

mcp.local


```

No ports.

Exactly like production.

---

# Then production becomes trivial

You literally only change

```
DOMAIN=intel.dom.gob

```

and Docker Compose should automatically expose

```
studio.intel.dom.gob

api.intel.dom.gob

mcp.intel.dom.gob

admin.intel.dom.gob

docs.intel.dom.gob

```

---

# Single docker compose

This is something I'd explicitly require.

Instead of

```
docker-compose.dev.yml

docker-compose.prod.yml

docker-compose.api.yml

docker-compose.search.yml

docker-compose.override.yml

```

❌ No.

Use

```
docker-compose.yml

```

Everything.

Development.

Production.

CI.

The behavior changes through environment variables.

---

# Example

```
docker compose up -d

```

should automatically bring up

* API
* Studio
* MCP
* PostgreSQL
* DragonflyDB (Redis-compatible, Redis Streams for the event bus)
* SearXNG
* Reverse Proxy

No additional commands.

---

# Reverse Proxy

I actually recommend **Caddy** over Traefik.

Why?

* Almost zero configuration
* Automatic HTTPS
* Automatic Let's Encrypt
* Excellent Docker support
* Easier than Nginx
* Easier than Traefik

Then deployment becomes

```
docker compose pull

docker compose up -d

```

Done.

HTTPS.

Certificates.

Routing.

Everything.

---

# Docker labels

Every service simply declares

```
studio.intel.dom.gob

↓

studio container

api.intel.dom.gob

↓

api container

mcp.intel.dom.gob

↓

mcp container

```

The reverse proxy discovers them automatically.

---

# Internal networking

Containers should never communicate through

```
localhost

```

Instead

```
api

orchestrator

search

postgres

dragonfly

searxng

```

using Docker DNS.

---

# Deployment

I'd even require a single deployment command.

Something like

```
./scripts/deploy.sh

```

Internally it would

```
git pull

↓

build

↓

docker compose pull

↓

docker compose up -d

↓

health checks

↓

success

```

One command.

---

# Health checks

Every container should expose

```
/health

/ready

/live

```

Then Docker waits until everything is healthy before starting dependent services.

---

# Local URLs

I'd expose

```
https://studio.localhost

https://api.localhost

https://mcp.localhost

https://admin.localhost

https://docs.localhost

```

which is almost identical to production.

---

# Production URLs

```
https://studio.intel.dom.gob

https://api.intel.dom.gob

https://mcp.intel.dom.gob

https://admin.intel.dom.gob

https://docs.intel.dom.gob

```

No configuration changes except the domain.

---

# I would actually add another major section to the prompt

## Deployment Philosophy

> The project must follow a **"develop exactly like production"** philosophy.
>
> Development and production should use the same Docker Compose stack.
>
> The only differences between environments should be configuration values supplied through environment variables.
>
> The platform must expose every application through a reverse proxy using human-readable subdomains instead of ports.
>
> The reverse proxy should automatically manage routing and HTTPS.
>
> A fresh deployment on a new server should require only:
>
> ```
> git clone ...
> cp .env.example .env
> docker compose up -d
>
> ```
>
> After this, the entire platform should be operational, with all services accessible through their respective domains, health checks passing, internal networking configured, and persistent data volumes created automatically.
>
> The deployment architecture should be suitable for both self-hosting and cloud VPS providers without modification.

---

I think **this is the missing piece**. If the AI builds around this philosophy, you'll end up with something that feels like **Coolify**, **Supabase**, or **Open WebUI**—clone the repo, edit one `.env`, run `docker compose up -d`, and the entire platform comes online with proper subdomains, HTTPS, health checks, and service discovery. That's the level of polish I'd aim for.

---

# ARCHITECT REVIEW — CTO / PRINCIPAL ARCHITECT PASS

Reviewed the architecture as if doing a CTO / principal architect review. Foundation is strong, but the plan described a great **AI platform** while still missing pieces required to become a real **government intelligence operating system**. The following corrections were incorporated into this document:

1. **Studio vs Web clarified** — Studio (`studio.intel.dom.gob`) is the actual application; `apps/web` renamed to `apps/website` and scoped to public marketing/documentation only, never a product.
2. **Workflow Engine** — added `services/workflow` (DAG, retries, checkpoints, approvals, human-in-the-loop).
3. **Event / Queue Architecture** — added Event Bus (`services/events` / `packages/events`), DragonflyDB (Redis-compatible) Streams initially, later NATS/Kafka.
4. **Worker Architecture** — added `workers/` (ai, document, ocr, crawler, embedding) to offload heavy work off the synchronous request path.
5. **Storage Architecture** — added `services/storage` abstraction over S3 / MinIO / GCS / Azure / local.
6. **Document Intelligence Pipeline** — unified Documents + OCR + RAG + Embeddings into one pipeline.
7. **Entity Extraction Service** — added `services/entities` as the input to the Knowledge Graph.
8. **Knowledge Graph details** — `services/knowledge-graph` with hybrid Vector + Graph + Full Text search (Neo4j / ArangoDB / PostgreSQL + AGE).
9. **Evaluation System** — added `services/evaluation` (prompt/agent/retrieval, hallucination, regression).
10. **Observability** — added `services/observability` (OpenTelemetry, Prometheus, Grafana, Loki).
11. **Prompt Management** — added `services/prompts` (versioning, variables, templates, experiments).
12. **Agent Registry** — added `services/agents`, agents as first-class objects.
13. **Permission Model** — added RBAC + ABAC on top of JWT/API Keys/Orgs/Teams.
14. **Multi-tenancy** — Org → Projects → Users → Resources.
15. **Secrets Management** — Vault / AWS Secrets Manager / Doppler / SOPS for production.
16. **AI SDK correction** — Vercel AI SDK is not model management; added separate `Model Registry Service`.
17. **API Gateway** — added gateway layer (Kong/Traefik/Envoy) for auth, rate limits, keys, routing.
18. **Tool Registry** — added `services/tool-registry` so MCP is only one consumer of tools.
19. **Plugin Architecture** — added `plugins/` for domain modules (senate, laws, judiciary, customs…).
20. **Deployment IaC** — added `infra/terraform` and `infra/ansible`.
21. **Final repository structure** — reflected all new services, workers, packages, plugins, and infra.

## OVERALL RATING

* Current architecture before corrections: **8.5 / 10**
* With these additions: **9.8 / 10**

Biggest missing pieces (now addressed):

1. Workflow engine
2. Event architecture
3. Workers
4. Document intelligence pipeline
5. Knowledge graph implementation
6. Observability
7. Multi-tenancy / security model
8. Plugin system

The vision is closer to combining: **OpenAI platform + Palantir Foundry + Supabase + OpenWebUI + LangGraph + MCP ecosystem**. The architecture should be built around **"government intelligence infrastructure"**, not just "AI chat".