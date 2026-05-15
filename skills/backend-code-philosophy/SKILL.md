---
name: backend-code-philosophy
description: Use this skill when planning or implementing backend code to ensure adherence to clean architecture, microservice readiness, and horizontal scaling.
---

# Backend Code Philosophy

This skill supplements the general `code-philosophy` skill with backend-specific concerns. Use it alongside `code-philosophy` when writing or reviewing any backend service code.

## References

Detailed content is organized into reference files for progressive loading:

| File | Content |
|------|---------|
| `references/microservice-patterns.md` | Microservice readiness, horizontal scaling, API design & contracts |
| `references/data-and-resilience.md` | Caching, database patterns, testing, error handling & resilience |
| `references/security-and-observability.md` | Security, observability, API versioning & migration |

## Core Principles (Summary)

### 1. Microservice Readiness
- **Independent deployability** — Feature flags over coordinated deploys
- **Async communication** — Events/message queues over synchronous HTTP for cross-service workflows
- **API Gateway** — Single entry point for auth, rate limiting, routing
- **Health checks** — Every service exposes `/health` and `/health/ready`

### 2. Horizontal Scaling
- **Statelessness** — Session state in external store (e.g. Redis), not process memory
- **Shared-nothing** — No local mutexes, no in-memory caches assuming single process
- **Idempotent handlers** — Same input always produces same result
- **Graceful shutdown** — SIGTERM drains connections before exit

### 3. API Design
- RESTful conventions (plural nouns, kebab-case, standard HTTP methods)
- Consistent response envelope (`{ success, data, error, meta }`)
- Cursor-based pagination with `limit`, `cursor`, and `hasMore`
- Idempotency-Key header for mutating endpoints

### 4. Caching
- Multi-layer: L1 (memory) → L2 (distributed cache) → L3 (database)
- Write-through or event-driven cache invalidation
- Probabilistic early expiration to prevent thundering herds

### 5. Database Patterns
- Repository pattern with domain/infrastructure separation
- Versioned, reversible migrations (up/down always)
- Eager loading to prevent N+1 queries
- Short transactions — never hold locks across external calls

### 6. Error Handling
- Custom error classes with status codes and machine-readable `code`
- Retry with exponential backoff for transient failures
- Circuit breaker pattern for downstream dependencies
- Timeouts on ALL external calls

### 7. Security
- Schema validation at API boundary (e.g. Zod, Joi, or custom validators)
- Token-based authentication + role-based authorization middleware
- Rate limiting (distributed, e.g. sliding window in Redis)
- Secrets in environment variables or secret manager, never in code

### 8. Observability
- Structured logging — never raw console.log
- Readiness + liveness health check endpoints
- Metrics collection (e.g. Prometheus histograms, gauges)

## Workflow

When asked to implement or review backend code:

1. **Load the general `code-philosophy` skill** first for foundational clean code, SOLID, and architecture guidance
2. **Load this `backend-code-philosophy` skill** for backend-specific concerns
3. **Identify the concern type** from the task:
   - New API endpoint → API Design + Security + Observability
   - New service/module → Microservice Readiness + Scaling + Database
   - Performance optimization → Caching + Query optimization
   - Resilience improvement → Error Handling & Resilience
   - Adding tests → Testing Strategy
   - Upgrading/versioning API → API Versioning
4. **Reference the relevant reference file** for detailed patterns and code examples
5. **Verify** the implementation follows both general and backend-specific principles

## Tooling

This skill ships with an automated check script:

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-backend.ts` | Detects statefulness, missing health checks, N+1 queries, missing validation, missing shutdown | `ts-node skills/scripts/backend-philosophy/check-backend.ts --dir=<project-dir>` |

```bash
# Run after implementation
ts-node skills/scripts/backend-philosophy/check-backend.ts --dir=./
```

> **For detailed patterns and code examples**, see the reference files:
> - `references/microservice-patterns.md` — Full microservice, scaling, and API design content
> - `references/data-and-resilience.md` — Caching, database, testing, and resilience patterns
> - `references/security-and-observability.md` — Security, observability, and API versioning
