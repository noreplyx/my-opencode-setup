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
