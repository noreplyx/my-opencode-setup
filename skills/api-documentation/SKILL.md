---
name: api-documentation
description: Use this skill when designing, implementing, or documenting APIs to ensure consistent, comprehensive, and developer-friendly API documentation following OpenAPI/Swagger standards and best practices.
---

# API Documentation Philosophy

This skill ensures that all APIs are well-documented, consistent, and developer-friendly, following OpenAPI standards and documentation best practices.

## Core Principles

### 1. OpenAPI / Swagger Standards

- Use **OpenAPI 3.x** (OpenAPI 3.1.0 preferred) for REST API documentation.
- Define APIs in a machine-readable format (YAML or JSON) that can be used to generate documentation, client SDKs, and server stubs.
- Maintain the API specification as the **single source of truth** — the specification should drive both documentation and code generation.

#### OpenAPI Document Structure
```yaml
openapi: 3.1.0
info:
  title: My API
  description: Comprehensive description of the API's purpose and capabilities
  version: 1.0.0
  contact:
    name: API Support
    email: api@example.com
servers:
  - url: https://api.example.com/v1
    description: Production server
paths:
  /users:
    get:
      summary: List all users
      description: Returns a paginated list of users with optional filtering
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
```

### 2. Documentation Completeness

Every API endpoint MUST document:

| Element | Required | Details |
|---------|----------|---------|
| **Summary** | ✅ | Brief, one-line description of what the endpoint does |
| **Description** | ✅ | Detailed explanation including business context |
| **Parameters** | ✅ | Query, path, header parameters with types, formats, and defaults |
| **Request Body** | ✅ | For POST/PUT/PATCH: schema, required fields, examples |
| **Responses** | ✅ | Every possible status code with schemas and examples |
| **Authentication** | ✅ | Auth method required (Bearer token, API key, OAuth) |
| **Error Responses** | ✅ | Error schemas with error codes and messages |
| **Rate Limits** | ⚠️ | If applicable |
| **Deprecation Status** | ⚠️ | If endpoint is deprecated |

### 3. API Design Consistency

#### Naming Conventions
- Use **kebab-case** for URL paths: `/api/v1/user-profiles`
- Use **camelCase** for JSON property names: `firstName`, `lastLoginAt`
- Use plural nouns for collection endpoints: `/users`, `/orders`
- Use HTTP methods to represent actions (not verbs in URLs):
  - ✅ `POST /users` (create a user)
  - ❌ `POST /createUser`

#### Status Codes
| Code | Meaning | When to Use |
|------|---------|-------------|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST (resource created) |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid input, validation errors |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Authenticated but not authorized |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource conflict (duplicate, stale version) |
| 422 | Unprocessable Entity | Semantic validation errors |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected server error |

### 4. Error Response Format

Use a consistent error response format across all endpoints:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request was invalid",
    "details": [
      {
        "field": "email",
        "code": "INVALID_FORMAT",
        "message": "Must be a valid email address"
      }
    ],
    "traceId": "abc-123-def-456",
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

### 5. API Versioning

- Use **URL-based versioning** (`/api/v1/`, `/api/v2/`) for clear, explicit versioning.
- Maintain backward compatibility within a major version:
  - Adding new optional fields to responses is OK.
  - Removing or renaming fields requires a new major version.
  - Adding new endpoints is OK within a version.
- Document deprecation timelines in the API specification using the `deprecated` field.

### 6. Examples & Use Cases

- Provide at least one **request example** and one **response example** for every endpoint.
- Include examples for:
  - Successful responses
  - Common error responses
  - Edge cases and boundary conditions
- Use `examples` (plural, for multiple named examples) rather than `example` (singular) in OpenAPI specs.

### 7. Interactive Documentation

- Use tools like **Swagger UI**, **Redoc**, or **Stoplight** to render interactive API documentation from OpenAPI specs.
- Include a "Try it out" feature that allows developers to make real API calls from the documentation.
- Provide SDK snippets in multiple languages (cURL, Python, JavaScript, Java, Go).

### 8. Documentation as Code

- Store OpenAPI specification files in version control alongside the codebase.
- Validate OpenAPI specs in CI/CD pipelines to catch breaking changes.
- Use tools to generate documentation from code annotations or code from OpenAPI specs:
  - **Code-first**: Use annotations/decorators to generate OpenAPI (SpringDoc, NestJS Swagger, FastAPI).
  - **Design-first**: Write OpenAPI first, then generate server stubs and client SDKs (openapi-generator, speakeasy).
- Run **contract tests** to verify the implementation matches the specification.

### 9. Changelog & Migration Guides

- Maintain a `CHANGELOG.md` or API changelog that documents:
  - New endpoints and features
  - Breaking changes with migration instructions
  - Deprecation notices with removal timelines
- Provide **migration guides** for major version upgrades with before/after examples.

## Security Schemes

Define security schemes in the `components/securitySchemes` section of your OpenAPI spec for consistency across all endpoints.

### API Key Authentication
```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
      description: API key issued via developer portal
```

### JWT Bearer Token
```yaml
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: JWT token obtained from /auth/login endpoint
```

### OAuth2 (Authorization Code Flow)
```yaml
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.com/authorize
          tokenUrl: https://auth.example.com/token
          scopes:
            read:users: Read user profiles
            write:users: Create and update users
            admin: Full administrative access
```

Apply security globally or per-operation:
```yaml
# Global (applies to all endpoints)
security:
  - BearerAuth: []

# Per-operation override
paths:
  /health:
    get:
      security: []  # Public endpoint — no auth required
```

## WebSocket Documentation Patterns

For real-time APIs (WebSocket), document the protocol separately from REST endpoints. Use an external markdown reference linked from the OpenAPI spec.

### WebSocket Document Template
```markdown
# WebSocket API — Real-Time Events

**Endpoint:** `wss://api.example.com/v1/events`

**Authentication:** Send JWT bearer token as the first message:
```json
{
  "type": "auth",
  "token": "<your-jwt-token>"
}
```

**Event Types:**

| Direction | Event | Payload | Description |
|-----------|-------|---------|-------------|
| Client → Server | `subscribe` | `{"type":"subscribe","channels":["orders"]}` | Subscribe to channels |
| Server → Client | `order.created` | `{"type":"order.created","data":{...}}` | New order created |
| Server → Client | `order.updated` | `{"type":"order.updated","data":{...}}` | Order status changed |
| Server → Client | `error` | `{"type":"error","code":"AUTH_FAILED","message":"..."}` | Error notification |

**Reconnection:** Exponential backoff starting at 1s, max 30s interval.
```

### GraphQL Documentation Notes
- Document the **schema** (types, queries, mutations, subscriptions) using SDL (Schema Definition Language).
- Maintain a **schema registry** and track changes with tools like Apollo Studio or GraphQL Inspector.
- Document **rate limiting** per operation complexity (not per request) and authentication requirements.

## SDK & Client Generation

Structure your OpenAPI spec to optimize auto-generated client SDKs using tools like `openapi-generator` or `speakeasy`.

### Best Practices for Client-Friendly Specs

- **Use `$ref` consistently** — avoid inline schemas for reused types so generated clients create proper classes.
- **Avoid `oneOf`/`anyOf` without discriminators** — use a `discriminator` property (e.g., `objectType`) so generated code can deserialize polymorphic responses.
- **Provide `example` values** on every schema property so generated client docs show realistic data.
- **Name operations explicitly** — use the `operationId` field with a clear verb-noun pattern (`getUserById`, `listOrders`).

```yaml
paths:
  /users/{userId}:
    get:
      operationId: getUserById  # Generates: client.getUserById(id)
      summary: Retrieve a user by ID
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: string
            format: uuid
```

### Generating Clients

```bash
# Generate a JavaScript client
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml \
  -g javascript \
  -o ./generated-client

# Generate a Python client
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml \
  -g python \
  -o ./generated-client-python
```

- Commit generated clients to a dedicated `clients/` directory in your monorepo or publish to a package registry (npm, PyPI).
- Add a `README.md` in each generated client directory with installation and quick-start instructions.

## Linting & Validation

Enforce API specification quality with **Spectral**, an OpenAPI linter.

### Recommended Spectral Ruleset
```yaml
# .spectral.yaml
extends: [[spectral:oas, all]]
rules:
  # Require operationId on every endpoint
  my-api-operation-id:
    message: "Every operation must have an operationId"
    given: $.paths[*][*]
    then:
      field: operationId
      function: truthy

  # Require description on all operations
  my-api-description:
    message: "Every operation must have a description"
    given: $.paths[*][*]
    then:
      field: description
      function: truthy

  # Require 4xx/5xx error responses
  my-api-error-responses:
    message: "Operation must document at least one error response (4xx or 5xx)"
    given: $.paths[*][*].responses
    then:
      field: 4XX
      function: truthy

  # Enforce version format
  my-api-version-format:
    message: "API version must follow semver (e.g., 1.0.0)"
    given: $.info.version
    then:
      function: pattern
      functionOptions:
        match: "^(\\d+)\\.(\\d+)\\.(\\d+)$"

  # Examples required on all request bodies
  my-api-request-examples:
    message: "Request body must include at least one example"
    given: $.paths[*][*].requestBody.content[*]
    then:
      field: examples
      function: truthy
```

### CI/CD Integration
```yaml
# Example GitHub Actions step
- name: Lint OpenAPI spec
  run: npx @stoplight/spectral lint openapi.yaml
```

Run Spectral in pre-commit hooks and CI pipelines to prevent non-compliant specs from being merged.

## Common Request/Response Patterns

### Pagination (Cursor-Based)
Cursor-based pagination is preferred over offset-based for large datasets and real-time consistency.

```yaml
parameters:
  - name: cursor
    in: query
    description: Opaque cursor from the previous response for fetching the next page
    schema:
      type: string
    example: "eyJpZCI6IjEyMyJ9"
  - name: limit
    in: query
    description: Maximum number of items to return (1–100)
    schema:
      type: integer
      minimum: 1
      maximum: 100
      default: 20
```

```json
// Response
{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6IjQ1NiJ9",
    "hasMore": true,
    "total": 152
  }
}
```

### Filtering
Use a consistent query parameter pattern for filtering collection endpoints.

```yaml
parameters:
  - name: filter[status]
    in: query
    description: Filter by order status. Supports comma-separated OR logic.
    schema:
      type: string
    example: "active,pending"
  - name: filter[createdAfter]
    in: query
    description: Filter records created after this ISO 8601 timestamp
    schema:
      type: string
      format: date-time
    example: "2024-01-01T00:00:00Z"
  - name: search
    in: query
    description: Full-text search across name and description fields
    schema:
      type: string
    example: "widget"
```

```json
// GET /orders?filter[status]=active,pending&filter[createdAfter]=2024-01-01T00:00:00Z&search=widget
{
  "data": [
    {
      "id": "ord_123",
      "status": "active",
      "createdAt": "2024-03-15T10:30:00Z",
      "customerName": "Acme Corp"
    }
  ],
  "pagination": { "nextCursor": null, "hasMore": false, "total": 1 }
}
```

### Sorting
```yaml
parameters:
  - name: sort
    in: query
    description: "Sort field and direction. Prefix with `-` for descending. Default: `-createdAt`"
    schema:
      type: string
    example: "-createdAt"
```
Accepted values: `createdAt`, `-createdAt`, `name`, `-name`, `updatedAt`, `-updatedAt`.

### Idempotent Create (POST with Idempotency-Key)
```yaml
parameters:
  - name: Idempotency-Key
    in: header
    required: true
    description: Unique key to ensure idempotent creation. The same key within 24 hours returns the original resource.
    schema:
      type: string
      format: uuid
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

```json
// Response (201 on first request, 200 on subsequent with same key)
{
  "id": "ord_456",
  "status": "created",
  "idempotencyKey": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
// Header: Idempotent-Replayed: true (if replayed)
```

## Breaking Changes Policy

### What Constitutes a Breaking Change

| Change | Breaking? | Notes |
|--------|-----------|-------|
| Removing an endpoint | ✅ Yes | New major version required |
| Renaming a field | ✅ Yes | New major version required |
| Changing a field type | ✅ Yes | New major version required |
| Making an optional field required | ✅ Yes | New major version required |
| Removing an enum value | ✅ Yes | New major version required |
| Adding a new required field in request body | ✅ Yes | New major version required |
| Changing the URL path structure | ✅ Yes | New major version required |
| Changing authentication requirements | ✅ Yes | New major version required |
| Adding a new optional field to response | ❌ No | Backward compatible |
| Adding a new endpoint | ❌ No | Backward compatible |
| Adding a new enum value | ❌ No | Backward compatible (clients should handle unknown values gracefully) |
| Relaxing validation constraints | ❌ No | Backward compatible |
| Extending max length on a field | ❌ No | Backward compatible |

### Communication Protocol
1. **Announcement**: Post deprecation notice in the API changelog and on the developer portal at least **90 days** before removal.
2. **Sunset Header**: Return a `Sunset: Sat, 01 Nov 2025 00:00:00 GMT` HTTP header on deprecated endpoints.
3. **Deprecation Header**: Return a `Deprecation: true` HTTP header and include a `Deprecation` link header to the migration guide.
4. **Migration Period**: Maintain the old and new versions concurrently for at least **6 months** after the new major version is released.

### OpenAPI Deprecation Annotation
```yaml
paths:
  /v1/orders:
    get:
      deprecated: true
      description: "**Deprecated.** Use `GET /v2/orders` instead. Migration guide: https://docs.example.com/migration-v2"
```

## Code-First vs Design-First

| Aspect | Code-First | Design-First |
|--------|-----------|--------------|
| **Workflow** | Write code first; generate OpenAPI from annotations/decorators | Write OpenAPI spec first; generate server stubs and client code |
| **Tools** | SpringDoc, NestJS Swagger, FastAPI, Django REST Framework | openapi-generator, speakeasy, Fern, Stoplight |
| **Source of Truth** | Code (spec is derived) | OpenAPI spec (code is derived) |
| **Speed of Initial Development** | Faster — no upfront spec design | Slower — spec must be written first |
| **API Contract Consistency** | Lower — spec details depend on annotation coverage | Higher — spec drives all implementation |
| **Client SDK Generation** | Possible but requires spec stability | Natural fit — spec is the input to codegen |
| **Cross-Team Collaboration** | Harder — frontend/mobile teams must wait for backend | Easier — spec is available before any code is written |
| **Breaking Change Detection** | Manual or done at integration test time | Automatic — CI can diff specs and flag breaking changes |
| **Documentation Quality** | Varies — depends on annotation thoroughness | High — spec is written with documentation in mind |
| **When to Use** | Prototypes, small teams, rapid iteration | Large teams, public APIs, multiple client platforms |

**Recommendation**: Use **Design-First** for public-facing APIs and multi-platform products. Use **Code-First** for internal microservices where the backend is the only consumer and speed matters.

## Workflow

When applying the API Documentation skill, follow these steps:

1. **Audit**: Review the current API documentation for completeness and consistency. Check for missing endpoints, inadequate descriptions, inconsistent naming, and lack of error responses. Run Spectral linting against the spec.

2. **Identify**: Point out missing documentation, inconsistent patterns, or broken specifications. Note security schemes that are undocumented, endpoints without examples, and missing error response schemas.

3. **Propose**: Suggest improvements following the standards above. For each issue, provide a concrete fix — a code snippet showing the improved OpenAPI YAML or JSON. Prioritize fixes by impact:
   - **P0**: Missing authentication/security definitions or broken specs that prevent code generation
   - **P1**: Endpoints without request/response examples or error documentation
   - **P2**: Inconsistent naming, missing descriptions, or incomplete pagination documentation

4. **Generate**: Create or update OpenAPI specifications with comprehensive documentation. Include:
   - Full security schemes in `components/securitySchemes`
   - Pagination, filtering, and sorting parameters on list endpoints
   - At least one example per request body and per response
   - Deprecation annotations with migration links where applicable
   - Error response schemas with all applicable status codes (400, 401, 403, 404, 409, 422, 429, 500)

5. **Validate**: Run Spectral linting and fix all errors. Verify the spec renders correctly in Swagger UI or Redoc. Run contract tests to confirm the implementation matches the specification.

6. **Communicate**: Publish the changelog entry, announce via developer portal or internal communication channels, and update the migration guide if this is a breaking change.

---

## Tooling (Automated Checks)

This skill includes an executable script that performs automated OpenAPI/Swagger spec validation.

### Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-api-docs.ts` | Validates OpenAPI specs for missing fields, examples, error responses, security schemes | `ts-node <skills-dir>/scripts/api-documentation/check-api-docs.ts --dir=<project-dir> [--spec=<openapi-file>]` |

### What It Checks

| Rule | Severity | What It Validates |
|------|----------|-------------------|
| `info-required` | Error | Missing info section with title and version |
| `info-version` | Error | Missing semantic version (e.g., 1.0.0) |
| `operation-id` | Warning | Missing operationId (needed for SDK generation) |
| `operation-summary` | Warning | Missing summary on each endpoint |
| `responses-required` | Error | Missing responses section |
| `error-responses` | Warning | No 4xx/5xx error responses documented |
| `response-examples` | Warning | No response examples provided |
| `request-examples` | Warning | No request body examples provided |
| `security-schemes` | Warning | No security schemes defined |

### CI Integration

```bash
# Run in CI to validate OpenAPI specs
ts-node skills/scripts/api-documentation/check-api-docs.ts --dir=./
ts-node skills/scripts/api-documentation/check-api-docs.ts --spec=openapi.yaml
```
