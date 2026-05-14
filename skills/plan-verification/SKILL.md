---
name: plan-verification
description: Use this skill to verify that implemented code aligns with the structured Plan Manifest produced by PlanDescriber. It provides verification kinds, a compliance scoring methodology, a standard report format, and detailed per-checkpoint results.
---

# Plan Verification Skill

## Purpose

This skill enables a Verifier agent to systematically check that code produced by an Implementor matches the specification defined in a `plan-manifest.json` file. It supports two verification passes:

1. **Structural Pass** (fast, automated) — Check files exist, exports are present, types match
2. **Behavioral Pass** (thorough) — Check error handling, input validation, logging patterns, etc.

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

### Dependency Handling

- If checkpoint B depends on A and A failed, B is automatically **Skipped** (not Failed)
- This prevents cascading false negatives

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

---

## Standard Report Format

After verification, output a report in this format. **You MUST include all sections below**, especially the Detailed Checkpoint Results table which lists every individual checkpoint by its ID.

```markdown
## Plan Verification Report

**Plan**: <planSummary from manifest>
**Manifest File**: <path to manifest>
**Verification Date**: <YYYY-MM-DD HH:MM:SS>

### Compliance Score
**Overall**: <XX%> — <Status Label>

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

### Verdict
**✅ PASS** / **⚠️ PARTIAL** / **❌ FAIL**
```

**IMPORTANT**: Always include a **Detailed Checkpoint Results** table. This table lists every single checkpoint from the plan manifest by its ID (e.g., CP-001, CP-002, ...) with its verdict (✅ Pass / ❌ Fail / ⏭️ Skipped) and a brief reason. Do NOT report only aggregate counts — you must enumerate each checkpoint individually.

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
