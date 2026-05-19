---
name: plan-verification
description: Use this skill to verify that implemented code aligns with the structured Plan Manifest produced by PlanDescriber. It provides verification kinds, a compliance scoring methodology, a standard report format, and detailed per-checkpoint results.
---

# Plan Verification Skill

## Purpose

This skill enables a Verifier agent to systematically check that code produced by an Implementor matches the specification defined in a `plan-manifest.json` file. It supports four verification passes:

1. **Structural Pass** (fast, automated) — Check files exist, exports are present, types match
2. **Behavioral Pass** (thorough) — Check error handling, input validation, logging patterns, etc.
3. **Checkpoint Suggestion Pass** (corrective) — When behavioral checks fail, suggest missing checkpoints for PlanDescriber
4. **Plan Drift Detection Pass** (architectural) — Verify overall implementation matches plan's architectural intent

---

## Verification Kinds

### Structural Verification Kinds

| Kind | What It Checks | How to Verify |
|---|---|---|
| `fileExists` | File exists at the specified path | `glob` or `read` the path — if it returns content, pass |
| `fileNotExists` | File or directory does NOT exist (e.g., after deletion) | `glob` the path — if it returns nothing, pass; if path exists, fail |
| `exportExists` | A named export exists in a module | `grep` for `export class <Name>`, `export function <Name>`, `export const <Name>`, `export interface <Name>` in the target file |
| `classExists` | A class is exported from a module | `grep` for `export class <className>` in the target file |
| `functionExists` | A function is exported from a module | `grep` for `export function <functionName>` or `export const <functionName>` in the target file |
| `methodExists` | A class has a specific method | `grep` for `<methodName>` inside the class definition in the target file |
| `typeExists` | A type/interface is exported | `grep` for `export type <name>` or `export interface <name>` in the target file |
| `routeExists` | An API route endpoint is registered | `grep` for the route path + HTTP method (e.g., `app.get('/users'`, `router.post('/users'`) in the routes file |

### Behavioral Verification Kinds

| Kind | What It Checks | How to Verify |
|---|---|---|
| `handlesError` | Method handles a specific error condition | Search for try/catch blocks, `if`-guard-`throw` patterns, error class references, or error-handling middleware. Accept any pattern that interrupts normal flow on error (throw, return error, catch block). The method does NOT need try/catch — a simple `if (condition) throw new Error(...)` is valid error handling. |
| `validatesInput` | Method validates input before processing | Search for input validation logic (e.g., zod schemas, `if`/`else` guards that throw on invalid input, regex tests, validation library calls) **before** the main processing logic. An `if (!x) throw ...` guard at the top of a method counts as input validation. |
| `logsAtLevel` | Logging at a specific severity level exists | `grep` for `logger.<level>(` or `console.<level>(` in the target file |
| `hasMiddleware` | A route/endpoint has specified middleware | `grep` for the middleware name in route registrations (e.g., `app.get('/path', middlewareName` or `.use(middlewareName)`) |

---

## Plan Manifest Format

The Verifier reads a `plan-manifest.json` file that follows this schema:

```json
{
  "manifestVersion": 1,
  "planSummary": "Brief description of the overall plan",
  "createdAt": "ISO timestamp",
  "checkpoints": [
    {
      "id": "CP-001",
      "type": "structural",
      "description": "Human-readable description of what to verify",
      "target": "relative/file/path.ts",
      "verify": {
        "kind": "fileExists"
      },
      "dependsOn": []
    },
    {
      "id": "CP-002",
      "type": "behavioral",
      "description": "Description of behavioral check",
      "target": "relative/file/path.ts",
      "verify": {
        "kind": "validatesInput",
        "methodName": "someMethod",
        "details": "Optional extra context"
      },
      "dependsOn": ["CP-001"]
    }
  ]
}
```

The manifest will be written by PlanDescriber alongside the roadmap, typically at a path like `plan-manifests/<feature-name>-manifest.json`.

---

## Verification Methodology

### Pass 1: Structural Verification

For each structural checkpoint (in dependency order):
1. Check that all `dependsOn` checkpoints passed
2. Perform the verification according to the `verify.kind`
3. Record: Pass / Fail / Skipped (if dependency failed)

**Structural pass fails if:**
- A required file doesn't exist
- A required file or directory exists when it should have been deleted
- A required export/class/function/type is missing
- A required route is not registered

### Pass 2: Behavioral Verification

For each behavioral checkpoint (in dependency order):
1. Check that all `dependsOn` checkpoints passed
2. Read the target file and search for the expected pattern
3. Record: Pass / Fail / Skipped (if dependency failed)

**Behavioral pass fails if:**
- No error handling exists where required
- No input validation exists where required
- No logging at the specified level exists
- Middleware is not applied to the route

### Cross-File Consistency Checks

During both structural and behavioral passes, perform cross-file checks to ensure imports and exports are consistent:

- When checking `exportExists` for file A, verify that imports in file B that reference this export resolve correctly
- When checking `classExists`, verify that files depending on this class import it correctly
- Use `grep` to trace import chains: `grep "from './file-a'" src/**/*.ts`
- Report cross-file issues as checkpoint failures (e.g., "Export 'Foo' exists in file A but file B's import does not resolve")

### Dependency Handling

- If checkpoint B depends on A and A failed, B is automatically **Skipped** (not Failed)
- This prevents cascading false negatives

### Pass 3: Checkpoint Suggestion Pass

After behavioral verification, analyze any failed behavioral checkpoints and suggest missing checkpoints for PlanDescriber:

1. For each behavioral checkpoint that **Failed**, analyze the implementation to determine what checkpoint **would have caught** the issue
2. Suggest the missing checkpoint in the format: `Suggested missing checkpoint: CP-NNN (handlesError) for method Y in file Z`
3. Include these as a "Suggested Checkpoints" section in the report

**Example**:
- If CP-005 (`handlesError` for `validateEmail`) fails because no duplicate email error handling was found, suggest:
  `Suggested missing checkpoint: CP-NNN (handlesError) for method validateEmail in file src/services/user-service.ts — Missing error handling for duplicate email`

This feedback loop helps PlanDescriber produce better manifests next time.

### Pass 4: Plan Drift Detection

Beyond individual checkpoint compliance, check if the overall implementation approach matches the plan's architectural intent:

1. Read the `planSummary` from the manifest and any architectural notes in the checkpoint descriptions
2. Compare against actual implementation patterns found during structural/behavioral passes
3. Detect architectural drift, for example:
   - "Plan says 'use repository pattern' but implementation directly queries the database"
   - "Plan says 'use dependency injection' but classes are instantiated with `new` directly"
   - "Plan says 'use zod for validation' but implementation uses manual if/else guards"
4. Report drift as a non-blocking **warning** unless it contradicts a specific checkpoint

---

## Compliance Scoring

The overall compliance score is calculated as:

```
Compliance % = (Total Passed / (Total Checkpoints - Total Skipped)) × 100
```

- **Skipped** checkpoints are excluded from the denominator (they indicate blocked checks, not failures)
- **Failed** checkpoints count against the score

### Scoring Thresholds

| Score | Status | Meaning |
|---|---|---|
| 100% | ✅ Full Compliance | Everything in the plan is implemented |
| 80–99% | ⚠️ Partial Compliance | Most things implemented, some missing |
| 50–79% | ❌ Low Compliance | Significant gaps between plan and implementation |
| < 50% | 🚫 Critical Non-Compliance | Major deviations from the plan |

### Confidence Level

A `confidence` field accompanies the compliance score to indicate how trustworthy the score is:

| Condition | Confidence |
|---|---|
| 100% pass rate + all cross-file checks pass + no drift detected | **HIGH** |
| 100% pass rate but drift detected | **MEDIUM** |
| < 100% pass rate (any failures) | **LOW** (explicit deviations) |

The confidence level is reported alongside the compliance score (e.g., "95% — ⚠️ Partial Compliance — Confidence: LOW").

---

## Standard Report Format

After verification, output a report in this format. **You MUST include all sections below**, especially the Detailed Checkpoint Results table which lists every individual checkpoint by its ID.

```markdown
## Plan Verification Report

**Plan**: <planSummary from manifest>
**Manifest File**: <path to manifest>
**Verification Date**: <YYYY-MM-DD HH:MM:SS>

### Compliance Score
**Overall**: <XX%> — <Status Label> — Confidence: <HIGH/MEDIUM/LOW>

### Results Summary
| Category | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Structural | N | N | N | N |
| Behavioral | N | N | N | N |
| **Total** | **N** | **N** | **N** | **N** |

### Detailed Checkpoint Results
| ID | Type | Verdict | Reason |
|---|---|---|---|
| CP-001 | structural (fileExists) | ✅ Pass | File exists at path/to/file.ts |
| CP-002 | structural (exportExists) | ❌ Fail | Export "Foo" not found in target file |
| CP-003 | behavioral (handlesError) | ⏭️ Skipped | Depends on CP-001 which failed |

### Failed Checkpoints
| ID | Type | Description | Failure Reason |
|---|---|---|---|
| CP-XXX | structural | ... | File not found at path/to/file.ts |

### Skipped Checkpoints
| ID | Type | Description | Blocked By |
|---|---|---|---|
| CP-XXX | behavioral | ... | Depends on CP-YYY which failed |

### Suggested Checkpoints (for PlanDescriber)
| Suggested ID | Type | Description | Based On |
|---|---|---|---|
| CP-NNN | behavioral | handlesError for method validateEmail | Missing error handling for duplicate email |

### Drift Detection
None detected ✅ / ⚠️ Drift found: [description]

### Verdict
**✅ PASS** / **⚠️ PARTIAL** / **❌ FAIL**
```

**IMPORTANT**: Always include a **Detailed Checkpoint Results** table. This table lists every single checkpoint from the plan manifest by its ID (e.g., CP-001, CP-002, ...) with its verdict (✅ Pass / ❌ Fail / ⏭️ Skipped) and a brief reason. Do NOT report only aggregate counts — you must enumerate each checkpoint individually.

**IMPORTANT**: If Pass 3 or Pass 4 yielded any results, include the **Suggested Checkpoints** and **Drift Detection** sections in the report. If neither pass produced results, these sections can be omitted.

---

## Hard Rules

- ❌ NEVER modify implementation code
- ❌ NEVER modify the plan manifest
- ✅ ONLY read files, search with grep/glob, and produce a verification report
- ✅ Always process checkpoints in dependency order
- ✅ Skip behavioral verification if structural verification failed for related files

---

## Tooling (Automated Verification)

This skill includes an executable script that programmatically verifies code against a plan manifest.

### Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `verify-manifest.ts` | Reads `plan-manifest.json` and verifies each checkpoint against actual code. Produces compliance score report. | `ts-node <skills-dir>/scripts/plan-verification/verify-manifest.ts --manifest=<manifest-path> --dir=<project-dir> [--verbose]` |

### Supported Verification Kinds

| Kind | What It Checks |
|------|----------------|
| `fileExists` | File exists at the specified path |
| `fileNotExists` | File doesn't exist (e.g., after deletion) |
| `exportExists` | Named export present in a module |
| `functionExists` | Named function exported from module |
| `methodExists` | Method exists on a class |
| `handlesError` | Error handling in target file (try/catch, if-guard-throw, error class references) |
| `validatesInput` | Input validation (zod, Joi, if/assert, if-guard-throw) in target file |

### Usage

```bash
# After implementation, verify against the plan
ts-node skills/scripts/plan-verification/verify-manifest.ts \
  --manifest=plan-manifests/user-profile-manifest.json \
  --dir=./
```

The script processes checkpoints in topological dependency order, automatically skipping downstream checks when dependencies fail. It produces a compliance score with pass/fail/skipped breakdown.

### Pass 2.5: Acceptance Criteria Verification (NEW)

For each `acceptance` type checkpoint, run the specified `testCommand` to verify the implementation meets the business requirement:

1. Check that all `dependsOn` checkpoints passed
2. Execute the `testCommand` from the checkpoint manifest using your bash tool
3. If exit code is 0 → ✅ Pass
4. If exit code is non-zero → ❌ Fail, capture stdout+stderr
5. Record: Pass / Fail / Skipped (if dependency failed)

**Acceptance criteria pass fails if:**
- The `testCommand` exits with non-zero status
- The command fails to connect to the application (app not running)
- The response does not match the expected `then` description

**Important considerations:**
- `acceptanceCriteria` checkpoints require the application to be running
- The Verifier MUST start the application before running these checks if it's not already running:
  ```bash
  # Start app in background, wait for health check
  npm run start &  # or npm run dev, or the appropriate command
  sleep 3
  curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health || \
    (echo "App failed to start" && kill %1 && exit 1)
  ```
- After all acceptance checks, stop the background app: `kill %1 2>/dev/null || true`
- If the app cannot be started, all acceptance checkpoints are Skipped with reason "App not running"
- For unit-testable acceptance criteria (pure function tests), use the test runner instead:
  ```bash
  npx jest --testPathPattern="user-service" --silent 2>&1 | grep -q "PASS"
  ```

**Dependency ordering:**
- `acceptanceCriteria` checkpoints typically depend on structural checkpoints (file exists, export exists)
- They should also depend on any behavioral checkpoints that validate the same code path
- This ensures acceptance tests only run when the underlying implementation exists

### Pass 2.5 Impact on Scoring

Acceptance criteria checkpoints are weighted **double** in the compliance score:

```
Compliance % = ((Structural Passed × 1) + (Behavioral Passed × 1) + (Acceptance Passed × 2)) / 
               ((Total Structural × 1) + (Total Behavioral × 1) + (Total Acceptance × 2)) × 100
```

This weighting reflects that acceptance criteria provide the highest confidence that the implementation works correctly.

**Example:**
- 5 structural (all pass), 3 behavioral (2 pass, 1 fail), 2 acceptance (1 pass, 1 fail)
- Score = ((5 × 1) + (2 × 1) + (1 × 2)) / ((5 × 1) + (3 × 1) + (2 × 2)) × 100
- Score = (5 + 2 + 2) / (5 + 3 + 4) × 100 = 9/12 × 100 = 75%


### Acceptance Criteria Verification Kind

In addition to structural and behavioral kinds, the Verifier now supports `acceptance` type checkpoints:

| Kind | What It Checks | How to Verify |
|------|----------------|---------------|
| `acceptanceCriteria` | A specific business scenario works end-to-end | Execute `verify.testCommand` via bash. Exit 0 = pass. Exit non-zero = fail with captured output. |

**Full `acceptanceCriteria` manifest schema:**
```json
{
  "id": "CP-010",
  "type": "acceptance",
  "description": "Registration with existing email returns 409",
  "target": "src/controllers/user.controller.ts",
  "verify": {
    "kind": "acceptanceCriteria",
    "given": "A user with email 'alice@example.com' already exists",
    "when": "POST /api/users with body { email: 'alice@example.com' }",
    "then": "Response is 409 with error message",
    "testCommand": "curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/users -H 'Content-Type: application/json' -d '{\"email\":\"alice@example.com\",\"name\":\"Alice\"}' | grep -q 409"
  },
  "dependsOn": ["CP-001"]
}
```

## Hard Rules Update

- ❌ NEVER skip acceptance criteria verification — these provide the highest-confidence check that code works for the business scenario
- ✅ ALWAYS start the application if acceptance criteria checkpoints exist in the manifest
- ✅ ALWAYS stop the application after all acceptance checks complete
- ✅ ALWAYS report the exit code and captured output for failed acceptance criteria checkpoints
