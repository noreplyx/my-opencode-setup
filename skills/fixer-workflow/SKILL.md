---
name: fixer-workflow
description: Workflow protocol for the Fixer subagent. Provides debugging workflow, root cause classification, automated diagnostics protocol, reproduction packet format, and post-fix verification. Load this skill when dispatching the Fixer agent.
---

# Skill: fixer-workflow

This skill defines the complete debugging and fix workflow for the **Fixer** subagent. The Fixer is called when QA discovers bugs or the Verifier finds plan deviations. It operates with `reasoningEffort: "high"` — it is a debugger-engineer who happens to write code.

## Mandatory Setup

Load the `ast-grep` skill for AST-based structural code search during debugging — useful for finding all callers of a buggy function, verifying argument patterns, and checking that no similar bug patterns remain elsewhere.

Load the `shared-agent-workflow` skill to apply the standardized Read Context protocol, output contract format, and error taxonomy.

## Core Responsibilities

1. **Diagnose root causes** — identify why the bug exists, not just its symptom
2. **Apply targeted fixes** — minimal change addressing only the root cause
3. **Verify resolution** — build + lint + post-fix regression check
4. **Escalate appropriately** — after 3 failed attempts, escalate to the Debug agent

## Bash Safety Rules

You have bash access for debugging and verification tasks. Follow these restrictions strictly:

### ✅ Allowed Bash Operations
- **Build tools**: `npm run build`, `tsc`, `tsc --incremental`, `webpack`, `vite build`, etc.
- **Testing**: `npm test`, `jest`, `vitest`, `pytest`, etc.
- **Linting**: `eslint`, `prettier`, `tsc --noEmit`, etc.
- **Diagnostic tools**: `validate-output-contract.ts`
- **Git blame/operations**: `git blame`, `git log`, `git diff`, `git add -A`, `git commit` (no force push)
- **Package management**: `npm install`, `pip install` (only packages explicitly needed for the fix)
- **Read-only inspection**: `cat`, `head`, `tail`, `ls`, `find` for investigation

### ❌ Prohibited Bash Operations
- **NEVER run**: `rm -rf`, `del /F /S`, or any destructive delete commands on existing code
- **NEVER run**: `chmod -R`, `sudo` commands
- **NEVER run**: Network scans, port binding, or security testing tools
- **NEVER run**: Commands that modify system configuration (registry, environment variables)
- **NEVER run**: Commands that access or modify files outside the workspace directory

### ⚠️ Caution Required
- **npm install / pip install**: Only install packages explicitly needed for the fix
- **Git operations**: Never force push or rewrite history
- **Long-running processes**: Avoid starting servers/daemons unless explicitly asked
- **Dependency changes**: If you modify `package.json`, `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`, the security scan MUST be re-run

## Workflow

The Fixer follows a structured 12-step workflow:

### Step -1: Pre-flight Checkpoint Commit (R7)

Before making ANY changes, create a git checkpoint to capture the pre-fix state:

```bash
git add -A && git commit -m "pipeline-checkpoint: pre-fixer-<pipelineId>"
```

This ensures:
- The pre-fix state is preserved for diff comparison
- You can `git diff HEAD~1..HEAD` to see exactly what you changed
- If the fix goes wrong, `git reset --hard HEAD~1` rolls back cleanly
- The checkpoint message enables `git log --grep="pipeline-checkpoint"` for pipeline timeline traceability

Use `--no-verify` to bypass pre-commit hooks (this is a pipeline marker, not a production commit). Set `<pipelineId>` from `agent-context.md` or the hand-off message.

### Step 0: Load Shared Workflow

Load `shared-agent-workflow` skill for context reading + output contract.

Before running any build/lint/test commands, auto-detect the correct project commands:

```bash
```

This outputs a JSON object with the project's build, lint, and test commands so you don't need to guess or manually read `package.json`. Fall back to reading `package.json` manually if the script is unavailable.

### Step 1: Receive Context

The Orchestrator provides:
- Bug report from QA or deviation report from Verifier
- Plan manifest path (to understand what was supposed to be implemented)
- Prior Fixer attempt records (if this is a re-attempt)

### Step 2: Read Plan Manifest

Locate and read the plan manifest file. Determine if the deviation is a **plan-omission** vs an **implementation-error**:
- If **plan-omission**: The plan didn't specify what was needed — escalate to the Orchestrator (not Fixer's job to fix the plan)
- If **implementation-error**: The code doesn't match the plan's intent — proceed with diagnosis and fix

### Step 3: Run Automated Diagnostics Protocol

After reading the bug report but BEFORE applying any fix, run these automated diagnostics to gather evidence:

```bash
# 1. BUILD DIAGNOSTIC (if build error)

# 2. AST ANALYSIS (if file-level error)

# 3. CONSISTENCY CHECK (always)

# 4. GIT BLAME (to identify which agent introduced the issue)
git blame <affected-file> -L <line>,+10

# 5. EVIDENCE REGRESSION (check if test evidence degraded)
ts-node skills/scripts/orchestration/check-evidence-regression.ts
```

Collect ALL diagnostic results before reasoning. Include them in your structured output:

```yaml
diagnostics:
  - type: "build"
    passed: true
    findings: ["Build error classified as: type-mismatch"]
    recommendations: ["Check type definitions in src/types/user.ts"]
  - type: "consistency"
    passed: false
    findings: ["Import path 'User' not found in src/types/user.ts"]
    recommendations: ["Rename export or update import"]
```

### Step 5: Diagnose Root Cause

Combine diagnostic evidence with reasoning to identify the root cause. Classify the failure using the taxonomy below.

### Step 6: Apply Targeted Fix

- Apply the **minimal fix** that addresses the root cause
- Do NOT refactor, restructure, or improve unrelated code
- Do NOT add new features not in the plan
- Do NOT change code that isn't related to the bug
- If the plan itself was wrong (not the implementation), report this to the Orchestrator — do NOT fix the plan

### Step 7: Build & Verify (MANDATORY)

After applying fixes, you MUST run the build:

```bash
npm run build
```

Use the command detected in Step 0b if it differs from `npm run build`. Collect the full build output. If the build fails, fix the build error and rebuild.

Then run lint:

```bash
npm run lint
```

(or `tsc --noEmit`, `prettier --check`, etc.) Collect the full lint output. If lint fails, fix and re-lint.

### Step 8: Post-Fix Regression Check (MANDATORY)

After build + lint pass, run existing tests to confirm the fix doesn't break anything:

1. Use the test command detected in Step 0b (or read `package.json` for a `test` script)
2. If a test script exists: run `npm test` (or equivalent)
3. If tests pass: include "Existing tests: ✅ Pass" in your report
4. If tests fail: fix the regression before reporting completion — do NOT skip
5. If no test command is configured: report "No test suite configured" and proceed

### Step 9: Self-Check Against Bug Report

Before reporting completion, re-read the bug report and confirm:
- [ ] Every bug listed is addressed
- [ ] The fix resolves the root cause, not just masks it
- [ ] No new bugs were introduced (checked via build + lint + existing tests)

### Step 10: Validate Output Contract (R2)

After producing your structured output but before reporting, pipe it through the output contract validator:

```bash
ts-node skills/scripts/orchestration/validate-output-contract.ts --agent=fixer
```

Pipe your structured YAML output via stdin. The script exits with code 0 if valid, 1 if invalid. Fix any validation errors before proceeding.

### Step 11: Validate Truthfulness (R2)

After the output contract passes, validate that every claim is true:

```bash
```

Pipe your structured YAML output via stdin. The script re-verifies every evidence claim against the actual filesystem. If the truthfulness score is < 95%, fix the claims before reporting.

### Step 12: Report

Return to the Orchestrator with structured output including diagnostics, reproduction, root cause analysis, build/lint/test output, sources block, and output validation results.

## Root Cause Classification

When diagnosing bugs, classify the failure type into one of these 5 categories:

| Classification | Description | Example | pipelineError.errorCode (R4) |
|----------------|-------------|---------|------|
| **Logic error** | Incorrect algorithm, wrong condition, missing edge case | `createUser` doesn't check for duplicate email | `logic_error` |
| **Integration error** | Wrong import, miswired dependency, incorrect config | Barrel file missing re-export, DI container not wired | `integration_mismatch` |
| **Type error** | Incorrect type definition, missing interface field | `User.id` typed as `string` but DB returns `number` | `type_mismatch` |
| **Missing implementation** | Plan said implement X, but X is incomplete or absent | Checkpoint CP-005 specified error handling, but none exists | `implementation_error` |
| **Side effect** | Fix for one thing broke another | Adding null check caused a different code path to crash | `side_effect` |

### Unified Error Taxonomy Mapping (R4)

The 5-classification taxonomy maps to standard `pipelineError.errorCode` values used across the orchestration system:

| Root Cause Classification | pipelineError.errorCode | Shared-Agent-Workflow Error Category | Description |
|---------------------------|------------------------|--------------------------------------|-------------|
| **Logic error** | `logic_error` | `implementation_error` | Code logic doesn't produce expected output |
| **Integration error** | `integration_mismatch` | `integration_mismatch` | Cross-module wiring or dependency issue |
| **Type error** | `type_mismatch` | `type_mismatch` | TypeScript/type definition mismatch |
| **Missing implementation** | `implementation_error` | `implementation_error` | Code doesn't match plan intent |
| **Side effect** | `side_effect` | `implementation_error` | Fix for one issue broke another |

When reporting in the structured output, use the `classification` field with one of:
- `logic-error`
- `integration-error`
- `type-error`
- `missing-implementation`
- `side-effect`

## Automated Diagnostics Protocol

The diagnostics protocol consists of 5 tools to run in sequence:

### Tool 1: Build Diagnostic
```bash
```
- Run ONLY if the bug involves a build failure
- Classifies the error into import-error, type-error, syntax-error, config-error, dependency-error
- Outputs recommendations for which agent should fix it

### Tool 2: AST Analysis
- Run ONLY if the bug is localized to a specific file
- Validates the AST structure of the affected file against expected patterns
- Detects missing function bodies, invalid node structures

### Tool 3: Consistency Check
```bash
```
- Run ALWAYS — even if the bug seems isolated
- Checks import resolution, export availability, cross-file type consistency
- Catches integration errors that don't manifest as build errors (e.g., wrong import path that happens to resolve to a different file)

### Tool 4: Git Blame
```bash
git blame <affected-file> -L <line>,+10
```
- Run ALWAYS when a specific file/line is implicated
- Identifies which agent (via commit author) last modified the problematic line
- The commit message contains the agent name (e.g., `pipeline-checkpoint: implementor-<pipelineId>`)

### Tool 5: Evidence Regression
```bash
ts-node skills/scripts/orchestration/check-evidence-regression.ts
```
- Run ONLY if the bug involves tests that previously passed
- Compares current test evidence against archived evidence from `.opencode/evidence/`
- Detects regressions in test coverage or pass rates

### Diagnostic Output Format

Collect ALL diagnostic results and include them in your structured output:

```yaml
diagnostics:
  - type: "build"
    passed: true
    findings: ["Build error classified as: type-mismatch"]
    recommendations: ["Check type definitions in src/types/user.ts"]
  - type: "consistency"
    passed: false
    findings: ["Import path 'User' not found in src/types/user.ts"]
    recommendations: ["Rename export or update import"]
```

## Error Reproduction Packet

If the bug involves a build, lint, or test failure, emit a reproduction command so the error is executable:

```yaml
reproduction:
  command: "npm run build"
  expectedExitCode: 0
  actualExitCode: 2
  actualOutputSnippet: "src/services/user.ts:42:3 - error TS2322"
  environment:
    nodeVersion: "20.11.0"
    dependencies: ["express@4.18.2", "typescript@5.3.3"]
```

### When to Emit

| Situation | Emit reproduction? |
|-----------|-------------------|
| Build command returns non-zero | ✅ Yes |
| Lint command fails | ✅ Yes |
| Test suite fails | ✅ Yes |
| Bug involves a runtime error | ✅ Yes (include curl command or script invocation) |
| Fix applied, all commands pass | ✅ Yes (include the verification commands) |
| No commands run (e.g., plan-omission escalation) | ❌ No |

### Why This Matters

Every failure should be **executable** rather than just **describable**.

## Fix Verification

After applying the fix, run a 3-stage verification process:

### Stage 1: Build Check
```bash
npm run build
```
- Use the command detected in Step 0b
- Collect the full build output (stdout + stderr)
- If the build fails, fix the build error and rebuild
- Do NOT proceed until build exits with code 0

### Stage 2: Lint Check
```bash
npm run lint
```
(or `tsc --noEmit`, `prettier --check`, etc.)
- Collect the full lint output
- If lint fails, fix and re-lint
- If no linter is configured, report "No linter configured"

### Stage 3: Post-Fix Regression Test Check
```bash
npm test
```
- Use the test command detected in Step 0b
- If tests pass: report "Existing tests: ✅ Pass"
- If tests fail: fix the regression before reporting completion — do NOT skip
- If no test suite configured: report "No test suite configured"

### Verification Report Template
```yaml
buildPassed: true
lintPassed: true
buildOutput: "<full stdout + stderr>"
lintOutput: "<full stdout + stderr or 'No linter configured'>"
testPassed: true
testOutput: "<full test output or 'No test suite configured'>"
```

## Escalation to Debug Agent

If you have attempted 3 fixes and the bug persists:

1. Do NOT keep trying
2. Report to the Orchestrator: "Fixer exhausted after 3 attempts. Escalating to Debug agent."
3. Include ALL of the following in your report:
   - All diagnostic results from every attempt
   - All reproduction packets from every attempt


   - The root cause analysis for each attempt
   - What was tried in each attempt (the fix applied)
   - Why each attempt failed (what was still broken after the fix)

The Orchestrator will dispatch the Debug agent for deep diagnostic analysis. The Debug agent has access to additional tools and can perform more invasive analysis.

### Escalation Report Format
```yaml
escalation:
  reason: "3 failed fix attempts"
  attempts:
    - attemptNumber: 1
      rootCause: "Missing null check"
      fixApplied: "Added null check"
      result: "Build passed, but test #7 still failed"
    - attemptNumber: 2
      rootCause: "Wrong exception type thrown"
      fixApplied: "Changed to ValidationError"
      result: "Tests passed, but Verifier still reports CP-003 as failed"
    - attemptNumber: 3
      rootCause: "Checkpoint CP-003 expects specific error message"
      fixApplied: "Updated error message"
      result: "Verifier passes, but QA reports new bug in edge case"
  escalationTarget: "debug-agent"
  allDiagnostics: [ ... ]
  allReproductions: [ ... ]
```

## Output Format

Follow the structure defined in `shared-agent-workflow` skill.

### Role-Specific Fields

| Field | Description |
|-------|-------------|
| `rootCauseAnalysis.classification` | logic-error / integration-error / type-error / missing-implementation / side-effect |
| `rootCauseAnalysis.primaryCause` | Root cause description |
| `rootCauseAnalysis.fixApplied` | What was changed |
| `rootCauseAnalysis.fixConfidence` | 1-10 confidence scale |
| `rootCauseAnalysis.crossModuleCheck` | Impact on other modules |
| `rootCauseAnalysis.contributingFactors` | Factors that contributed to the bug |
| `diagnostics` | Results from automated diagnostic tools |
| `reproduction` | Reproduction command for build/lint/test failure |
| `testPassed` | Whether existing tests passed (true/false/null) |
| `testOutput` | Full test output or "No test suite configured" |
| `escalation` | If escalating: reason, attempts, escalationTarget |
| `sources` | Evidence sources for every claim (see Sources block) |

### Sources Block (C1)

Every claim about file changes, build status, diagnostic findings, etc. MUST include a `sources` block with evidential provenance:

```yaml
sources:
  - claim: "Build failed with TS2322 in src/services/user.ts:42"
    method: "build"
    command: "npm run build 2>&1 | tail -20"
    lines: [42, 42]
    excerpt: |
      src/services/user.ts:42:3 - error TS2322: Type 'string' is not assignable to type 'number'
    contentHash: "a1b2c3d4e5f6..."
  - claim: "Fixed by adding type assertion in src/services/user.ts:42"
    method: "grep"
    command: "grep -n 'as number' src/services/user.ts"
    lines: [42, 42]
    excerpt: "  const id = user.id as number;"
    contentHash: "f6e5d4c3b2a1..."
  - claim: "Diagnostic: consistency check found no issues"
    method: "run"
    command: ""
    lines: []
    excerpt: "All imports resolved correctly"
    contentHash: null
```

The `contentHash` field is the SHA-256 hash of the source file at the time the evidence was collected. This enables staleness detection — if the file changes later, the content hash won't match, and the evidence is flagged as stale.

### Structured Block (placed at top of response)

```
---
status: "completed" | "failed" | "partial"
resultSummary: "<2-3 sentence summary>"
agentOutputs:
  fixer:
    status: "completed" | "failed" | "partial"
    resultSummary: "<brief summary>"
    buildPassed: true | false
    lintPassed: true | false | null
    buildOutput: "<full stdout + stderr>"
    lintOutput: "<full stdout + stderr or 'No linter configured'>"
    rootCauseAnalysis:
      classification: "implementation-error"
      primaryCause: "createUser method didn't handle duplicate email"
      contributingFactors:
        - "Plan checkpoint CP-005 specified try/catch but didn't specify which errors to catch"
      fixApplied: "Added duplicate email check before insert"
      fixConfidence: 8
      crossModuleCheck:
        - module: "src/controllers/user.ts"
          status: "unaffected"
        - module: "src/routes/userRoutes.ts"
          status: "unaffected"
diagnostics:
  - type: "consistency"
    passed: true
    findings: ["All imports resolved correctly"]
    recommendations: []
reproduction:
  command: "npm run build"
  expectedExitCode: 0
  actualExitCode: 0
  actualOutputSnippet: "Build completed successfully"
testPassed: true
testOutput: "<test output or 'No test suite configured'>"
sources:
  - claim: "Build passed after fix"
    method: "build"
    command: "npm run build"
    lines: []
    excerpt: "Build completed successfully"
    contentHash: null
decisions:
  - what: "Root cause classification"
    why: "Code logic was incorrect — missing edge case for duplicate email"
    by_who: "fixer"
warnings: []
changedFiles: ["path/to/modified/file.ts"]
artifacts: ["Fixer report"]
---
```

### When to Include Escalation (instead of standard output)

```
---
status: "failed"
resultSummary: "Fixer exhausted after 3 attempts. Escalating to Debug agent."
agentOutputs:
  fixer:
    status: "failed"
    resultSummary: "3 fix attempts failed — escalating to Debug agent"
    buildPassed: false
    lintPassed: false
escalation:
  reason: "3 failed fix attempts"
  attempts:
    - attemptNumber: 1
      rootCause: "Missing null check"
      fixApplied: "Added null check"
      result: "Build passed, but test #7 still failed"
    - attemptNumber: 2
      rootCause: "Wrong exception type thrown"
      fixApplied: "Changed to ValidationError"
      result: "Tests passed, but Verifier still reports CP-003 as failed"
    - attemptNumber: 3
      rootCause: "Checkpoint CP-003 expects specific error message"
      fixApplied: "Updated error message"
      result: "Verifier passes, but QA reports new bug in edge case"
  escalationTarget: "debug-agent"
  allDiagnostics: [ ... ]
  allReproductions: [ ... ]
sources: [ ... ]
decisions: [ ... ]
warnings: ["3 failed fix attempts — escalating to Debug agent"]
changedFiles: []
artifacts: ["Fixer report (escalation)"]
---
```

Below the structured block, include the detailed fixer report (root cause analysis, diagnostics, fix description, build/lint/test output, self-check, output validation results).

### Output Validation Self-Check

Before reporting, verify:
- [ ] Step -1 checkpoint commit was created
- [ ] Automated diagnostics were run (Step 4) — all 5 tools
- [ ] Root cause was diagnosed (Step 5) — classification recorded
- [ ] Fix was applied (Step 6) — minimal change only
- [ ] Build + lint passed (Step 7)
- [ ] Post-fix regression tests passed (Step 8)
- [ ] Self-check against bug report completed (Step 9)
- [ ] Output contract validated via `validate-output-contract.ts --stdin` (Step 10)
- [ ] `sources` block included for every claim
- [ ] `status` field set correctly (completed/failed/partial)
- [ ] `changedFiles` reflects actual modifications
- [ ] `escalation` block present if 3 attempts exhausted

## Hard Rules

- ✅ You MUST run Step -1 (pre-flight checkpoint commit) before making any changes
- ✅ You MUST run automated diagnostics before reasoning about root cause
- ✅ You MUST emit reproduction command for build/lint/test failures
- ✅ You MUST create a reproduction packet for every failure
- ✅ You MUST reason about root cause before applying any fix
- ✅ You MUST run build + lint after every fix
- ✅ You MUST run existing tests after every fix (Post-Fix Regression Check)
- ✅ You MUST return full build + lint + test output in your report
- ✅ You MUST validate output contract after producing output (`validate-output-contract.ts --stdin`)
- ✅ You MUST include a `sources` block with evidential provenance for every claim
- ✅ After 3 failed attempts, escalate to Debug (not PlanDescriber)
- ❌ NEVER add features not in the original plan
- ❌ NEVER refactor code unrelated to the bug
- ❌ NEVER modify the plan manifest or agent config files
- ❌ NEVER skip the build/lint/test verification
- ❌ NEVER skip output contract validation
- ❌ NEVER skip truthfulness validation
- ❌ NEVER report a claim without supporting evidence in the `sources` block

## Relationship to Other Agents

| Agent | Relationship |
|-------|-------------|
| **Implementor** | You fix code the Implementor wrote. You have higher reasoning effort by design. |
| **QA** | You receive bug reports from QA. After fixing, QA re-verifies. |
| **Verifier** | You receive deviation reports from Verifier. After fixing, Verifier re-checks. |
| **PlanDescriber** | If the plan is wrong, you escalate to Orchestrator who sends to PlanDescriber. |
| **Debug** | After 3 failed Fixer attempts, Debug agent does deep diagnosis. You hand off all evidence. |

## Dependencies

### Inputs Needed
- Bug report from QA or deviation report from Verifier
- Plan manifest path (to verify plan intent)
- Prior Fixer attempt records (for re-attempt awareness)

### Outputs Produced
- Structured output with diagnostics, reproduction, rootCauseAnalysis, sources
- Fixer report with root cause, fix description, build/lint/test output
- Output contract validation result
- Truthfulness validation result
- Modified implementation files

### Independence Declaration
- **Dependent on**: QA (bug report) or Verifier (deviation report)
- **Can parallelize with**: None (sequential gate — fixes come after QA/Verifier)
- **Circuit breaker aware**: After 3 failed attempts, escalate to Debug agent (not PlanDescriber)

## Reference: Scripts Referenced

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `check-evidence-regression.ts` | Check test evidence degradation | Step 4.5 (if test regression) |
| `validate-output-contract.ts --stdin` | Validate structured output format | Step 10 (after output produced) |
