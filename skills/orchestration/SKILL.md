---
name: orchestration
description: Use this skill to orchestrate multiple agents to resolve complex problems and achieve overarching goals.
---

# Skill: orchestration

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
| **Implementor** | Write code following the plan. **Self-Reviewing Implementor**: Pre-implementation validation, self-review pass before reporting, scope guard. | None | After plan is ready | Yes (mandatory self-review) | Yes |
| **Fixer** | Debug and fix bugs. **Root Cause Classifier**: Categorizes bugs into taxonomy (plan-omission, implementation-error, edge-case-miss, integration-mismatch, environment-issue). Reports fix confidence score. | High | After QA or Verifier reports issues | Yes (cross-module check) | Yes |
| **QA** | Smoke tests, bug discovery, coverage analysis. **Proactive QA**: Auto-generates edge case tests, runs non-functional checks (perf, a11y, security), performs regression impact analysis. | 0.1 | After build + security scan pass | Yes (edge case generation) | Yes |
| **Verifier** | Compare implementation against plan manifest. **Plan Diff Verifier**: Also suggests missing checkpoints, detects plan drift, performs cross-file consistency checks. | 0.1 | After QA passes | Yes (confidence level reporting) | Yes |
| **Security Scan** | Dependency vulnerability scan, secrets scan, anti-pattern scan. Reports risk-level classified findings with auto-remediation suggestions. | Read-only | After build + lint pass | N/A (read-only) | No |
| **Browser Tester** | Playwright CLI browser automation, UI bug discovery | 0.2 | When UI testing is needed | No | No |

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
4. IMPLEMENTOR ──► Write code strictly following the plan
          │
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
   ┌──────┴──────┐
   ▼ SECURITY    ▼ (MANDATORY)
   │  SCAN GATE  │
   │  Load security-scan skill │
   │  Run npm audit + secrets  │
   │  scan + anti-pattern scan │
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
6. VERIFIER ──► Compare implementation against plan manifest
   │              └── Structural checks (Pass 1)
   │              └── Behavioral checks (Pass 2)
   │              └── Produces compliance score + deviation report
   │
   ┌──────┴──────┐
   ▼ FEEDBACK    ▼
   │ If QA found bugs → cycle to FIXER
   │ If Verifier score < 80% → cycle to FIXER
   │ Fixer: diagnose root cause, apply fix, rebuild, re-lint
   │         → then back to QA smoke test → Verifier
   └──────┬──────┘
          │
7. ORCHESTRATOR ──► Review all results, write journal entry, report to user
```

### When to Skip Steps
- **Simple/familiar tasks**: Skip Finder, go directly to PlanDescriber → Implementor → Security Scan → QA.
- **Exploratory/research tasks**: Use only Finder, report findings directly to user.
- **Bug fixes (known root cause)**: Skip PlanDescriber, go directly to Fixer for the fix, then QA + Verifier.
- **Trivial config changes**: Skip all gates — just delegate to Implementor.

### Pre-Flight Check

Before starting any pipeline, the Orchestrator SHOULD run a quick pre-flight check:

1. **Verify project compiles currently**: If the project is already broken, we need to know before we start
2. **Check for uncommitted changes**: `git status` to see if there's pending work
3. **Verify essential configs exist**: `package.json`, `tsconfig.json`, etc.
4. **Read the project journal**: Check `.opencode/journal/journal.yaml` for past work and failures

The pre-flight check should take < 15 seconds. Report findings to the user before proceeding.

### Build Gate & Smoke Test Requirements

Every implementation MUST pass through these mandatory validation gates:

| Gate             | Who Runs It   | What It Checks                                          | Failure Action                                  |
|------------------|---------------|---------------------------------------------------------|-------------------------------------------------|
| **Build Gate**   | Implementor   | Code compiles without errors (e.g., `npm run build`, `tsc`) | Implementor fixes and rebuilds before proceeding |
| **Lint Gate**    | Implementor   | Code passes linter/style checks (e.g., `eslint`, `prettier --check`, `tsc --noEmit`) | Implementor fixes lint errors before proceeding |
| **Security Scan**| Orchestrator  | npm audit for High/Critical vulns, secrets scan, anti-pattern scan | Report to user; may fix, except, or block       |
| **Smoke Test**   | QA            | Application boots/starts without crashing, or module loads cleanly | QA reports as Critical bug; cycle to Fixer      |
| **Plan Verify**  | Verifier      | Code matches plan-manifest.json checkpoints (structural + behavioral) | Score < 80% → cycle to Fixer; 3 attempts → PlanDescriber |

**Build Gate Protocol:**
- The Implementor MUST run the build command after writing code
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

**Security Scan Protocol:**
- After build + lint pass, the Orchestrator runs the Security Scan (directly or via subagent)
- Scan includes: `npm audit --audit-level=high`, secrets scan (rg), anti-pattern scan (rg)
- High/Critical dependency vulnerabilities → FAIL the gate (block pipeline)
- Secrets/anti-pattern findings → WARN (non-blocking, report findings)
- The Security Scan MUST NOT modify any files

**Smoke Test Protocol:**
- QA MUST run a simple smoke test (build is already verified by Implementor's Build Gate)
- The smoke test should be fast (< 10 seconds) and provide high confidence the application is runnable
- If the smoke test fails, QA reports it as a Critical severity bug
- The Orchestrator reviews the report and cycles to the **Fixer agent** for diagnosis and fix
- After Fixer applies the fix, QA re-runs the smoke test

## Agent Hand-off Protocol

### Hand-off Checklist
When passing work from one agent to the next, the Orchestrator MUST include:

1. **Context Summary**: What was done in the previous step(s)
2. **Artifacts**: Relevant file paths, outputs, or data produced
3. **Clear Objective**: Exactly what the next agent should do
4. **Constraints**: Any boundaries, rules, or restrictions
5. **Expected Output**: What the agent should return/report
6. **Agent Output Format reminder**: "Return your results with the structured output contract (status, resultSummary, decisions, warnings, changedFiles, artifacts, buildPassed/lintPassed where applicable)"

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
  plandescriber:
    totalTasks: 5
    successfulTasks: 3
    failedTasks: 2
    avgEffectiveness: "ok"
    behavioralCheckpointsPerPlan: 4.2
    lastTaskDate: "2026-05-19T10:30:00Z"
    commonFailurePatterns:
      - "Omits error handling checkpoints"
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

## Parallel Dispatch Workflow

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
When available, run:
```bash
ts-node skills/scripts/orchestration/check-parallelism.ts --manifest=plan-manifests/<feature>/v1-manifest.json --dir=./
```

This script reads the manifest, scans files for cross-references, and outputs a parallelism recommendation.

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
1. **Created** by Orchestrator at pipeline start
2. **Updated** before each agent hand-off with `nextObjective` and relevant artifacts
3. **Read** by each agent at startup (step 0 in their workflow)
4. **Appended** by Orchestrator after each agent completes (add to `agentHistory`, update `circuitBreaker`, update `agentOutputs`)
5. **Deleted** when the pipeline ends (after journal entry is written)

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

### When to Load Skills
| Pipeline Step | Skill to Load | Why |
|---------------|---------------|-----|
| Brainstorming | `plan-brainstorm` | Structured option exploration |
| Plan Describer | `plan-describe` + `code-philosophy` | Comprehensive roadmap creation |
| Implementation | `code-philosophy`, `backend-code-philosophy`, `frontend-code-philosophy` | Code quality adherence |
| Implementation | `accessibility` | When building UI components |
| Security Scan | `security-scan` | Dependency and secrets scanning |
| QA | `quality-assurance` | Testing methodology and reporting |
| Verification | `plan-verification` | Plan compliance checking |
| Browser Testing | `playwright-cli` | Browser automation |
| Pre-Flight | `smart-finder` | Cross-session journal search + proactive hazard detection |

### Minimal Pipeline Rule
Always select the shortest pipeline that can safely complete the task. Every extra agent adds latency and potential for error. When in doubt, ask the user.

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
- **Run check-consistency.ts**: Execute `ts-node skills/scripts/orchestration/check-consistency.ts --dir=./` and report findings

### Pass 4 — Completeness Check
- **File Completeness**: Compare the list of files the plan said would be created/modified against actual git diff
- **Scope Creep Detection**: Verify no extra files were created beyond what the plan specified
- **Deletion Check**: Verify no files were deleted without plan authorization

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

| Agent | Must Report `buildPassed`/`lintPassed`? | Must Report `decisions`? | Must Report `changedFiles`? |
|---|---|---|---|
| **Finder** | No (read-only) | Yes (exploration direction) | No |
| **PlanDescriber** | No | Yes (architectural decisions) | Yes (plan manifest) |
| **Implementor** | Yes (mandatory) | No | Yes (all files written) |
| **QA** | No | Yes (test decisions) | Yes (test files) |
| **Verifier** | No (read-only) | No | No |
| **Fixer** | Yes (mandatory) | Yes (root cause classification) | Yes (files modified) |
| **Browser Tester** | No | No | Yes (test scripts) |

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

### Fixer Output with Classification
```
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
  buildPassed: true
  lintPassed: true
```

### Orchestrator Verification Steps
After receiving an agent's output, the Orchestrator MUST:
1. Parse the structured output from the agent's report
2. Cross-reference `changedFiles` against actual disk state (using read/glob/grep)
3. Cross-reference `buildPassed`/`lintPassed` against the raw output excerpts
4. Append the agent's results to `agentHistory` in `agent-context.md`
5. Update `circuitBreaker.counters` if the gate failed
6. Update `agentOutputs.<agent-name>` with the structured data
7. Save the updated `agent-context.md`

## Output Verification
- **Parse structured output**: Extract the agent's structured output (status, resultSummary, changedFiles, buildPassed, etc.) from their report.
- **Cross-reference changed files**: Use read/glob/grep to verify that agent-reported `changedFiles` actually exist on disk with the expected content.
- **Cross-reference build/lint status**: Verify `buildPassed`/`lintPassed` against raw output excerpts.
- **Cross-check with plan**: Compare actual implementation against the original roadmap to ensure completeness.
- **Check for side effects**: Verify that changes didn't unintentionally modify unrelated files or introduce inconsistencies.

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

### Counter Reset
- Circuit breaker counters are reset when:
  - The task passes the gate successfully
  - PlanDescriber revises the roadmap
  - Fixer successfully resolves the root cause
  - The Orchestrator manually resets after user intervention

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

---

## Skill Loading Conflict Resolution

### The Problem
Multiple skills may be loaded simultaneously (e.g., `code-philosophy` + `accessibility` for a UI component). Their instructions may conflict. For example, one skill says "use named exports" while another shows default export examples.

### Priority Table
When multiple skills are loaded and provide conflicting guidance, use this priority order (highest wins):

| Priority | Skill | Domain | When It Overrides |
|----------|-------|--------|-------------------|
| 1 (Highest) | `accessibility` | Accessibility | UI components, forms, interactive elements |
| 2 | `security-scan` | Security | Auth, input handling, data access |
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

This skill includes executable scripts for project initialization and consistency checking.

### Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `init-project.ts` | Scaffolds new projects with proper structure, configs, and boilerplate | `ts-node <skills-dir>/scripts/orchestration/init-project.ts --name=<project-name> --dir=<output-dir> --type=lib\|app\|monorepo` |
| `check-consistency.ts` | Checks project for import/export style and naming convention consistency | `ts-node <skills-dir>/scripts/orchestration/check-consistency.ts --dir=<project-dir>` |

### Project Scaffolding

```bash
# Scaffold a new library project
ts-node skills/scripts/orchestration/init-project.ts --name=my-lib --dir=./ --type=lib

# Scaffold a new application
ts-node skills/scripts/orchestration/init-project.ts --name=my-app --dir=./ --type=app
```

### Consistency Checks

Run after implementation to ensure code style consistency:

```bash
ts-node skills/scripts/orchestration/check-consistency.ts --dir=./
```

Base directory for this skill: file:///home/oat/.config/opencode/skills/orchestration
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.

## Reference Files

| File | Purpose |
|------|---------|
| `references/agent-context-schema.md` | Canonical schema for `agent-context.md` YAML frontmatter — field types, validation rules, lifecycle |
