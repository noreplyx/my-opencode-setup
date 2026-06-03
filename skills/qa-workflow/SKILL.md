---
name: qa-workflow
description: |
  UNIFIED QA SKILL (consolidated from qa-workflow + quality-assurance)

  Provides:
  - Testing Workflow: project detection, smoke tests, test discovery, test execution, coverage analysis (from qa-workflow)
  - QA Methodology: edge case generation, non-functional testing, regression impact analysis (from quality-assurance)

  Single source of truth for QA subagent workflows.
---

# Unified QA Skill

This is the single source of truth for all QA agent workflows. It consolidates content from two prior skills (`qa-workflow` and `quality-assurance`) into one unified document.

> **Legacy skills remain in place for backward compatibility:**
> - `quality-assurance/SKILL.md` — Part B (Methodology) originated here
> - `qa-workflow/SKILL.md` (old) — Part A (Workflow) originated here
> - Reference files remain at `quality-assurance/references/` for detailed guidance

---

## Table of Contents

| Part | Content |
|------|---------|
| **Part A: Workflow** | End-to-end QA workflow (pre-flight, project detection, smoke tests, test execution, coverage, security regression) |
| **Part B: Methodology** | Edge case generation, non-functional testing, regression impact analysis, AI-powered test generation, quality metrics, retrospective |
| **Part C: Integration** | Agent loading table, reference map |

---

# Part A: Workflow

> Origin: `qa-workflow/SKILL.md` (Chapter 2)

## Mandatory Setup

Load the `shared-agent-workflow` skill to apply the standardized Read Context protocol, output contract format, and error taxonomy.

Then load `qa-workflow` skill (this file) for testing workflow + QA methodology, and `accessibility` if testing frontend components.

## Workflow Steps

### Step -1: Pre-flight Checkpoint Commit

Before any QA operations begin, create a pre-flight git checkpoint to preserve pipeline state:

```bash
git add -A && git commit -m "pipeline-checkpoint: pre-qa-<pipelineId>"
```

This ensures:
- The exact code state under test is captured
- Rollback is possible if QA finds irreparable issues
- The git log shows a clear pipeline timeline (`git log --grep="pipeline-checkpoint"`)

If the commit fails (nothing to stage), log and proceed — no checkpoint needed.

### Step 0: Load Shared Workflow

Load `shared-agent-workflow` skill for context reading + output contract (see Mandatory Setup above).

### Step 0b: Validate Output Contract

Run the output contract validation on the prior agent's (Implementor's) structured output:

```bash
ts-node skills/scripts/orchestration/validate-output-contract.ts --stdin
```

Pipe the prior agent's output contract into this command. It validates:
- All `changedFiles` claims exist on disk
- All `artifacts` claims exist on disk
- No false claims (files listed but not actually modified)
- Output matches the shared-agent-workflow schema

If validation fails, report the mismatches to the Orchestrator and block QA until resolved.

### Step 0c: Validate Truth Table

Run the truth validation script to cross-check all claims from prior agents:

```bash
# Note: truth table validation script is empty or not found.
# This step is a placeholder for future implementation.
```

This script:
- Reads the prior agent's output and the current state of the workspace
- Cross-references every "claim" (changedFiles, artifacts, decisions) against reality
- Flags stale claims (e.g., "file was modified" but the file hasn't changed)
- Validates that the QA agent's own prerequisites are met

### Step 1: Requirements Analysis

Review the approved plan and quality standards for the specific task. Extract:
- Feature scope and acceptance criteria
- Implementor's `changedFiles` list
- Plan checkpoints and test expectations
- Prior QA history (retry count from agent-context.md)

### Step 2: Test Planning

Determine the necessary testing types and define test cases. Use this priority table:

| Priority | Test Type | When to Apply |
|----------|-----------|---------------|
| P0 | Smoke test | Always — must pass before any other testing |
| P1 | Functional tests | Always — verify feature correctness |
| P1 | Security regression | Changes touching auth, input, data access |
| P2 | Integration tests | Cross-module changes |
| P2 | Edge case tests | Public API changes, new functions |
| P3 | Performance tests | Database queries, API endpoints, rendering |
| P3 | Accessibility | UI/frontend changes |

#### Test Type Definitions

| Test Type | Description | Examples |
|-----------|-------------|----------|
| **Smoke Test** | Quick "does it start?" verification. Fast (<10s), reliable, zero flakiness. | App boots, health endpoint returns 200, CLI --help exits 0 |
| **Functional Test** | Verify feature correctness against specifications. | CRUD operations, form validation, API response codes |
| **Integration Test** | Verify cross-module interactions. | API + database, service + external API, component + store |
| **Security Regression** | Verify no new vulnerabilities introduced. | SQLi, XSS, auth bypass, IDOR, SSRF — see Step 8 |
| **Edge Case Test** | Boundary values, null/empty inputs, type mismatches. | See Part B Phase 2.5 |
| **Performance Test** | Response time, throughput, resource usage. | p95 < 500ms, bundle size budgets |
| **Accessibility Test** | WCAG compliance for UI. | Keyboard nav, color contrast, screen reader, axe-core |

### Step 3: Project Type Detection & Test Command Discovery

Before running the smoke test, auto-detect the project type and test command.

**Detection heuristics:**
1. **Read package.json**: Check `scripts.start`, `scripts.build`, `scripts.test`, `main`, `bin` fields
2. **Check dependencies**: react, vue, next, express, commander, etc.
3. **Check config files**: vite.config, next.config, webpack.config, tsconfig (jsx setting)
4. **Detect test framework**: Read `jest.config.*`, `vitest.config.*`, `pytest.ini`, `mocha.opts`, check for `tests/`, `__tests__/`, `src/__tests__/`
5. **Classify project** into: `web-app-backend` \| `web-app-frontend` \| `library` \| `cli-tool` \| `react-spa` \| `monorepo-package` \| `unknown`
6. **Report**: "Detected [Jest/Vitest/Pytest/Mocha/None] with tests in [path]"
7. **If no framework detected**: report "No test framework detected" and proceed with manual quality checks

#### Project Type Commands & Smoke Test Definitions

| Project Type | Detection Heuristics | Smoke Test Command / Approach |
|---|---|---|
| Node.js library | `main` field in package.json, no framework deps | `node -e "require('./dist/index')"` |
| Web app (frontend) | `react`, `vue`, `next` in deps | `npm run build` and verify dist/ is produced |
| Web app (backend) | `express`, `fastify`, `koa` in deps, `scripts.start` | Start server, verify it binds to the port |
| CLI tool | `bin` field in package.json | Run `node dist/cli.js --help` and check exit code |
| React/Vue app | `react`, `vue` in deps, vite.config/next.config | Verify build completes and bundle is generated |
| Monorepo package | Workspaces config in package.json | Run the package-specific build + import check |

### Step 4: Implementation Review

Inspect the code for obvious quality issues, security flaws, and adherence to the plan before running any tests.

### Step 5: Smoke Test

Run a quick "does the app start?" smoke test. The build gate and security scan have already passed — this confirms the app is runnable.

**The smoke test should be simple, fast (under 10 seconds), and give high confidence the code is runnable.**

Every smoke test claim MUST include evidence:
```yaml
evidence:
  - claim: "Smoke test: app boots successfully"
    method: "test"
    source: "test"
    command: "<exact command run>"
    excerpt: "<key output lines or error>"
    result: "passed" | "failed"
```

### Step 6: Test Auto-Discovery & Execution

Before running any test suite:

1. If no framework was detected in Step 3, report "No test framework detected" and proceed with manual quality checks
2. **Check for shared test manifest** (P3 coordination):
   ```
   Before running tests, check if `.opencode/test-manifest.yaml` exists.
   If it does, read it to understand what the Browser Tester is testing.
   Use it to coordinate parallel test execution — avoid duplicating test coverage.
   ```
3. **QA + Browser Tester hand-off protocol** (P3 coordination):
   ```
   If both QA and Browser Tester are running in parallel, share test results
   via `.opencode/test-results/` directory. Write QA results to
   `.opencode/test-results/qa-<pipelineId>.json` after each test phase completes.
   Read `.opencode/test-results/browser-<pipelineId>.json` for Browser Tester results
   to avoid duplicating browser-level tests.
   ```
4. **Test discovery fallback chain**: Run `npm test` → if no test framework found, try `npx jest` → `npx vitest run` → `npx mocha` → `npx ava` → `npx tap`. First command that succeeds wins.
5. Run the detected test command. Collect full output.

### Step 7: Coverage Analysis

Run coverage tool appropriate to the project stack:

| Stack | Command |
|-------|---------|
| Node.js/TypeScript | `npx c8 report --reporter=text` or `npx nyc report --reporter=text` |
| Python | `pytest --cov=src --cov-report=term-missing` |

Parse the coverage report to identify uncovered lines and files. Add to Quality Metrics:

| File | % Coverage | Uncovered Lines | Risk |
|------|-----------|-----------------|------|
| src/services/user.ts | 85% | 45-48, 102 | Medium |

Include a **Coverage Summary** row.

### Step 8: Security Regression Test Generation

After coverage analysis, automatically generate security regression tests for the changed code.

**For each file in Implementor's `changedFiles`, detect security-relevant patterns and generate tests:**

| If file contains... | Generate security test... |
|---------------------|--------------------------|
| Database queries (`db.query`, `db.execute`, `.find(`, `.raw(`) | SQL/NoSQL injection test — try injection payloads on all endpoints that use this file |
| Route handlers (`@Post`, `app.post`, `router.post`, `@Get`, `app.get`) | Auth bypass test — try accessing protected routes without a token |
| File I/O (`readFileSync`, `writeFileSync`, `createReadStream`) | Path traversal test — try path traversal payloads in file-related parameters |
| User input processing (`req.body`, `req.query`, `req.params`) | XSS test — try XSS payloads on text input fields |
| `res.redirect` or `response.redirect` | Open redirect test — try external URL redirects |
| JWT or auth logic | Token tampering test — try modified JWTs |
| ID-based resource access (`/api/:id`, `/api/users/:userId`) | IDOR test — try accessing another user's resource |
| File upload handling | Upload validation test — try uploading malicious file types |
| Rate limiting (or missing rate limiting) | Rate limit test — verify 429 after N rapid requests |
| `fetch()` or `http.request()` to external URLs | **SSRF test** — try internal hostnames (127.0.0.1, 169.254.169.254, metadata endpoints) and verify they are blocked |
| Object merge/spread (`Object.assign`, `{...obj}`, `_.merge`, `_.extend`) | **Prototype pollution test** — try `__proto__`, `constructor.prototype` payloads and verify object integrity |
| MongoDB query operators (`$where`, `$gt`, `$ne`, `$regex` in query objects) | **NoSQL injection test** — try `$gt: ""`, `$ne: null`, `$where: "1"` payloads on MongoDB-backed endpoints |
| Unsanitized user input in `eval()`, `setTimeout()`, `setInterval()` string args | **Code injection test** — try payloads that execute arbitrary code |

**Test file naming convention:**
- `tests/security/<feature>-sqli.test.ts`
- `tests/security/<feature>-idor.test.ts`
- `tests/security/<feature>-auth.test.ts`
- `tests/security/<feature>-xss.test.ts`
- `tests/security/<feature>-ssrf.test.ts`
- `tests/security/<feature>-prototype-pollution.test.ts`
- `tests/security/<feature>-nosql-injection.test.ts`
- `tests/security/<feature>-code-injection.test.ts`

### Step 9: Bug Reporting

Document all identified issues with clear steps to reproduce and expected vs. actual results. Every bug MUST include reproducible evidence (command + output + reproduction steps).

#### Severity Definitions

| Severity | Priority | Meaning | Action |
|----------|----------|---------|--------|
| **S1 - Critical** | P0 | App crash, data loss, security breach | Stop the line. Fix immediately, rollback if needed. |
| **S2 - Major** | P1 | Major feature broken, no workaround | Fix within the current sprint. |
| **S3 - Minor** | P2 | Non-critical feature broken, has workaround | Schedule in the next sprint. |
| **S4 - Trivial** | P3 | Cosmetic, typo, minor UI misalignment | Add to backlog. |

### Step 10: Regression Impact Analysis

After all tests pass, perform a cross-module impact analysis (see Part B Phase 5.5 for full methodology).

### Step 11: Final Validation

Once fixes are applied (by Fixer agent), re-verify the affected areas to ensure the issues are resolved.

## Core Responsibilities

### Testing Execution
- **Functional Testing**: Verify that each feature operates according to the functional specifications and requirements.
- **Regression Testing**: Ensure that new changes or bug fixes have not adversely affected existing functionality.
- **Integration Testing**: Validate the seamless interaction between different modules, services, and external APIs.
- **Performance Testing**: Analyze system responsiveness, stability, and scalability under various load conditions.
- **Security Testing**: Identify vulnerabilities and ensure the application is protected against common security threats.

### Quality Control & Bug Discovery
- **Finding Bugs and Issues**: Proactively identify defects, edge-case failures, and logical errors in the implementation.
- **Ensuring Adherence to Quality Standards**: Enforce coding standards, linting rules, and architectural guidelines.

### Technical Review
- **Code Quality**: Check for maintainability, readability, and the use of appropriate data structures and algorithms.
- **Error Handling**: Verify that the system handles errors gracefully and provides meaningful logging for critical paths.
- **Security Review**: Confirm input validation, parameterized queries, and proper authentication/authorization mechanisms.

## Output Format

Follow the structure defined in `shared-agent-workflow` skill.

### Role-Specific Fields (QA Agent Output)

| Field | Description |
|-------|-------------|
| `projectType` | Detected project type (web-app-backend, library, etc.) |
| `smokeTestPassed` | Whether the smoke test passed |
| `testFramework` | Detected test framework (Jest, Vitest, etc.) or null |
| `coverage.totalCoverage` | Overall coverage percentage |
| `coverage.files` | Per-file coverage data |
| `securityTestsGenerated` | Number of security test files created |
| `securityTestCoverage.patternsDetected` | Number of security patterns found in modified code |
| `securityTestCoverage.testsGenerated` | Number of security tests actually created |
| `securityTestCoverage.coverage` | Coverage percentage (testsGenerated / patternsDetected * 100) |
| `securityTestCoverage.gatePassed` | Whether coverage meets the ≥ 80% threshold |
| `securityTestCoverage.missingTests` | List of untested patterns with documented skip reasons |

### Sources Block (C1 Compliance)

Every claim in the QA output MUST include a `sources` block that traces back to the exact method, command, and output excerpt that produced the claim:

```yaml
sources:
  - claim: "POST /api/users returns 400 for missing email"
    method: "test"
    command: "curl -s -w '%{http_code}' -X POST http://localhost:3000/api/users -H 'Content-Type: application/json' -d '{\"name\":\"Alice\"}'"
    excerpt: "400"
  - claim: "Coverage: src/services/user.ts at 85%"
    method: "coverage-report"
    command: "npx c8 report --reporter=text"
    excerpt: "src/services/user.ts | 85% | 45-48, 102"
```

**Hard rule**: Every claim MUST include `method`, `command`, and `excerpt`. Claims without sources are invalid and will be rejected by the Orchestrator.

### Evidence Block

Include evidence in the structured output contract. Every bug report and test result must have reproducible evidence:

```yaml
evidence:
  - claim: "POST /api/users crashes with TypeError when email is null"
    method: "test"
    source: "test"
    command: "curl -s -X POST http://localhost:3000/api/users -H 'Content-Type: application/json' -d '{\"name\":\"Alice\"}'"
    excerpt: |
      HTTP/1.1 500 Internal Server Error
      TypeError: Cannot read properties of null (reading 'includes')
          at validateEmail (src/services/user.ts:42)
    result: "failed"
    lines: [42, 42]
  - claim: "Smoke test: app boots successfully"
    method: "test"
    source: "test"
    command: "npm start & sleep 3 && curl -s http://localhost:3000/health"
    excerpt: '{"status":"ok"}'
    result: "passed"
```

#### Evidence Requirements by Test Type

| Test Type | Required Evidence | Minimum Fields |
|-----------|------------------|----------------|
| **Smoke Test** | Command used, exit code, app response | `claim`, `method`, `command`, `excerpt`, `result` |
| **Functional Test** | Command/test name, pass/fail count, failed test output | `claim`, `method`, `command`, `excerpt`, `result` |
| **Edge Case** | Input values, expected vs actual output | `claim`, `method`, `command`, `excerpt`, `result` |
| **Bug Report** | Full reproduction steps, request, response, stack trace | `claim`, `method`, `command`, `excerpt`, `result`, `lines` |
| **Non-Functional Issue** | Tool used, metric value, threshold comparison | `claim`, `method`, `command`, `excerpt`, `result` |
| **Regression Impact** | Import graph, affected modules | `claim`, `method`, `command`, `excerpt`, `result` |

## Write Access Rules

You have write access **ONLY for the following purposes**:
1. **Creating test files** — Write new test files under `tests/`
2. **Fixing test bugs** — Edit existing test files when you discover incorrect assertions or missing test cases
3. **Adding test fixtures** — Create test data files under `tests/fixtures/`
4. **Updating test config** — Modify `vitest.config.ts`, `jest.config.ts`, or equivalent
5. **Writing test results** — Write to `.opencode/test-results/` for QA + Browser Tester hand-off

## NEVER write to:
- Production code files (`src/`, `lib/`, `dist/`)
- Agent configuration files (`agents/`)
- Skill files (`skills/`)
- Plan manifests (`plan-manifests/`)
- Configuration files (`opencode.jsonc`, `package.json`, `tsconfig.json`)

## Dependencies

### Inputs Needed
- Implementation files produced by Implementor
- Test configuration and existing test suite
- `.opencode/test-manifest.yaml` (optional — for parallel test coordination with Browser Tester)
- `.opencode/test-results/browser-<pipelineId>.json` (optional — Browser Tester results for hand-off)

### Outputs Produced
- Structured output (status, resultSummary, decisions, warnings, changedFiles, artifacts, sources)
- QA report with compliance status, test results, defect log, quality metrics, final verdict
- Coverage analysis report (after running `c8`/`nyc`/`pytest --cov`)
- Test framework discovery report
- Security regression test files (generated under `tests/security/`)
- `.opencode/test-results/qa-<pipelineId>.json` (for QA + Browser Tester hand-off)

### Independence Declaration
- **Dependent on**: Implementor (must have code to test), Security Scan (must have passed)
- **Can parallelize with**: Browser Tester (UI testing runs in parallel with QA logic testing) — coordinate via `.opencode/test-manifest.yaml` and `.opencode/test-results/`
- **Circuit breaker aware**: Smoke test failures increment `circuitBreaker.counters.smokeTest`

---

# Part B: Methodology

> Origin: `quality-assurance/SKILL.md` (Chapter 1)

## Core Principles

- **Prefer integration tests** over unit tests for business logic with side effects. Prefer E2E for critical money/security flows.
- **Smoke tests must be fast** (< 5 minutes) and reliable (zero flakiness). If a smoke test fails, abort the full suite and roll back.
- **Treat accessibility bugs as S2 (major)** by default. Automated a11y checks belong in every PR pipeline.
- **Every bug report must have clear reproduction steps**, environment details, and severity classification.
- **Prefer fakes** for databases and file systems; prefer mocks only for external I/O boundaries.
- **Document acceptance criteria** using Given/When/Then format for unambiguous pass/fail conditions.
- **Always include boundary value analysis** for numeric and date inputs.

## Workflow Summary (Methodology Phases)

### Phase 1: Requirement Review
Review specs, identify gaps, write acceptance criteria (Given/When/Then).

### Phase 2: Test Planning
Determine scope, design test cases (equivalence partitioning, boundary analysis), identify test data needs.

### Phase 2.5: Automatic Edge Case Generation
After smoke tests pass and before full test execution, automatically generate boundary value tests.

#### Edge Case Generation Methodology

**Generate test cases for:**
- **Boundary**: Min/max values for numeric inputs, edge of valid ranges, off-by-one errors
- **Null/Empty**: Null/undefined inputs, empty arrays/strings, missing required fields
- **Type Mismatch**: Passing string for number, object for array, invalid enums
- **Race Condition**: Concurrent writes, simultaneous requests to the same resource
- **Overflow**: Very large numbers, max-length strings/arrays/buffers, deeply nested objects
- **Authentication**: Expired tokens, malformed tokens, missing auth headers, role escalation attempts
- **Special Characters**: HTML entities, Unicode, control characters, SQL metacharacters

**Implementation:**
- Use the project's existing test framework (Jest, Vitest, pytest) to generate these automatically where possible
- Write parameterized tests that iterate over edge case matrices
- For JavaScript/TypeScript projects, use `test.each` or `describe.each` for data-driven edge case testing
- For Python projects, use `@pytest.mark.parametrize`

**Output:**
- Report generated edge cases alongside bug findings
- Each edge case test result should be logged with pass/fail status
- Failed edge cases are automatically promoted to bug reports

### Phase 3: Test Execution
Run automated tests, manual exploratory testing, verify edge cases, run regression, performance, and security scans.

### Phase 3.5: Non-Functional Testing
Run performance, accessibility, and security checks on critical paths.

#### Performance/Load Testing
- Run a basic response time check for critical paths (API endpoints, page loads, database queries)
- If response time > 500ms for a simple query, flag as a **performance concern (S3 severity)**
- Document baseline measurements for trend analysis

#### Accessibility Scanning (for UI changes)
- Run basic a11y checks including:
  - Alt text presence on images
  - ARIA labels on interactive elements
  - Color contrast ratios (minimum 4.5:1 for normal text, 3:1 for large text)
- Flag issues as **S2 (major)** by default
- Use automated tools: axe-core, Lighthouse, or platform-specific a11y checkers

#### Security Regression (for changes touching auth, input handling, or data access)
- Run security scan patterns for:
  - `eval()` and similar dynamic code execution
  - `innerHTML` and other DOM injection vectors
  - SQL injection patterns (string concatenation in queries)
  - Hardcoded secrets/tokens
  - Insecure direct object references
- Flag confirmed issues as **S1 (critical)** or **S2 (major)** depending on exploitability

**Reporting:**
- Report non-functional issues in a separate section from functional bugs
- Include the type, finding, severity, and details for each issue

#### Non-Functional Issues Report Format

| Type | Finding | Severity | Details |
|------|---------|----------|---------|
| Performance | ... | S3 | ... |
| Accessibility | ... | S2 | ... |
| Security | ... | S1/S2 | ... |

### Phase 4: Bug Triage & Retesting
Log bugs using the standard template, classify by severity/priority, assign, retest after fixes.

### Phase 5: Release Sign-Off
Verify smoke tests pass, no S1/S2 bugs open, coverage thresholds met, security scan clean.

### Phase 5.5: Regression Impact Analysis
After all tests pass, perform a cross-module impact analysis to identify modules that may be affected by the changes.

#### Full Procedure

1. **Identify all changed files** in the branch/PR
2. **For each changed file, search for import references** across the codebase:
   ```bash
   grep -r "from '.*changed-file'" src/
   grep -r "import.*changed-file" src/
   grep -r "require('.*changed-file')" src/
   ```
3. **Trace impacted modules**: From each importing module, recursively trace imports to find the full dependency graph
4. **Find their test files**: For each impacted module, locate corresponding test files (`*.test.ts`, `*.spec.ts`, `__tests__/`)
5. **Run the impacted tests** to verify no regressions
6. **For each importing module**, flag: "This change may affect [module X] — review recommended"
7. **Classify risk level**:
   - **High**: Direct import of exported types/classes used in critical paths
   - **Medium**: Indirect import or import of utility functions
   - **Low**: Import of constants or type-only imports

**Output:**
- Include a regression impact table in the final QA report
- List each affected module, the file that changed, risk level, and recommended action

#### Regression Impact Table Format

| Affected Module | File | Risk | Action |
|-----------------|------|------|--------|
| module-a.ts | changed-file.ts | High | Review recommended |

### Phase 6: Post-Release Monitoring
Monitor error rates, verify production smoke tests, review user-reported bugs.

---

## AI-Powered Test Generation

When the project has no existing test framework or coverage is below threshold, use these prompts to auto-generate test files.

### Prompt for Unit Test Generation

```
Generate unit tests for the following code.
- Use the [Jest/Vitest] framework
- Cover: happy path, error path, edge cases (null, empty, boundary values)
- Do NOT mock dependencies — prefer integration-style tests
- Include type annotations

[PASTE CODE HERE]
```

### Prompt for Integration Test Generation

```
Generate integration tests for the following API/service.
- Use [supertest/Jest] for HTTP assertions
- Test: successful response, validation errors, auth errors, not-found cases
- Include setup/teardown for test database or in-memory store

[PASTE CODE HERE]
```

### Prompt for Security Test Generation

```
Generate security regression tests for the following code.
- Test for: [SQL injection / XSS / auth bypass / path traversal]
- Use the project's existing test framework
- Include both valid and attack payloads
- Assert that malicious inputs are rejected

[PASTE CODE HERE]
```

## Quality Metrics Report Format

Include this in the final QA output:

```yaml
qualityMetrics:
  testCount: 42
  testPass: 40
  testFail: 2
  testSkip: 0
  coverage: 78%
  coverageThreshold: 80%
  coverageMet: false
  lintPassed: true
  typeCheckPassed: true
  securityScanPassed: true
  accessibilityIssues: 1
  performanceConcerns: 0
  blockingBugs: 1
  nonBlockingBugs: 3
  verdict: "BLOCKED"  # PASS | BLOCKED | CONDITIONAL_PASS
```

## Bug Report Format

Every bug report MUST include execution environment info:

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

## Evidence
- **Command**: `curl -s -X POST ...` or `npm test -- --grep "test name"`
- **Output**: `HTTP 500 - TypeError: Cannot read properties of null`
- **Reproduction**: Run `npm test` with the exact test case, or run the curl command above
- **Line numbers**: src/services/user.ts:42-45

## Severity
S1 - Critical | S2 - Major | S3 - Minor | S4 - Trivial
```

## Retrospective Report Format

After the QA cycle completes, produce a retrospective:

```yaml
retrospective:
  whatWentRight:
    - "Smoke tests caught boot failure immediately in iteration 2"
    - "Edge case generation found 3 null-input bugs before merge"
    - "Security regression tests for SQL injection prevented a PR from shipping with vulnerable queries"
  whatWentWrong:
    - "Test framework auto-detection failed for monorepo — required manual override"
    - "Coverage report missing for 2 files due to c8 config issue"
  improvements:
    - "Add explicit test framework config to monorepo packages"
    - "Pre-configure c8 in the project scaffolding template"
    - "Add a 'tests must exist' gate to the pipeline before QA runs"
```

## Test Execution Best Practices

### Idempotency
- Tests must produce the same result when run multiple times
- Use `beforeEach` to reset state, never depend on test ordering
- Avoid global state pollution between tests
- Use unique identifiers (UUIDs, timestamps) for test data to prevent collisions

### Isolation
- Tests must not depend on each other — each test is a standalone assertion
- Use per-test fixtures/teardown rather than shared state
- Database tests should use transactions that roll back, or dedicated test databases
- Mock external services at the I/O boundary (HTTP, filesystem, message queues)

### Deterministic
- Remove non-determinism: no random values without seeding, no timing-dependent assertions
- Use fixed seeds for random generators: `Math.random = () => 0.5` or `faker.seed(123)`
- Await all async operations — no fire-and-forget promises
- Set explicit timeouts for async operations rather than relying on defaults
- Mock `Date.now()` and `setTimeout()` when testing time-sensitive logic

---

# Part C: Integration

## Agent Loading Table

| QA Agent / Scenario | Load This Skill | Also Load | Purpose |
|---------------------|-----------------|-----------|---------|
| **Full QA workflow** | `qa-workflow` (this file) | `shared-agent-workflow` | Complete testing pipeline |
| **Edge case testing only** | `qa-workflow` (this file) | — | Part B Phase 2.5 methodology |
| **Non-functional testing** | `qa-workflow` (this file) | `accessibility` (if UI) | Part B Phase 3.5 |
| **Security regression** | `qa-workflow` (this file) | — | Part A Step 8 security test generation |
| **Regression impact analysis** | `qa-workflow` (this file) | — | Part B Phase 5.5 |
| **Browser/UI testing** | `qa-workflow` (this file) | `accessibility`, `playwright-cli` | Browser Tester coordination |

## Reference File Map

Detailed guidance is available in the original reference files (at `quality-assurance/references/`):

| Reference File | Content | When to Load |
|----------------|---------|-------------|
| `quality-assurance/references/testing-strategies.md` | Test pyramid, functional/integration/performance/security testing, smoke test guidelines | Designing test cases, choosing test types |
| `quality-assurance/references/qa-workflow.md` | Full QA workflow phases, test documentation, acceptance criteria | Following the end-to-end QA process |
| `quality-assurance/references/ci-testing.md` | CI/CD quality gates, regression testing, flaky tests, accessibility, bug reporting | Setting up CI/CD quality gates, reporting bugs |

---

## Hard Rules

- ❌ NEVER skip smoke tests before full test suite execution
- ❌ NEVER leave flaky tests in the critical CI path — quarantine them
- ❌ NEVER deploy with known S1 (critical) bugs open
- ❌ NEVER report a claim without a `sources` block (method + command + excerpt)
- ❌ NEVER report a bug without reproducible evidence (command + output + reproduction steps)
- ❌ NEVER report a test as passed without showing the command and output excerpt
- ❌ NEVER modify production code, agent configs, skill files, plan manifests, or project config files
- ✅ ALWAYS document acceptance criteria as Given/When/Then
- ✅ ALWAYS include boundary value analysis for numeric/date inputs
- ✅ ALWAYS run security scans for changes touching auth, input handling, or data access
- ✅ ALWAYS run `validate-output-contract.ts --stdin` before testing (Step 0b)
- ✅ ALWAYS create a pre-flight checkpoint commit before any QA operations (Step -1)
- ✅ ALWAYS check `.opencode/test-manifest.yaml` for parallel test coordination (Step 6)
- ✅ ALWAYS share results via `.opencode/test-results/` when running in parallel with Browser Tester (Step 6)
- ✅ ALWAYS include the exact command used to reproduce each bug
- ✅ ALWAYS include the exact output/error for failed tests
- ✅ ALWAYS include line numbers for bugs that reference specific code locations
- ✅ ALWAYS include reproduction steps in the bug description

---

## Tooling (Automated Checks)

This skill includes an executable script that performs automated QA readiness checks (originally from `quality-assurance`).

### Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-qa.ts` | Analyzes project for test coverage, test config, linter setup, CI pipeline, TS strict mode | `ts-node <skills-dir>/scripts/quality-assurance/check-qa.ts --dir=<project-dir> [--ci]` |

### What It Checks

| Area | Checks |
|------|--------|
| Testing | Test files exist, jest/vitest configured, test script in package.json, coverage script |
| Config | TypeScript strict mode, ESLint config, Prettier config |
| CI | GitHub Actions workflow presence |
| E2E | Playwright configuration |

### CI Integration

Use the `--ci` flag to make the script exit with code 1 on failure, suitable for CI pipeline gating:

```bash
ts-node skills/scripts/quality-assurance/check-qa.ts --dir=./ --ci
```

---

> **For detailed guidance**, load the appropriate reference file from `quality-assurance/references/`:
> - `testing-strategies.md` — Test pyramid, functional/integration/performance/security testing, smoke tests
> - `qa-workflow.md` — Full QA workflow phases, test documentation, acceptance criteria
> - `ci-testing.md` — CI/CD quality gates, regression testing, flaky tests, accessibility, bug reporting