---
name: plan-describe
description: Use this skill to transform a high-level technical plan or a set of brainstorming ideas into a detailed, actionable implementation roadmap. It focuses on bridging the gap between "what" needs to be done and "how" it will be executed.
---

## Goal
The primary objective is to provide a comprehensive, step-by-step breakdown of a technical plan, ensuring that every architectural decision is analyzed, every dependency is identified, and every implementation detail is explicit.

## Workflow

### 1. Plan Analysis
Break down the high-level plan to identify potential gaps, risks, and assumptions.
- **Decomposition:** Split the plan into logical modules or milestones.
- **Critical Path Analysis:** Identify the sequence of tasks that determines the project duration.
- **Risk Assessment:** Pinpoint potential technical bottlenecks, breaking changes, or security vulnerabilities.
- **Consistency Check:** Ensure the plan aligns with existing project conventions and architectural patterns.

### 2. Implementation Deep Dive
For each module identified in the analysis, provide a deep dive into the "how".
- **Interface Definition:** Specify exactly which functions, classes, or API endpoints need to be created or modified.
- **Data Flow Mapping:** Describe how data moves through the system for each step.
- **Library/Tool Selection:** Justify the choice of specific libraries or utilities based on the codebase.
- **Edge Case Handling:** Explicitly define how the implementation should handle errors, timeouts, and unexpected inputs.
- **Performance Considerations:** Detail how the implementation will maintain or improve system performance.

### 3. Step-by-Step Execution Roadmap
Convert the deep dive into a linear sequence of actionable tasks.
- **Phase 1: Prerequisites & Foundation**
  - List necessary configuration changes, dependency installations, or boilerplate code.
- **Phase 2: Core Implementation**
  - Provide an ordered list of files to edit/create.
  - For each file, specify the exact logic to be implemented (e.g., "Add `validateInput` method to `UserService` to handle X and Y").
- **Phase 3: Integration & Wiring**
  - Describe how the new components are connected to the rest of the system.
  - Detail the sequence of wiring (e.g., "Register the new service in the file after implementing the service logic").
- **Phase 4: Verification & Quality Assurance**
  - Define the specific test cases (unit, integration, E2E) that must pass.
  - Specify the exact commands to run for linting and type-checking.

### 4. Definition of Done

For each phase and the overall feature, clearly define what "done" means. This prevents scope creep and gives the implementor a clear exit criterion.

| Level | Criteria |
|---|---|
| **Per-File Done** | File created/modified, exports match the interface, builds without errors |
| **Per-Phase Done** | All files in the phase created, tests pass for that phase, lint clean |
| **Feature Done** | All phases complete, all checkpoints in plan-manifest pass, smoke test passes, no regressions |

### 5. Plan Manifest Generation
After completing the roadmap, produce a machine-readable `plan-manifest.json` file in the `plan-manifests/` directory.

#### Why a Plan Manifest?
The Plan Manifest enables the Verifier agent to programmatically compare the implemented code against the plan specification. Without it, verification is purely manual and relies on the Orchestrator's subjective reading.

#### Naming Convention
Name the file `plan-manifests/<feature-name>-manifest.json` where `<feature-name>` matches the feature being described.

#### Manifest Schema
The manifest must follow this JSON structure:

```json
{
  "manifestVersion": 1,
  "planSummary": "Brief description of the overall plan",
  "createdAt": "<ISO-8601 timestamp>",
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
    }
  ]
}
```

#### Checkpoint ID Convention
- IDs follow the pattern `CP-NNN` (e.g., `CP-001`, `CP-042`)
- Number sequentially starting from 001
- Group structural checkpoints first, then behavioral checkpoints

#### Available Verification Kinds

**Structural kinds** (use `type: "structural"`):
| kind | When to Use | verify fields |
|---|---|---|
| `fileExists` | A new file must be created | No extra fields |
| `fileNotExists` | A file or directory must be deleted/removed | No extra fields |
| `exportExists` | A named export must be present | `exportName`: the exported name |
| `classExists` | A class must be exported | `className`: the class name |
| `functionExists` | A function must be exported | `functionName`: the function name |
| `methodExists` | A class must have a method | `className`, `methodName` |
| `typeExists` | A type/interface must be exported | `typeName`: the type or interface name |
| `routeExists` | An API route must be registered | `routePath`: e.g., "/api/users", `method`: "GET/POST/PUT/DELETE" |

**Behavioral kinds** (use `type: "behavioral"`):
| kind | When to Use | verify fields |
|---|---|---|
| `handlesError` | Code must handle a specific error scenario | `methodName`, `details`: error description |
| `validatesInput` | A method must validate its inputs | `methodName` |
| `logsAtLevel` | Must log at a specific level | `level`: "info/warn/error/debug" |
| `hasMiddleware` | A route must use middleware | `middlewareName`, `routePath`, `method` |

**Meta kinds** (use `type: "meta"`):
| kind | When to Use | verify fields |
|---|---|---|
| `selfReviewCheckpoint` | A meta-checkpoint for the Implementor to self-verify | `prompt`: what to check, `method`: "grep" / "read" / "reason" |

#### Dependency Mapping
- Use `dependsOn` to express ordering: if checkpoint A must pass before B can be verified, set B's `dependsOn: ["CP-00A"]`
- File existence checks should be dependencies of export/behavioral checks within that file
- Keep dependencies minimal — only declare what's strictly necessary

#### Manifest Diffing Support

Each manifest version should include a `changes` field listing what changed from the previous version. This enables the Verifier to produce plan diff reports across versions.

Schema addition:
```json
{
  "manifestVersion": 2,
  "changes": [
    {
      "from": "CP-005",
      "to": "CP-007",
      "description": "Split error handling checkpoint into two: one for 429 response, one for timeout"
    }
  ]
}
```

When incrementing the manifest version, always document the diff in the `changes` array. If there is no previous version (first manifest), omit the `changes` field or set it to an empty array.

#### Hard Rule
- ❌ NEVER skip producing the manifest. Every roadmap MUST have a corresponding manifest.
- ✅ Place all manifests under `plan-manifests/` directory (create it if it doesn't exist).
- ✅ Use only the verification kinds listed above.
- ❌ NEVER produce a plan manifest with only structural checkpoints — every manifest MUST include at least 2 behavioral checkpoints (`handlesError`, `validatesInput`, or `logsAtLevel`) per file being modified.
- ✅ ALWAYS include edge case checkpoints: empty input, null input, concurrent access, rate limits.

## Full Roadmap Example

Below is a complete example showing how a brainstormed decision translates into a step-by-step roadmap with a corresponding plan manifest.

### Context
After brainstorming, the user chose: **In-memory sliding window rate limiter** for a 5-route Express API at ~100 req/s.

### Roadmap

#### Phase 1: Prerequisites & Foundation
1. **Install dependency**: `express-rate-limiter` (npm install)
2. **Create directory**: `src/middleware/` if it doesn't exist

#### Phase 2: Core Implementation
1. **Create file `src/middleware/rate-limiter.ts`**:
   - Export `RateLimiterOptions` interface with fields: `windowMs`, `maxRequests`, `statusCode`
   - Export `createRateLimiter(options)` factory function
   - Use an in-memory Map<string, number[]> keyed by IP address
   - Implement sliding window logic: filter timestamps within `windowMs`, count, reject if over limit
   - Return Express middleware `(req, res, next) => {...}`

2. **Modify `src/app.ts`**:
   - Import `createRateLimiter` from the new middleware
   - Create limiter with `{ windowMs: 60_000, maxRequests: 100, statusCode: 429 }`
   - Apply to all routes: `app.use(limiter)`

#### Phase 3: Integration & Wiring
- Register the rate limiter middleware **before** route handlers in `app.ts`
- Ensure `/health` endpoint is either exempt or uses a higher limit

#### Phase 4: Definition of Done
- [ ] `src/middleware/rate-limiter.ts` exists with correct exports
- [ ] `src/app.ts` imports and applies the limiter
- [ ] Build passes: `npm run build`
- [ ] Lint passes: `npm run lint`
- [ ] Smoke test: 101 requests in 1 second from same IP → 100 succeed, 101st gets 429

### Corresponding Manifest
The `plan-manifests/rate-limiter-manifest.json` would contain:
- CP-001: fileExists for src/middleware/rate-limiter.ts
- CP-002: exportExists: createRateLimiter
- CP-003: exportExists: RateLimiterOptions
- CP-004: functionExists: createRateLimiter
- CP-005: handlesError: rate limiter returns 429 when limit exceeded
- CP-006: validatesInput: createRateLimiter validates options (windowMs > 0, maxRequests > 0)

## Plan Confidence Score

Before finalizing a roadmap, the PlanDescriber should rate its own confidence (1-10) in each phase. This gives the Orchestrator a signal to provide more context or run Finder first.

### How to Score

For each phase in the roadmap, assign a confidence score:

| Score | Meaning | Action |
|---|---|---|
| 10 | Certain — exact files, lines, and logic are known | Proceed |
| 7-9 | Mostly confident — minor ambiguity about internal details | Proceed, but note the uncertainty |
| 4-6 | Partial — unsure about some file locations or interfaces | Orchestrator should consider running Finder for more context |
| 1-3 | Uncertain — significant gaps in understanding of the codebase | Orchestrator MUST run Finder before proceeding |

### Scoring Format

Include confidence scores in the roadmap as a comment block before the phase:

```
<!-- Confidence: Phase 1 = 9, Phase 2 = 6 (unsure about middleware registration order), Phase 3 = 8 -->
```

If any phase scores below 7, append a note explaining what's uncertain and what additional context would help:

```
<!-- Low Confidence Note: Phase 2 scores 6 because the exact location of route registration in app.ts is unknown. Running Finder with goal "find route registration in app.ts" would raise confidence to 9. -->
```

## Output Requirements
The final description must be so detailed that an implementor can follow it without needing further clarification. It should include:
- A clear "Definition of Done" for each step.
- References to existing files/lines that will be impacted.
- A logical ordering that minimizes rework.

### Roadmap Quality Checklist
Before finalizing a roadmap, verify:
- [ ] Every file to be created or modified is listed
- [ ] Each file has a specific description of what logic to add/change
- [ ] Dependencies between steps are explicit (step B references step A's output)
- [ ] Edge cases are documented for non-trivial logic
- [ ] Test commands are specified (build, lint, test, type-check)
- [ ] A plan-manifest.json is always produced alongside the roadmap

## Hard Rules
- ❌ NEVER skip the Plan Analysis phase — always decompose the plan first
- ❌ NEVER skip producing the plan-manifest.json — verification depends on it
- ❌ NEVER use vague language like "implement the feature" — specify exact files, functions, and logic
- ✅ ALWAYS include a Definition of Done for each phase
- ✅ ALWAYS reference specific file paths and line numbers for modifications to existing files
- ✅ ALWAYS specify exact commands for build, lint, and test verification

---

## Tooling (Manifest Generation)

This skill includes an executable script to generate plan-manifest.json templates.

### Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `generate-manifest.ts` | Generates a `plan-manifest.json` template with structural and behavioral checkpoints | `ts-node <skills-dir>/scripts/plan-describe/generate-manifest.ts --name=<feature-name> --out=<project-dir>` |

### Usage

```bash
# Generate a plan manifest template for a feature
ts-node skills/scripts/plan-describe/generate-manifest.ts \
  --name=user-profile \
  --out=./
```

This creates `plan-manifests/user-profile-manifest.json` with 5 checkpoints (3 structural + 2 behavioral) in dependency order. Customize the generated template with specific file paths, export names, and verification details for your feature.

#### Acceptance Criteria Kinds (NEW)
Use `type: "acceptance"` for business-verifiable checkpoints. These checkpoints define a concrete test that the Verifier can execute to confirm the implementation meets the business requirement.

| kind | When to Use | verify fields |
|------|-------------|---------------|
| `acceptanceCriteria` | A specific business scenario must work end-to-end | `given`: precondition, `when`: action/trigger, `then`: expected outcome, `testCommand`: shell command that exits 0 on pass |

**Why acceptance criteria matter:**
Structural checkpoints verify that code has certain patterns (exports, error handling). Behavioral checkpoints verify code patterns exist. But neither verifies that the code actually *works correctly* for the business scenario. Acceptance criteria close this gap by defining an executable test.

**Schema example:**
```json
{
  "id": "CP-010",
  "type": "acceptance",
  "description": "Registration with existing email returns 409",
  "target": "src/controllers/user.controller.ts",
  "verify": {
    "kind": "acceptanceCriteria",
    "given": "A user with email 'alice@example.com' already exists in the database",
    "when": "POST /api/users is called with body { email: 'alice@example.com', name: 'Alice' }",
    "then": "Response status is 409 and body contains error: 'Email already registered'",
    "testCommand": "curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/users -H 'Content-Type: application/json' -d '{\"email\":\"alice@example.com\",\"name\":\"Alice\"}' | grep -q 409"
  },
  "dependsOn": ["CP-001", "CP-006"]
}
```

**When to add acceptance criteria:**
- Every POST/PUT/DELETE endpoint should have at least 1 acceptance criteria (happy path)
- Every endpoint with business validation should have 2 acceptance criteria (happy + validation failure)
- Error scenarios from the plan's edge case analysis should have acceptance criteria
- At minimum, each manifest MUST include at least 2 acceptance criteria checkpoints for features that modify data or have business rules

#### Hard Rule Update
- ✅ At minimum, each manifest MUST include at least 2 `acceptanceCriteria` checkpoints for features that create/modify data or have business rules. This ensures the code actually works for the business scenario, not just that the code structure matches expectations.
