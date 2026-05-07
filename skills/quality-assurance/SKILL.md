---
name: quality-assurance
description: Expert skill for ensuring software quality through comprehensive testing, bug discovery, and adherence to quality standards.
---

# Quality Assurance Skill

This skill provides a rigorous framework for validating software correctness, stability, performance, and security. Quality assurance is not merely about finding bugs — it is about building confidence that the system behaves correctly, performs reliably, and remains maintainable under change. Every test should serve a purpose: catch regressions, document expected behavior, or validate a requirement.

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

## Testing Domains

### 1. Functional Testing

**Goal**: Verify that software behaves according to specified requirements.

#### Test Case Design Techniques
- **Equivalence Partitioning**: Divide input data into partitions that should be treated identically by the system. Test one value from each partition.
  - Example: Age field (0-17 = minor, 18-65 = adult, 66+ = senior) → test 10, 30, 70.
- **Boundary Value Analysis**: Test the edges of equivalence partitions.
  - Example: For "age must be 18-65", test 17, 18, 19, 64, 65, 66.
- **Decision Table Testing**: Test combinations of conditions and expected actions.
  - Example: Login — valid credentials? account active? IP whitelisted?
- **State Transition Testing**: Model the system as states and test valid/invalid transitions.

#### Acceptance Criteria Format (Given/When/Then)
```
Scenario: User resets their password
  Given the user is on the login page
    And the user has a registered email address
  When the user submits the "Forgot Password" form with their email
  Then a password reset email is sent to that address
    And the user sees a confirmation message "Check your inbox"
```

#### Checklist
- [ ] All acceptance criteria pass
- [ ] Error messages are clear and user-friendly
- [ ] Empty/null/malformed inputs handled gracefully
- [ ] Happy path, alternate path, and error path covered
- [ ] Boundary values tested for numeric/date inputs

---

### 2. Regression Testing

**Goal**: Ensure new changes do not break existing functionality.

#### Test Selection Strategies
- **Minimized**: Run only tests affected by the code change (test impact analysis). Fastest, highest risk of missing bugs.
- **Risk-Based**: Run all tests in high-risk areas (payment, auth) + impacted tests. Recommended for most commits.
- **Full Suite**: Run everything. Slowest, safest. Use only for release candidates or nightly builds.

#### Test Impact Analysis
Identify which tests are affected by a change:
1. Parse the git diff to list changed files.
2. Map files to test files using code coverage data or dependency graph.
3. Run only the mapped tests plus all tests in the "critical path."

#### Prioritization
| Priority | When to Run | Examples |
|---|---|---|
| P0 (Critical) | Every commit, pre-merge | Auth flows, payment, data loss scenarios |
| P1 (High) | Every PR, nightly | CRUD operations, search, reporting |
| P2 (Medium) | Nightly | Edge cases, UI polish, non-critical paths |
| P3 (Low) | Weekly | Visual regression, deprecated feature paths |

#### Tools
- **Jest --onlyChanged** / **Vitest --changed**: Run tests related to changed files.
- **nx affected:test**: Monorepo-aware test selection.
- **Coverage diff**: Fail CI if coverage decreases in changed files.

---

### 3. Integration Testing

**Goal**: Verify that modules or services work together correctly.

#### Contract Testing (Pact)
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

#### API Testing Patterns
- **Status codes**: 200 for success, 201 for creation, 400 for bad request, 401 for unauthorized, 404 for not found, 500 for server error.
- **Response schema validation**: Use JSON Schema, Zod, or io-ts to validate response shapes.
- **Idempotency**: POST requests should be idempotent where possible (use idempotency keys).
- **Pagination**: Test page size, cursor/offset behavior, empty pages, last page.

#### Mock vs Stub vs Fake
| Technique | Purpose | Example |
|---|---|---|
| **Mock** | Verify behavior (was method called with right args?) | `jest.fn()` with `expect(mock).toHaveBeenCalledWith(...)` |
| **Stub** | Provide canned answers | `jest.fn().mockReturnValue(42)` |
| **Fake** | Working lightweight implementation | In-memory database, fake SMTP server |

**Rule**: Prefer fakes for databases and file systems; prefer mocks only for external I/O boundaries (HTTP calls, message queues).

---

### 4. Performance Testing

**Goal**: Evaluate responsiveness, stability, and scalability under workload.

#### Load Testing with k6
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

#### Identifying Bottlenecks
| Bottleneck | Symptom | Investigation |
|---|---|---|
| Database query | High response time on specific endpoints | Slow query log, `EXPLAIN ANALYZE`, missing index |
| CPU-bound | High CPU usage, requests queuing | Flame graphs, profiler (clinic.js, py-spy) |
| Memory leak | Increasing memory over time, GC pauses | Heap snapshots, `--inspect` for Node.js |
| I/O / Network | High connection count, socket timeouts | Connection pooling, keep-alive, CDN |
| Lock contention | Requests that should be fast are slow under concurrency | Database lock monitoring, mutex profiling |

#### Performance Budgets
Define budgets in your CI pipeline (Lighthouse CI, k6 thresholds):
- **API response**: p95 < 500ms for non-cached, p95 < 100ms for cached.
- **Page load**: FCP < 1.5s, LCP < 2.5s, TBT < 200ms, CLS < 0.1.
- **Bundle size**: JS < 200KB gzipped, CSS < 50KB gzipped.
- **Throughput**: System handles 2x expected peak traffic with < 1% error rate.

---

### 5. Security Testing

**Goal**: Identify vulnerabilities and protect against attacks.

#### OWASP Top 10 Checklist (abbreviated)
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

#### Tool Categories
| Category | Tool | What It Finds |
|---|---|---|
| **SAST** (Static) | SonarQube, Semgrep, CodeQL | Security bugs in source code during dev |
| **DAST** (Dynamic) | OWASP ZAP, Burp Suite | Runtime vulnerabilities in running app |
| **Dependency Scan** | `npm audit`, Snyk, Trivy | Known CVEs in third-party packages |
| **Secret Detection** | GitLeaks, truffleHog | Leaked credentials, API keys in git history |
| **Container Scan** | Trivy, Grype | Vulnerable base images, malware |

#### Pipeline Integration
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

---

## Bug Reporting Standards

Every bug report must contain enough information for a developer to reproduce and triage without additional back-and-forth.

### Bug Report Template

```markdown
## Summary
[One-line description of the issue]

## Environment
- **Environment**: [staging / production / local]
- **Browser / OS**: [Chrome 120 / Windows 11]
- **Commit / Version**: [abc1234 / v2.5.1]
- **Feature Flag Status**: [enabled flags, if applicable]

## Steps to Reproduce
1. Go to [page / endpoint]
2. Enter [specific input]
3. Click [button]
4. Observe [unexpected behavior]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Logs / Screenshots
```
[Relevant logs, stack traces, or HAR files]
```
[Attach screenshot or screen recording if UI-related]

## Severity & Priority
| Severity | Priority | Meaning |
|---|---|---|
| S1 - Critical | P0 | App crash, data loss, security breach |
| S2 - Major | P1 | Major feature broken, no workaround |
| S3 - Minor | P2 | Non-critical feature broken, has workaround |
| S4 - Trivial | P3 | Cosmetic, typo, minor UI misalignment |
```

### Triaging Rules
- **S1/P0**: Stop the line. Fix immediately, rollback if needed.
- **S2/P1**: Fix within the current sprint.
- **S3/P2**: Schedule in the next sprint.
- **S4/P3**: Add to backlog, may never be fixed.

---

## QA in CI/CD

Integrating quality gates into the pipeline ensures consistent quality without relying on manual gates.

### Pipeline Stage Timing

| Pipeline Stage | Tests Run | Gate? |
|---|---|---|
| **pre-commit / pre-push** | Lint, type check, unit tests, smoke tests | Yes — block push if failed |
| **PR (feature branch)** | All unit + integration tests, SAST, dependency scan, coverage diff | Yes — block merge if failed |
| **Staging deploy** | E2E tests, performance tests, DAST | Yes — block promotion if failed |
| **Production deploy** | Smoke tests, canary analysis | Soft gate — alert but allow if canary passes |
| **Nightly** | Full regression suite, visual regression, long-running perf tests | No blocking — report in morning standup |

### Flaky Test Management
- **Detection**: Tag tests as `@flaky` if they fail > 5% of runs without a real bug.
- **Quarantine**: Move flaky tests to a separate CI job that does not block the pipeline.
- **Resolution**: Require a bug ticket before un-quarantining. Triage within 1 sprint.
- **Tooling**: Use `jest --rerun-failed` / `cypress --retries` as a short-term band-aid only.

### Gating Strategy
- **Required checks**: All P0 + P1 tests must pass. Coverage must not decrease.
- **Soft checks**: P2 tests, performance budgets — warn but do not block.
- **Emergency override**: Engineering lead can bypass the gate with written justification (logged in audit trail).

---

## Accessibility Testing

Accessibility (a11y) testing ensures the application is usable by people with disabilities. Treat accessibility bugs as S2 (major) by default.

### Automated Testing
| Tool | What It Checks | How to Run |
|---|---|---|
| **axe-core** (axe DevTools) | WCAG 2.2 AA violations in rendered DOM | `npx axe http://localhost:3000` or in E2E tests |
| **Lighthouse** | a11y score, best practices, perf | `npx lighthouse http://localhost:3000 --preset=desktop` |
| **WAVE** | Visual overlay of a11y issues | Browser extension |
| **pa11y** | CI-friendly a11y assertions | `npx pa11y http://localhost:3000` |
| **eslint-plugin-jsx-a11y** | Catch issues at dev time (missing alt, role, label) | ESLint rule |

```javascript
// Playwright + axe example
const { injectAxe, checkAxe } = require('axe-playwright');

test('home page has no accessibility violations', async ({ page }) => {
  await page.goto('/');
  await injectAxe(page);
  const results = await checkAxe(page);
  expect(results.violations).toHaveLength(0);
});
```

### Manual Testing Checklist
- [ ] **Keyboard navigation**: Tab through all interactive elements. Is focus order logical? Is there a visible focus indicator?
- [ ] **Screen reader**: Narrator (Windows), VoiceOver (macOS/iOS), TalkBack (Android). Listen to the full flow.
- [ ] **Color contrast**: Check all text/background combos. Minimum ratio 4.5:1 for normal text, 3:1 for large text.
- [ ] **Zoom**: 200% zoom in browser — no content clipped or overlapping.
- [ ] **Reduced motion**: With `prefers-reduced-motion: reduce`, animations should be disabled or replaced.
- [ ] **Form labels**: Every input has an associated `<label>` or `aria-label`.

---

## Test Documentation

Good documentation makes tests maintainable, auditable, and valuable for onboarding.

### Test Plan Structure
```
1. Scope (what is being tested and what is out of scope)
2. Test Strategy (types of tests, tools, environment)
3. Test Schedule (milestones, regression schedule)
4. Entry / Exit Criteria
   - Entry: Code complete, build stable, environment ready
   - Exit: All P0/P1 tests pass, no S1 bugs open, coverage >= 80%
5. Roles & Responsibilities
6. Risks & Mitigations
7. Test Deliverables (test cases, reports, bug list)
```

### Test Case Format
| Field | Example |
|---|---|
| **ID** | TC-LOGIN-001 |
| **Title** | Login with valid credentials |
| **Preconditions** | User is registered and not locked out |
| **Test Data** | `username=alice`, `password=ValidP@ss1` |
| **Steps** | 1. Navigate to /login. 2. Enter username. 3. Enter password. 4. Click "Sign In". |
| **Expected Result** | User is redirected to dashboard. Welcome message shows "Hello, Alice!" |
| **Actual Result** | (filled during test execution) |
| **Status** | Pass / Fail / Blocked |

### Traceability Matrix
A traceability matrix maps requirements → test cases → test results.

| Req ID | Requirement | Test Case ID(s) | Status |
|---|---|---|---|
| REQ-AUTH-01 | User can log in with email and password | TC-LOGIN-001, TC-LOGIN-002 | ✅ Pass |
| REQ-AUTH-02 | Locked user gets "Account locked" message | TC-LOGIN-005 | ✅ Pass |
| REQ-AUTH-03 | Password reset email sent within 30 seconds | TC-LOGIN-010 | ❌ Fail — timeout > 30s |

Maintain this matrix in a spreadsheet or test management tool (TestRail, Xray, Zephyr). Update after every test cycle.

---

## Workflow: Step-by-Step QA Process

Follow this process for every feature, bug fix, or release.

### Phase 1: Requirement Review
1. Read the PR description, ticket, or specification.
2. Identify gaps, ambiguities, and missing edge cases.
3. Write acceptance criteria if not provided (Given/When/Then).
4. **Output**: Reviewed requirements + acceptance criteria.

### Phase 2: Test Planning
1. Determine test scope (what to test, what to skip).
2. Design test cases using equivalence partitioning and boundary analysis.
3. Identify test data needs (seed data, mocks, fixtures).
4. Choose test type distribution (unit vs integration vs E2E).
5. **Output**: Test plan document or test case list.

### Phase 3: Test Execution
1. Run all automated unit/integration tests.
2. Execute manual exploratory tests for the feature area.
3. Verify edge cases, error paths, and boundary values.
4. Run regression tests for affected areas.
5. Run performance test if the change affects a hot path.
6. Run security scan if the change touches auth, input handling, or data access.
7. **Output**: Test results, bug reports for found issues.

### Phase 4: Bug Triage & Retesting
1. Log all bugs using the bug report template.
2. Classify by severity and priority.
3. Assign bugs to developers.
4. After fixes are deployed to a test environment, retest and close verified bugs.
5. **Output**: Closed bugs, updated traceability matrix.

### Phase 5: Release Sign-Off
1. Verify smoke tests pass on the release candidate.
2. Confirm no S1/S2 bugs open.
3. Verify coverage thresholds are met.
4. Ensure security scan is clean (no critical/high CVEs).
5. **Output**: Signed-off release candidate ready for production.

### Phase 6: Post-Release Monitoring
1. Monitor production error rates and performance metrics for 24-48 hours.
2. Verify smoke tests pass in production.
3. Review any new bugs filed by users.
4. **Output**: Release retrospective notes for the next sprint.
