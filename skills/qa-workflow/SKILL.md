---
name: qa-workflow
description: Workflow protocol for the QA subagent. Provides testing methodology, smoke test guidelines, project type detection, test auto-discovery, coverage analysis, security regression test generation, and output contract. Load this skill when dispatching the QA agent.
---

# QA Workflow Skill

## Purpose

The QA Workflow skill defines the standardized end-to-end testing methodology for the QA subagent. It bridges the gap between "code compiles" (Build Gate) and "code is correct, secure, and reliable" (QA Gate). This skill ensures every pipeline run produces reproducible, evidenced test results regardless of project type or stack.

## Mandatory Setup

Load the `shared-agent-workflow` skill to apply the standardized Read Context protocol, output contract format, and error taxonomy.

Then load `quality-assurance` skill for QA methodology (edge case generation, non-functional testing, regression impact analysis) and `accessibility` if testing frontend components.

---

## Workflow

### Step -1: Pre-flight Checkpoint Commit

Before any QA operations begin, create a pre-flight git checkpoint to preserve pipeline state:

```bash
git add -A && git commit -m "pipeline-checkpoint: pre-qa-<pipelineId>"
```

This ensures:
- The exact code state under test is captured
- Rollback is possible if QA finds irreparable issues
- The git log shows a clear pipeline timeline (`git log --grep="pipeline-checkpoint"`)

If the commit fails (nothing to stage), log and proceed -- no checkpoint needed.

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

Determine the necessary testing types (Functional, Integration, Security, Performance) and define test cases. Prioritize:

| Priority | Test Type | When to Apply |
|----------|-----------|---------------|
| P0 | Smoke test | Always -- must pass before any other testing |
| P1 | Functional tests | Always -- verify feature correctness |
| P1 | Security regression | Changes touching auth, input, data access |
| P2 | Integration tests | Cross-module changes |
| P2 | Edge case tests | Public API changes, new functions |
| P3 | Performance tests | Database queries, API endpoints, rendering |
| P3 | Accessibility | UI/frontend changes |

### Step 2.5: Project Type Detection & Test Command Discovery

Before running the smoke test, auto-detect the project type and test command:

1. **Read package.json**: Check for `scripts.start`, `scripts.build`, `scripts.test`, `main`, `bin` fields
2. **Check dependencies**: react, vue, next, express, commander, etc.
3. **Check config files**: vite.config, next.config, webpack.config, tsconfig (jsx setting)
4. **Detect test framework**: Read `jest.config.*`, `vitest.config.*`, `pytest.ini`, `mocha.opts`, check for `tests/`, `__tests__/`, `src/__tests__/`
6. **Classify project** into: `web-app-backend` | `web-app-frontend` | `library` | `cli-tool` | `react-spa` | `monorepo-package` | `unknown`
7. **Report**: "Detected [Jest/Vitest/Pytest/Mocha/None] with tests in [path]"
8. **If no framework detected**: report "No test framework detected" and proceed with manual quality checks

### Step 3: Implementation Review

Inspect the code for obvious quality issues, security flaws, and adherence to the plan before running any tests.

### Step 4: Smoke Test

Run a quick "does the app start?" smoke test. The build gate and security scan have already passed -- this confirms the app is runnable.

Choose the most appropriate approach for the project (see Smoke Test Guidelines table below).

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

### Step 5: Test Auto-Discovery & Execution

Before running any test suite:

1. If no framework was detected in Step 2.5, report "No test framework detected" and proceed with manual quality checks
2. **Check for shared test manifest** (P3 coordination):
   ```
   Before running tests, check if `.opencode/test-manifest.yaml` exists.
   If it does, read it to understand what the Browser Tester is testing.
   Use it to coordinate parallel test execution -- avoid duplicating test coverage.
   ```
3. **QA + Browser Tester hand-off protocol** (P3 coordination):
   ```
   If both QA and Browser Tester are running in parallel, share test results
   via `.opencode/test-results/` directory. Write QA results to
   `.opencode/test-results/qa-<pipelineId>.json` after each test phase completes.
   Read `.opencode/test-results/browser-<pipelineId>.json` for Browser Tester results
   to avoid duplicating browser-level tests.
   ```
4. Run the detected test command (e.g., `npm test` or `jest`). Collect full output.

### Step 6: Execution & Verification

- Perform functional and integration checks.
- Run regression suites.
- Evaluate performance and security vectors.
- Run automatic edge case generation (see `quality-assurance` skill Phase 2.5).
- Run non-functional testing (see `quality-assurance` skill Phase 3.5).

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

### Step 7b: Security Regression Test Generation

After coverage analysis, automatically generate security regression tests for the changed code.

**For each file in Implementor's `changedFiles`, detect security-relevant patterns and generate tests:**

| If file contains... | Generate security test... |
|---------------------|--------------------------|
| Database queries (`db.query`, `db.execute`, `.find(`, `.raw(`) | SQL/NoSQL injection test -- try injection payloads on all endpoints that use this file |
| Route handlers (`@Post`, `app.post`, `router.post`, `@Get`, `app.get`) | Auth bypass test -- try accessing protected routes without a token |
| File I/O (`readFileSync`, `writeFileSync`, `createReadStream`) | Path traversal test -- try path traversal payloads in file-related parameters |
| User input processing (`req.body`, `req.query`, `req.params`) | XSS test -- try XSS payloads on text input fields |
| `res.redirect` or `response.redirect` | Open redirect test -- try external URL redirects |
| JWT or auth logic | Token tampering test -- try modified JWTs |
| ID-based resource access (`/api/:id`, `/api/users/:userId`) | IDOR test -- try accessing another user's resource |
| File upload handling | Upload validation test -- try uploading malicious file types |
| Rate limiting (or missing rate limiting) | Rate limit test -- verify 429 after N rapid requests |
| `fetch()` or `http.request()` to external URLs | **SSRF test** -- try internal hostnames (127.0.0.1, 169.254.169.254, metadata endpoints) and verify they are blocked |
| Object merge/spread (`Object.assign`, `{...obj}`, `_.merge`, `_.extend`) | **Prototype pollution test** -- try `__proto__`, `constructor.prototype` payloads and verify object integrity |
| MongoDB query operators (`$where`, `$gt`, `$ne`, `$regex` in query objects) | **NoSQL injection test** -- try `$gt: ""`, `$ne: null`, `$where: "1"` payloads on MongoDB-backed endpoints |
| Unsanitized user input in `eval()`, `setTimeout()`, `setInterval()` string args | **Code injection test** -- try payloads that execute arbitrary code |

**Test file naming convention:**
- `tests/security/<feature>-sqli.test.ts`
- `tests/security/<feature>-idor.test.ts`
- `tests/security/<feature>-auth.test.ts`
- `tests/security/<feature>-xss.test.ts`
- `tests/security/<feature>-ssrf.test.ts`
- `tests/security/<feature>-prototype-pollution.test.ts`
- `tests/security/<feature>-nosql-injection.test.ts`
- `tests/security/<feature>-code-injection.test.ts`

### Step 8: Bug Reporting

Document all identified issues with clear steps to reproduce and expected vs. actual results. Every bug MUST include reproducible evidence (command + output + reproduction steps).

### Step 9: Regression Impact Analysis

After all tests pass, perform a cross-module impact analysis (see `quality-assurance` skill Phase 5.5).

### Step 10: Final Validation

Once fixes are applied (by Fixer agent), re-verify the affected areas to ensure the issues are resolved.

---

## Smoke Test Guidelines

| Project Type | Smoke Test Command / Approach | Detection Heuristics |
|---|---|---|
| Node.js library | `node -e "require('./dist/index')"` | `main` field in package.json, no framework deps |
| Web app (frontend) | `npm run build` and verify dist/ is produced | `react`, `vue`, `next` in deps |
| Web app (backend) | Start server, verify it binds to the port | `express`, `fastify`, `koa` in deps, `scripts.start` |
| CLI tool | Run `node dist/cli.js --help` and check exit code | `bin` field in package.json |
| React/Vue app | Verify build completes and bundle is generated | `react`, `vue` in deps, vite.config/next.config |
| Monorepo package | Run the package-specific build + import check | Workspaces config in package.json |

---

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

---

## Output Format

Follow the structure defined in `shared-agent-workflow` skill.

### Role-Specific Fields

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
| `securityTestCoverage.gatePassed` | Whether coverage meets the >= 80% threshold |
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

Include evidence in the structured output contract per the `quality-assurance` skill. Every bug report and test result must have reproducible evidence.

---

## Write Access Rules

You have write access **ONLY for the following purposes**:
1. **Creating test files** -- Write new test files under `tests/`
2. **Fixing test bugs** -- Edit existing test files when you discover incorrect assertions or missing test cases
3. **Adding test fixtures** -- Create test data files under `tests/fixtures/`
4. **Updating test config** -- Modify `vitest.config.ts`, `jest.config.ts`, or equivalent
5. **Writing test results** -- Write to `.opencode/test-results/` for QA + Browser Tester hand-off

## NEVER write to:
- Production code files (`src/`, `lib/`, `dist/`)
- Agent configuration files (`agents/`)
- Skill files (`skills/`)
- Plan manifests (`plan-manifests/`)
- Configuration files (`opencode.jsonc`, `package.json`, `tsconfig.json`)

---

## Dependencies

### Inputs Needed
- Implementation files produced by Implementor
- Test configuration and existing test suite
- `.opencode/test-manifest.yaml` (optional -- for parallel test coordination with Browser Tester)
- `.opencode/test-results/browser-<pipelineId>.json` (optional -- Browser Tester results for hand-off)

### Outputs Produced
- Structured output (status, resultSummary, decisions, warnings, changedFiles, artifacts, sources)
- QA report with compliance status, test results, defect log, quality metrics, final verdict
- Coverage analysis report (after running `c8`/`nyc`/`pytest --cov`)
- Test framework discovery report
- Security regression test files (generated under `tests/security/`)
- `.opencode/test-results/qa-<pipelineId>.json` (for QA + Browser Tester hand-off)

### Independence Declaration
- **Dependent on**: Implementor (must have code to test), Security Scan (must have passed)
- **Can parallelize with**: Browser Tester (UI testing runs in parallel with QA logic testing) -- coordinate via `.opencode/test-manifest.yaml` and `.opencode/test-results/`
- **Circuit breaker aware**: Smoke test failures increment `circuitBreaker.counters.smokeTest`

---

## Hard Rules

- [X] NEVER skip smoke tests before full test suite execution
- [X] NEVER report a claim without a `sources` block (method + command + excerpt)
- [X] NEVER report a bug without reproducible evidence (command + output + reproduction steps)
- [X] NEVER report a test as passed without showing the command and output excerpt
- [X] NEVER modify production code, agent configs, skill files, plan manifests, or project config files
- [X] NEVER leave flaky tests in the critical CI path -- quarantine them
- [X] NEVER deploy with known S1 (critical) bugs open
- [x] ALWAYS run `validate-output-contract.ts --stdin` before testing (Step 0b)
- [x] ALWAYS create a pre-flight checkpoint commit before any QA operations (Step -1)
- [x] ALWAYS check `.opencode/test-manifest.yaml` for parallel test coordination (Step 5)
- [x] ALWAYS share results via `.opencode/test-results/` when running in parallel with Browser Tester (Step 5)
- [x] ALWAYS include boundary value analysis for numeric/date inputs
- [x] ALWAYS run security scans for changes touching auth, input handling, or data access
- [x] ALWAYS document acceptance criteria as Given/When/Then
- [x] ALWAYS include the exact command and excerpt for every claim in the `sources` block
