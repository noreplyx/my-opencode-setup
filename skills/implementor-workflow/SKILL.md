---
name: implementor-workflow
description: Workflow protocol for the Implementor subagent. Provides step-by-step implementation instructions, bash safety rules, security self-review checklist, pre-build import validation, and structured output contract. Load this skill when dispatching the Implementor agent.
---

# Skill: implementor-workflow

## Core Responsibilities

- **No thinking. Implement follow the plan.** Do not deviate from the provided roadmap.
- Write code exactly as specified — no extra features, no creative additions.
- Keep output minimal and focused. Only produce the code/files requested.
- Every substantive claim in your output MUST include a `sources` block with method, command, lines, excerpt, and contentHash (see Output Format).

---

## Mandatory Setup

1. **Load `shared-agent-workflow`** — Apply the standardized Read Context protocol, output contract format, and error taxonomy.
2. **Load `code-philosophy`** (and backend/frontend variants if applicable) for code quality self-checks.

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
0.  Load Shared Workflow ──► Load shared-agent-workflow skill
0a. Detect Project Commands ──► Call detect-project-commands.ts for build/lint/test commands
0b. Validate Output Contract ──► Run validate-output-contract.ts on structured output before returning
0c. Validate Truth ──► Run validate-truth.ts --stdin --agent=implementor to verify claims
0d. Pre-flight Checkpoint Commit ──► git add -A && git commit -m "pipeline-checkpoint: pre-implementor-<pipelineId>"
1.  Receive Plan ──► Review the step-by-step roadmap from PlanDescriber
2.  Implement ──► Write code files in the specified order, following the plan exactly
3.  Security Self-Review (MANDATORY) ──► Run the Security Self-Review checklist (see section below)
4.  Pre-Build Import Validation (MANDATORY) ──► Lightweight pre-check before full build
5.  Incremental Build ──► Prefer incremental builds (tsc --incremental, Vite, etc.)
6.  Build & Verify (MANDATORY) ──► Run build command, collect full output
7.  Lint & Verify (MANDATORY) ──► Run linter, fix issues, re-lint until clean
8.  Output Contract Validation ──► Run validate-output-contract.ts --stdin on your structured output
9.  Truth Validation ──► Run validate-truth.ts --stdin --agent=implementor on your structured output
10. Report ──► Return structured output at the top of your message, followed by detailed summary
```

### Step 0 — Load Shared Workflow

Load `shared-agent-workflow` skill for context reading + output contract.

### Step 0a — Detect Project Commands (R5)

Call the project command detection script to discover the correct build/lint/test commands for this project:

```bash
ts-node skills/scripts/orchestration/detect-project-commands.ts --brief
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
cat <<'EOF' | ts-node skills/scripts/orchestration/validate-truth.ts --stdin --agent=implementor
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

### Step 1 — Receive Plan

Review the step-by-step roadmap from the Planner/Orchestrator. Cross-reference with the plan manifest (`plan-manifests/<feature>-manifest.json`) for verification checkpoints.

### Step 2 — Implement

Write code files in the specified order, following the plan exactly. Do not deviate from the roadmap. Do not add extra features or creative additions.

### Step 3 — Security Self-Review (MANDATORY)

After writing all files, run the Security Self-Review checklist (load `security-workflow` Section 1 — the canonical 17-item checklist) before proceeding to Pre-Build Import Validation.

### Step 4 — Pre-Build Import Validation (MANDATORY)

After writing all files but before running the full build, do a lightweight pre-check:

1. For each new/modified file, grep for `from '` or `from "` import paths
2. For each import path, verify the target file exists via `glob`
3. For each named import, verify the export exists in the target via `grep`
4. Report any mismatches immediately: fix them before running the full build

This catches the most common build failures (wrong import paths, missing exports) in seconds instead of minutes.

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

### Step 8 — Output Contract Validation

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

```
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
    barrelExports: ["src/services/index.ts ← UserService"]
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
- **MANDATORY**: You MUST call `detect-project-commands.ts --brief` (or fallback heuristic) to get correct build/lint/test commands
- **MANDATORY**: You MUST create a pre-flight checkpoint commit (`git add -A && git commit -m "pipeline-checkpoint: pre-implementor-<pipelineId>"`) before making changes, unless the working tree is already clean
- **MANDATORY**: You MUST run the Pre-Build Import Validation after writing code and before building
- **MANDATORY**: You MUST prefer incremental builds when the project supports them
- **MANDATORY**: You MUST run the build command after writing code. Never report completion without first running and passing the build
- **MANDATORY**: Return the full build output (both stdout and stderr) in your report to the Orchestrator
- **MANDATORY**: If the build fails, attempt to fix the issue before reporting
- **MANDATORY**: You MUST run the linter after the build succeeds. Never report completion without first running and passing lint checks (or confirming no linter is configured)
- **MANDATORY**: You MUST run the Security Self-Review checklist against all created/modified files and include the results in your report
- **MANDATORY**: You MUST include a `sources` block with evidence for every substantive claim (method, command, lines, excerpt, contentHash)
- **MANDATORY**: You MUST run `validate-output-contract.ts --stdin` and `validate-truth.ts --stdin --agent=implementor` on your structured output before returning it
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
| `validate-truth.ts --stdin --agent=implementor` | Verifies claims match filesystem state | After producing output (Steps 0c and 9) | ✅ Yes |
| `detect-project-commands.ts --brief` | Detects correct build/lint/test commands for project | At start (Step 0a) | ✅ Yes |
