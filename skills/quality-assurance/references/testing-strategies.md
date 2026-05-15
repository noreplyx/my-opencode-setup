---
name: testing-strategies
description: Detailed reference for test types, functional testing techniques, integration testing patterns, performance testing, security testing, and smoke test guidelines.
---

## Table of Contents

1. [Test Pyramid & Strategy](#test-pyramid--strategy)
2. [Functional Testing](#functional-testing)
3. [Integration Testing](#integration-testing)
4. [Performance Testing](#performance-testing)
5. [Security Testing](#security-testing)
6. [Smoke Test Guidelines](#smoke-test-guidelines)

---

## Test Pyramid & Strategy

The test pyramid guides the distribution of test types to maximize confidence while minimizing maintenance cost and execution time.

### Traditional Test Pyramid

- **Unit Tests (60-70%)**: Fast, isolated, no I/O. Test a single function/class in isolation. Run on every file save.
- **Integration Tests (20-25%)**: Test interactions between components (API + database, service + external API). Run on every commit.
- **E2E Tests (5-10%)**: Full user flow through the system. Run on CI before merge and nightly.
- **Manual / Exploratory (1-5%)**: Ad-hoc testing, usability review, edge case discovery.

### Testing Trophy (Testing Library Philosophy)

The "trophy" model (Kent C. Dodds) de-emphasizes shallow unit tests in favor of integration tests that exercise components the way users do:

| Test Type | Role | Example |
|---|---|---|
| **Static Analysis** | Catch typos and type errors | TypeScript, ESLint |
| **Unit Tests** | Pure logic, utilities, helpers | Jest + Vitest |
| **Integration Tests** | **Core confidence** — test behavior not implementation | React Testing Library, Supertest |
| **E2E Tests** | Critical user journeys | Playwright, Cypress |
| **Visual Regression** | UI appearance changes | Percy, Chromatic |

### Balancing Rules

- Prefer integration tests over unit tests for business logic with side effects.
- Prefer E2E tests over integration tests for critical money/security flows.
- Avoid testing framework internals (e.g., component lifecycle methods, private functions).

---

## Functional Testing

**Goal**: Verify that software behaves according to specified requirements.

### Test Case Design Techniques

#### Equivalence Partitioning

Divide input data into partitions that should be treated identically by the system. Test one value from each partition.

- **Example**: Age field (0-17 = minor, 18-65 = adult, 66+ = senior) → test 10, 30, 70.

#### Boundary Value Analysis

Test the edges of equivalence partitions.

- **Example**: For "age must be 18-65", test 17, 18, 19, 64, 65, 66.

#### Decision Table Testing

Test combinations of conditions and expected actions.

- **Example**: Login — valid credentials? account active? IP whitelisted?

#### State Transition Testing

Model the system as states and test valid/invalid transitions.

### Functional Testing Checklist

- [ ] All acceptance criteria pass
- [ ] Error messages are clear and user-friendly
- [ ] Empty/null/malformed inputs handled gracefully
- [ ] Happy path, alternate path, and error path covered
- [ ] Boundary values tested for numeric/date inputs

---

## Integration Testing

**Goal**: Verify that modules or services work together correctly.

### Contract Testing (Pact)

Contract tests verify that API interactions between a consumer and provider are compatible without needing both running simultaneously.

```pact
# Consumer-side (e.g., frontend expects this from backend)
{
  "uponReceiving": "a request for user profile",
  "withRequest": { "method": "GET", "path": "/users/1" },
  "willRespondWith": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "body": { "id": 1, "name": like("Alice"), "email": like("alice@example.com") }
  }
}
```

- Run consumer tests against a Pact mock server.
- Publish the Pact file to a Pact Broker.
- Provider tests verify the real API satisfies all published contracts.

### API Testing Patterns

- **Status codes**: 200 for success, 201 for creation, 400 for bad request, 401 for unauthorized, 404 for not found, 500 for server error.
- **Response schema validation**: Use JSON Schema, Zod, or io-ts to validate response shapes.
- **Idempotency**: POST requests should be idempotent where possible (use idempotency keys).
- **Pagination**: Test page size, cursor/offset behavior, empty pages, last page.

### Mock vs Stub vs Fake

| Technique | Purpose | Example |
|---|---|---|
| **Mock** | Verify behavior (was method called with right args?) | `jest.fn()` with `expect(mock).toHaveBeenCalledWith(...)` |
| **Stub** | Provide canned answers | `jest.fn().mockReturnValue(42)` |
| **Fake** | Working lightweight implementation | In-memory database, fake SMTP server |

**Rule**: Prefer fakes for databases and file systems; prefer mocks only for external I/O boundaries (HTTP calls, message queues).

---

## Performance Testing

**Goal**: Evaluate responsiveness, stability, and scalability under workload.

### Load Testing with k6

```javascript
// k6 script example
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp-up
    { duration: '3m', target: 50 },   // Sustained load
    { duration: '1m', target: 0 },    // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],   // Less than 1% failure rate
  },
};

export default function () {
  const res = http.get('https://api.example.com/health');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
```

### Identifying Bottlenecks

| Bottleneck | Symptom | Investigation |
|---|---|---|
| Database query | High response time on specific endpoints | Slow query log, `EXPLAIN ANALYZE`, missing index |
| CPU-bound | High CPU usage, requests queuing | Flame graphs, profiler (clinic.js, py-spy) |
| Memory leak | Increasing memory over time, GC pauses | Heap snapshots, `--inspect` for Node.js |
| I/O / Network | High connection count, socket timeouts | Connection pooling, keep-alive, CDN |
| Lock contention | Requests that should be fast are slow under concurrency | Database lock monitoring, mutex profiling |

### Performance Budgets

Define budgets in your CI pipeline (Lighthouse CI, k6 thresholds):

- **API response**: p95 < 500ms for non-cached, p95 < 100ms for cached.
- **Page load**: FCP < 1.5s, LCP < 2.5s, TBT < 200ms, CLS < 0.1.
- **Bundle size**: JS < 200KB gzipped, CSS < 50KB gzipped.
- **Throughput**: System handles 2x expected peak traffic with < 1% error rate.

---

## Security Testing

**Goal**: Identify vulnerabilities and protect against attacks.

### OWASP Top 10 Checklist (abbreviated)

- [ ] **Broken Access Control**: Verify user A cannot access user B's data. Test role escalation.
- [ ] **Cryptographic Failures**: No hardcoded secrets. TLS everywhere. Passwords hashed (bcrypt, argon2).
- [ ] **Injection**: SQLi, NoSQLi, XSS, command injection. Use parameterized queries and output encoding.
- [ ] **Insecure Design**: Rate limiting on auth endpoints, proper session management.
- [ ] **Security Misconfiguration**: Default credentials removed, debug endpoints disabled, CORS locked down.
- [ ] **Vulnerable Components**: `npm audit`, `pip audit`, Dependabot alerts. No known-CVE dependencies.
- [ ] **Auth & Session Failures**: MFA for sensitive actions, session timeout, CSRF tokens.
- [ ] **Software & Data Integrity**: Signed packages, SBOM for dependencies, lockfiles committed.
- [ ] **Logging & Monitoring Failures**: Audit logs for sensitive actions, alerts on brute force.
- [ ] **SSRF**: Validate and whitelist URLs the server fetches.

### Tool Categories

| Category | Tool | What It Finds |
|---|---|---|
| **SAST** (Static) | SonarQube, Semgrep, CodeQL | Security bugs in source code during dev |
| **DAST** (Dynamic) | OWASP ZAP, Burp Suite | Runtime vulnerabilities in running app |
| **Dependency Scan** | `npm audit`, Snyk, Trivy | Known CVEs in third-party packages |
| **Secret Detection** | GitLeaks, truffleHog | Leaked credentials, API keys in git history |
| **Container Scan** | Trivy, Grype | Vulnerable base images, malware |

### Pipeline Integration

- **Every PR**: SAST scan (10 min max), dependency scan, secret scan.
- **Nightly / Staging**: DAST scan (full crawl + active scan).
- **Release**: Container scan + SBOM generation + full security review.

---

## Smoke Test Guidelines

Smoke tests verify that the most critical system functions work after a deployment, before running the full test suite.

| Project Type | Smoke Test Approach | Typical Duration |
|---|---|---|
| **Web App (SPA)** | Visit home page, log in, perform one CRUD action, verify 200 on health endpoint | 2-5 min |
| **API / Microservice** | Health check endpoint, auth endpoint, one core business endpoint | 1-2 min |
| **Mobile App** | App launches, login flow works, main feed renders | 3-5 min |
| **CLI / Library** | Package installs, help flag works, one core command succeeds | 30 sec - 2 min |
| **Data Pipeline** | Source connector connects, one record is processed and lands in sink | 5-10 min |

**Rule**: Smoke tests must be fast (< 5 minutes) and reliable (zero flakiness). If a smoke test fails, abort the full test suite and roll back the deployment.
