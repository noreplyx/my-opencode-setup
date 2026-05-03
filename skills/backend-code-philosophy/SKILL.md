---
name: backend-code-philosophy
description: Use this skill when planning or implementing backend code to ensure adherence to microservice readiness and horizontal scaling.
---

## Core Principles

### 1. Microservice Readiness
- **Independent Deployability**: Ensure services can be deployed without requiring synchronous changes to other services.
- **Loose Coupling**: Use asynchronous communication (events/queues) to reduce direct dependencies.
- **API Versioning**: Maintain backward compatibility through versioned endpoints.
- **Resilience Patterns**: Implement Circuit Breakers, Retries, and Timeouts to handle distributed system failures.
### 2. Horizontal Scaling
- **Statelessness**: Avoid storing session state on the server; use external caches or databases.
- **Shared-Nothing Architecture**: Ensure nodes do not share state, allowing them to be added or removed independently.
- **Load Balancing**: Design for requests to be distributed evenly across multiple instances.
- **Database Scalability**: Use read replicas and sharding strategies to prevent the database from becoming a bottleneck.

### 3. API Design & Contracts
- **RESTful Conventions**: Use standard HTTP methods (GET, POST, PUT, DELETE, PATCH) and consistent resource naming (plural nouns, kebab-case).
- **Request/Response Contracts**: Define clear request schemas (validation rules, required/optional fields) and response schemas (consistent envelope format with data, error, and metadata fields).
- **Pagination & Filtering**: Implement cursor-based or offset-based pagination for list endpoints. Support filtering, sorting, and field selection via query parameters.
- **Error Handling**: Return structured error responses with standard HTTP status codes, error codes, and human-readable messages. Never expose stack traces or internal details.
- **Idempotency**: Design mutating endpoints (POST, PUT, PATCH, DELETE) to be idempotent where appropriate, using idempotency keys for payment or order operations.

### 4. Caching Strategies
- **Multi-Layer Caching**: Implement caching at multiple layers — application-level (in-memory cache), distributed cache (Redis/Memcached), and HTTP caching (Cache-Control headers, ETags).
- **Cache Invalidation**: Use cache-aside (lazy loading) or write-through patterns. Invalidate caches on data mutations via event-driven invalidation or TTL-based expiration.
- **Stale Data Tolerance**: Classify data by how stale it can be (real-time vs. near-real-time vs. eventually consistent) and choose caching strategies accordingly.
- **Cache Key Design**: Use structured, namespaced cache keys (e.g., `user:{id}:profile`) to avoid collisions and enable bulk invalidation.
- **Thundering Herd Prevention**: Use locking mechanisms (mutex) or probabilistic early expiration to prevent multiple concurrent requests from overwhelming the data source when a cache entry expires.

### 5. Database Patterns & Data Access
- **Repository Pattern**: Abstract data access behind repository interfaces to decouple business logic from specific database implementations (SQL, NoSQL, ORM).
- **Connection Management**: Use connection pooling with appropriate min/max pool sizes. Implement retry logic with exponential backoff for transient database failures.
- **Query Optimization**: Use indexed columns for filtering and sorting. Avoid N+1 query problems by using eager loading or batch queries. Analyze slow queries with EXPLAIN plans.
- **Migrations & Versioning**: Manage schema changes through versioned, reversible migration scripts. Never modify production schemas directly; always use migrations.
- **Soft Deletes & Auditing**: Implement soft deletes (e.g., `deleted_at` timestamp) instead of hard deletes for critical data. Include `created_at`, `updated_at`, and `created_by` audit columns.
- **Transactional Integrity**: Use database transactions for operations that modify multiple related records. Keep transaction scopes as narrow as possible to avoid long-held locks.
