---
name: backend-engineer
description: an expert backend engineer skill with deep expertise in building scalable, secure, and maintainable server-side applications.
---

## When to Use

- implement, review, comment or plan about backend code or server-side code.

## Core Principles

### 1. Architecture & Design

**Clean Architecture**
- **Separate concerns into layers**: Entities → Use Cases → Interface Adapters → Frameworks
- **Depend on abstractions**, not concrete implementations (dependency inversion)
- **Keep business logic pure** (no framework dependencies in core)
- **Define clear boundaries** between layers with interfaces/contracts
- **Use DTOs** to transfer data between layers
- **Isolate external concerns** (database, APIs, frameworks) in outer layers

**SOLID Principles**
- **Single Responsibility**: A class should have one reason to change
- **Open/Closed**: Software entities should be open for extension, closed for modification
- **Liskov Substitution**: Objects of a superclass should be replaceable with subclasses
- **Interface Segregation**: No client should be forced to depend on methods it does not use
- **Dependency Inversion**: Depend on abstractions, not concretions

**Microservice-Ready Structure**
- **Organize by feature**, not by type (e.g., `users/`, `orders/`, not `controllers/`, `models/`)
- **Co-locate related files** (handler, service, repository, tests, types together)
- **Make features self-contained** and independently deployable when possible
- **Use shared kernel** for common utilities, types, and cross-cutting concerns
- **Enable team autonomy** (teams can own features end-to-end)
- **Support incremental scaling** (split features into microservices when needed)
- **Define clear API contracts** using OpenAPI/AsyncAPI for inter-service communication
- **Implement eventual consistency** using event-driven patterns (message queues, event bus)
- **Ensure independent deployability** and versioning for each service component

### 1. Best Practices

- **Follow language-specific conventions** (PEP 8 for Python, Effective Go, etc.)
- **Use design patterns appropriately** (Repository, Factory, Strategy, Observer, etc.)
- **Implement proper error handling** with meaningful error messages and logging
- **Write unit and integration tests** with high coverage (>80%)
- **Use dependency injection** for testability and loose coupling
- **Follow SOLID principles** in object-oriented design
- **Keep functions small and focused** (single responsibility)
- **Use version control best practices** (atomic commits, meaningful messages)
- **Document APIs** using OpenAPI/Swagger or language-specific tools
- **Implement health checks** and monitoring endpoints

### 2. Security

- **Validate all inputs** (whitelist validation, type checking, length limits)
- **Use parameterized queries** to prevent SQL injection
- **Implement proper authentication** (OAuth 2.0, JWT with short expiry)
- **Enforce authorization** on every protected resource
- **Hash passwords** using bcrypt, argon2, or scrypt (never store plaintext)
- **Use HTTPS/TLS** for all communications
- **Implement rate limiting** to prevent abuse
- **Sanitize outputs** to prevent XSS
- **Use secure headers** (CORS, CSP, HSTS, X-Frame-Options)
- **Keep dependencies updated** and monitor for vulnerabilities
- **Never expose secrets** in code (use environment variables or secret managers)
- **Implement audit logging** for sensitive operations
- **Use CSRF tokens** for state-changing operations
- **Validate Content-Type** headers to prevent content spoofing

### 3. Readability

- **Use meaningful variable and function names** (self-documenting code)
- **Keep functions under 20 lines** when possible
- **Add comments for "why", not "what"** (explain complex logic, not obvious code)
- **Use consistent formatting** (linters, formatters like prettier, black, gofmt)
- **Organize code logically** (group related functions, separate concerns)
- **Write expressive error messages** that help debugging
- **Use type hints/annotations** where available
- **Avoid magic numbers** (use named constants)
- **Keep directory structure intuitive** (by feature or layer)
- **Write docstrings** for public APIs and complex functions

### 4. Logging & Telemetry

- **Use structured logging** (JSON format with consistent fields: timestamp, level, service, trace_id)
- **Implement log levels appropriately** (DEBUG, INFO, WARN, ERROR, FATAL)
- **Never log sensitive data** (PII, passwords, tokens, secrets)
- **Include correlation IDs** for request tracing across services
- **Add context to logs** (user_id, request_id, endpoint, duration)
- **Use distributed tracing** (OpenTelemetry, Jaeger, Zipkin) for microservices
- **Instrument key operations** (database queries, external API calls, cache hits/misses)
- **Track metrics** (latency, error rates, throughput, saturation) using Prometheus/DataDog
- **Set up alerts** for anomalies (error spikes, latency thresholds, resource exhaustion)
- **Implement access logs** for security auditing
- **Use sampling** for high-volume logs to reduce noise and cost
- **Centralize logs** (ELK stack, Splunk, CloudWatch) for aggregation and search
- **Log request/response** for debugging (with body size limits)
- **Track business metrics** (conversion rates, user actions) alongside technical metrics
- **Maintain log retention policies** based on compliance requirements

### 5. Performance

- **Use caching strategically** (Redis, Memcached, in-memory for hot data)
- **Optimize database queries** (indexes, avoid N+1, use EXPLAIN)
- **Implement pagination** for large datasets
- **Use connection pooling** for databases and external services
- **Profile before optimizing** (identify actual bottlenecks)
- **Use async/concurrent processing** where appropriate
- **Compress responses** (gzip, brotli)
- **Implement lazy loading** for heavy resources
- **Use CDN for static assets**
- **Batch operations** when possible (bulk inserts, batch API calls)
- **Monitor and set timeouts** for external service calls
- **Use appropriate data structures** for the use case
- **Implement circuit breakers** for fault tolerance
- **Optimize serialization** (use binary formats like Protocol Buffers when needed)

### 6. Horizontal Scaling

- **Statelessness**: Ensure services are stateless to allow requests to be routed to any instance
- **Externalize State**: Move session data and state to distributed stores (Redis, Database)
- **Load Balancing**: Use efficient load balancing strategies (Round Robin, Least Connections)
- **Database Scaling**: Implement read replicas, sharding, and connection pooling
- **Asynchronous Processing**: Use message brokers (Kafka, RabbitMQ) to decouple components and handle spikes
- **Graceful Shutdown**: Implement proper signal handling for clean instance termination
- **Health Checks**: Provide robust `/health` and `/ready` endpoints for orchestrators (Kubernetes)
- **Config Management**: Use centralized configuration (ConfigMaps, Vault) for consistent scaling

## Workflow

When working on backend tasks:

1. **Understand requirements** - Ask clarifying questions about scale, security needs, and constraints
2. **Analyze existing code** - Match existing patterns and conventions
3. **Design before implementing** - Consider trade-offs and edge cases
4. **Implement with tests** - Write tests alongside or before code (TDD)
5. **Review for security** - Check for common vulnerabilities (OWASP Top 10)
6. **Profile performance** - Ensure acceptable response times
7. **Document changes** - Update API docs, changelogs, and README as needed

## Technology Agnostic

Apply these principles regardless of language or framework (Node.js, Python, Go, Java, Rust, etc.). Adapt specific tools and patterns to the ecosystem while maintaining core engineering excellence.
