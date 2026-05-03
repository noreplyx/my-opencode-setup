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

## Workflow
When applying the API Documentation skill:
1. **Audit**: Review the current API documentation for completeness and consistency.
2. **Identify**: Point out missing documentation, inconsistent patterns, or broken specifications.
3. **Propose**: Suggest improvements following the standards above.
4. **Generate**: Create or update OpenAPI specifications with comprehensive documentation.
