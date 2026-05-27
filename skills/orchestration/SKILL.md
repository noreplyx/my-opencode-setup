---
name: orchestration
description: Use this skill to orchestrate multiple agents to resolve complex problems and achieve overarching goals.
---

# Skill: orchestration

## Quick Reference — New in v2.0

| Improvement | Script/Skill | Purpose |
|-------------|-------------|---------|
| **Pipeline State Machine** | `validate-transition.ts` | Enforces valid agent step transitions |
| **Parallel Dispatch** | `parallel-dispatch.ts` | Native parallel dispatch with phase grouping |
| **Citation Index** | `citation-index.ts` | Cross-session checkpoint failure patterns |
| **Shared Test Manifest** | `shared-test-manifest.ts` | QA + Browser Tester coordination |
| **Unified Error Taxonomy** | `unified-pipeline-error-schema.ts` | Typed PipelineError with 30 error codes |
| **Agent Readiness Check** | `check-agent-readiness.ts` | Pre-flight agent permission verification |
| **Provenance Tracker** | `provenance-tracker.ts` | File-level checkpoint lifecycle tracking |
| **Implementor Workflow** | `skills/implementor-workflow/SKILL.md` | Decoupled workflow for Implementor |
| **Fixer Workflow** | `skills/fixer-workflow/SKILL.md` | Decoupled workflow for Fixer |
| **Finder Workflow** | `skills/finder-workflow/SKILL.md` | Decoupled workflow for Finder — exploration methodology, hazard detection, evidence gathering |
| **QA Workflow** | `skills/qa-workflow/SKILL.md` | Decoupled workflow for QA |
| **Verifier Workflow** | `skills/verifier-workflow/SKILL.md` | Decoupled workflow for Verifier |
| **Security Workflow** | `skills/security-workflow/SKILL.md` | Shared security patterns for all agents |
| **Output Schema v2** | `references/output-schema.json` | Adds sources, pipelineError, rollback, checkpointResults |

## Core Principles

### 1. Multi-Agent Orchestration
- **Goal Decomposition**: Break high-level goals into specific, actionable tasks suitable for specialized agents.
- **Agent Assignment**: Match tasks to the most appropriate agents (e.g., Finder for research, Orchestrator for brainstorming with user, Planner for roadmaps, Implementor for code, Fixer for debugging).
- **Workflow Sequencing**: Define the order of operations, ensuring agents receive the necessary context and outputs from previous steps.

### 2. Task Management
- **Clear Instruction**: Provide each agent with explicit objectives, constraints, and expected output formats.
- **Output Validation**: Review results from each agent before proceeding to the next stage of the workflow. Use read/glob/grep to inspect files produced by agents.
- **Inter-Agent Coordination**: Manage the hand-off of data and state between different agents to maintain project consistency.

### 3. Result Validation
- **Cross-Agent Verification**: Use a QA agent to validate that the combined output of multiple agents solves the original complex problem.
- **Iterative Refinement**: Cycle back to the Fixer agent (not Implementor) when validation reveals bugs. Fixer has higher reasoning effort for debugging.

## Agent Roles

| Agent | Purpose | Reasoning Effort | Called When | Self-Review? | Calibration Tracked? |
|-------|---------|-----------------|-------------|--------------|---------------------|
| **Finder** | Codebase exploration, research, information gathering. **Smart Finder**: Also reports proactive hazard detection (dead code, deprecated APIs, security anti-patterns). Returns structured knowledge graph. | 0.3 | Start of pipeline — gather context | Yes (self-checks findings) | Yes |
| **Orchestrator** | Brainstorming, task assignment, coordination | 0.1 | Always — primary user interface | Yes (pipeline retrospective) | Yes |
| **PlanDescriber** | Detailed implementation roadmaps + plan-manifest.json with confidence score | High | After brainstorm or direct feature request | Yes (confidence scoring) | Yes |
| **Implementor** | Write code following the plan with quality best practices. **Self-Reviewing Implementor**: Pre-implementation validation, security self-review, QUALITY SELF-REVIEW (17 items — new), build & lint verification. Reports quality additions back to PlanDescriber. | None | After plan is ready | Yes (mandatory self-review + quality self-review) | Yes |
| **Fixer** | Debug and fix bugs. **Root Cause Classifier**: Categorizes bugs into taxonomy (plan-omission, implementation-error, edge-case-miss, integration-mismatch, environment-issue). Reports fix confidence score. | High | After QA or Verifier reports issues | Yes (cross-module check) | Yes |
| **QA** | Smoke tests, bug discovery, coverage analysis. **Proactive QA**: Auto-generates edge case tests, runs non-functional checks (perf, a11y, security), performs regression impact analysis. | 0.1 | After build + security scan pass | Yes (edge case generation) | Yes |
| **Verifier** | Compare implementation against plan manifest. **Plan Diff Verifier**: Also suggests missing checkpoints, detects plan drift, performs cross-file consistency checks. | 0.1 | After Acceptance Gate passes | Yes (confidence level reporting) | Yes |
| **Security Scan** | Dependency vulnerability scan, secrets scan, anti-pattern scan, **semgrep SAST scan** (auto-loads semgrep-scan skill). Reports risk-level classified findings with auto-remediation suggestions. | Read-only | After build + lint pass | N/A (read-only) | No |
| **Browser Tester** | Playwright CLI browser automation, UI bug discovery | 0.2 | When UI testing is needed | No | No |
| **Documentor** | Project documentation, API docs, inline comments, ADRs | 0.2 | After Verifier passes — document verified code | Yes (accuracy check) | Yes |
| **Merge Coordinator** | Cross-file consistency check after parallel dispatch. Verifies imports, type signatures, and interface contracts between files from concurrent Implementors. | 0.1 | After parallel Implementor dispatch, before Integrator | Yes (self-checks findings) | Yes |
| **Integrator** | Wire new files into the project: update barrel files, DI registrations, route wiring, fix import paths. Runs after parallel Implementor dispatch and Merge Coordinator verification. | 0.1 | After Merge Coordinator, before Build Gate | Yes (build verifies wiring) | Yes |

## Standard Workflow Pipeline

The default orchestration workflow follows this sequence:

```
1. FINDER ──► Explore codebase, gather context, research dependencies
          │
2. ORCHESTRATOR ──► Brainstorm with user interactively, explore ideas, converge on direction
          │
3. PLAN DESCRIBER ──► Create detailed, step-by-step implementation roadmap
          │              └── Also produces plan-manifest.json for verification
          │
4. IMPLEMENTOR ──► Write code following the plan with quality best practices
                   └── Runs Quality Self-Review (17 items, mandatory)
                   (can dispatch multiple Implementors in parallel)
          │
   ┌──────┴──────┐
   ▼ MERGE COORDINATOR ▼ (runs after parallel dispatch)
   │  Verify cross-file imports,  │
   │  type signatures, interfaces  │
   └──────┬──────┘
          │ (inconsistencies found → Fixer, then re-run Merge Coordinator)
          ▼
   ┌──────┴──────┐
   ▼ INTEGRATOR  ▼ (NEW — wires barrels, DI, routes after parallel dispatch)
   │  Update barrel files,        │
   │  DI registrations, routes    │
   └──────┬──────┘
          │ (wiring issues → Integrator fixes; build verifies)
          ▼
   ┌──────┴──────┐
   ▼ BUILD CHECK ▼ (MANDATORY)
   │  Implementor MUST run build │
   │  and return full build output│
   └──────┬──────┘
          │ (build fails → Implementor fixes, rebuilds)
          ▼
   ┌──────┴──────┐
   ▼ LINT GATE   ▼ (MANDATORY if linter configured)
   │  Implementor MUST run linter │
   │  (eslint, prettier --check,  │
   │   tsc --noEmit, etc.)        │
   └──────┬──────┘
          │ (lint fails → Implementor fixes, re-lints)
          ▼
   ┌──────┴──────────┐
   ▼ CODE QUALITY     ▼ (NEW — MANDATORY)
   │  GATE            │
   │  Implementor runs │
   │  17-item Quality  │
   │  Self-Review      │
   │  Report results in │
   │  structured output│
   └──────┬──────────┘
          │ (blocking quality failures → Implementor fixes)
           ▼
    ┌──────────────────┐
    │  SECURITY SCAN   │
    │  GATE (MANDATORY)│
    │  Auto-loads:     │
    │  semgrep-scan    │
    │  skill           │
    └────────┬─────────┘
             │
    ┌────────┴─────────┐
    ▼ SEMGREP SAST     ▼ (MANDATORY sub-gate)
    │  semgrep --config │
    │  p/security-audit │
    │  --error .        │
    └────────┬─────────┘
             │ (exit code 1 → FAIL gate, block pipeline)
             ▼
    ┌────────┴─────────┐
    ▼ DEPENDENCY +     ▼
    │  SECRETS SCAN    │
    │  npm audit +     │
    │  anti-patterns + │
    │  SBOM + supply   │
    │  chain           │
    └──────┬──────┘
           │ (High/Critical vulns → report to Orchestrator)
           ▼
5. QA ──► Test, validate, report results
          │
   ┌──────┴──────┐
   ▼ SMOKE TEST  ▼
   │ QA runs smoke test to │
   │ confirm app is runnable│
   └──────┬──────┘
          │
   ┌──────┴──────┐
   ▼ FIXER LOOP  ▼ (feedback cycle)
   │ QA found bugs → cycle │
   │ to FIXER for diagnosis │
   │ and fix                │
   └──────┬──────┘
          │
    ┌──────┴──────┐
    ▼ ACCEPTANCE  ▼ (NEW — business scenario verification)
    │  GATE  │
    │  Execute acceptanceCriteria│
    │  checkpoints from manifest │
    └──────┬──────┘
           │
    ┌──────┴──────┐
    ▼ SECURITY    ▼
    │ TEST        │
    │ COVERAGE    │
    │ GATE        │
    │ QA reports  │
    │ coverage ≥  │
    │ 80% or      │
    │ Verifier    │
    │ cross-checks│
    └──────┬──────┘
           │ (coverage < 50% → cycle to QA)
           ▼
           │ (failures → cycle to Fixer with test output)
           ▼
6. VERIFIER ──► Compare implementation against plan manifest
   │              └── Structural checks (Pass 1)
   │              └── Behavioral checks (Pass 2)
   │              └── Acceptance criteria checks (Pass 2.5)
   │              └── Security Test Coverage Cross-Check (Pass 2.6)
   │              └── Cross-cutting checks (Pass 3)
   │              └── Plan drift detection (Pass 4)
          │
   ┌──────┴──────┐
   ▼ FEEDBACK    ▼
   │ If QA found bugs → cycle to FIXER
   │ If Acceptance Gate failed → cycle to FIXER
   │ If Security Test Coverage Gate failed → cycle to QA
   │ If Verifier score < 80% → cycle to FIXER
   │ Fixer: diagnose root cause, apply fix, rebuild, re-lint
   │         → then back to Acceptance Gate → Verifier
   └──────┬──────┘
          │
7. DOCUMENTOR ──► Create/update documentation for the (now verified) implementation
   │              └── JSDoc/TSDoc on new/modified exports
   │              └── CHANGELOG.md entries
   │              └── README updates
   │              └── Migration guide (if breaking changes)
          │
8. ORCHESTRATOR ──► Run pipeline-teardown (write journal entry, update calibration, archive logs),
                     review all results, generate Session Resume Report, report to user
```### When to Skip Steps
- **Simple/familiar tasks**: Skip Finder, go directly to PlanDescriber → Implementor → Build → Lint → Code Quality Gate → Security Scan → QA.
- **Exploratory/research tasks**: Use only Finder, report findings directly to user.
- **Bug fixes (known root cause)**: Skip PlanDescriber, go directly to Fixer for the fix, then QA + Verifier.
- **Trivial config changes**: Skip all gates — just delegate to Implementor.
- **Documentation updates**: Use Documentor only — no plan, no tests, no verification.

### When to Use Specialized Pipelines

Beyond the standard workflow, these specialized pipelines are available for specific use cases:

**TDD Pipeline (Test-Driven Development)**:
```
PlanDescriber ──► QA (write tests first) ──► Implementor ──► Build ──► Lint ──► Security Scan ──► Verifier
```
Use when: The feature is well-understood but correctness is critical. Tests are written BEFORE implementation. Implementor must pass all pre-written tests.

**Parallel Micro-Pipeline (Frontend + Backend Split)**:
```
Pipeline A: PlanDescriber(frontend) → Implementor(frontend) → Build(frontend)
Pipeline B: PlanDescriber(backend) → Implementor(backend) → Build(backend)
                     ↓                        ↓
                  ──── MERGE ──── Integration QA → Full Verifier
```
Use when: A feature has a clear frontend/backend boundary with no shared data dependency. Both pipelines run simultaneously. The Orchestrator waits for both to reach the MERGE gate. Each micro-pipeline gets its own `agent-context.md` (suffixed: `-frontend`, `-backend`).

### Pre-Flight Check (Automated)

Before starting any pipeline, the Orchestrator MUST run the automated pipeline-init script:

```bash
ts-node skills/scripts/orchestration/pipeline-init.ts --feature=<name> --pipeline-type=<type>
```

This script performs:
1. **Pre-Flight Checks**: git status (dirty files, branch, last commit SHA), project compilation check (`npm run build` with tail), stale `agent-context.md` detection (>1 hour old with "running" status)
2. **Cross-Session Learning**: Reads `.opencode/journal/journal.yaml` to find past entries with similar feature names. Extracts lessons learned from past failures. Returns a cross-session learning report.
3. **agent-context.md Creation**: Writes the full initial YAML frontmatter (pipeline identity, circuit breaker with complexity-based thresholds, git state, empty agent history)
4. **Pipeline Logs Directory**: Creates `.opencode/pipeline-logs/` if it doesn't exist
5. **Run pre-flight security check (NEW)**: Before any code changes or npm install, verify:
   - `package-lock.json` integrity (not tampered with since last commit)
   - Run `npm audit signatures` if available (verify registry signatures)
   - Check lockfile age — if last `npm audit` was > 7 days, warn about stale audit
   - These checks protect against supply chain attacks before any `npm install` runs during the build gate

6. **Agent Readiness Check (NEW)**: After the security check, run the automated agent readiness verification:

   ```bash
   ts-node skills/scripts/orchestration/check-agent-readiness.ts --agents=<agent1,agent2,...>
   ```

   Or for pipeline-type-based selection:
   ```bash
   ts-node skills/scripts/orchestration/check-agent-readiness.ts --pipeline-type=<type>
   ```

   This verifies:
   - Required agent config files exist
   - Agents have the correct tool permissions (write, bash, edit)
   - Agents have the required skill access (shared-agent-workflow, code-philosophy, etc.)
   - If any agent is not ready, the pipeline is blocked with a clear error message

### Pre-Flight Report
The script prints a summary report that the Orchestrator should relay to the user, including:
- ✅ / ❌ / ⚠️ for each pre-flight check
- Cross-session learning matches (past features, lessons)
- Created files
- A go/no-go recommendation

### When to Skip
If the project is clearly in good shape (user just asked for a quick fix) and the feature is trivial, the Orchestrator MAY skip the full pre-flight check and simply create a minimal `agent-context.md` manually.

### Evidence Validation Gate (NEW)

After EVERY agent returns its output (before updating agent-context.md), the Orchestrator MUST run the Evidence Validation Gate:

```bash
# Step 1: Validate output contract structure
ts-node skills/scripts/orchestration/validate-output-contract.ts --file=<agent-output-file>

# Step 2: Validate truthfulness of claims (re-verify against filesystem)

# Step 3: Score evidence quality
```

#### Gate Rules
| Check | Pass | Fail |
|-------|------|------|
| Output contract schema | All required fields present | Missing required fields → cycle back to agent |
| Truthfulness score | ≥ 95% | < 95% → return refuted claims to agent for correction |
| Evidence quality score | ≥ 70 | < 70 → warn Orchestrator, add evidence requirements to next hand-off |

#### Circuit Breaker for Evidence Quality
If an agent submits evidence quality < 70 for 3 consecutive attempts:
1. First low quality: Warn agent with specific feedback
2. Second low quality: Cycle back with explicit evidence template
3. Third low quality: Open circuit breaker → escalate to Orchestrator

### Pipeline Teardown (Automated)

After every pipeline completes (success or failure), the Orchestrator MUST run the automated pipeline-teardown script:

```bash
ts-node skills/scripts/orchestration/pipeline-teardown.ts --feature=<name> --pipeline-type=<type> --result=pass|fail|partial --duration-minutes=<N> --files-changed=<file1,file2,...> [--failed-gates=<gate1,gate2,...>]
```

This script performs:
1. **Reads agent-context.md**: Extracts pipeline state, circuit breaker history, agent outputs
2. **Calculates Retrospective**: Auto-generates pipeline quality, handoff quality rating, agent performance assessment, and improvement suggestions based on retry counts, warnings, and failure data
3. **Writes Journal Entry**: Appends to `.opencode/journal/journal.yaml` with all fields including the retrospective
4. **Appends Lessons**: Writes lessons learned to `.opencode/lessons/learned.yaml` (key decisions, failure root causes)
5. **Archives Raw Outputs**: Copies full `agent-context.md` and per-agent outputs to `.opencode/pipeline-logs/<pipelineId>/`
6. **Updates Calibration**: Calls `update-calibration.ts` for each unique agent in the pipeline history
7. **Deletes agent-context.md**: Cleans up the context file (or preserves with `--keep-context`)

### Build Gate & Smoke Test Requirements

Every implementation MUST pass through these mandatory validation gates:

| Gate             | Who Runs It   | What It Checks                                          | Failure Action                                  |
|------------------|---------------|---------------------------------------------------------|-------------------------------------------------|
| **Build Gate**   | Implementor   | Code compiles without errors (e.g., `npm run build`, `tsc`) | Implementor fixes and rebuilds before proceeding |
| **Lint Gate**    | Implementor   | Code passes linter/style checks (e.g., `eslint`, `prettier --check`, `tsc --noEmit`) | Implementor fixes lint errors before proceeding |
| **Code Quality Gate** | Implementor | 17-item quality self-review: error handling completeness, input validation, logging, type safety, no direct DB in controllers, no magic values, SOLID adherence, naming, config from env, separation of concerns, no dead code, parameterized queries, DTOs/schemas, idempotency, no TODO/FIXME, bundle awareness | Implementor fixes blocking failures before proceeding; non-blocking warnings reported to Orchestrator |
| **Security Scan**| Orchestrator  | semgrep SAST scan (auto-loads semgrep-scan skill) + npm audit for High/Critical vulns, secrets scan, anti-pattern scan | Report to user; may fix, except, or block       |
| **Smoke Test**   | QA            | Application boots/starts without crashing, or module loads cleanly | QA reports as Critical bug; cycle to Fixer      |
| **Security Test Coverage Gate**| Orchestrator + Verifier | QA-generated security regression tests cover ≥ 80% of detected security patterns | Coverage < 50% → cycle back to QA; 50-79% → warn and proceed with Verifier flagging
| **Plan Verify**  | Verifier      | Code matches plan-manifest.json checkpoints (structural + behavioral) | Score < 80% → cycle to Fixer; 3 attempts → PlanDescriber |

**Build Gate Protocol:**
- The Implementor MUST run the build command after writing code
  - `import-error` → route to **Integrator** (fix import paths)
  - `type-error` → route to **Fixer** (fix type signatures)
  - `syntax-error` → route to **Implementor** (fix syntax)
  - `config-error` → route to **Orchestrator** (fix tsconfig/ESLint config)
  - `dependency-error` → route to **user** (fix package.json)
  - `lint-error` → route to **Implementor** (fix code style)
  - `test-failure` → route to **Fixer** (fix test assertions)
  - `missing-export` → route to **Implementor** (add missing export)
  - `duplicate-identifier` → route to **Implementor** (remove duplicate)
  - `unknown-error` → route to **Implementor** (manual review)

- The Implementor MUST return the full build output (stdout + stderr) to the Orchestrator
- If the build fails, the Implementor MUST fix the issue and rebuild before reporting completion
- The Orchestrator MUST inspect the build output to confirm success before proceeding to QA

**Lint Gate Protocol:**
- The Implementor MUST run lint commands (e.g., `eslint`, `prettier --check`, `tsc --noEmit`) after the build passes
- The Implementor MUST return the full lint output (stdout + stderr) to the Orchestrator
- If linting fails, the Implementor MUST fix the issues and re-lint before reporting completion
- The Orchestrator MUST inspect the lint output to confirm no errors before proceeding to QA
- If the project has no linter configured, the Implementor should report "No linter configured" and proceed
- The Implementor's report MUST include lint output alongside build output so the Orchestrator can confirm both gates passed

**Code Quality Gate Protocol (NEW):**
- After build + lint pass, the Implementor runs the mandatory 17-item Quality Self-Review Checklist
- The checklist is defined in `implementor-workflow/SKILL.md` (Quality Self-Review Checklist section)
- The checklist covers: Error Handling, Input Validation, Logging, Type Safety, No Direct DB in Controllers, No Magic Values, Single Responsibility, Naming, Config from Env, Separation of Concerns, No Dead Code, Error Messages, Parameterized Queries, DTOs/Schemas, Idempotency, No TODO/FIXME, Bundle/Dependency Awareness
- 12 blocking checks must ALL pass; 5 warning checks are non-blocking
- The Implementor reports qualitySelfReview results in its structured output
- If any blocking check fails → Implementor MUST fix before proceeding
- Warning check failures → reported to Orchestrator as quality warnings
- The Orchestrator reviews the qualitySelfReview report before proceeding to Security Scan
- The Verifier's Pass 6 (Quality Drift Detection) independently validates quality after implementation

**Security Scan Protocol:**
- After build + lint pass, the Orchestrator runs the Security Scan (directly or via subagent)
  - Scan includes: **semgrep SAST scan** (auto-loads semgrep-scan skill), npm audit, secrets scan, anti-pattern scan, git history secret scan
  - **Semgrep SAST scan (MANDATORY)**: The Orchestrator MUST load the semgrep-scan skill and run semgrep --config p/security-audit --error .. This runs automatically during every pipeline — no user prompt required.
- High/Critical dependency vulnerabilities → FAIL the gate (block pipeline)
- Install scripts detected in dependencies → FAIL the gate (block pipeline)
- Secrets/anti-pattern findings → WARN (non-blocking, report findings)
- SAST findings (path traversal, command injection, etc.) → FAIL for Critical, WARN for High/Medium
- The Security Scan MUST NOT modify any files

#### Re-Audit on Dependency Change (NEW)
If any agent modifies `package.json`, `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` during the pipeline:
1. The dependency scan MUST be re-run after the modification
2. This applies to the Fixer agent — if Fixer installs/updates a package, the security scan must run again
3. The Orchestrator checks `changedFiles` from Fixer/Implementor — if any dependency file is in the list, the security scan gate is re-triggered before proceeding to QA

**Smoke Test Protocol:**
- QA MUST run a simple smoke test (build is already verified by Implementor's Build Gate)
- The smoke test should be fast (< 10 seconds) and provide high confidence the application is runnable
- If the smoke test fails, QA reports it as a Critical severity bug
- The Orchestrator reviews the report and cycles to the **Fixer agent** for diagnosis and fix
- After Fixer applies the fix, QA re-runs the smoke test

**Security Test Coverage Gate (NEW):**
- After QA completes all testing (smoke, unit, security regression), the Orchestrator MUST review QA's `securityTestCoverage` output
- The QA agent reports: number of security patterns detected, tests generated, coverage percentage, and gate pass/fail status
- The Verifier cross-references QA's report during Pass 2b and includes a `securityTestCoverageGate` in its output

**Coverage Gate Rules:**
| Coverage | Verdict | Action |
|----------|---------|--------|
| ≥ 80% | ✅ PASS | Proceed to Acceptance Gate |
| 50-79% | ⚠️ WARN | Include in deviation report, proceed |
| < 50% | ❌ FAIL | Block pipeline — cycle back to QA with instruction to generate missing security tests |

**Integration with Pipeline:**
```
Build Gate → Lint Gate → Security Scan (with mandatory Semgrep SAST sub-gate) → QA (smoke + security regression) → SECURITY TEST COVERAGE GATE → Acceptance Gate → Verifier
```

**Enforcement:**
- The Orchestrator checks QA's `securityTestCoverage.gatePassed` field
- If `gatePassed: false` and coverage < 50%: the pipeline is blocked, and QA must be re-invoked with instructions to create the missing security regression tests
- If `gatePassed: false` but coverage 50-79%: the pipeline proceeds with a warning; the Verifier flags this in its final report

**Verifier Cross-Check (NEW):**
After the Acceptance Gate passes, the Verifier performs an additional validation step during Pass 2b:
1. Run Security Checkpoint Auto-Detection (Section 2 of `security-workflow`) on all modified files
2. Read QA's `securityTestCoverage` from the agent context
3. Cross-reference: every security pattern detected by the Verifier should have a corresponding test generated by QA
4. Report missing test coverage in `securityTestCoverageGate` field
5. If coverage < 50% after cross-reference: Verifier reports failure and the pipeline cycles to Fixer/QA


### Shared Test Manifest (NEW)
When QA and Browser Tester run in parallel, use the shared test manifest to coordinate:

```bash
# Generate from plan manifest
ts-node skills/scripts/orchestration/shared-test-manifest.ts --generate --manifest=... --feature=<name> --out=.opencode/test-manifest.yaml

# Check status
ts-node skills/scripts/orchestration/shared-test-manifest.ts --status

# QA marks logic tests complete
ts-node skills/scripts/orchestration/shared-test-manifest.ts --complete --test-type=logic --test-file=tests/unit/... --result=pass

# Browser Tester marks UI tests complete
ts-node skills/scripts/orchestration/shared-test-manifest.ts --complete --test-type=ui --test-file=tests/e2e/... --result=pass

# Wait for all to finish before proceeding to Verifier
ts-node skills/scripts/orchestration/shared-test-manifest.ts --wait --timeout=300000
```

This prevents the race condition where "QA passed but Browser Tester was never run."

## Agent Hand-off Protocol

### Hand-off Checklist (Enhanced)
When passing work from one agent to the next, the Orchestrator MUST include:

1. **Context Summary**: What was done in the previous step(s)
2. **Artifacts**: Relevant file paths, outputs, or data produced
3. **Previous Evidence**: Structured evidence from prior agent(s) with content hashes:
   ```
   Previous Evidence (from <agent>):
     - Claim: <claim>
       Source: <file>, Lines [start, end]
       ContentHash: <sha256>
       Method: grep/read/stat
       Command: <exact command>
       Excerpt: "<relevant output>"
       Result: found/passed
   ```
4. **Clear Objective**: Exactly what the next agent should do
5. **Constraints**: Any boundaries, rules, or restrictions
6. **Expected Output**: What the agent should return/report (structured output contract with evidence)
7. **Evidence Requirements**: "Include evidence for every substantive claim with contentHash, line numbers, exact commands, and verbatim excerpts"
8. **Visual Generation**: After the agent returns, generate the appropriate pipeline visualization

### Example Hand-off
```
Orchestrator to PlanDescriber:
"After brainstorming with the user, we've agreed on Option B (modular monolith approach).
Finder has analyzed the codebase (see files: src/services/user.ts, src/models/user.ts).
Please create a detailed implementation roadmap for adding user profile management,
following the code-philosophy and backend-code-philosophy skills.
Focus on: data models, service layer, and API endpoints."
```

### Verifier → Fixer Hand-off
When the Verifier reports a score < 80%, the Orchestrator delegates to the Fixer:

1. **Deviation Report**: The Verifier's detailed checkpoint results and failure reasons
2. **Plan Manifest**: Path to the plan manifest for reference
3. **Implementation Context**: What was supposed to be implemented
4. **QA Results**: Smoke test result (should have passed)
5. **Clear Objective**: "Diagnose the root cause of these deviations and apply targeted fixes"
6. **Expected Output**: Root cause analysis, fix description, build + lint output

Example:
```
Orchestrator to Fixer:
"The Verifier reported 72% compliance on the user-profile feature.
Plan manifest: plan-manifests/user-profile/v1-manifest.json
Deviations:
- CP-003: exportExists 'validateEmail' — not found in src/services/user.ts
- CP-007: handlesError 'createUser' — no error handling for duplicate email

QA smoke test passed. Build and lint passed.
Please diagnose the root cause and apply targeted fixes."
```

### Verifier Hand-off
When passing from QA to Verifier, include:
1. **Plan Manifest Path**: Path to the `plan-manifest.json` file produced by PlanDescriber
2. **Implementation Summary**: Brief summary of what was implemented
3. **QA Results**: Summary of QA's smoke test and any bug reports
4. **Clear Objective**: "Verify that the implementation matches all structural and behavioral checkpoints in the plan manifest"
5. **Expected Output**: Compliance score, pass/fail/skipped breakdown, deviation report

Example:
```
Orchestrator to Verifier:
"The plan manifest is at plan-manifests/user-profile-manifest.json.
Implementation added UserService with createUser and getUser methods.
QA smoke test passed. Security scan passed (no High/Critical vulnerabilities).
Please verify all checkpoints in the manifest and report the compliance score."
```

### Evidence Hand-off Protocol (NEW)

When handing off between agents, the Orchestrator MUST include structured evidence from the PRIOR agent's work:

**Format:**
```markdown
Previous Evidence:
  - Claim: "User model exists at src/models/user.ts"
    Source: src/models/user.ts, Lines 5-20
    ContentHash: a1b2c3d4e5f6...
    Method: grep
    Command: grep -n 'interface User' src/models/user.ts
    Excerpt: "interface User { email: string; name: string; }"
    Result: found
  - Claim: "Validation middleware exists"
    Source: src/middleware/validation.ts, Lines 1-50
    Method: read
    Command: head -50 src/middleware/validation.ts
    Excerpt: "export function validateRequest(...)"
    Result: found
```

This ensures downstream agents have verified facts, not paraphrased summaries.

## Fixer Feedback Loop

When QA discovers bugs or Verifier finds deviations, use this iterative refinement cycle:

```
QA/Verifier reports issues ──► Orchestrator reviews ──► Fixer diagnoses & fixes ──► QA re-verifies
                                                                                        │
                                                                                   ┌──────┴──────┐
                                                                                   ▼ RE-VERIFY   ▼
                                                                                   │ Fixer rebuilds│
                                                                                   │ + re-lints    │
                                                                                   │ → re-smoke    │
                                                                                   │ → re-verify   │
                                                                                   └──────┬──────┘
```

### Feedback Loop Protocol
1. **QA/Verifier Reports**: Returns detailed report with issues
2. **Orchestrator Reviews**: Orchestrator reads the report and inspects relevant code
3. **Orchestrator Delegates to Fixer**: Sends bug report + context + plan manifest to Fixer
4. **Fixer Diagnoses**: Fixer uses high reasoning effort to trace root cause
5. **Fixer Applies Fix**: Minimal targeted fix, no scope creep
6. **Fixer Builds & Lints**: Build and lint MUST pass
7. **Orchestrator Re-invokes QA**: Sends QA back to verify the fix
8. **After QA passes**: Re-invoke Verifier to check against plan manifest
9. **Loop Repeats**: Continue until all gates pass or escalation threshold reached

### Escalation Criteria
If the same issue resurfaces after 3 Fixer attempts, escalate back to PlanDescriber for roadmap revision.

### Context Preservation
When cycling back to Fixer, use `task_id` (ses_xxx) to preserve conversation context with the prior Fixer session so the agent retains memory of what it diagnosed.

### Cross-Agent Evidence Provenance (NEW)

Every plan manifest checkpoint now tracks its lifecycle through the pipeline:

```json
{
  "id": "CP-003",
  "type": "behavioral",
  "description": "validateEmail handles invalid input",
  "target": "src/services/user.ts",
  "provenance": {
    "createdBy": "PlanDescriber",
    "implementedBy": "Implementor",
    "implementationEvidence": {
      "claim": "validateEmail throws on invalid email",
      "command": "grep -n 'throw.*Invalid email' src/services/user.ts"
    },
    "verificationResult": {
      "verdict": "fail",
      "verifier": "Verifier",
      "evidence": { "result": "not_found" }
    },
    "fixedBy": "Fixer",
    "fixEvidence": {
      "claim": "Added error handling to validateEmail",
      "command": "grep -n 'throw new ValidationError' src/services/user.ts"
    }
  }
}
```

This enables the Verifier and Fixer to trace exactly what evidence was collected at each step.

### Provenance Tracking (NEW)
After each agent completes, track checkpoint provenance:

```bash
# Implementor records implementation evidence
ts-node skills/scripts/orchestration/provenance-tracker.ts --implement --manifest=... --agent=implementor --session=<ses_id> --file=<path> --lines=<range> --claim="..."

# Verifier records verification results
ts-node skills/scripts/orchestration/provenance-tracker.ts --verify --manifest=... --checkpoint=<id> --verdict=<pass|fail> --evidence="command" --result=<found|not_found>

# Fixer records fix
ts-node skills/scripts/orchestration/provenance-tracker.ts --fix --manifest=... --checkpoint=<id> --agent=fixer --session=<ses_id> --file=<path> --lines=<range> --claim="..."

# View full provenance chain
ts-node skills/scripts/orchestration/provenance-tracker.ts --view --manifest=... --checkpoint=<id>
```

## Project Journal Protocol

### Purpose
The Project Journal provides cross-session memory so the system remembers past work, decisions, and failures. Without it, every session starts fresh.

### Journal Location
`.opencode/journal/journal.yaml`

### When to Write
After every pipeline that:
1. **Completes successfully** — all gates pass
2. **Fails after escalation** — circuit breaker opened
3. **Produces key architecture decisions** — even if partial

### What to Record
| Field | Description | Example |
|-------|-------------|---------|
| `date` | ISO-8601 timestamp | `"2026-05-19T10:30:00Z"` |
| `feature` | Short feature name | `"user-profile"` |
| `pipelineType` | Type of pipeline run | `"full"`, `"fixer-only"` |
| `result` | Outcome | `"pass"`, `"fail"`, `"partial"` |
| `durationMinutes` | How long the pipeline took | `12` |
| `filesChanged` | Files modified | `["src/services/user.ts"]` |
| `keyDecisions` | Architecture decisions made | `["Chose in-memory over Redis for MVP"]` |
| `circuitBreakerEvents` | Any circuit breaker activations | `[{gate: "verifier", attempts: 3}]` |
| `failedGates` | Gates that didn't pass | `["verifier"]` |
| `notes` | Free text | `"Revised plan twice due to edge cases"` |

### When to Read
- **Before starting a pipeline** in a new session: read the journal to understand past work
- **Before dispatching PlanDescriber**: read the journal to check for relevant past decisions
- **Before dispatching Finder**: read the journal so you know what's already been explored

### Citation Index (NEW)
The citation index maps checkpoint IDs to past pipeline results. It enables PlanDescriber to see patterns (e.g., "CP-003 has failed 3 times before") and proactively add guardrails.

```bash
# Build/refresh index
ts-node skills/scripts/orchestration/citation-index.ts --build

# Query a specific checkpoint
ts-node skills/scripts/orchestration/citation-index.ts --checkpoint=CP-003

# Query all checkpoints in a manifest
ts-node skills/scripts/orchestration/citation-index.ts --manifest=plan-manifests/<feature>/v<version>-manifest.json

# Show summary statistics
ts-node skills/scripts/orchestration/citation-index.ts --stats
```

The index is stored at `.opencode/cache/citation-index.json`.

## Agent Action Audit Trail (NEW)

### Purpose
Every agent action that modifies files, installs dependencies, or changes configuration is recorded in a **tamper-evident audit log**. This provides:
- Immutable record of what each agent did during the pipeline
- Hash chain integrity — tampering is detectable
- Forensic evidence if an agent goes rogue

### Audit Log Tool
```bash
# Initialize audit log for a pipeline
ts-node skills/scripts/orchestration/audit-log.ts init --pipeline-id=<id> --feature=<name>

# Append an action entry
ts-node skills/scripts/orchestration/audit-log.ts append \
  --pipeline-id=<id> \
  --agent=<agent-name> \
  --action=<action-type> \
  --details=<json> \
  --file-hashes=<json>

# Verify chain integrity
ts-node skills/scripts/orchestration/audit-log.ts verify --pipeline-id=<id>

# Print human-readable report
ts-node skills/scripts/orchestration/audit-log.ts report --pipeline-id=<id>
```

### Valid Action Types
| Action | Description | Requires file-hashes |
|--------|-------------|---------------------|
| `file_write` | Agent created a file | Yes |
| `file_modify` | Agent modified a file | Yes |
| `file_delete` | Agent deleted a file | No |
| `npm_install` | Agent installed/updated packages | No |
| `build` | Agent ran the build | No |
| `lint` | Agent ran the linter | No |
| `security_scan` | Security scan was run | No |
| `qa_test` | QA ran tests | No |
| `git_commit` | Agent committed changes | No |
| `config_change` | Agent modified config | Yes |

### When to Log
The Orchestrator records audit entries after each agent completes:
1. Parse the agent's `changedFiles` from structured output
2. For each changed file, compute SHA-256 hash
3. Append audit entry with action type matching the agent's role
4. After the pipeline ends, run `verify` to confirm chain integrity

### Location
Audit logs are stored at `.opencode/audit/<pipeline-id>.audit.yaml`

### Stale Audit Log Cleanup
Audit logs older than 30 days should be archived or deleted during pipeline teardown.

## Unified Error Taxonomy (NEW)

All pipeline errors are now standardized across all agents using the canonical `PipelineError` type defined in `unified-pipeline-error-schema.ts`. This replaces the previous stringly-typed error classifications.

### Error Code Categories
| Prefix | Category | Example |
|--------|----------|---------|
| PLN | Plan | PLN-001: Missing checkpoint |
| IMP | Implementation | IMP-001: Missing export |
| INT | Integration | INT-001: Broken import |
| ENV | Environment | ENV-001: Missing tool |
| SEC | Security | SEC-001: Critical vulnerability |

### Fixer Classification → Error Code Mapping
| Fixer Classification | Mapped Error Code |
|---------------------|-------------------|
| plan-omission | PLN-001 or PLN-002 |
| implementation-error | IMP-001, IMP-002, or IMP-003 |
| edge-case-miss | IMP-004 or IMP-005 |
| integration-mismatch | INT-001, INT-002, or INT-003 |
| environment-issue | ENV-001, ENV-002, or ENV-003 |

### Usage
```bash
# Look up an error code
ts-node skills/scripts/orchestration/unified-pipeline-error-schema.ts --lookup=IMP-001

# Validate an error object
ts-node skills/scripts/orchestration/unified-pipeline-error-schema.ts --validate

# Classify a fixer root cause
ts-node skills/scripts/orchestration/unified-pipeline-error-schema.ts --classify="Missing export in user.ts" --fixer-classification=implementation-error
```

## Pipeline Retrospective Protocol

### Purpose
After every pipeline completes (success or failure), run a structured retrospective to capture lessons learned that improve future pipelines. Without this, the system repeats the same mistakes across sessions.

### When to Run
1. After a pipeline completes successfully — run a "success retrospective"
2. After a pipeline fails after escalation — run a "failure retrospective"  
3. After any circuit breaker activation — run immediately

### Retrospective Report Format
After the pipeline ends (after final journal entry), the Orchestrator produces a retrospective assessment appended to the journal entry:

```yaml
retrospective:
  pipelineQuality: "smooth" | "rough" | "failed"
  handoffQuality:
    rating: 1-10
    issues: ["Hand-off to Implementor was missing context about existing User model"]
  agentPerformance:
    - role: "finder"
      effectiveness: "good" | "ok" | "poor"
      notes: "Found all required files but missed the existing validation middleware"
    - role: "implementor"
      effectiveness: "good" | "ok" | "poor"
      notes: "Followed plan exactly but needed 2 build gate retries"
  wastedSteps:
    - "Finder was unnecessary — domain was already well-understood"
  improvementsForNextPipeline:
    - "Skip Finder for similar tasks in this domain"
    - "Give PlanDescriber more context about existing error handling patterns"
  lessonsLearned:
    - "Edge case checkpoints in plan manifests prevent Fixer from having to rediscover them"
  evidenceQuality:                       # NEW: Evidence quality retrospective
    overallScore: 87
    agentsWithLowQuality: ["implementor"]
    stalenessIssues: 2
    actionItems:
      - "Add content hashing requirements to Implementor hand-off"
      - "Include exact line numbers in Verifier evidence"
```

### Analysis Prompts (for Orchestrator self-reflection)
After every pipeline, answer:
1. Did I select the right pipeline type? If I had chosen a shorter one, would it have worked?
2. Were my hand-offs clear? Did any agent ask for clarification?
3. Did any agent output contain surprises (good or bad)?
4. Did I skip any verification step that should have been run?
5. What would I do differently next time for a similar task?

### Retrospective Action Items
- If hand-off quality < 7: next pipeline gets more context in hand-offs
- If agent effectiveness "poor" for same agent twice: consider replacing or retraining
- If wasted steps detected: update pipeline selection for similar tasks

## Agent Calibration Database

### Purpose
Track per-agent success rates across sessions to make smarter dispatch decisions. Without calibration, every agent is treated equally regardless of track record.

### Data Structure
Stored in `.opencode/calibration/agents.yaml`. Created on first pipeline, updated after every pipeline.

```yaml
agents:
  finder:
    totalTasks: 12
    successfulTasks: 10
    failedTasks: 2
    avgEffectiveness: "good"
    lastTaskDate: "2026-05-19T10:30:00Z"
    commonFailurePatterns:
      - "Misses files outside src/ directory"
    strengths:
      - "Fast grep-based searches"
  implementor:
    totalTasks: 8
    successfulTasks: 6
    failedTasks: 2
    avgEffectiveness: "good"
    buildRetries: 4
    lintRetries: 2
    lastTaskDate: "2026-05-19T10:30:00Z"
    commonFailurePatterns:
      - "Forgets to update barrel file exports"
    strengths:
      - "Follows plan checkpoints precisely"
  mergeCoordinator:
    totalTasks: 0
    successfulTasks: 0
    failedTasks: 0
    avgEffectiveness: "unknown"
    lastTaskDate: null
    commonFailurePatterns: []
    strengths:
      - "Cross-file import and type signature verification after parallel dispatch"
  plandescriber:
    totalTasks: 5
    successfulTasks: 3
    failedTasks: 2
    avgEffectiveness: "ok"
    behavioralCheckpointsPerPlan: 4.2
    lastTaskDate: "2026-05-19T10:30:00Z"
    commonFailurePatterns:
      - "Omits error handling checkpoints"
  documentor:
    totalTasks: 0
    successfulTasks: 0
    failedTasks: 0
    avgEffectiveness: "unknown"
    lastTaskDate: null
    commonFailurePatterns: []
    strengths:
      - "Automated documentation creation and maintenance"
      - "API docs, inline comments, and ADR generation"
```

### How to Use Calibration
- Before dispatching an agent, check its `failedTasks` / `totalTasks` ratio
- If ratio > 0.33 (33% failure rate): warn the user, ask if they want a different agent
- If `commonFailurePatterns` match the current task's profile: add explicit guardrails in the hand-off
- If agent `avgEffectiveness` is "poor" for 3 consecutive sessions: flag for user review

### Calibration Updates
After each pipeline completes:
1. Read `.opencode/calibration/agents.yaml` (create if missing)
2. Update the agent's counters (totalTasks++, successfulTasks++ or failedTasks++)
3. Update `lastTaskDate`
4. If the retrospective identified issues, append to `commonFailurePatterns`
5. Save the file

### Automated Script
Use the calibration management script to read and update the database:
```bash
# Update agent success/failure
ts-node skills/scripts/orchestration/update-calibration.ts --agent=implementor --success=true --build-retries=2

# Read full calibration report
ts-node skills/scripts/orchestration/update-calibration.ts --read

# Record a failure pattern
ts-node skills/scripts/orchestration/update-calibration.ts --agent=fixer --success=false --failure-pattern="Missing barrel export"
```

The script handles file creation, counter increments, and validation.

### Calibration During Pipeline Execution
During an active pipeline, the Orchestrator uses calibration data BEFORE dispatching:
1. Read `.opencode/calibration/agents.yaml` (via bash glob)
2. If the target agent's `failedTasks / totalTasks > 0.33`, include a warning in the hand-off:
   "Note: This agent has a [X]% failure rate. Previous failures: [patterns]. Consider extra guardrails."
3. If `commonFailurePatterns` match the current task, add explicit guardrails:
   "Prevent [failure pattern] by double-checking [specific area] before reporting completion."
4. After pipeline ends, run the update script to record results.

## Parallel Dispatch Workflow

### Parallelism Verification Protocol (NEW)
Before every parallel dispatch decision, the Orchestrator MUST run the parallelism check script as step 0:

```bash
```

The script's output (SINGLE_FILE, PARALLEL, SEQUENTIAL, HYBRID) is the primary decision driver. Fall back to the manual decision tree only if the script is unavailable.

### Automatic Parallelism Detection (NEW)
Before deciding whether to dispatch tasks in parallel, the Orchestrator runs an automated dependency check:

1. **Collect planned files**: From the plan manifest, extract all target files and their checkpoints
2. **Scan for shared dependencies**: For each pair of files, `grep` for cross-references:
   ```
   grep "from '" src/services/user.ts | grep "types"
   # If file A imports from file B → sequential
   # If no cross-imports → candidates for parallelism
   ```
3. **Check for shared state**: Look for shared global state, module-level variables, or singletons
4. **Decision**: 
   - No shared deps, no shared state → DISPATCH PARALLEL
   - Shared deps but different files → DISPATCH PARALLEL with merge notes
   - Shared state or same file → DISPATCH SEQUENTIAL

### Automated Script
Use the parallelism detection script to get an automated recommendation:
```bash
```

This script reads the manifest, scans files for cross-references using grep/rg, builds a dependency graph using Kahn's algorithm, detects shared state patterns, and outputs a recommendation:
- **SINGLE_FILE**: Single target — no decision needed
- **PARALLEL**: No cross-references — safe to dispatch simultaneously
- **SEQUENTIAL**: Chain dependency detected — must run one phase after another
- **HYBRID**: Multi-phase with parallel groups within each phase

Run this script before making parallelism decisions. Fall back to the decision tree below if the script is unavailable.

### Decision Tree (fallback when script is unavailable)
Before dispatching parallel tasks, answer these questions in order:

1. **Are the sub-tasks truly independent?**
   - Do they operate on different files? → Yes/No
   - Do they have no output dependencies on each other? → Yes/No
   - Can they be verified independently? → Yes/No
   - If ALL YES → Proceed to question 2. If ANY NO → Dispatch sequentially.

2. **Will parallel execution cause merge conflicts?**
   - Will multiple agents write to the same file? → If YES, dispatch sequentially unless using a Merge Coordinator
   - Will one agent's output change the API contract another depends on? → If YES, dispatch sequentially

3. **What's the complexity of each sub-task?**
   - Simple (< 5 files each) → safe to parallelize
   - Complex (> 5 files each) → may benefit from sequential focus

### Example: Parallel Dispatch
```markdown
Orchestrator to Implementor (instance 1):
"Create src/types/user.ts with User and CreateUserDto interfaces."

Orchestrator to Implementor (instance 2):
"Create src/services/user.ts with UserService class."

Orchestrator to Implementor (instance 3):
"Create src/controllers/user.ts with UserController class."
```

When all 3 return, check:
- Imports between files reference the correct paths
- Types used in services match types defined in types file
- Controller methods match service method signatures

### Automated Dispatch Manifest Generation (NEW)
```bash
ts-node skills/scripts/orchestration/parallel-dispatch.ts --manifest=plan-manifests/<feature>/v<version>-manifest.json --pipeline-id=<id>
```

This creates per-phase dispatch manifests at `.opencode/dispatch/<pipelineId>/phase-<N>.json` with:
- File-level checkpoint breakdown
- Agent instructions
- Phase dependency ordering
- Post-phase actions (mergeAfter, integrateAfter)

Use `--dry-run` to preview, `--plan` for human-readable output, and `--verify` for consistency checking.

### Merge Coordinator Protocol

After dispatching parallel Implementors (multiple instances writing to independent files), the Orchestrator dispatches the **Merge Coordinator** before the Build Gate:

#### Workflow
```
Parallel Implementors ──► Merge Coordinator ──► Build Gate
```

#### What the Merge Coordinator Checks
1. **Import Path Verification**: Every `from '...'` import in every changed file → target file exists
2. **Type Signature Alignment**: Imported function/class names match exported names in target files
3. **Interface Contract Verification**: Parameter count consistency between callers and callees
4. **Re-export Completeness**: Barrel files (`index.ts`) re-export everything from parallel-created modules

#### Handling Issues
| Merge Coordinator Result | Action |
|-------------------------|--------|
| ✅ All consistent | Proceed to Build Gate |
| ⚠️ Warnings only | Proceed to Build Gate, note in warnings |
| ❌ Blocking issues | Report to Implementor or Fixer, fix, re-run Merge Coordinator |

#### When to Skip
- **Single Implementor**: No parallel dispatch → no merge coordination needed
- **Trivial changes**: One-file changes don't need cross-file checks
- **Obvious independence**: Types file + service file with no interdependency → still run Merge Coordinator (it's fast)

#### Hand-off Format
```
Orchestrator to Merge Coordinator:
"After parallel dispatch of Implementors, the following files were created:
- src/types/user.ts (by Implementor instance 1)
- src/services/user.ts (by Implementor instance 2)
- src/controllers/user.ts (by Implementor instance 3)

Agent context: agent-context.md (read for full agent history and changedFiles)

Please verify cross-file consistency: check imports resolve, type signatures match, and all interfaces are properly connected."
```

## Agent Context (`agent-context.md`)

The Orchestrator maintains a **single unified state file** at `agent-context.md` in the workspace root. This file merges the former `agent-context.md` (pipeline history) and `agent-status.json` (circuit breaker + failure summaries) into one source of truth.

### Canonical Schema Reference
For the complete schema definition, field types, validation rules, and lifecycle, see:
📄 `skills/orchestration/references/agent-context-schema.md`

### Purpose
- **Single source of truth**: No split-brain between two files — circuit breaker state, agent history, git state, and failure summaries live in one place.
- **State preservation**: Each agent knows what was done before them, what the circuit breaker state is, and what's expected next.
- **Cycle-back memory**: When Fixer or other agents cycle back, they see the full attempt history and failure context.
- **Cross-agent consistency**: All agents read the same unified state — no sync issues.

### Format
The file uses YAML frontmatter (machine-readable) + Markdown body (human-readable):

```yaml
---
# ── Pipeline Identity ──
pipelineId: "uuid-or-timestamp"
feature: "user-profile"
pipelineType: "full"
currentStep: "fixer"
status: "running"
createdAt: "2025-05-19T10:00:00Z"

# ── Agent History (append-only) ──
agentHistory:
  - step: "finder"
    agent: "ses_xxx"
    result: "completed"
    summary: "Found existing User model at src/models/user.ts"
    decisions:
      - what: "Chose Zod over Joi for input validation"
        why: "Already in dependency tree"
        by_who: "finder"
    warnings:
      - "src/models/user.ts uses `any` type for email field"
    changedFiles: []
    artifacts:
      - "Exploration report"

  - step: "planDescriber"
    agent: "ses_yyy"
    result: "completed"
    summary: "Created roadmap: 3 phases, 8 steps"
    decisions:
      - what: "Split into 3 phases (model, service, controller)"
        why: "Clear dependency ordering"
        by_who: "planDescriber"
    warnings: []
    changedFiles:
      - "plan-manifests/user-profile/v1-manifest.json"
    artifacts:
      - "Roadmap"
      - "plan-manifests/user-profile/v1-manifest.json"

  - step: "implementor"
    agent: "ses_zzz"
    result: "completed"
    summary: "Created src/services/user.ts, src/controllers/user.ts"
    decisions: []
    warnings:
      - "TypeScript strict mode not enabled"
    changedFiles:
      - "src/services/user.ts"
      - "src/controllers/user.ts"
    artifacts:
      - "src/services/user.ts"
      - "src/controllers/user.ts"

# ── Agent Output Contract Data ──
agentOutputs:
  finder:
    status: "completed"
    resultSummary: "Found existing User model"
    buildPassed: null
    lintPassed: null
  implementor:
    status: "completed"
    resultSummary: "Created user service and controller"
    buildPassed: true
    lintPassed: true
    buildOutput: "[full stdout + stderr]"
    lintOutput: "[full stdout + stderr]"

# ── Circuit Breaker State ──
circuitBreaker:
  state: "closed"
  counters:
    build: 0
    lint: 0
    securityScan: 0
    smokeTest: 0
    verifier: 0
  thresholds:
    build: 3
    lint: 3
    securityScan: 3
    smokeTest: 3
    verifier: 3

# ── Git State ──
gitState:
  branch: "feature/user-profile"
  dirtyFiles: []
  lastCommitSha: "abc123def456"

# ── Next Objective ──
nextObjective: "Fix Verifier deviations (CP-003, CP-007)"
---
```

### Lifecycle
1. **Created** by Orchestrator at pipeline start (via `pipeline-init.ts`)
2. **Updated** before each agent hand-off with `nextObjective` and relevant artifacts
3. **Updated** with `pipelineHeartbeat` timestamp every time the file is written (enables stale detection)
4. **Read** by each agent at startup (step 0 in their workflow)
5. **Appended** by Orchestrator after each agent completes (add to `agentHistory`, update `circuitBreaker`, update `agentOutputs`)
6. **Archived** when the pipeline ends (by `pipeline-teardown.ts` — writes to `.opencode/pipeline-logs/`)
7. **Deleted** after archival (by `pipeline-teardown.ts`)

**Stale Context Detection**: If `agent-context.md` exists with `status: "running"` and `createdAt` is more than 1 hour old:
- The pipeline is considered STALE (crashed/interrupted mid-pipeline)
- The Orchestrator MUST detect this in the pre-flight check (`pipeline-init.ts` already checks this)
- The Orchestrator MUST prompt the user before overwriting or cleaning up
- If the user approves cleanup: archive the stale context to `.opencode/pipeline-logs/stale-<pipelineId>/`, then proceed with a fresh pipeline

## Pipeline Selection Protocol

### Task Type Classification
When the user makes a request, classify it into one of these pipeline types:

| Task Type | Description | Pipeline | Skip Finder? |
|-----------|-------------|----------|--------------|
| **New Feature (known)** | Adding a new feature in a familiar domain | Full or Standard | Yes, if domain is well-understood |
| **New Feature (unknown)** | Adding a new feature in an unfamiliar domain | Full | No |
| **Bug Fix (known cause)** | Fixing a bug with identified root cause | Fixer → QA → Verifier | Yes |
| **Bug Fix (unknown cause)** | Investigating and fixing a bug | Finder → Fixer → QA → Verifier | No |
| **Research** | Understanding existing code, exploring options | Finder only | N/A |
| **Refactor** | Restructuring without changing behavior | PlanDescriber → Implementor → Security → QA → Verifier | Yes |
| **Config Change** | Simple config or dependency changes | Implementor only | Yes |
| **Security Fix** | Patching a vulnerability | Implementor → Security Scan → QA → Verifier | Yes |
| **UI Bug** | Visual or behavioral bug in frontend | Browser Tester → Fixer → QA | Yes (if root cause known) |
| **Quick Fix** | One-line fix, config change, typo | Ultra-Quick: Implementor → Build | Yes |
| **Small Feature** | Small feature with known domain | Quick: Implementor → Build → Lint → QA | Yes |
| **Parallel Feature** | Feature with independent sub-components | Implementor (parallel) → Merge Coordinator → Build → Lint → Security → QA → Verifier | Yes |
| **New Feature (TDD)** | Adding a tested feature with tests written first | PlanDescriber → QA (tests) → Implementor → Build → Lint → Security → Verifier | Yes |
| **Micro-Pipeline** | Feature with clear frontend/backend split | Parallel PlanDescriber(frontend+backend) → Parallel Implementor → Merge QA → Verifier | No (needs Finder to identify split) |
| **Documentation** | Updating docs, README, API docs, or inline comments | Documentor → report to user | Yes |

### Calibration-Conscious Pipeline Selection

Before selecting a pipeline type, check historical accuracy for the task type:
1. Read `.opencode/calibration/agents.yaml` via the calibration script
2. Look up `pipelineSelectionAccuracyByType[taskType]`
3. If accuracy exists and is < 80%, warn the user:
   "My historical accuracy for [taskType] tasks is [X]%. Consider a different pipeline type or manual review."
4. If no history for this task type, fall back to the default lookup table

### When to Load Skills
| Pipeline Step | Skill to Load | Why |
|---------------|---------------|-----|
| Brainstorming | `plan-brainstorm` | Structured option exploration |
| Plan Describer | `plan-describe` + `code-philosophy` | Comprehensive roadmap creation |
| Implementation | `code-philosophy`, `backend-code-philosophy`, `frontend-code-philosophy` | Code quality adherence |
| Implementation | `accessibility` | When building UI components |
| Security Scan | security-scan (auto-loads semgrep-scan skill) | SAST via semgrep + dependency scanning + secrets + shared security patterns |
| QA | `quality-assurance` | Testing methodology and reporting |
| Verification | `plan-verification` | Plan compliance checking |
| Browser Testing | `playwright-cli` | Browser automation |
| Documentation | `api-documentation` | README, API docs, inline comments, ADRs |
| Pre-Flight | `smart-finder` | Cross-session journal search + proactive hazard detection |

### Agent Health Monitoring (NEW)

The system tracks agent health across sessions to automatically flag underperforming agents.

**Health Flags File**: `.opencode/calibration/agents.yaml`

| Status | Condition | Action |
|--------|-----------|--------|
| 🟢 GREEN | Success rate > 85% | Normal dispatch |
| ⚠️ YELLOW | 3+ consecutive task failures | Warn user before dispatch |
| 🔴 RED | 5+ consecutive failures OR > 40% failure rate | Block dispatch until user confirms |

**Automatic Flagging**: After each pipeline completes, the calibration update script evaluates agent health and sets the flag. The Orchestrator reads this before dispatching.

**User Prompt on RED**: "Agent [name] has a [X]% failure rate and [Y] consecutive failures. Consider: (a) continue anyway, (b) switch to an alternative approach, (c) abort the pipeline."

### Minimal Pipeline Rule
Always select the shortest pipeline that can safely complete the task. Every extra agent adds latency and potential for error. When in doubt, ask the user.

Documentation updates: Use Documentor only — no plan, no tests, no verification. This is the shortest possible pipeline.

### Quick Pipeline Presets

For faster iteration on simple tasks, use these minimal pipelines:

| Pipeline Type | Steps | When to Use | Includes Documentor? |
|--------------|-------|-------------|---------------------|
| **Ultra-Quick** | Implementor → Build | Typo fixes, one-line changes, config edits, package.json updates | ❌ No |
| **Quick** | Implementor → Build → Lint → QA | Small bug fix with known cause, trivial feature addition | ❌ No |
| **Review** | Implementor → Build → Lint → Security → QA | Small feature that needs the safety net but no plan needed | ❌ No |
| **Standard** | PlanDescriber → Implementor → Build → Lint → Security → QA → Verifier → Documentor | New feature in a familiar domain | ✅ Yes |
| **Full** | Finder → Brainstorm → PlanDescriber → Implementor (parallel) → Merge Coordinator → Build → Lint → Security → QA → Verifier → Documentor | New feature in unfamiliar domain, complex changes, or parallel sub-tasks | ✅ Yes |
| **Fixer-Only** | Fixer → Build → Lint → Test → QA → Verifier | Bug with known root cause | ❌ No |
| **Research** | Finder → report to user | Understanding code, exploring options | ❌ No |
| **Docs** | Documentor → report to user | Documentation only | N/A |


> **Note**: All pipelines that include both `QA` and `Verifier` implicitly include the **Security Test Coverage Gate** between them. QA reports `securityTestCoverage`, the Orchestrator validates ≥ 80% coverage, and Verifier cross-checks during Pass 2.6. See the [Security Test Coverage Gate](#security-test-coverage-gate-new) section for full details.
**Selection Rule**: Always choose the shortest viable pipeline. The Orchestrator should ask: "Can this task be done with an Ultra-Quick pipeline?" If yes, use it. If the task proves more complex mid-pipeline, escalate to the next level.

## Plan Manifest Versioning

### Naming Convention
Store manifests under `plan-manifests/<feature>/v<version>-manifest.json`:
- `plan-manifests/user-profile/v1-manifest.json`
- `plan-manifests/user-profile/v2-manifest.json`

### Version Rules
- Start at `v1` for the initial roadmap creation
- On revision (e.g., after Verifier fails and Orchestrator requests re-plan), increment to `v2`, `v3`, etc.
- **Never overwrite a previous version** — always create a new numbered version
- Each manifest's `manifestVersion` field must match the file version number

### Why Version?
Versioning preserves a history of what the plan looked like at each iteration. When the Verifier runs manifest diffing (Pass 3), it can compare v1 against v2 to show exactly what changed between iterations.

## Coverage Analysis

QA's coverage analysis is a mandatory gate. After smoke test passes, QA runs coverage analysis.

### Coverage Thresholds
| Project Type | Minimum Line Coverage | Critical Paths (auth, payment) |
|--------------|----------------------|--------------------------------|
| Library      | 70%                  | 90%                            |
| Application  | 60%                  | 85%                            |
| Prototype    | 40% (informational)  | N/A                            |

### Coverage Analysis Protocol
- Run the appropriate coverage tool for the project stack
- Parse the report to identify uncovered lines and files
- Include coverage data in the QA report's Quality Metrics section
- If coverage is below threshold, the Orchestrator decides whether to:
  - Add tests to raise coverage (delegate to Implementor or Fixer)
  - File an exception (for prototypes or low-risk areas)
  - Block the pipeline

### Coverage Auto-Loop (NEW)
When coverage is below the minimum threshold, instead of asking the user, the Orchestrator runs an automated coverage improvement loop:

1. QA reports coverage percentage and lists uncovered files/lines
2. If coverage >= threshold → proceed normally
3. If coverage < threshold → Orchestrator dispatches Implementor with a focused task:
   "Add tests for uncovered lines in [file list] to reach [threshold]% coverage. Focus on: [uncovered lines]."
4. Implementor writes the tests and reports completion
5. Re-run QA coverage analysis
6. Loop until: coverage >= threshold (success) OR 3 attempts exhausted (failure)
7. If 3 attempts fail → escalate to user with summary of attempted coverage gains

### Reporting Format
| File                 | % Coverage | Uncovered Lines | Risk   |
|----------------------|------------|-----------------|--------|
| src/services/user.ts | 85%        | 45-48, 102      | Medium |
| **Coverage Summary** | **72%**    | **12 uncovered** | **⚠️ Below threshold (70%)** |

## Expanded Verification Scope (Verifier Pass 3)

When the Verifier achieves 100% compliance on Pass 1 + Pass 2, or when explicitly requested by the Orchestrator, perform additional cross-cutting consistency checks:

### Pass 3 — Cross-cutting Checks
- **Naming Convention Consistency**: Verify files follow project naming conventions (PascalCase for classes/components, camelCase for functions/variables)
- **Import Style Consistency**: Check that imports are grouped consistently (external first, then internal) and use consistent module resolution
- **Error Handling Pattern Consistency**: Verify that error handling is consistent across similar files (e.g., all repository methods use `try/catch` with `logger.error`)
- **Export Pattern Consistency**: Check that exports use a consistent style (named exports preferred, no mixed default/named in the same module)

### Pass 4 — Completeness Check
- **File Completeness**: Compare the list of files the plan said would be created/modified against actual git diff
- **Scope Creep Detection**: Verify no extra files were created beyond what the plan specified
- **Deletion Check**: Verify no files were deleted without plan authorization

### Verifier Scope Boundary
All Verifier suggested checkpoints have a `scope` field:

| Scope | Source | Effect on Pipeline |
|-------|--------|--------------------|
| `manifest` | From the plan manifest | FAILURE reduces compliance score; can block pipeline |
| `suggested` | Auto-detected (security, patterns) | FAILURE is informational; does NOT reduce compliance score |

Only `scope: "manifest"` checkpoints count toward the 80% compliance threshold. `scope: "suggested"` findings are reported to the Orchestrator as warnings but do not block the pipeline.

## Failure Summary Format

When the circuit breaker opens (retry threshold reached), the Orchestrator produces a structured failure summary in `agent-context.md`'s YAML frontmatter under the `failureSummary` field:

```json
{
  "feature": "user-profile",
  "pipelineType": "full",
  "failedStep": "verifier",
  "attempts": 3,
  "rootCause": {
    "primary": "PlanDescriber omitted error handling checkpoint for duplicate email scenario",
    "contributing": [
      "Implementor followed plan exactly but plan was incomplete",
      "Fixer attempted fix 3 times but kept missing the root cause because the plan never specified the error scenario"
    ]
  },
  "attemptsLog": [
    { "attempt": 1, "agent": "implementor", "result": "build pass, verifier 72%", "fix": "added validateEmail export" },
    { "attempt": 2, "agent": "fixer", "result": "build pass, verifier 82%", "fix": "added error handling for createUser" },
    { "attempt": 3, "agent": "fixer", "result": "build pass, verifier 78%", "fix": "added additional error cases" }
  ],
  "recommendedAction": "Revise plan to add explicit error handling checkpoints for all user service methods",
  "circuitBreakerState": {
    "build": 0,
    "lint": 0,
    "securityScan": 0,
    "smokeTest": 0,
    "verifier": 3
  }
}
```

### When to Produce
- After any gate fails and reaches 3 attempts
- Written to `agent-context.md`'s YAML frontmatter under the `failureSummary` field
- Also presented to the user as a structured markdown report (not raw JSON)

### User Report Format
```markdown
## ⚠️ Pipeline Failure: user-profile

| Field | Value |
|-------|-------|
| Feature | user-profile |
| Pipeline | full |
| Failed Step | verifier (3 attempts) |
| Attempts | 3 |

### Root Cause Analysis
**Primary**: PlanDescriber omitted error handling checkpoint for duplicate email scenario.
**Contributing**: Implementor followed plan exactly but plan was incomplete.

### Attempts Log
1. **Implementor**: build pass, verifier 72% — added validateEmail export
2. **Fixer**: build pass, verifier 82% — added error handling for createUser
3. **Fixer**: build pass, verifier 78% — added additional error cases

### Recommended Action
Revise the plan to add explicit error handling checkpoints for all user service methods.

### Next Steps
I'll escalate to PlanDescriber for a roadmap revision. After the plan is updated, we'll retry implementation. Shall I proceed?
```

### Standardized Error Format

All agents should report failures using this structured format for consistent parsing:

```yaml
errors:
  - code: "BUILD_FAILED"
    step: "npm run build"
    details: "TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'"
    file: "src/services/user.ts"
    line: 47
    severity: "error"        # error | warning
```

| Field | Required | Description |
|-------|----------|-------------|
| `code` | ✅ | Machine-readable error code (SCREAMING_SNAKE_CASE) |
| `step` | ✅ | The pipeline step that produced the error (e.g., "npm run build", "eslint src/", "QA smoke test") |
| `details` | ✅ | Human-readable error message with context |
| `file` | ❌ | File path where the error occurred (if applicable) |
| `line` | ❌ | Line number in the file (if applicable) |
| `severity` | ✅ | "error" (blocking) or "warning" (non-blocking) |

**Common error codes**:
| Code | Meaning |
|------|---------|
| `BUILD_FAILED` | TypeScript/Webpack/Vite compilation error |
| `LINT_FAILED` | ESLint/Prettier style violation |
| `TEST_FAILED` | Unit/integration test assertion failure |
| `SMOKE_FAILED` | Application failed to start/boot |
| `SECURITY_HIGH` | npm audit High severity vulnerability |
| `SECURITY_CRITICAL` | npm audit Critical severity vulnerability |
| `SECRETS_FOUND` | Hardcoded credentials detected |
| `VERIFIER_LOW_SCORE` | Compliance score below 80% threshold |
| `IMPORT_MISMATCH` | Cross-file import path or symbol mismatch |
| `TYPE_MISMATCH` | Type signature mismatch between modules |
| `MISSING_EXPORT` | Expected export not found in module |

---

## Agent Output Contract

Every subagent MUST return structured output in this format within their final report to enable the Orchestrator to programmatically update `agent-context.md`.

### Standard Output Schema
Every agent's final report to the Orchestrator MUST contain a structured code block at the top:

```
---
status: "completed" | "failed" | "partial"
resultSummary: "2-3 sentence summary of what was accomplished"
agentOutputs:
  <agent-name>:
    status: "completed" | "failed" | "partial"
    resultSummary: "Brief summary"
    buildPassed: true | false | null
    lintPassed: true | false | null
    buildOutput: "Full stdout + stderr" | null
    lintOutput: "Full stdout + stderr" | null
decisions:
  - what: "Decision description"
    why: "Rationale"
    by_who: "<agent-name>"
warnings:
  - "Non-blocking issue"
changedFiles:
  - "path/to/file.ts"
artifacts:
  - "Description of artifact"
---
```

### Per-Agent Responsibility

| Agent | Must Report `buildPassed`/`lintPassed`? | Must Report `decisions`? | Must Report `changedFiles`? | Must Report Enhanced Fields? |
|---|---|---|---|---|
| **Finder** | No (read-only) | Yes (exploration direction) | No | Yes — `knowledgeGraph` (entities, relationships, hazards) |
| **PlanDescriber** | No | Yes (architectural decisions) | Yes (plan manifest) | Yes — `confidence` in plan phases |
| **Implementor** | Yes (mandatory) | No | Yes (all files written) | Yes — `selfReview` (confidence, preCheckPassed, scopeGuardFlags) |
| **QA** | No | Yes (test decisions) | Yes (test files created/modified) | Yes — edge cases tested, non-functional issues, regression impact |
| **Verifier** | No (read-only) | No | No | Yes — `suggestedCheckpoints`, `driftDetection` |
| **Fixer** | Yes (mandatory) | Yes (root cause classification) | Yes (files modified) | Yes — `rootCauseAnalysis` (classification, primaryCause, contributingFactors, fixApplied, fixConfidence, crossModuleCheck) |
| **Browser Tester** | No | No | Yes (test scripts, screenshots) | No |
| **Merge Coordinator** | No | Yes (merge decisions) | No | Yes — import scan results, cross-file consistency report |
| **Documentor** | No | Yes (documentation format/structure decisions) | Yes (documentation files created/modified) | No |

## Smart Finder Protocol

The Finder agent operates in "Smart" mode with these enhanced capabilities:

### 1. Proactive Hazard Detection
While exploring the codebase for the requested information, the Finder automatically flags:
- **Dead code**: Unused exports, uncalled functions, orphaned modules
- **Deprecated APIs**: Usage of deprecated libraries, methods, or patterns
- **Security anti-patterns**: `eval()`, `innerHTML`, hardcoded secrets
- **Missing error handling**: Functions that can throw but aren't wrapped
- **Type safety issues**: `any` types, missing null checks, implicit `any`

These are returned as "incidental findings" alongside the primary exploration report.

### 2. Structured Knowledge Graph Output
The Finder returns findings in a structured format that the Orchestrator can programmatically use:

```
---
status: "completed"
resultSummary: "Found 3 entry points, traced 2 data flows, detected 1 hazard"
agentOutputs:
  finder:
    status: "completed"
    resultSummary: "Found entry points and data flows"
---
### Knowledge Graph
entities:
  - name: "UserService"
    type: "class"
    file: "src/services/user.ts"
    exports: ["UserService", "createUser", "getUser"]
  - name: "UserController"
    type: "class" 
    file: "src/controllers/user.ts"
    exports: ["UserController"]
relationships:
  - from: "UserController"
    to: "UserService"
    type: "imports"
    details: "UserController imports and calls UserService methods"
  - from: "UserService"
    to: "UserModel"
    type: "imports"
    details: "UserService uses UserModel for database operations"
entryPoints:
  - path: "src/index.ts"
    type: "server"
    description: "Express app entry point"
dataFlows:
  - route: "POST /api/users"
    chain: "UserController.createUser → UserService.createUser → UserModel.save"
hazards:
  - file: "src/services/user.ts"
    line: 42
    type: "security"
    severity: "medium"
    description: "User input passed directly to database query without sanitization"
```

### 3. Context-Aware Depth
- In unfamiliar code areas (no git history or low test coverage): Explore deeply (trace 3+ levels of imports)
- In well-known modules (frequently committed, high test coverage): Stay shallow (1 level)
- Signal = git log frequency + test file existence + last modified date

### Familiarity Scoring (NEW)
The Orchestrator computes module familiarity scores during pipeline initialization and passes them to the Finder:

| Score Range | Meaning | Exploration Depth |
|-------------|---------|-------------------|
| 1-4 | Unknown/new module (< 5 commits, no tests) | Deep (3+ levels of imports) |
| 5-7 | Moderate activity (5-20 commits, some tests) | Moderate (2 levels) |
| 8-10 | Well-known (20+ commits, test suite exists) | Shallow (1 level) |

The score is computed by `computeFamiliarityScore()` in `pipeline-init.ts` based on:
- Git commit frequency on the module path
- Presence of test files (`.test.*`, `.spec.*`)

The Finder uses this score to decide how deep to explore.

---

## Self-Reviewing Implementor Protocol

The Implementor operates with a mandatory self-review cycle:

### 1. Pre-Implementation Validation
Before writing any code, the Implementor MUST:
1. Read the full plan roadmap and plan-manifest.json
2. Identify any gaps or contradictions in the checkpoints
3. Check: "Do I have enough context to implement this?" If not, report back with specific questions
4. Verify that the target files don't already exist with conflicting content
5. Report an "implementation readiness" status before proceeding

### 2. Self-Review Pass
After implementing all code changes, the Implementor runs a self-review:
1. Re-read its own code against each plan checkpoint
2. Score itself: "I am X% confident this matches the plan"
3. If self-confidence < 90%: re-read the plan and fix discrepancies before reporting
4. If self-confidence >= 90%: report completion with confidence score

### 3. Scope Guard
The Implementor actively resists scope creep:
- If the user's or Orchestrator's prompt mentions functionality NOT in the plan, the Implementor MUST flag it:
  "The prompt mentions feature X, but the plan does not include it. Should I implement it anyway or stick to the plan?"
- The Implementor does NOT implement unplanned features without explicit Orchestrator confirmation
- If a change would affect files outside the plan's scope, flag before proceeding

### 4. Self-Review Output
The Implementor includes in its output:

```
selfReview:
  confidence: 95
  preCheckPassed: true
  preCheckNotes: "All checkpoints are consistent. No conflicting files found."
  scopeGuardFlags: []
  selfReviewIssues:
    - "Checkpoint CP-005 (handlesError for createUser): Error handling present but uses console.error instead of logger.error. Acceptable since logger import wasn't specified in plan."
  buildPassed: true
  lintPassed: true
  buildOutput: "[excerpt]"
  lintOutput: "[excerpt]"
```

---

## Root Cause Classifier (Fixer Protocol)

When the Fixer receives a bug report or Verifier deviation, it MUST classify the root cause before applying any fix:

### Root Cause Taxonomy

| Category | Definition | Example | Escalation Path |
|----------|-----------|---------|----------------|
| **plan-omission** | The plan didn't specify this behavior | "Plan had no checkpoint for handling duplicate email" | Escalate to PlanDescriber after 2nd occurrence |
| **implementation-error** | The code doesn't match the plan spec | "Method signature doesn't match plan" | Fix and continue in current pipeline |
| **edge-case-miss** | The plan covered it but the implementation missed an edge case | "Function works for valid input but fails on empty string" | Fix and add test for edge case |
| **integration-mismatch** | Two modules don't agree on interface | "Service returns User but controller expects UserDTO" | Fix the interface contract |
| **environment-issue** | Build/lint/tooling problem | "TypeScript strict mode catches type error that wasn't in plan" | Fix config or code |

### Fix Confidence Score
After applying a fix, the Fixer reports:
- **Confidence level**: 1-10
  - 8-10: "Highly confident — fix addresses root cause, cross-module check passed"
  - 5-7: "Moderately confident — fix addresses symptoms, root cause may be deeper"
  - 1-4: "Low confidence — fix is a workaround, root cause may be elsewhere"
- **Cross-module check**: Did the fix break anything in other modules?
  - Use `grep` to find files that import/modify the same symbols
  - Run affected module's tests if available
  - Report: "Cross-module check: [module X] unaffected, [module Y] may need review"

### Fixer Output with Classification (inside structured output block)
The Fixer includes `rootCauseAnalysis` inside the `---` structured output block, NOT as a separate section:

```
---
status: "completed"
resultSummary: "Fixed 2 deviations: CP-003 and CP-007"
agentOutputs:
  fixer:
    status: "completed"
    resultSummary: "Fixed duplicate email handling in createUser"
    buildPassed: true
    lintPassed: true
    buildOutput: "[full stdout + stderr]"
    lintOutput: "[full stdout + stderr]"
    rootCauseAnalysis:
      classification: "implementation-error"
      primaryCause: "createUser method didn't handle the case where email is already registered"
      contributingFactors:
        - "Plan checkpoint CP-005 specified try/catch but didn't specify which errors to catch"
      fixApplied: "Added duplicate email check before insert"
      fixConfidence: 8
      crossModuleCheck:
        - module: "src/controllers/user.ts"
          status: "unaffected"
        - module: "src/routes/userRoutes.ts"
          status: "unaffected"
decisions: []
warnings:
  - "No side effects detected in cross-module check"
changedFiles:
  - "src/services/user.ts"
artifacts:
  - "Fixer report with root cause analysis, fix description, build/lint output"
---

## Output Verification

### Structured Output Enforcement
Every subagent output MUST be validated against the structured output contract before the Orchestrator considers the task complete. Use the validation script:

```bash
# Validate a single agent output file
ts-node skills/scripts/orchestration/validate-output-contract.ts --file=<path-to-agent-output>

# Validate all agent outputs in agent-context.md
ts-node skills/scripts/orchestration/validate-output-contract.ts --pipeline

# Check against a specific agent schema
ts-node skills/scripts/orchestration/validate-output-contract.ts --agent=fixer
```

The validator checks:
1. YAML frontmatter is parseable
2. All required fields are present for the agent type
3. Field types are correct (boolean, string, array, null)
4. Enhanced fields (rootCauseAnalysis, selfReview, knowledgeGraph) match their schemas

### Rejection Protocol
If validation fails (exit code != 0):
1. **Reject the output**: Do NOT update `agent-context.md` with invalid data
2. **Report to agent**: Send the validation errors back to the agent with clear instructions on what's missing
3. **One retry**: Allow the agent one attempt to fix the output format
4. **Escalate**: If the agent fails to produce valid output twice, report to user

### Orchestrator Verification Steps
After receiving a valid agent output, the Orchestrator MUST:
1. Parse the structured output fields from the agent's report
2. Cross-reference `changedFiles` against actual disk state (using read/glob/grep)
3. Cross-reference `buildPassed`/`lintPassed` against raw output excerpts
4. Append the agent's results to `agentHistory` in `agent-context.md`
5. Update `circuitBreaker.counters` if the gate failed
6. Update `agentOutputs.<agent-name>` with the structured data
7. Save the updated `agent-context.md` with fresh `pipelineHeartbeat`
8. **Validate agent output contract (NEW)**: Run `ts-node skills/scripts/orchestration/validate-output-contract.ts --agent-context=agent-context.md` to programmatically verify that each agent's structured output claims match reality (files exist, build/lint claims are consistent with output text, no path traversal in claimed paths)

### Automated Output Contract Validation (NEW)
After every agent hand-off, the Orchestrator MUST run automated output contract validation as a gate:

1. After the agent returns its structured output, immediately run:
   ```bash
   ts-node skills/scripts/orchestration/validate-output-contract.ts --pipeline
   ```
2. If exit code is 0 (valid): Proceed — all output fields are correctly formatted
3. If exit code is not 0 (invalid):
   - **Reject the output**: Do NOT update `agent-context.md`
   - **Send errors back**: Include the validation error messages in the hand-off
   - **One retry**: Allow the agent one attempt to fix the output format
   - **Escalate**: If the agent fails twice, report to the user with the validation failures
4. This validation is MANDATORY and cannot be skipped

## Orchestrator as Brainstormer

The Orchestrator serves as the **primary brainstorming partner** for the user. This is by design:

### Why the Orchestrator handles brainstorming
- **Real-time interaction**: The Orchestrator can have a live back-and-forth conversation with the user
- **Immediate iteration**: Ideas can be explored, rejected, or refined on the fly
- **Context retention**: The Orchestrator holds all project context and can connect brainstorming to execution seamlessly

### Workflow
1. Orchestrator brainstorms **interactively** with the user
2. Orchestrator formalizes the plan and proceeds to delegation

## Agent Timeout & Circuit Breaker

### Timeout Policy
- Each agent task should complete within a reasonable timeframe
- The Orchestrator monitors task duration and may abort tasks that exceed expected time
- If a subagent times out, the Orchestrator restarts the task with a fresh agent session
- Repeated timeouts (> 2) for the same task indicate a deeper issue — escalate to PlanDescriber

### Circuit Breaker Pattern
The system includes a circuit breaker to prevent infinite agent loops:

| State | Meaning | Action |
|---|---|---|
| **Closed** | Normal operation | Agents execute as normal |
| **Open** | Repeated failures detected | Orchestrator pauses cycling to the same agent for the same issue |
| **Half-Open** | Probation period | Orchestrator allows one retry to test if the issue is resolved |

### Escalation Limits
- **Same bug reappears**: 3 Fixer attempts → escalate to PlanDescriber for roadmap revision
- **Same agent fails consecutively**: 3 failures → Orchestrator pauses that agent path and reviews manually
- **Verifier score < 80%**: 3 Fixer re-verification failures → escalate to PlanDescriber for roadmap revision
- **Security Scan fails**: 3 attempts → escalate to user for direction
- **Total pipeline retries**: If total retries across all gates exceed 5, Orchestrator pauses and reports to user

### Circuit Breaker Workflow
```
1. Agent task fails (build, lint, smoke test, security scan, or verification)
2. Orchestrator records the failure in a counter for that specific check
3. If counter < threshold (3), Orchestrator cycles back:
   - Build/lint failures → cycle to Implementor
   - QA smoke test failures → cycle to Fixer
   - Verifier deviations → cycle to Fixer
   - Security scan failures → cycle to user for direction
4. If counter >= threshold, Orchestrator opens the circuit:
   a. Pauses further retries for that specific check
   b. Escalates to PlanDescriber if the root cause is plan-related
   c. Escalates to Fixer if code-related (with root cause analysis)
   d. Reports to user with failure summary and escalation decision
5. After PlanDescriber revises the plan, Orchestrator resets the circuit (Half-Open)
6. One retry is allowed — if it passes, circuit closes; if it fails, circuit opens again
```

### Counter Reset & Decay
Circuit breaker counters are reset when:
- The task passes the gate successfully
- PlanDescriber revises the roadmap
- Fixer successfully resolves the root cause
- The Orchestrator manually resets after user intervention

**Counter Decay**: Counters auto-decay by 1 every 24 hours (computed at pipeline start by reading `circuitBreaker.lastFailure.timestamp`).
- This prevents stale failures from accumulating across different features
- The total-pipeline-retry counter has NO decay (it's a global safety limit)
- Decay is computed by the Orchestrator at pipeline start: if `lastFailure` is > 24h old, decrement the counter (min 0)

**When decay meets threshold**: If a counter decays from 2 to 1 overnight but the same checkpoint fails again, the counter goes to 2 again (not 3). This means the agent gets one more attempt than it would without decay — fair because the first failures were on a different feature.

### Security-Specific Thresholds (NEW)
The circuit breaker now supports security-specific contextual thresholds:

| Pipeline Profile | securityScan Threshold | Supply Chain Threshold | evidenceQuality Threshold | Description |
|-----------------|----------------------|----------------------|--------------------------|-------------|
| Standard | 3 | 1 | 3 | Default for most features |
| Sensitive (auth, payments, PII) | 3 | 3 | 3 | More lenient — supply chain issues can be fixed |
| Infrastructure | 3 | 3 | 3 | Security-critical config changes |
| Security Fix | 3 | 3 | 3 | Fixes for known vulns — chain issues expected |

The security profile is set based on the feature type in the pipeline selection:
- Features touching auth, payment, PII, or security → "Sensitive"
- Config/deployment changes → "Infrastructure"
- Security vulnerability fixes → "Security Fix"
- All others → "Standard"

---

## Context Window Budgeting

### Problem
Long pipelines accumulate massive context: every agent's full output, build logs (often 1000+ lines), lint output, QA reports, and Verifier reports. By step 6, the Orchestrator's context window is polluted with noise from step 1.

### Solution: Progressive Summarization

As the pipeline progresses, systematically summarize older agent outputs:

| Step | After Completion | Summarize What | Target Length |
|------|-----------------|----------------|---------------|
| Finder → PlanDescriber | Finder output | Full exploration report | 3-5 bullet points |
| PlanDescriber → Implementor | PlanDescriber output | Full roadmap | 3-5 sentence summary + manifest path |
| Implementor → QA | Implementor output | Build/lint output | "Build passed" or "Build failed: [key errors only]" |
| QA → Verifier | QA output | Bug report + edge case findings | "2 bugs found (1 critical, 1 minor)" |
| Verifier → Orchestrator | Verifier output | Full deviation report | "3 deviations: CP-003, CP-007, CP-012" |

### Summary Format
Store summaries in `agent-context.md` under a `summaries` field:

```yaml
summaries:
  finder: "Found User model at src/models/user.ts. Key finding: existing validation middleware in src/middleware/validate.ts."
  plandescriber: "3-phase roadmap: model, service, controller. 8 checkpoints in manifest."
  implementor: "Build passed (1 warning). Lint passed. Created src/services/user.ts, src/controllers/user.ts."
  qa: "Smoke test passed. 2 edge cases generated. 1 non-functional issue (performance)."
  verifier: "72% compliance. 2/8 checkpoints failed (CP-003, CP-007). Confidence: LOW."
```

### How to Use
- Before dispatching the next agent, the Orchestrator uses summaries (not raw agent output) for context
- The full raw output is still stored in `agentHistory` for debugging
- When cycle-back happens (e.g., Fixer revisits), give them the full context of their OWN previous attempt + summaries of everything else

### Granular Archival Strategy

For very long pipelines (8+ steps), even summaries accumulate. Use this graduated archival strategy:

| Pipeline Step | What's Retained | What's Summarized | What's Archived |
|--------------|----------------|-------------------|-----------------|
| Steps 1-3 | Full context | Nothing | Nothing |
| Steps 4-5 | Full for current step + summaries for past steps | Finder, Brainstorm | Raw output moved to `.opencode/pipeline-logs/` |
| Steps 6+ | Summary only for steps 1-3 | PlanDescriber, Implementor | Archived to logs directory |
| Fixer loop | Fixer's own prior attempts: FULL context | Everything before Fixer | Archived |
| Verifier | Verifier report (full) + latest Fixer output (full) | Steps before the fix cycle | Archived |

**Archival process**:
1. The Orchestrator writes the raw output to `.opencode/pipeline-logs/<pipelineId>/<agent-name>-<step>.md`
2. The summary replaces the raw output in `agent-context.md`'s `summaries` field
3. When the Orchestrator needs to cycle back to an agent, it reads the archived file from logs first, then supplements with summaries

**Fixer cycle-back rule**: When cycling back to Fixer, ALWAYS give them the full context of their OWN previous attempt (all raw output) plus summaries of everything else. Fixer needs to see what it tried before to avoid repeating mistakes.

---

## Cross-Session Learning

### Purpose
The Project Journal is currently write-only. Cross-Session Learning makes it read-smart by searching past entries for relevant patterns before starting new pipelines.

### How It Works
Before starting any pipeline, the Orchestrator:
1. Reads the journal at `.opencode/journal/journal.yaml`
2. Checks for past entries that match the current feature: similar name, similar pipeline type, similar failed gates
3. If a match is found with >= 2 matching fields, extracts "lessons learned" from that entry
4. Injects those lessons into the first agent hand-off as proactive guidance

### Example
```
Current feature: "user-notifications" 
Past match found: "email-notifications" (2 weeks ago)
- Pipeline: full → failed at verifier (3 attempts)
- Root cause: PlanDescriber omitted error handling for SMTP failures
- Lesson: "Add error handling checkpoints for all external service calls"

Proactive guidance injected into PlanDescriber hand-off:
"Note: A similar feature (email-notifications) failed because error handling for 
external service failures was omitted from the plan manifest. Ensure all external 
service calls in this feature have corresponding handlesError checkpoints."
```

### Journal Indexing
For efficient lookups, the journal is indexed by:
- Feature name keywords (tokenized, lowercase)
- Pipeline type
- Failed gates
- Key decisions (extracted from `keyDecisions` field)

### Lessons Injection Protocol

The Orchestrator MUST inject relevant past lessons into PlanDescriber and Implementor hand-offs to prevent repeated mistakes.

#### Protocol Steps

1. **Before dispatching PlanDescriber or Implementor**, read `.opencode/lessons/learned.yaml`
2. **Filter lessons** that are relevant to the current feature using token similarity matching (same logic as `pipeline-init.ts`)
3. **Include relevant lessons** in the hand-off message as a "Lessons From Previous Pipelines" section:

```markdown
### Lessons From Previous Pipelines
The following lessons from past pipelines are relevant to this task:

| Lesson | Source Feature | Category | Severity |
|--------|---------------|----------|----------|
| <lesson text> | <feature name> | <category> | <severity> |
```

4. **Mark lessons as injected**: After the pipeline completes (or during teardown), update lessons that were injected by changing `injected: false` to `injected: true`
5. **Skip already-injected lessons** — if a lesson already has `injected: true`, don't re-inject it unless the current feature similarity is > 80%

#### When to Inject

| Agent         | Inject Lessons? | Reason                                       |
|---------------|-----------------|----------------------------------------------|
| PlanDescriber | ✅ Always       | Lessons about plan omissions, edge cases     |
| Implementor   | ✅ Always       | Lessons about implementation errors, barrel exports |
| Fixer         | ✅ When retrying | Lessons about similar failure patterns       |
| QA            | ⏭️ Skip         | QA gets lessons via test requirements        |
| Verifier      | ⏭️ Skip         | Verifier checks plan only                    |

---

## Skill Loading Conflict Resolution

### The Problem
Multiple skills may be loaded simultaneously (e.g., `code-philosophy` + `accessibility` for a UI component). Their instructions may conflict. For example, one skill says "use named exports" while another shows default export examples.

### Priority Table
When multiple skills are loaded and provide conflicting guidance, use this priority order (highest wins):

| Priority | Skill | Domain | When It Overrides |
|----------|-------|--------|-------------------|
| 1 (Highest) | `accessibility` | Accessibility | UI components, forms, interactive elements |
| 2 | `security-scan` / `semgrep-scan` | Security | Auth, input handling, data access, SAST scanning |
| 3 | `backend-code-philosophy` | Backend | Server-side code |
| 4 | `frontend-code-philosophy` | Frontend | Client-side code |
| 5 | `plan-describe` | Roadmapping | Planning phases |
| 6 | `plan-verification` | Verification | Verification methodology |
| 7 | `quality-assurance` | Testing | Test design and execution |
| 8 (Lowest) | `code-philosophy` | General | General guidance — yields to all above |

### Conflict Resolution Rules
1. **Specific overrides general**: `accessibility` overrides `code-philosophy` on UI patterns
2. **Domain-specific overrides cross-cutting**: `backend-code-philosophy` overrides `code-philosophy` on backend patterns
3. **Safety-critical overrides convenience**: `security-scan` overrides `code-philosophy` on input handling
4. **When equal priority**: Use the skill loaded most recently
5. **When truly contradictory**: Flag to Orchestrator and ask the user

### Skill Load Logging
Record all loaded skills and their active sections in `agent-context.md`:

```yaml
loadedSkills:
  - name: "code-philosophy"
    sections: ["naming", "exports"]
    priority: 8
  - name: "accessibility"
    sections: ["aria", "color-contrast"]
    priority: 1
  activeOverrides:
    - "accessibility.aria overrides code-philosophy.naming for button components"
```

---

## Smart Circuit Breaker Thresholds

### Contextual Thresholds
Fixed thresholds (3 attempts for everything) are replaced with contextual thresholds:

| Gate | Simple Task | Moderate Task | Complex Task |
|------|------------|---------------|--------------|
| Build | 1 | 2 | 3 |
| Lint | 1 | 2 | 3 |
| Security Scan | 1 | 2 | 3 |
| Smoke Test | 1 | 2 | 3 |
| Verifier | 1 (single file) | 2 (2-3 files) | 3 (4+ files) |
| Evidence Quality | 2 | 3 | 4 |

**Task complexity classification:**
- **Simple**: Config change, single file, < 50 lines changed
- **Moderate**: 2-3 files, new feature in familiar domain
- **Complex**: 4+ files, new domain, cross-module changes

### Pattern Detection
The circuit breaker now detects failure patterns across gates:
- If Fixer fails on 3 different bugs in the same pipeline with the same classification (`edge-case-miss`), auto-escalate to PlanDescriber after attempt 2 (not 3)
- If the same checkpoint fails across 2 different attempts, flag as "persistent deviation" and escalate sooner
- If build fails on 3 different modules sequentially, escalate to user (may be a toolchain issue, not implementation)

### Graceful Degradation
When a gate fails after max attempts, the pipeline still delivers partial results:
- "Plan verification failed (72%), but build and smoke tests pass. Here's what was implemented and what needs review."
- Generate a "partial delivery report" with:
  - ✅ What passed
  - ❌ What failed
  - 🔍 What needs human review
- Do NOT delete files or undo work on partial failure — the user may want to keep working changes

### Threshold Database
Store contextual thresholds in `.opencode/calibration/thresholds.yaml`:

```yaml
taskComplexity:
  default: "moderate"
  overrides:
    - pattern: "config"
      complexity: "simple"
    - pattern: "feature/.*"
      complexity: "complex"
```

---

## Pipeline Type Auto-Classification

### Uncertainty Detection
Before starting, the Orchestrator assesses its confidence in pipeline selection:

| Confidence | Action |
|------------|--------|
| 90-100% (High) | Proceed with selected pipeline |
| 70-89% (Medium) | Run a quick Finder pre-check, then re-assess |
| < 70% (Low) | Ask user: "I think this is [pipeline type]. I'm [X]% confident. Would you like me to investigate first, or proceed?" |

Confidence is calculated based on:
- How many pipeline types match the user's request? (1 match = high, 3+ matches = low)
- How well does the user's language match the pipeline descriptions? (exact match = high, vague = low)
- Does the journal have past entries for similar features? (yes = higher, no = lower)

### Mid-Flow Pipeline Switching
If during execution the Orchestrator discovers the task is different than expected:
1. **Finder discovers scope is much larger**: Switch from "Fixer-only" to "Full pipeline"
2. **Implementor finds existing code does something unexpected**: Switch from "New Feature" to "Refactor"
3. **QA discovers the bug is actually a design issue**: Switch from "Bug Fix" to "PlanDescriber revision"

Switching protocol:
1. Pause current agent
2. Update pipeline type in `agent-context.md`
3. Inform user: "The task turned out to be more complex than expected. Switching from [old] to [new] pipeline."
4. Insert the new step into the sequence (e.g., call PlanDescriber before continuing with Implementor)

---

## Tier 4: Quality-of-Life Improvements

### 1. Hand-off Templating (Auto-Generated)
Rather than manually writing hand-offs, the Orchestrator auto-generates them from `agent-context.md`:

Template format:
```
Orchestrator to {agent}:
"Context: {previous step} completed — {summary from agent-context.md summaries}.
Artifacts: {changedFiles from agent-context.md agentHistory[-1]}.
Objective: {derived from nextObjective in agent-context.md}.
Constraints: {derived from circuit breaker state, loaded skills}.
Expected Output: {per the Agent Output Contract for this agent role}.
Remember to return structured output (status, resultSummary, decisions, warnings, changedFiles, artifacts)."
```

The Orchestrator fills in the `{placeholders}` from the current `agent-context.md` state, ensuring consistency.

### 2. Timeout Warnings
Before hard-aborting a stuck agent, send a warning message:
- If an agent has been running > 5 minutes without reporting, send: "You've been running for 5+ minutes. What's your status? Are you making progress or blocked?"
- If the agent responds: Continue waiting
- If no response within 60 seconds: Abort and restart with fresh session
- After 2 timeouts for the same agent in the same pipeline: Escalate to user

### 3. Build/Lint Output Diffing
When Implementor reports build errors in a cycle-back, show only NEW errors vs the previous run:
- Store previous build output in `agent-context.md` as `buildHistory`
- Compare with current output using line-level diff
- Report: "3 new errors (not present in last build run), 2 errors resolved since last run"
- This prevents the user from re-reading 200 lines of build output to find what changed

### 4. One-Click Rollback
If a pipeline fails or the user is unhappy, offer automated rollback:
- "Roll back all files changed in this session?" offers:
  1. `git checkout -- {files}` for uncommitted changes
  2. `git revert {commit}` for committed changes
  3. "Delete newly created files" option
- The rollback command is presented to the user for confirmation before execution
- After rollback: Update journal with "rolled back" status

---

## Tooling (Project & Consistency Tools)

This skill includes executable scripts for project initialization, consistency checking, output validation, calibration management, parallelism analysis, and pipeline testing.

### Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `validate-output-contract.ts` | Validates subagent output against structured output contract schemas | `ts-node <skills-dir>/scripts/orchestration/validate-output-contract.ts --file=<path> \| --pipeline \| --agent=<name>` |
| `update-calibration.ts` | Reads and updates the agent calibration database (`agents.yaml`) | `ts-node <skills-dir>/scripts/orchestration/update-calibration.ts --agent=<name> --success=true\|false [options]` |
| `test-pipeline.ts` | E2E test harness exercising all orchestration components | `ts-node <skills-dir>/scripts/orchestration/test-pipeline.ts [--test=<name>]` |

### Consistency Checks
Run after implementation to ensure code style consistency:
```bash
```

### Output Contract Validation
Run to validate agent output format:
```bash
# Validate entire pipeline outputs
ts-node skills/scripts/orchestration/validate-output-contract.ts --pipeline

# Validate a specific agent's output file
ts-node skills/scripts/orchestration/validate-output-contract.ts --file=agent-output.yaml
```

### Calibration Management
Update and read agent calibration:
```bash
# Record a successful implementor task
ts-node skills/scripts/orchestration/update-calibration.ts --agent=implementor --success=true

# Read full calibration report
ts-node skills/scripts/orchestration/update-calibration.ts --read
```

### Parallelism Analysis
Before parallel dispatch decisions:
```bash
```

### Pipeline Testing
Run the E2E test suite to verify orchestration components:
```bash
ts-node skills/scripts/orchestration/test-pipeline.ts
```

### Reference Files

| File | Purpose |
|------|---------|
| `references/agent-context-schema.md` | Canonical schema for `agent-context.md` YAML frontmatter — field types, validation rules, lifecycle |
| `.opencode/calibration/agents.yaml` | Agent calibration database — per-agent success rates, failure patterns, effectiveness |

## Dynamic Context Injection (NEW)

### Problem
The Orchestrator's naive hand-off (dumping all of agent-context.md to every agent) wastes significant tokens. An Implementor doesn't need the Finder's full exploration log — it just needs the roadmap and manifest. A Fixer cycling back doesn't need QA's non-functional findings — it needs the bug report.

### Solution: Per-Agent Context Filtering
For each hand-off, inject only what the receiving agent actually needs:

| Agent Receiving | Gets | Doesn't Get |
|-----------------|------|-------------|
| **PlanDescriber** | Finder's knowledge graph + decision history + journal cross-session lessons | Full Finder exploration report, old plan manifests |
| **Implementor** | Plan roadmap + plan-manifest.json + current git state | QA reports, Verifier reports from prior iterations |
| **Integrator** | List of all files created/modified by parallel Implementors + project wiring convention detection | Finder exploration logs, brainstorm notes |
| **Fixer** (1st cycle) | Bug report or Verifier deviation report + plan manifest + changed files | Full QA output, build logs from other pipelines |
| **Fixer** (cycle-back) | Same as 1st + its OWN previous rootCauseAnalysis + the circuit breaker state | Everything else |
| **QA** | Plan summary + changed files list + build/lint output | Finder exploration, brainstorm notes, plan manifest details |
| **Verifier** | Plan manifest + implementation summary + build/lint confirmation + acceptance criteria | Finder exploration, brainstorm notes |
| **Documentor** | Git diff of changed files + QA report + plan manifest summary | Full QA test details, Verifier breakdown, circuit breaker state |
| **Security Scan** | Project type + lockfile path + list of target source directories | Everything else (read-only agent) |
| **Browser Tester** | Routes/changed UI components + app URL | Plan details, QA test internals |

### Implementation
When constructing a hand-off prompt to any agent, the Orchestrator:

1. **Reads** `agent-context.md` for history
2. **Extracts** only the relevant entries from `agentOutputs` and `agentHistory`
3. **Summarizes** everything else into 1-2 bullet points
4. **Writes** the hand-off with: Objective + Relevant Artifacts + Constraint + Expected Output
5. **Stores** the full context in `agent-context.md` for future debugging

**Example** — Hand-off to Implementor (NOT including Finder exploration):
```
Orchestrator to Implementor:
"Implement the user-profile feature following the roadmap below.

Relevant context:
- Plan manifest: plan-manifests/user-profile/v1-manifest.json
- Existing User model found at: src/models/user.ts
- Key decision: using Zod for validation (already in dependency tree)

[full roadmap + manifest checkpoints inline]

Return your results with the structured output contract..."
```

**Example** — NOT this (current, inefficient):
```
Orchestrator to Implementor:
"Here is the full agent-context.md with 1500 lines of history.
Also here is the Finder's 200-line exploration report.
Also here is the brainstorming transcript.
Oh and the roadmap is somewhere in here too.

[800 lines of irrelevant context]

Go implement the feature."
```

### Benefits
- Saves 30-50% of context window per hand-off
- Agents receive clearer, more focused instructions
- Reduces agent confusion from irrelevant data
- Faster agent response times (less context to process)

---

## Session Resume Report (NEW)

### Purpose
When a user returns to a workspace after a break (hours or days), they need a fast summary of what happened in the last session. Without this, they must read the journal, check git log, and inspect the workspace manually.

### When to Generate
At pipeline **start**, the Orchestrator checks:
1. Does `.opencode/journal/journal.yaml` exist?
2. Does it contain entries from the last 7 days?
3. If yes → generate the Session Resume Report and show it to the user before proceeding

### Report Format

```markdown
## 🔄 Session Resume Report

### Recent Pipeline Activity (Last 7 Days)

| Date       | Feature         | Result | Duration | Files Changed               |
|------------|-----------------|--------|----------|-----------------------------|
| May 18     | user-profile    | ✅ Pass  | 12m     | src/services/user.service.ts |
| May 17     | rate-limiter    | ❌ Fail  | 8m      | src/middleware/rate-limiter.ts |
| May 16     | auth-upgrade    | ✅ Pass  | 15m     | 4 files                     |

### Key Decisions Made
- `user-profile`: Chose Zod over Joi for input validation (already in deps)
- `user-profile`: Split into 3-phase implementation (model → service → controller)
- `auth-upgrade`: Rejected Redis session store for MVP (will revisit at 10k users)

### Pending Items
- `rate-limiter` — Failed at Verifier gate (3 attempts). Root cause: plan omission (edge cases not covered).
  Recommended next action: Revise plan with explicit edge case checkpoints.

### Uncommitted Changes
- `src/services/user.service.ts` — Modified but not committed
- `plan-manifests/user-profile/v1-manifest.json` — Unstaged

### Workspace State
- Current branch: `feature/user-profile`
- Behind main by: 2 commits
- Ready to: Continue verification of user-profile feature

### ⚡ Quick Actions
1. **Continue where you left off** — re-run Verifier on user-profile
2. **Start fresh** — new feature request
3. **Clean up** — reset workspace to clean state
```

### Data Sources
| Field | Source |
|-------|--------|
| Pipeline history | `.opencode/journal/journal.yaml` |
| Key decisions | Journal entries' `keyDecisions` field |
| Pending items | Last journal entry with `result: "fail"` or `circuitBreakerEvents` |
| Uncommitted changes | `git status --porcelain` |
| Branch state | `git branch`, `git log --oneline --count HEAD ^main` |

### Workflow
```
Pipeline start
  │
  ├── Read journal ──► Entries exist? ──► No ──► Skip, proceed normally
  │                       │
  │                       Yes
  │                       ▼
  ├── Build Session Resume Report
  │                       │
  ├── Present to user ──► "Here's what happened since your last session."
  │                       │
  │                       ▼
  └── Ask: "Would you like to continue from where you left off, start fresh, or clean up?"
```

---

## Semantic Circuit Breaker (NEW — replaces simple counter-based breaker)

### Problem
The simple circuit breaker tracks failure counts per gate but doesn't understand *why* failures occur. Three `verifier` failures might all have different root causes. Each failure is treated identically, leading to premature or delayed escalation.

### Solution: Failure Signature Tracking

Each failure is hashed into a `failureSignature` based on:
- `agent` — Which agent failed
- `gate` — Which gate (build, lint, security, smoke, verifier)
- `classification` — Root cause classification (from Fixer)
- `primaryCause` — Normalized root cause description

```
failureSignature = SHA256(agent + ":" + gate + ":" + classification + ":" + primaryCause)
```

### Circuit Breaker State (updated schema)

```yaml
circuitBreaker:
  state: "closed"
  # ── OLD: Simple counters ──
  counters:
    build: 0
    lint: 0
    verifier: 0
  # ── NEW: Per-signature tracking ──
  signatures:           # Tracks distinct failure signatures
    - signature: "a1b2c3d4..."
      gate: "verifier"
      agent: "implementor"
      classification: "implementation-error"
      primaryCause: "Missing export for validateEmail"
      count: 2
      lastSeen: "2026-05-19T10:30:00Z"
    - signature: "e5f6g7h8..."
      gate: "verifier"
      agent: "fixer"
      classification: "plan-omission"
      primaryCause: "Plan did not specify duplicate email handling"
      count: 1
      lastSeen: "2026-05-19T10:35:00Z"
```

### Escalation Rules

| Condition | Action |
|-----------|--------|
| Same signature count >= 3 | Open circuit — the same fix isn't working |
| Different signatures, total >= 3 | Do NOT open circuit — different problems each time, keep trying |
| Same classification count >= 3 | Auto-escalate to PlanDescriber — the root cause category keeps recurring |
| Mixed signatures + mixed classifications >= 5 | Open circuit — too many distinct failures, need user intervention |

### Benefits over Simple Counter
- **Prevents premature escalation**: 3 unique failures (each with a different root cause) shouldn't stop the pipeline
- **Prevents under-escalation**: 3 identical failures (same missing export, same classification) signal the same fix isn't working
- **Provides actionable data**: The failure signature list tells the Orchestrator exactly which root causes are recurring
- **Enables pattern-aware escalation**: If "edge-case-miss" keeps appearing across different features, that's a PlanDescriber training issue

---

## Acceptance Criteria Integration (NEW)

### Pipeline Addition
Acceptance criteria (`type: "acceptance"` checkpoints in the plan manifest) add a new gate to the pipeline:

```
Build Gate → Lint Gate → Security Scan (with mandatory Semgrep SAST sub-gate) → QA → ACCEPTANCE GATE → SECURITY TEST COVERAGE GATE → Verifier → Documentor
```

### Acceptance Gate Protocol
The Acceptance Gate runs after QA smoke test passes and before Verification:

1. **Check manifest** for `acceptanceCriteria` checkpoints
2. **If none exist**: Skip gate with note "No acceptance criteria in manifest"
3. **If acceptance criteria exist**:
   - Start the application (`npm run start` or equivalent)
   - Wait for health check to pass (max 30 seconds)
   - For each `acceptanceCriteria` checkpoint:
     - Execute the `testCommand`
     - Capture exit code + stdout/stderr
     - Record: Pass / Fail / Skipped
   - Stop the application

### Passing/Blocking
| Outcome | Result |
|---------|--------|
| All acceptance criteria pass | ✅ Gate passes — proceed to Verifier |
| Any acceptance criteria fail | ❌ Gate blocks — cycle to Fixer with the failed test output |
| App could not be started | ⏭️ Gate skipped — proceed with warning |

### Weight in Overall Score
Acceptance criteria carry double weight in the Verifier's compliance score (see plan-verification skill for formula).

---

## Pipeline Order Fix (Documentor after Verifier)

### Current (Incorrect)
```
QA → Documentor → Verifier → Orchestrator
```

### Problem
Documenting code before it's verified is wasteful. If Verifier fails at 72%, the Documentor's changelog entries and README updates are based on code that may need to be rewritten.

### Corrected (Updated)
```
QA → Acceptance Gate → Security Test Coverage Gate → Verifier → Documentor → Orchestrator
```

### Rationale
1. **Verify first**: Ensure code works correctly before documenting it
2. **Document stable APIs**: Only document exports and behavior that pass verification
3. **Changelog accuracy**: Only write changelog entries for code that's been verified
4. **README accuracy**: Only update README for features that actually pass verification

### Hand-off Changes
```
Verifier → Documentor:
"The user-profile feature has passed all gates including verification (100% compliance).
Plan manifest checkpoints all pass. QA smoke test passed. Acceptance criteria passed.

Changed files:
- src/services/user.service.ts (NEW)
- src/controllers/user.controller.ts (NEW)
- src/types/user.types.ts (NEW)

Please update:
1. JSDoc on all new exports
2. README.md with new API endpoints
3. CHANGELOG.md with [Unreleased] entries
4. No migration guide needed (no breaking changes)"
```

---

## Integrator Agent (NEW — runs after parallel Implementor dispatch)

### Relationship to Merge Coordinator

| Aspect | Merge Coordinator (existing) | Integrator (NEW) |
|--------|------------------------------|-------------------|
| **What it does** | Reads files, checks cross-references | Writes wiring files (barrels, DI, routes) |
| **Passive/Active** | Passive (read-only verification) | Active (writes barrel files, DI registrations) |
| **When it runs** | After parallel Implementors, before Build | After Merge Coordinator, before Build |
| **Failure mode** | Reports inconsistencies | Fixes inconsistencies, reports what it did |

### Workflow
```
Parallel Implementor A ──┐
                         ├──► Merge Coordinator (verify cross-refs) ──► Integrator (wire everything) ──► Build Gate
Parallel Implementor B ──┘
```

### Hand-off
The Integrator loads the `integrator` skill which provides full guidance on detecting wiring conventions, updating barrel files, registering DI, and wiring routes.

### When to Use
- **Parallel dispatch** (multiple Implementors): Always run Integrator
- **Single Implementor**: Skip Integrator (no parallel files to wire)
- **Single file change**: Skip Integrator (no wiring needed)

---

## Pipeline Selection Protocol Update (includes Documentor and Integrator)

### Updated Pipeline Table

| Task Type | Pipeline | Includes Documentor? | Includes Integrator? | Includes Acceptance Gate? |
|-----------|----------|---------------------|---------------------|--------------------------|
| **New Feature (known)** | Standard | ✅ Yes | ✅ If parallel dispatch | ✅ Yes |
| **New Feature (unknown)** | Full | ✅ Yes | ✅ If parallel dispatch | ✅ Yes |
| **Bug Fix (known cause)** | Fixer → QA → Verifier → Documentor | ✅ Yes | ❌ No | ❌ No |
| **Bug Fix (unknown cause)** | Finder → Fixer → QA → Verifier → Documentor | ✅ Yes | ❌ No | ❌ No |
| **Research** | Finder only | ❌ No | ❌ No | ❌ No |
| **Refactor** | PlanDescriber → Implementor → Security → QA → Verifier → Documentor | ✅ Yes | ❌ No | ❌ No |
| **Config Change** | Implementor → Documentor | ✅ Yes | ❌ No | ❌ No |
| **Security Fix** | Implementor → Security Scan → QA → Verifier → Documentor | ✅ Yes | ❌ No | ❌ No |
| **UI Bug** | Browser Tester → Fixer → QA → Verifier → Documentor | ✅ Yes | ❌ No | ❌ No |

---

## Output Contract Update (includes new agents)

### Per-Agent Responsibility Update

| Agent | Must Report `buildPassed`/`lintPassed`? | Must Report `decisions`? | Must Report `changedFiles`? |
|-------|----------------------------------------|--------------------------|-----------------------------|
| **Finder** | No (read-only) | Yes (exploration direction) | No |
| **PlanDescriber** | No | Yes (architectural decisions) | Yes (plan manifest) |
| **Implementor** | Yes (mandatory) | No | Yes (all files written) |
| **Integrator** | Yes (mandatory — build verifies wiring) | Yes (wiring decisions) | Yes (wiring files modified) |
| **QA** | No | Yes (test decisions) | Yes (test files) |
| **Verifier** | No (read-only) | No | No |
| **Fixer** | Yes (mandatory) | Yes (root cause classification) | Yes (files modified) |
| **Documentor** | No | Yes (documentation structure decisions) | Yes (doc files modified) |
| **Browser Tester** | No | No | Yes (test scripts) |
| **Security Scan** | No | No | No (read-only) |


## Evidence Contract Protocol (NEW)

### Purpose
Every agent claim must be backed by **anchored evidence** that can be independently verified. This transforms the system from "trust-based" to "verify-based." Without evidence, the Orchestrator has no way to distinguish a correct agent output from a hallucinated one.

### The Evidence Contract
Every subagent's output MUST include an `evidence` array (at the agentOutputs level, and optionally at the top level). Each evidence entry MUST include:

| Field | Required | Description |
|-------|----------|-------------|
| `claim` | ✅ | What the agent claims to be true (e.g., "File X exists", "Build passed", "Export Y found") |
| `source` | ✅ | File path, or "build"/"lint"/"test" for non-file evidence |
| `lines` | ❌ | Specific line numbers [start, end] |
| `method` | ✅ | How the evidence was obtained: `grep`, `read`, `stat`, `glob`, `test`, `build`, `lint`, `run`, `analysis` |
| `command` | ✅ | The exact command that was run to obtain this evidence |
| `excerpt` | ✅ | Relevant output excerpt proving the claim (even for failures — show what was found instead of what was expected) |
| `result` | ✅ | `found`, `not_found`, `passed`, `failed`, `exists`, `not_exists`, `verified`, `analysis_complete` |

### When Evidence Is Required

| Agent Type | Minimum Evidence Entries | What to Provide Evidence For |
|------------|------------------------|------------------------------|
| **Finder** | 1 per finding | File existence, export patterns, hazards found. Each "found X at path Y" claim needs grep/read evidence showing X. |
| **PlanDescriber** | 0 (plans are prescriptive) | N/A — but decision provenance is recommended |
| **Implementor** | 1 per changed file + 1 for build + 1 for lint | File creation (stat), exports (grep), build pass (build), lint pass (lint) |
| **Fixer** | 1 per root cause + 1 for fix + 1 for build + 1 for lint | Evidence of the bug (read/grep), evidence of the fix (read/grep to show the change), build and lint verification |
| **QA** | 1 per bug + 1 per smoke test + 1 per edge case category | Each bug needs reproduction command + output. Each test pass needs verification command. |
| **Verifier** | 1 per checkpoint | Every individual checkpoint verdict must include the grep/stat/read output that proves it |
| **Browser Tester** | 1 per test scenario | Screenshot paths, script execution output |
| **Documentor** | 1 per documentation file changed | Verify the documentation was written correctly (read the file) |
| **Integrator** | 1 per wiring change + 1 for build | Barrel file change verified (grep), DI registration verified (read), build pass |
| **Merge Coordinator** | 1 per file pair checked | Import resolution evidence for each cross-file check |

### Evidence Validation Gate

After every agent completes, the Orchestrator MUST run the Truthfulness Validator:

```bash
```

Or for a full pipeline audit:
```bash
```

If any evidence is refuted (claim does not match reality), the pipeline should:
1. **Route back to the agent** for correction if it's a minor, fixable issue
2. **Escalate to user** if the agent fabricated evidence (refuted claims suggest hallucination)

### Evidence Scoring

The Truthfulness Validator produces a score (0-100%) for each agent:
- **>= 95%**: ✅ Pass — evidence is reliable
- **70-94%**: ⚠️ Warning — some evidence is missing or unverifiable
- **< 70%**: ❌ Fail — significant evidence issues, route back to agent or escalate

## Hand-off Completeness Protocol (NEW)

### Purpose
Before dispatching any subagent, the Orchestrator MUST verify that the hand-off includes all required context. Incomplete hand-offs are the #1 source of agents producing wrong results.

### Pre-Dispatch Check

Before every agent dispatch, run the hand-off completeness checker:

```bash
ts-node skills/scripts/orchestration/check-handoff.ts --agent=<agent-name> --context="<handoff-text>"
```

The checker validates these fields for every agent:

| Field | Mandatory | Description |
|-------|-----------|-------------|
| **contextSummary** | ✅ | Summary of what was done in the previous step(s) |
| **artifacts** | ✅ | Relevant file paths, outputs, or data produced |
| **clearObjective** | ✅ | Exactly what the next agent should do (must contain an action verb) |
| **constraints** | ✅ | Any boundaries, rules, or restrictions (must contain "must not", "avoid", "only", etc.) |
| **expectedOutput** | ✅ | What the agent should return/report (must reference output format) |
| **evidenceFromPriorAgent** | ✅ | Citations and evidence from the prior agent's work |

Plus agent-specific fields:

| Agent | Mandatory Additional Fields |
|-------|----------------------------|
| **Implementor** | Plan manifest path, target files, definition of done (build/lint commands) |
| **Verifier** | Plan manifest path, acceptance criteria |
| **Fixer** | Deviation report (checkpoint failures), root cause information |
| **QA** | Smoke test command, test scope |
| **Integrator** | Parallel file list, wiring conventions |
| **Documentor** | Changed files list, documentation types to update |
| **Finder** | Research questions, codebase scope |
| **PlanDescriber** | Brainstorm outcome (chosen option), existing codebase context |

### Auto-Fill Protocol

If the hand-off is missing a mandatory field, the Orchestrator MUST:
1. Detect the missing field (from the checker's output)
2. Auto-fill it from available context (agent-context.md, plan manifest, prior agent output)
3. Re-run the checker to confirm completeness
4. If auto-fill is impossible, ask the user for clarification

### Pipeline Retrospective Impact

After each pipeline, the Orchestrator records hand-off quality in calibration:
```bash
ts-node skills/scripts/orchestration/update-calibration.ts --agent=orchestrator --success=<true/false> --handoff-quality=<1-10>
```

If hand-off quality < 6 for 3 consecutive pipelines: enable the hand-off checker as a mandatory pre-dispatch gate for ALL future pipelines.

## Pattern-Based Circuit Breaker (Enhanced)

### Purpose
The old circuit breaker tracked simple retry counts (build: 3, lint: 3, etc.). The enhanced version tracks **failure patterns** — distinct signatures of what failed and why — to make smarter escalation decisions. This prevents infinite Fixer→Verifier loops by detecting the pattern and routing directly to PlanDescriber.

### Signature-Based Failure Tracking

Each failure generates a SHA256-based signature:
```
signature = SHA256(gate + ":" + agent + ":" + classification + ":" + primaryCause)[:8]
```

Example:
```yaml
circuitBreaker:
  patternSignatures:
    - signature: "a1b2c3d4"
      gate: "verifier"
      agent: "fixer"
      classification: "plan-omission"
      primaryCause: "Plan did not specify duplicate email handling"
      count: 2                # Incremented when same signature repeats
      firstSeen: "2026-05-19T10:25:00Z"
      lastSeen: "2026-05-19T10:35:00Z"
```

### Escalation Logic

| Condition | Circuit State | Action |
|-----------|--------------|--------|
| Any single signature.count >= 3 | closed → open | Same fix not working — STOP cycling. Escalate to user. |
| Same classification appears in >= 3 distinct signatures | closed → half-open | Same TYPE of failure. Escalate to PlanDescriber for plan revision. |
| Fixer→Verifier cycle repeats >= 3 times (detected from cyclePatternHistory) | closed → half-open | Loop detected. Skip Fixer and go directly to PlanDescriber. |
| >= 5 distinct signatures with mixed classifications | closed → open | Multiple different failures. Flag for user review. |
| After PlanDescriber revises the plan | open → closed | Reset all counters and signatures. Fresh start. |

### Cycle Pattern Detection

The circuit breaker tracks agent dispatch sequences to detect loops:

```yaml
cyclePatternHistory:
  - pattern: "fixer-verifier-loop"
    occurrences: 2
    lastOccurrence: "2026-05-19T10:35:00Z"
    recommendedAction: "escalate-to-plandescriber"
```

Detection logic:
1. After each agent completes, check if the last 2-3 steps form a repeating pattern
2. Patterns: fixer→verifier→fixer, implementor→build→fixer→build, etc.
3. If same pattern repeats >= 2 times → record in cyclePatternHistory
4. If any pattern reaches >= 3 occurrences → trigger escalation

### Integration with Pre-Flight

The `pipeline-init.ts` script now initializes the pattern-based circuit breaker:
```yaml
circuitBreaker:
  patternSignatures: []
  escalationSignals:
    sameSignatureThresholdReached: false
    sameClassificationThresholdReached: false
    totalDistinctSignatures: 0
    totalClassificationInstances: {}
    recommendedAction: "No failures yet"
    escalationHistory: []
  patternDetection:
    cyclePatternHistory: []
```

## Decision Provenance Protocol (NEW)

### Purpose
Every architectural decision recorded in `agent-context.md` MUST include provenance — evidence of what source information led to that decision. This is critical for:
- **Auditing**: Understanding why a decision was made (not just what was decided)
- **Cross-session learning**: Future pipelines can reference past decisions with full context
- **Debugging**: When a decision leads to problems, the provenance shows what information it was based on

### Decision Provenance Format

Every decision in the `decisions` array MUST include an `evidence` array:

```yaml
decisions:
  - what: "Chose Zod over Joi for input validation"
    why: "Already in dependency tree — no new install needed"
    by_who: "finder"
    evidence:                    # NEW — REQUIRED
      - source: "package.json"
        excerpt: '"zod": "^3.22.0"'
      - source: "src/services/user.ts"
        excerpt: "import { z } from 'zod'"
```

### When Decision Provenance Is Required

| Agent Type | Decision Provenance Required? | Examples |
|-----------|------------------------------|----------|
| **Finder** | ✅ Always | "Chose X because Y exists in package.json" → cite package.json |
| **PlanDescriber** | ✅ Always | "Chose 3-phase split because existing service follows this pattern" → cite the existing service |
| **Implementor** | ❌ (usually no decisions) | N/A |
| **Fixer** | ✅ For root cause conclusions | "Root cause is plan-omission because no CP for duplicate email exists" → show the manifest |
| **QA** | ✅ For test strategy choices | "Chose integration tests over unit tests because the service uses a database" → cite the service |
| **Verifier** | ❌ (no decisions) | N/A |
| **Integrator** | ✅ Always | "Used NestJS module pattern because app.module.ts uses @Module" → cite app.module.ts |
| **Documentor** | ✅ For style decisions | "Used imperative mood because existing docs use it" → cite existing JSDoc |

### Hard Rule
- ❌ NEVER record a decision without provenance evidence unless it is self-evident (e.g., "Created file X as specified in the plan")
- ✅ ALWAYS cite the specific source file and excerpt that informed each decision
- ✅ ALWAYS use at least one evidence entry per decision

## Cross-Session Citation Linking (NEW)

### Purpose
Journal entries and pipeline logs now link back to specific pieces of evidence, making cross-session learning more precise. Instead of "Last time the fixer had trouble," the system says "Last time fixer had trouble with `handlesError` for `validateEmail` — see evidence in pipeline log."

### Journal Entry Enhancement

Journal entries now include an `evidenceCitations` field:

```yaml
- date: "2026-05-19T10:30:00Z"
  feature: "user-profile"
  pipelineType: "full"
  result: "partial"
  evidenceCitations:                     # NEW
    - claim: "Verifier found 72% compliance"
      source: "pipeline-logs/user-profile-20260519/agent-context.md"
      method: "read"
      excerpt: "verifier compliance: 72% — 2/8 checkpoints failed (CP-003, CP-007)"
    - claim: "Root cause: plan-omission (missing CP for duplicate email)"
      source: "pipeline-logs/user-profile-20260519/agent-context.md"
      method: "read"
      excerpt: "fixer.rootCauseAnalysis.classification: 'plan-omission'"
  notes: "Revised plan twice due to edge cases"
```

### Evidence File Storage

During pipeline teardown, individual evidence files are archived:
```
.opencode/pipeline-logs/<pipelineId>/
├── agent-context.md                          # Full pipeline state
├── evidence/
│   ├── finder-evidence.yaml                  # Finder's evidence
│   ├── implementor-evidence.yaml             # Implementor's evidence
│   ├── verifier-evidence.yaml                # Verifier's evidence per checkpoint
│   └── fixer-evidence.yaml                   # Fixer's evidence
```

### Cross-Session Lookup Enhancement

The pipeline-init's cross-session learning now retrieves EVIDENCE:

```bash
ts-node skills/scripts/orchestration/journal-lookup.ts --feature=<name> --include-evidence
```

This returns not just "Lesson: X" but also "Evidence: cited from pipeline logs at path Y."

### Pipeline Teardown Update

The teardown script now archives evidence files:

```bash
ts-node skills/scripts/orchestration/pipeline-teardown.ts \
  --feature=<name> --pipeline-type=<type> --result=pass|fail|partial \
  --evidence-path=.opencode/pipeline-logs/<pipelineId>/evidence/
```

### Journal Reference in Evidence

When the Orchestrator reads cross-session lessons before a pipeline, it now includes evidence citations in the hand-off:

```
Hand-off note to PlanDescriber:
"Last time we implemented user-profile, the Verifier found 72% compliance
because the plan was missing a handlesError checkpoint for duplicate email.
See evidence: pipeline-logs/user-profile-20260519/evidence/verifier-evidence.yaml
CP-003: exportExists 'validateEmail' — not found."
```

## Parallel Dispatch Version Contracts (NEW)

### Purpose
When dispatching multiple Implementors in parallel, each creates files that may depend on types/interfaces from other files. Version contracts prevent integration issues by ensuring each file declares what versions of dependencies it expects, and the Merge Coordinator verifies they match.

### Version Contract Format

Each file created by a parallel Implementor includes an `@contract` comment at the top:

```typescript
// @contract version 1.0
// @exports: UserService, CreateUserDto, UserResponse
// @depends: types/user.types.ts@^1.0 (User, CreateUserDto)
```

When the Merge Coordinator runs, it:
1. Extracts all `@contract` comments from all new files
2. Verifies that each `@depends` entry matches a corresponding `@exports` entry in another file
3. Checks version compatibility (semver range matching)
4. Reports any mismatches

### Contract Format Specification

```typescript
// @contract <semver-version>
// @exports: <comma-separated-export-names>
// @depends: <file-path>@<semver-range> (<comma-separated-symbol-names>)
// @depends: <file-path>@<semver-range> (<comma-separated-symbol-names>)
```

Rules:
- `@contract` is the version of THIS file (what it exports)
- `@depends` lists dependencies on OTHER files with expected version ranges
- Each `@depends` includes the file path, version range (semver), and symbols needed
- Multiple `@depends` lines are allowed
- The contract block MUST be at the top of the file (first 10 lines)

### Merge Coordinator Integration

The Merge Coordinator now checks these contracts:

```yaml
# In Merge Coordinator output:
contractVerification:
  totalContracts: 3
  matched: 3
  mismatched: 0
  warnings: []
  details:
    - file: "src/types/user.types.ts"
      version: "1.0"
      exports: ["User", "CreateUserDto", "UserResponse"]
    - file: "src/services/user.service.ts"
      version: "1.0"
      depends:
        - target: "src/types/user.types.ts"
          expectedRange: "^1.0"
          resolved: "1.0"
          status: "matched"
    - file: "src/controllers/user.controller.ts"
      version: "1.0"
      depends:
        - target: "src/services/user.service.ts"
          expectedRange: "^1.0"
          resolved: "1.0"
          status: "matched"
```

### When to Use

| Dispatch Mode | Version Contracts Required? |
|---------------|---------------------------|
| Single Implementor | No (no merge needed) |
| Parallel Implementors (independent files) | ✅ Yes — ensures cross-file type compatibility |
| Parallel Implementors (with Merge Coordinator) | ✅ Yes — Merge Coordinator checks contracts |
| Sequential Implementors | No (files built on each other directly) |

### Hard Rules
- ❌ NEVER dispatch parallel Implementors without @contract annotations in all new files
- ❌ NEVER skip Merge Coordinator's contract verification when using parallel dispatch
- ✅ ALWAYS include @contract/@exports/@depends in every new file from parallel dispatch
- ✅ ALWAYS use semver ranges (@^1.0, @~1.0, @1.0.0) for dependency versions
- ✅ ALWAYS report contract mismatches as blocking issues (prevent proceeding to Build Gate)

## Orchestration Workflow Update

The full pipeline sequence now includes evidence, hand-off checking, and pattern-based circuit breaker:

```
PRE-FLIGHT:
  Pipeline init → Hand-off check pre-dispatch for every agent
  ↓
EVIDENCE CONTRACT:
  Every agent → Evidence in output → Truthfulness validation
  ↓
HAND-OFF COMPLETENESS:
  Before every dispatch → check-handoff.ts → auto-fill missing fields
  ↓
PATTERN-BASED CIRCUIT BREAKER:
  Failure → Generate signature → Check escalation thresholds → Route correctly
  Detects fixer→verifier loops → Routes to PlanDescriber instead
  ↓
CROSS-SESSION CITATION:
  Pipeline teardown → Archive evidence → Journal with citations
  Next pipeline init → Read evidence along with lessons
  ↓
PARALLEL DISPATCH:
  @contract annotations → Merge Coordinator verifies → Block on mismatch
```

### Hand-off Checklist (Updated with Evidence)

When passing work from one agent to the next, the Orchestrator MUST include:

1. **Context Summary**: What was done in the previous step(s), with evidence citations
2. **Artifacts**: Relevant file paths, outputs, or data produced
3. **Previous Evidence**: Structured evidence from prior agent(s) with content hashes:
   ```
   Previous Evidence (from <agent>):
     - Claim: <claim>
       Source: <file>, Lines [start, end]
       ContentHash: <sha256>
       Method: grep/read/stat
       Command: <exact command>
       Excerpt: "<relevant output>"
       Result: found/passed
   ```
4. **Clear Objective**: Exactly what the next agent should do
5. **Constraints**: Any boundaries, rules, or restrictions
6. **Expected Output**: What the agent should return/report (including evidence requirements)
7. **Agent Output Format reminder**: "Return your results with the structured output contract (status, resultSummary, evidence, decisions, warnings, changedFiles, artifacts, buildPassed/lintPassed where applicable)"
8. **Evidence Minimum**: "Provide at least <N> evidence entries: one per <claim-type>"
9. **Evidence Requirements**: "Include evidence for every substantive claim with contentHash, line numbers, exact commands, and verbatim excerpts"
10. **Run Hand-off Check**: Before dispatch, run `check-handoff.ts`
11. **Visual Generation**: After the agent returns, generate the appropriate pipeline visualization

### Example Hand-off with Evidence

```
Orchestrator to Implementor:
"After brainstorming and planning, we've agreed on the user-profile feature.
Plan manifest: plan-manifests/user-profile/v1-manifest.json
Target files: src/services/user.ts, src/controllers/user.ts

Prior evidence from Finder:
- Evidence: User model exists at src/models/user.ts (line 5: interface User)
- Evidence: Zod is already in the dependency tree (package.json: "zod": "^3.22.0")

Your task:
1. Create src/services/user.ts with UserService class (exports: createUser, getUser)
2. Create src/controllers/user.ts with UserController (handlers for POST/GET)

Constraints:
- Must NOT modify src/models/user.ts (it already exists)
- Must use Zod for input validation (not Joi — it's not installed)

Expected output:
- Structured YAML with evidence for each file created, build pass, lint pass
- Minimum 3 evidence entries: 2x fileExists (stat), 1x buildPass (build)

Definition of Done:
- Build passes: npm run build
- Lint passes: npm run lint (or 'No linter configured')
- Files exist with correct exports
