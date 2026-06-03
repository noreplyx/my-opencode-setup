---
name: implementor-workflow
description: Workflow protocol for the Implementor subagent. Provides step-by-step implementation instructions, bash safety rules, security self-review checklist, pre-build import validation, and structured output contract. Load this skill when dispatching the Implementor agent.
---

# Skill: implementor-workflow

## Core Responsibilities

- **Follow the plan AND improve it.** Implement what's specified, then apply best practices the plan omitted.
- Every function that touches a database, network, or filesystem MUST have explicit error handling.
- Every public API method MUST validate its inputs.
- Every service-level function MUST log (info on success, error on failure).
- Every function MUST have proper TypeScript types — no `any`, no implicit returns.
- If the plan says direct DB access, extract a repository/DAO layer.
- Never hardcode config — use environment variables or config objects.
- Report EVERY quality improvement in your output — the Orchestrator feeds these back to PlanDescriber.
- Keep output focused. Quality additions are NOT scope creep — they are mandatory craftsmanship.
- Every substantive claim in your output MUST include a `sources` block with method, command, lines, excerpt, and contentHash (see Output Format).

---

## Quality Self-Review Checklist (MANDATORY)

After writing code and BEFORE running the build, run this mandatory quality self-review against every created/modified file:

### Quality Checks (17 items)

| # | Check | How to Verify | Severity |
|---|-------|--------------|----------|
| 1 | **Error Handling** — Every async/error-prone operation has try/catch or `.catch()` | `grep` for `try {` / `catch` / `.catch(` near DB/net/fs calls | ❌ Blocking |
| 2 | **Input Validation** — Every public function validates its parameters | `grep` for zod/joi/class-validator or `if (!x) throw` guards | ❌ Blocking |
| 3 | **Logging** — Every public method logs entry/exit (info) or errors (error) | `grep` for `logger.info\|logger.error\|console.log\|console.error` | ❌ Blocking |
| 4 | **Type Safety** — No `any`, no implicit return types, no untyped parameters | `grep` for `: any\|function .*(.*).*{` (check return types) | ❌ Blocking |
| 5 | **No Direct DB in Controllers** — DB access is behind repository/DAO | `grep` for `db\.\|prisma\.\|query\|execute` (should be in services/dao) | ❌ Blocking |
| 6 | **No Magic Values** — No hardcoded strings/numbers that should be config | Manual review for strings > 20 chars, numbers > 0 | ⚠️ Warning |
| 7 | **Single Responsibility** — Each function does ONE thing | Manual review — split functions > 30 lines | ⚠️ Warning |
| 8 | **Naming** — Names reveal intent (no `data`, `info`, `temp`, `x`, `foo`) | Manual review | ⚠️ Warning |
| 9 | **Config from Env** — Secrets/config come from process.env, not hardcoded | `grep` for hardcoded passwords/keys/URLs | ❌ Blocking |
| 10 | **Separation of Concerns** — Controllers don't do business logic, models don't handle HTTP | Manual review | ⚠️ Warning |
| 11 | **No Dead Code** — No commented-out code, no unused imports/variables | Manual review | ⚠️ Warning |
| 12 | **Error Messages** — Errors are descriptive and actionable, not just "Error" | Manual review | ⚠️ Warning |
| 13 | **Parameterized Queries** — No string concatenation in SQL/NoSQL | `grep` for `` `${` `` in db queries | ❌ Blocking |
| 14 | **DTOs/Validation Schemas** — Create DTOs/schemas for API request/response shapes | Check for exported interfaces/types/schemas | ❌ Blocking |
| 15 | **Idempotency Consideration** — For write operations, consider idempotency (upsert, unique constraints) | Manual review for POST/PUT endpoints | ⚠️ Warning |
| 16 | **No TODO/FIXME/HACK** — No unfinished work left in code | `grep` for `TODO\|FIXME\|HACK\|XXX` | ❌ Blocking |
| 17 | **Bundle Size / Dependency Awareness** — No unnecessary dependencies; tree-shakeable imports | Review new imports in package.json or import statements | ⚠️ Warning |

### Scoring

| Condition | Action |
|-----------|--------|
| All ❌ Blocking checks pass (12/12) | Proceed. Include `qualitySelfReview: { passed: true, blockingItems: 12/12, warningItems: 5/5 }` |
| Any ❌ Blocking fails | **FIX before reporting** — do NOT proceed to build |
| Any ⚠️ Warning fails | Flag in output as `warnings` — non-blocking but noted |

### Output Format for Quality Self-Review

```yaml
qualitySelfReview:
  passed: true | false
  blockingItemsPassed: 12
  blockingItemsTotal: 12
  warningItemsPassed: 5
  warningItemsTotal: 5
  failures:
    - file: "src/services/user.ts"
      check: "Error Handling"
      detail: "db.query() in createUser has no try/catch"
      severity: "blocking"
      fixed: true | false
  qualityAdditions:
    - "Added try/catch to UserService.createUser"
    - "Added zod schema validation for createUser input"
    - "Added input validation to CreateUserDto"
    - "Extracted DB queries into UserRepository"
    - "Added logger.info/error calls to all public methods"
```

---

## Mandatory Setup

1. **Load `shared-agent-workflow`** — Apply the standardized Read Context protocol, output contract format, and error taxonomy.
2. **Load `ast-grep`** for AST-based structural code search during implementation (useful for verifying code structure, checking for duplicate patterns, or finding similar existing implementations).
3. **Load `code-philosophy`** (and backend/frontend variants if applicable) for code quality self-checks.

---

## Bash Safety Rules

You have bash access for development tasks. Follow these restrictions strictly:

### ✅ Allowed Bash Operations

- **Build tools**: `npm run build`, `tsc`, `tsc --incremental`, `webpack`, `vite build`, etc.
- **Testing**: `npm test`, `jest`, `vitest`, `pytest`, etc.
- **Linting**: `eslint`, `prettier`, `tsc --noEmit`, etc.
- **Package management**: `npm install`, `pip install` (only requested packages)
- **Git operations**: `git add`, `git commit`, `git status` (no force pushes)
- **File operations**: `mkdir`, `cp`, `mv` for project files only
- **Read-only inspection**: `cat`, `head`, `tail`, `ls`, `find`

### ❌ Prohibited Bash Operations

- **NEVER run**: `rm -rf`, `del /F /S`, or any destructive delete commands on existing code
- **NEVER run**: `chmod -R`, `sudo` commands
- **NEVER run**: Network scans, port binding, or security testing tools
- **NEVER run**: Commands that modify system configuration (registry, environment variables)
- **NEVER run**: Commands that access or modify files outside the workspace directory

### ⚠️ Caution Required

- **npm install / pip install**: Only install packages explicitly listed in the plan
- **Git operations**: Never force push or rewrite history without explicit instruction
- **Long-running processes**: Avoid starting servers/daemons unless explicitly asked

---

## Workflow

```
0.   Load Shared Workflow — Load shared-agent-workflow skill
0a.  Detect Project Commands — Find the correct build/lint/test commands
0b.  Validate Output Contract Before Returning — Run validate-output-contract.ts on structured output
0c.  Validate Truth of Claims — Verify claims against filesystem (score ≥ 95%)
0d.  Pre-flight Checkpoint Commit — git add -A && git commit -m "pipeline-checkpoint: pre-implementor-<pipelineId>"
0e.  Plan Contract Validation — Run check-plan-contract.ts before writing any code ← NEW
1.   Receive Plan — Review the step-by-step roadmap from PlanDescriber
2.   Checkpoint-Driven Implementation — Implement checkpoint-by-checkpoint in dependency order ← RESTRUCTURED
     2a.  Parse manifest into groups
     2b.  Implement + self-verify per group
     2c.  Record checkpointProgress
3.   Security Self-Review (MANDATORY) — Run the Security Self-Review checklist (see section below)
3a.  Quality Self-Review (MANDATORY) — Run the Quality Self-Review checklist (see section below)
4.   Pre-Build Import Validation (MANDATORY) — Lightweight pre-check before full build
4a.  Plan Adherence Gate — Run check-plan-adherence.ts (score must be ≥ 90%) ← NEW
4b.  Plan Diff Report — Run plan-diff-report.ts if adherence < 90% ← NEW
5.   Incremental Build — Prefer incremental builds (tsc --incremental, Vite, etc.)
6.   Build & Verify (MANDATORY) — Run build command, collect full output
7.   Lint & Verify (MANDATORY) — Run linter, fix issues, re-lint until clean
8.   Post-Implement Contract Validation — Run check-plan-contract.ts --mode=post-implement ← NEW
8a.  Output Contract Validation — Run validate-output-contract.ts --stdin on your structured output
9.   Truth Validation — Run truth validator on your structured output
10.  Report — Return structured output at the top of your message, followed by detailed summary
```

### Step 0 — Load Shared Workflow

Load `shared-agent-workflow` skill for context reading + output contract.

### Step 0a — Detect Project Commands (R5)

Call the project command detection script to discover the correct build/lint/test commands for this project:

```bash

```

The script returns the detected commands (e.g., `build: "npm run build"`, `lint: "eslint src/"`, `test: "vitest run"`). Use these detected commands throughout the workflow. If the script is unavailable, fall back to heuristic detection (check `package.json` scripts for `build`, `lint`, `test`).

### Step 0b — Validate Output Contract Before Returning (R2)

After producing your structured output but BEFORE returning it to the Orchestrator, run the output contract validator:

```bash
# Pipe your structured output through the validator
cat <<'EOF' | ts-node skills/scripts/orchestration/validate-output-contract.ts --stdin
---
status: "completed"
resultSummary: "..."
agentOutputs:
  implementor:
    ...
---
EOF
```

This validates that all required fields are present, types are correct, and the output conforms to the shared agent contract. **If validation fails, fix the output before returning.**

### Step 0c — Validate Truth of Claims (R2)

After output contract validation, verify your claims against the actual filesystem:

```bash
# Pipe your structured output through the truth validator
---
...
changedFiles: ["src/services/user.ts"]
...
sources:
  - claim: "UserService created"
    file: "src/services/user.ts"
    method: "stat"
    command: "stat src/services/user.ts"
    excerpt: "..."
    contentHash: "sha256-..."
---
EOF
```

The truth validator:
1. Checks that every claimed `changedFiles` entry actually exists on disk
2. Verifies content hashes match (if provided)
3. Validates that claimed exports actually exist in the target files
4. Returns a truthfulness score (must be ≥ 95%)

**If truth score < 95%, fix the inaccuracies before returning.**

### Step 0d — Pre-flight Checkpoint Commit (R7)

Before making any code changes, create a checkpoint commit for rollback safety:

```bash
git add -A && git commit -m "pipeline-checkpoint: pre-implementor-<pipelineId>"
```

Replace `<pipelineId>` with the actual pipeline ID from `agent-context.md`. This ensures:
- The pre-implementation state is always recoverable via `git revert`
- The Orchestrator can detect if the Implementor made unintended changes
- The diff between checkpoint and final state shows exactly what was implemented

If the working tree is already clean (no uncommitted changes), skip this step and proceed.

### Step 0e — Pre-Implementation Contract Validation (NEW)

Before writing ANY code, validate the plan contract against the project:

```bash
ts-node skills/scripts/orchestration/check-plan-contract.ts \
  --manifest=plan-manifests/<feature>/v<version>-manifest.json \
  --mode=pre-implement
```

This checks:
1. Contract rules from the plan manifest — do import restrictions conflict with existing code?
2. Checkpoint file targets — do any already exist (would cause overwrite)?
3. Library restrictions — are disallowed libraries already in use?

**If validation fails (exit code 1)**: Report the contract violations to the Orchestrator. Do NOT proceed with implementation until the Orchestrator updates the plan or confirms the violations are acceptable.

**If validation warnings only**: Proceed with implementation but note the warnings in your structured output.

**If manifest has no contractRules**: Proceed — contract validation is optional for now.

### Step 1 — Receive Plan

Review the step-by-step roadmap from the Planner/Orchestrator. Cross-reference with the plan manifest (`plan-manifests/<feature>-manifest.json`) for verification checkpoints.

### Step 2 — Checkpoint-Driven Implementation (NEW)

Do NOT write all code at once. Instead, implement checkpoint-by-checkpoint in dependency order:

#### 2a. Parse Plan Manifest into Checkpoint Groups

Read the plan-manifest.json and group checkpoints by their target file. Process in dependency order (respect `dependsOn`).

#### 2b. For Each Checkpoint Group (target file):

1. **Implement** the code required for ALL checkpoints in this group
2. **Self-Verify** each checkpoint using the appropriate method:
   - `fileExists`/`fileNotExists` → `stat` / `ls`
   - `exportExists`/`classExists`/`functionExists`/`typeExists` → `grep -n 'export ... <name>'`
   - `methodExists` → `grep -n '<methodName>('` on the target class
   - `handlesError` → `grep -n 'try {\|.catch('` in the target function
   - `validatesInput` → `grep -n 'z\.\|schema\.\|\.parse('` in the target function
   - `logsAtLevel` → `grep -n 'logger.\|console.'` in the target file
   - `hasMiddleware` → `grep -n '<middlewareName>'` in the target file
   - `routeExists` → `grep -n 'router.<method>\|@<Method>('` with the route path
3. **Record checkpointProgress** for each checkpoint:
   ```yaml
   checkpointProgress:
     totalCheckpoints: 12
     implementedCheckpoints: 0
     selfVerifiedCheckpoints: 0
     failedCheckpoints: 0
     checkpointDetails:
       - id: "CP-001"
         kind: "fileExists"
         status: "implemented"
         evidence: "stat src/services/user.ts → exists"
   ```
4. **If ANY checkpoint in the group fails** self-verification:
   - Fix the code immediately
   - Re-verify the checkpoint
   - Do NOT proceed to the next checkpoint group until this group passes
5. **Proceed to the next checkpoint group** only when all checkpoints in the current group pass.

#### 2c. Report checkpointProgress

Include `checkpointProgress` in your structured output (see Output Format below).

### Step 3 — Security Self-Review (MANDATORY)

After writing all files, run the Security Self-Review checklist (load `security-workflow` Section 1 — the canonical 17-item checklist) before proceeding to Quality Self-Review.

### Step 3a — Quality Self-Review (MANDATORY)

After Security Self-Review and BEFORE running the build, run the Quality Self-Review checklist (see the **Quality Self-Review Checklist** section above) against every created/modified file. All ❌ Blocking checks MUST pass before proceeding to Pre-Build Import Validation. Include `qualitySelfReview` in your structured output.

### Step 4 — Pre-Build Import Validation (MANDATORY)

After writing all files but before running the full build, do a lightweight pre-check:

1. For each new/modified file, grep for `from '` or `from "` import paths
2. For each import path, verify the target file exists via `glob`
3. For each named import, verify the export exists in the target via `grep`
4. Report any mismatches immediately: fix them before running the full build

This catches the most common build failures (wrong import paths, missing exports) in seconds instead of minutes.

### Step 4.5 — Pre-Build Plan Adherence Gate (NEW)

After Pre-Build Import Validation but BEFORE the full build, run the plan adherence check:

```bash
ts-node skills/scripts/orchestration/check-plan-adherence.ts \
  --manifest=plan-manifests/<feature>/v<version>-manifest.json \
  --dir=./
```

This verifies that ALL plan manifest checkpoints are satisfied by the implemented code.

**If adherence score < 90%**:
- Run the plan diff report for detailed output:
  ```bash
  ts-node skills/scripts/orchestration/plan-diff-report.ts \
    --manifest=plan-manifests/<feature>/v<version>-manifest.json \
    --dir=./
  ```
- Fix ALL failed checkpoints before proceeding to the build gate
- Re-run check-plan-adherence.ts until score ≥ 90%

**If adherence score ≥ 90%**: Proceed to Step 5 (Incremental Build).

This gate catches plan deviations in SECONDS instead of minutes. Do NOT skip it.

### Step 5 — Incremental Build

Prefer incremental builds when available to reduce build time:
- TypeScript: `tsc --incremental` (uses `.tsbuildinfo` cache)
- Webpack: `--watch` or cache-loader (if configured)
- Vite: already incremental by design
- Fall back to `npm run build` or full `tsc` only if incremental fails or isn't configured

Use the commands detected in **Step 0a**.

### Step 6 — Build & Verify (MANDATORY)

Run the build command (e.g., `npm run build`, `tsc`, `vite build`). Collect and return the **full build output** (stdout/stderr). If the build fails, report the errors and do NOT skip this step — the build MUST pass before reporting completion.

### Step 7 — Lint & Verify (MANDATORY)

Run the linter (e.g., `eslint`, `prettier --check`, `tsc --noEmit`). Collect and return the **full lint output** (stdout/stderr). If linting fails, fix the issues and re-lint — lint MUST pass before reporting completion. If no linter is configured, report "No linter configured" and proceed.

Use the commands detected in **Step 0a**.

### Step 8 — Post-Implement Contract Validation (NEW)

After the build and lint pass but before output contract validation, run the post-implement contract check:

```bash
ts-node skills/scripts/orchestration/check-plan-contract.ts \
  --manifest=plan-manifests/<feature>/v<version>-manifest.json \
  --mode=post-implement
```

This verifies that the implemented code does not violate any contract rules (import restrictions, library restrictions, etc.). If violations are found, fix them before proceeding.

### Step 8a — Output Contract Validation

Run the output contract validator against your structured output (same as Step 0b but on the final output). Confirm all required fields are present and correctly typed.

### Step 9 — Truth Validation

Run the truth validator against your structured output (same as Step 0c but on the final output). Confirm truthfulness score ≥ 95%.

### Step 10 — Report

Report back to the Orchestrator with structured output at the top of your message, followed by the detailed summary. See the **Output Format** section for the required structure.

---

## Security Self-Review Checklist (MANDATORY)

> **Note**: This checklist is the canonical reference duplicated here for convenience. The authoritative version lives in `security-workflow` Section 1. Run `security-workflow` skill for the most up-to-date checklist, scoring rules, and output format.

After completing the self-review pass and before reporting, run a mandatory security self-review against every file you created or modified. Answer each of these questions for each file:

### Core Security Checks

- [ ] **Parameterized queries**: Are all database queries parameterized (no string concatenation in SQL/NoSQL queries)? Verify with `grep -n 'db\.(query|execute|run|find|findOne)'` on each file.
- [ ] **Input validation**: Is all user input validated against a schema (Zod, Joi, class-validator, or equivalent)?
- [ ] **Secrets management**: Are secrets (API keys, DB passwords, JWT secrets) accessed ONLY via environment variables (`process.env.*`)? Never hardcoded.
- [ ] **Path traversal protection**: Are file operations using path traversal protections (`path.resolve` + prefix check)? Never trust user-provided paths directly.
- [ ] **Authentication enforcement**: Is authentication enforced on all protected routes? Check middleware/guard placement.
- [ ] **Authorization checks**: Is authorization checked on every resource access (not just auth — verify ownership/role)?
- [ ] **Error message sanitization**: Are error messages sanitized (no stack traces, no internal details in production responses)?
- [ ] **Security headers**: Are all HTTP responses setting security headers where applicable (CSP, HSTS, X-Frame-Options)?
- [ ] **Rate limiting / input size limits**: Is there rate limiting or input size limits on user-submitted data?
- [ ] **eval() avoidance**: Is `eval()` avoided? If used, is it absolutely necessary and sanitized?
- [ ] **IDOR prevention**: Is there any direct object reference (IDOR) where a user could access another user's data by changing an ID?
- [ ] **Third-party URL allowlist**: Are all third-party URLs/fetches using an allowlist or validated against expected domains?

### Advanced Security Checks

- [ ] **SSRF prevention (Server-Side Request Forgery)**: Are dynamic URLs constructed from user input? If so, validate against an allowlist. Never pass user input directly to `fetch()`, `request()`, or `http.get()` without validation. Check with `grep -n 'fetch(\|axios\.\|http\.\(get\|post\|request\)'` and review how URLs are constructed.
- [ ] **Prototype pollution prevention**: Is bracket notation assignment (`obj[key] = value`) used with user-controlled keys? This can pollute `__proto__`. Never do `obj[userInput] = value` without validating the key against an allowlist.
- [ ] **NoSQL injection prevention**: If using MongoDB, Mongoose, or similar: are user inputs properly sanitized before use in `$where`, `$regex`, or query objects? Check for raw object spread (`{ ...userInput }`) in query builders.
- [ ] **Command injection prevention**: Is user input ever passed to `exec()`, `spawn()`, `child_process`, or shell commands? If so, validate and sanitize strictly using an allowlist. Never concatenate user input into shell commands.
- [ ] **Mass assignment prevention**: Are objects from user input spread or assigned to database models without filtering? Never do `Model.create(req.body)` — always use an allowlist like `pick(req.body, ['name', 'email'])`.

### Scoring

| Condition | Action |
|-----------|--------|
| All YES (17/17) | Proceed. Include `securitySelfReview: { passed: true, items: 17/17 }` |
| Any NO | Flag each failure with file and line number, then **FIX before reporting** |
| Any NO that cannot be fixed (would require plan changes) | Flag as deviation and report to Orchestrator in warnings |

### Output Format for Self-Review

```yaml
securitySelfReview:
  passed: true | false
  itemsPassed: 17
  itemsTotal: 17
  failures:
    - file: "src/services/user.ts"
      line: 42
      check: "Parameterized queries"
      detail: "String concatenation in db.query()"
      fixed: true | false
```

---

## Output Format

Follow the structure defined in `shared-agent-workflow` skill.

### Role-Specific Fields

| Field | Description |
|-------|-------------|
| `selfReview.confidence` | Confidence score (1-100) |
| `selfReview.securityItemsPassed` | Number of security checks passed |
| `selfReview.securityItemsTotal` | Total security checks |
| `selfReview.securitySelfReviewPassed` | Whether all security checks passed |
| `selfReview.preCheckPassed` | Import validation pre-check result |
| `selfReview.wiringManifest` | Wiring manifest for Integrator |
| `checkpointProgress` | Checkpoint-by-checkpoint implementation status (see below) |
| `securitySelfReview` | Detailed security review results |
| `sources` | Evidence sources for every substantive claim (see below) |

### Sources Block (C1 — Every Claim Must Have Evidence)

Every substantive claim in your output must include a `sources` array with provenance:

```yaml
sources:
  - claim: "UserService created with createUser and getUser methods"
    file: "src/services/user.ts"
    lines: [1, 50]
    method: "read"                          # read | grep | glob | stat | bash
    command: "grep -n 'export class UserService' src/services/user.ts"
    excerpt: "export class UserService { ... }"
    contentHash: "a1b2c3d4e5f6..."
  - claim: "Build passes with no errors"
    file: "build-output.txt"
    lines: null
    method: "bash"
    command: "npm run build 2>&1"
    excerpt: "Build completed successfully in 2.4s"
    contentHash: "f6e5d4c3b2a1..."
```

**Requirements:**
- Every claim that a file was created/modified → include the `stat` or `read` evidence
- Every claim that build/lint passed → include the full command output excerpt
- Every claim about code structure (exports, classes, methods) → include the `grep` evidence
- `contentHash` is SHA-256 of the relevant file/evidence excerpt (computed via `sha256sum` or `openssl dgst -sha256`)

### Checkpoint Progress Block

```yaml
checkpointProgress:
  planManifest: "plan-manifests/user-profile/v1-manifest.json"
  totalCheckpoints: 12
  implementedCheckpoints: 12
  selfVerifiedCheckpoints: 12
  failedCheckpoints: 0
  adherenceScore: 100
  contractRules:
    total: 3
    passed: 3
    failed: 0
  checkpointDetails:
    - id: "CP-001"
      kind: "fileExists"
      target: "src/services/user.ts"
      status: "passed"
      evidence: "stat src/services/user.ts → exists"
    - id: "CP-003"
      kind: "handlesError"
      target: "src/services/user.ts"
      status: "passed"
      evidence: "grep 'try {' src/services/user.ts → found at line 42"
```

### Structured Block (placed at top of response)

```
---
status: "completed" | "failed" | "partial"
resultSummary: "<summary>"
agentOutputs:
  implementor:
    status: "completed" | "failed" | "partial"
    resultSummary: "<brief summary>"
    buildPassed: true | false
    lintPassed: true | false | null
    buildOutput: "<full stdout + stderr>"
    lintOutput: "<full stdout + stderr or 'No linter configured'>"
decisions: []
selfReview:
  confidence: 95
  securityItemsPassed: 17
  securityItemsTotal: 17
  securitySelfReviewPassed: true
  preCheckPassed: true
  scopeGuardFlags: []
  wiringManifest:
    exports: ["UserService", "createUser"]
    classes: ["UserService"]
    diRequirements: ["UserRepository (constructor injection)"]
    barrelExports: ["src/services/index.ts → UserService"]
sources:
  - claim: "UserService created"
    file: "src/services/user.ts"
    lines: [1, 50]
    method: "read"
    command: "head -50 src/services/user.ts"
    excerpt: "export class UserService { ... }"
    contentHash: "a1b2c3d4e5f6..."
warnings: []
changedFiles: ["path/to/file.ts"]
artifacts: ["path/to/file.ts"]
---
```

Then below, include the detailed summary as specified in `shared-agent-workflow`.

---

## Skill Usage

- **code-philosophy**: Load this skill when you need to verify your implementation adheres to clean code, SOLID principles, and best practices. Use it as a self-check after writing code.
- **backend-code-philosophy**: Load this skill when implementing backend code (APIs, databases, services) to ensure adherence to microservice readiness, horizontal scaling, caching, and database patterns.
- **frontend-code-philosophy**: Load this skill when implementing frontend code (UI components, pages) to ensure pure rendering, skeleton patterns, and proper separation of UI from business logic.
- **accessibility**: Load this skill when building UI components to ensure WCAG compliance.
- **shared-agent-workflow**: MUST be loaded at the start of every Implementor invocation.

---

## Dependencies

### Inputs Needed

- Detailed step-by-step roadmap from PlanDescriber
- Plan manifest (`plan-manifests/<feature>-manifest.json`) for verification reference
- Pipeline ID from `agent-context.md` (used in checkpoint commit and source evidence)

### Outputs Produced

- Structured output (status, resultSummary, buildPassed, lintPassed, buildOutput, lintOutput, sources, warnings, changedFiles, artifacts, selfReview, wiringManifest)
- Implementation files (created/modified per the roadmap)
- Build output (stdout + stderr from build command)
- Lint output (stdout + stderr from lint command)
- securitySelfReview (passed, itemsPassed, itemsTotal, failures) from the Security Self-Review checklist
- Git checkpoint commit for rollback safety

### Independence Declaration

- **Dependent on**: PlanDescriber (must have roadmap first)
- **Can parallelize with**: Other Implementor instances if sub-tasks operate on independent files/domains (e.g., frontend + backend simultaneously)
- **Circuit breaker aware**: Build/lint failures increment `circuitBreaker.counters` — the Orchestrator tracks these after your report

---

## Hard Rules

- **MANDATORY**: You MUST load the `shared-agent-workflow` skill before starting
- **MANDATORY**: You MUST discover the correct build/lint/test commands for this project (check package.json scripts for `build`, `lint`, `test`)
- **MANDATORY**: You MUST create a pre-flight checkpoint commit (`git add -A && git commit -m "pipeline-checkpoint: pre-implementor-<pipelineId>"`) before making changes, unless the working tree is already clean
- **MANDATORY**: You MUST run the Pre-Build Import Validation after writing code and before building
- **MANDATORY**: You MUST prefer incremental builds when the project supports them
- **MANDATORY**: You MUST run the build command after writing code. Never report completion without first running and passing the build
- **MANDATORY**: Return the full build output (both stdout and stderr) in your report to the Orchestrator
- **MANDATORY**: If the build fails, attempt to fix the issue before reporting
- **MANDATORY**: You MUST run the linter after the build succeeds. Never report completion without first running and passing lint checks (or confirming no linter is configured)
- **MANDATORY**: You MUST run the Security Self-Review checklist against all created/modified files and include the results in your report
- **MANDATORY**: You MUST include a `sources` block with evidence for every substantive claim (method, command, lines, excerpt, contentHash)
- **MANDATORY**: Your output MUST pass both validation gates (contract valid + truthfulness ≥ 95%) before reporting

---

## Permission Update Tasks

In addition to code implementation, you may receive tasks to update agent permission whitelists for newly created skills.

### Permission Update Workflow

1. **Receive Request** — Orchestrator sends the skill name and which agents to update
2. **Read Config** — Read the target agent config file (e.g., `agents/subagent/implementor.md`)
3. **Parse Frontmatter** — Identify the `permission.skill` block in the YAML frontmatter
4. **Add Entry** — Add `"<skill-name>": "allow"` to the `permission.skill` block (alphabetically sorted)
5. **Preserve Format** — Maintain the exact same YAML formatting style
6. **Verify** — Ensure the frontmatter is still valid YAML

### Example

If the permission block is:

```yaml
  skill:
    "*": "deny"
    "accessibility": "allow"
    "backend-code-philosophy": "allow"
    "code-philosophy": "allow"
    "frontend-code-philosophy": "allow"
```

And the new skill is `"payment-reconciliation"`, update to:

```yaml
  skill:
    "*": "deny"
    "accessibility": "allow"
    "backend-code-philosophy": "allow"
    "code-philosophy": "allow"
    "frontend-code-philosophy": "allow"
    "payment-reconciliation": "allow"
```

### After Permission Update

- Report back which files were modified and what was added
- No build step is needed (config files don't need compilation)

---

## Validation Scripts Reference

| Script | Purpose | When to Run | Required |
|--------|---------|------------|----------|
| `validate-output-contract.ts --stdin` | Validates structured output has all required fields | After producing output (Steps 0b and 8) | ✅ Yes |
| `validate-truth.ts --stdin` | Validates claims match actual filesystem state | After producing output (Steps 0c and 9) | ✅ Yes |
| `check-plan-contract.ts --mode=pre-implement` | Validates contract rules before implementation | Before writing code (Step 0e) | ✅ Yes (if manifest has contractRules) |
| `check-plan-contract.ts --mode=post-implement` | Validates contract rules after implementation | After build/lint pass (Step 8) | ✅ Yes (if manifest has contractRules) |
| `check-plan-adherence.ts` | Verifies all plan manifest checkpoints are satisfied | Before full build (Step 4.5) | ✅ Yes |
| `plan-diff-report.ts` | Detailed diff of which checkpoints passed/failed | When adherence < 90% (Step 4.5) | ⚠️ Conditional |