---
name: orchestration
description: Use this skill to orchestrate multiple agents to resolve complex problems and achieve overarching goals. This skill now uses modular reference docs for deep protocol details — load the skill for the nav hub, then load individual reference docs as needed.
---

# Skill: orchestration

## Quick Reference — New in v2.0

| Improvement | Script/Skill | Purpose |
|-------------|-------------|---------|
| **Pipeline State Machine** | `validate-transition.ts` | Enforces valid agent step transitions |
| **Parallel Dispatch** | `parallel-dispatch.ts` | Native parallel dispatch with phase grouping |
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
| **Semgrep SAST Scan** | skills/semgrep-scan/SKILL.md | Auto-loaded SAST analysis (no user trigger needed) |
| **Output Schema v2** | `references/output-schema.json` | Adds sources, pipelineError, rollback, checkpointResults |
| **Plan Manifest Generator** | `plan-manifest-generator.ts` | Structured plan-manifest.json with acceptance criteria |
| **Pipeline Selection Classifier** | `pipeline-selector.ts` | Auto-classifies task type → pipeline type |
| **Smart Circuit Breaker** | Enhanced `circuit-breaker` in references | Failure signature tracking, pattern detection, contextual thresholds |
| **Hand-off Completeness Check** | `check-handoff.ts` | Validates mandatory hand-off fields before dispatch |
| **Evidence Contract** | Evidence arrays in every agent output | Anchored, verifiable evidence for every claim |
| **Decision Provenance** | `evidence` field in every `decisions` entry | Source citations for every architectural decision |
| **Dynamic Context Injection** | Per-agent context filtering | 30-50% token savings per hand-off |
| **Progressive Summarization** | `summaries` field in agent-context.md | Summarizes older outputs as pipeline progresses |
| **Granular Archival** | `.opencode/pipeline-logs/` | Full output archived, summaries retained |
| **Pattern-Based Circuit Breaker** | Failure signatures + cycle detection | Smarter escalation than simple counters |
| **Contextual Thresholds** | Varies by task complexity (simple/moderate/complex) | Build: 1/2/3 attempts; Verifier: 1/2/3 |
| **Counter Decay** | Auto-decay by 1 every 24h | Prevents stale failure accumulation |
| **Security-Specific Thresholds** | Per pipeline profile (Standard/Sensitive/Infrastructure/Security Fix) | supplyChainThreshold: 1-3 |
| **Audit Trail** | `audit-log.ts` | Tamper-evident hash chain |
| **Agent Timeout** | `agent-timeout.ts` | Heartbeat-based timeout detection |
| **Context Lock** | `context-lock.ts` | Race prevention lock |
| **Automated Gitleaks** | `pipeline-gitleaks.ts` | Automated gitleaks scanning |
| **V2 Extended Output Schemas** | Fixer Root Cause, QA Security Coverage, Verifier Drift Detection | Standardized new fields |
| **Pipeline Log Archiving** | `pipeline-teardown.ts` | Full log archival + agent-context.md cleanup |

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

| Agent | Purpose | Reasoning Effort | Self-Review? |
|-------|---------|-----------------|--------------|
| **Finder** | Codebase exploration, research, information gathering. **Smart Finder**: Also reports proactive hazard detection (dead code, deprecated APIs, security anti-patterns). Returns structured knowledge graph. | 0.3 | Yes |
| **Orchestrator** | Brainstorming, task assignment, coordination | 0.1 | Yes |
| **PlanDescriber** | Detailed implementation roadmaps + plan-manifest.json with confidence score | High | Yes |
| **Implementor** | Write code following the plan. **Self-Reviewing Implementor**: Pre-implementation validation, self-review pass before reporting, scope guard. | None | Yes (mandatory) |
| **Fixer** | Debug and fix bugs. **Root Cause Classifier**: Categorizes bugs into taxonomy (plan-omission, implementation-error, edge-case-miss, integration-mismatch, environment-issue). Reports fix confidence score. | High | Yes |
| **QA** | Smoke tests, bug discovery, coverage analysis. **Proactive QA**: Auto-generates edge case tests, runs non-functional checks (perf, a11y, security), performs regression impact analysis. | 0.1 | Yes |
| **Verifier** | Compare implementation against plan manifest. **Plan Diff Verifier**: Also suggests missing checkpoints, detects plan drift, performs cross-file consistency checks. | 0.1 | Yes |
| **Security Scan** | Dependency vulnerability scan, secrets scan, anti-pattern scan, **+ auto-loaded semgrep SAST scan**. Reports risk-level classified findings with auto-remediation suggestions. | Read-only | N/A |
| **Browser Tester** | Playwright CLI browser automation, UI bug discovery | 0.2 | No |
| **Documentor** | Project documentation, API docs, inline comments, ADRs | 0.2 | Yes |
| **Integrator** | Verifies cross-file consistency and wires new files into the project: updates barrel files, DI registrations, route wiring, and fixes import paths. Phase 1: read-only verification. Phase 2: write wiring. | 0.1 | Yes |

> See `references/agent-roles.md` for the complete reference.

## Standard Workflow Pipeline

```
1. FINDER ──► Explore codebase, gather context, research dependencies
          │
2. ORCHESTRATOR ──► Brainstorm with user interactively, explore ideas, converge on direction
          │
3. PLAN DESCRIBER ──► Create detailed, step-by-step implementation roadmap
          │              └──► Also produces plan-manifest.json for verification
          │
4. IMPLEMENTOR ──► Write code strictly following the plan (can dispatch multiple Implementors in parallel)
           │
    ┌──────┴──────────────┐
    ▼ INTEGRATOR (Phase 1: Verify)     ▼
    │  Verify cross-file imports,       │
    │  type signatures, interfaces       │
    └────────┬───────────┘
           │ (inconsistencies found → Fixer, then re-run Integrator Phase 1)
           ▼
    ┌──────┴──────────────┐
    ▼ INTEGRATOR (Phase 2: Wire)        ▼
    │  Update barrel files,              │
    │  DI registrations, routes          │
    └────────┬───────────┘
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
   ┌──────┴──────┐
   ▼ TEST GATE   ▼ (MANDATORY)
   │  Implementor MUST run the   │
   │  project test suite and     │
   │  report results. Falls back │
   │  gracefully if no test      │
   │  framework detected.        │
   └──────┬──────┘
          │ (tests fail → cycle to Fixer)
          ▼
   ┌──────┴──────┐
   ▼ SECURITY    ▼ (MANDATORY)
   │  SCAN GATE           │
   │  1. Load security-scan  │
   │     → npm audit,        │
   │       secrets, anti-    │
   │       pattern scan      │
   │  2. ★ Auto-load         │
   │     semgrep-scan skill  │
   │     → SAST rules (no    │
   │       user trigger)     │
   └──────┬──────┘
          │ (High/Crit vulns or SAST → block pipeline)
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
   │              └──► Structural checks (Pass 1)
   │              └──► Behavioral checks (Pass 2)
   │              └──► Acceptance criteria checks (Pass 2.5)
   │              └──► Security Test Coverage Cross-Check (Pass 2.6)
   │              └──► Cross-cutting checks (Pass 3)
   │              └──► Plan drift detection (Pass 4)
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
   │              └──► JSDoc/TSDoc on new/modified exports
   │              └──► CHANGELOG.md entries
   │              └──► README updates
   │              └──► Migration guide (if breaking changes)
          │
8. ORCHESTRATOR ──► Run pipeline-teardown (archive logs),
                      review all results, report to user
```

### When to Skip Steps
- **Simple/familiar tasks**: Skip Finder, go directly to PlanDescriber → Implementor → Security Scan (incl. auto semgrep) → QA.
- **Exploratory/research tasks**: Use only Finder, report findings directly to user.
- **Bug fixes (known root cause)**: Skip PlanDescriber, go directly to Fixer for the fix, then QA + Verifier.
- **Trivial config changes**: Skip all gates — just delegate to Implementor.
- **Documentation updates**: Use Documentor only — no plan, no tests, no verification.

### When to Use Specialized Pipelines

**TDD Pipeline:**
```
PlanDescriber ──► QA (write tests first) ──► Implementor ──► Build ──► Lint ──► Security Scan ──► Verifier
```

**Parallel Micro-Pipeline (Frontend + Backend Split):**
```
Pipeline A: PlanDescriber(frontend) → Implementor(frontend) → Build(frontend)
Pipeline B: PlanDescriber(backend) → Implementor(backend) → Build(backend)
                     ↓                        ↓
                  ──── MERGE ──── Integration QA → Full Verifier
```

### Pre-Flight Check

Before starting any pipeline, the Orchestrator MUST run:
```bash
ts-node skills/scripts/orchestration/pipeline-init.ts --feature=<name> --pipeline-type=<type>
```

This performs:
1. **Pre-Flight Checks**: git status (dirty files, branch, last commit SHA), project compilation check, stale `agent-context.md` detection (>1h old with "running" status)
2. **agent-context.md Creation**: Writes full YAML frontmatter (pipeline identity, circuit breaker with complexity-based thresholds, git state, empty agent history)
3. **Pipeline Logs Directory**: Creates `.opencode/pipeline-logs/` if needed
4. **Pre-flight security check**: `package-lock.json` integrity, `npm audit signatures`, lockfile age check (>7 days since last audit)
5. **Agent Readiness Check**: Verifies agent configs, tool permissions, skill access:
   ```bash
   ts-node skills/scripts/orchestration/check-agent-readiness.ts --pipeline-type=<type>
   ```

**When to Skip**: For trivial quick-fix tasks, the Orchestrator may skip full pre-flight and create a minimal `agent-context.md` manually.

### Pipeline Teardown

After every pipeline completes (success or failure), the Orchestrator MUST run:
```bash
ts-node skills/scripts/orchestration/pipeline-teardown.ts --feature=<name> --pipeline-type=<type> --result=pass|fail|partial --duration-minutes=<N>
```

This performs:
1. Reads agent-context.md, extracts pipeline state, circuit breaker history, agent outputs
2. Archives raw outputs to `.opencode/pipeline-logs/<pipelineId>/`
3. Deletes or preserves agent-context.md

## Gates & Validation

See the following reference docs for detailed gate protocols:
- **[references/pipeline-gates.md](references/pipeline-gates.md)** — Complete gate protocols: Build Gate, Lint Gate, Code Quality Gate, Test Gate, Security Scan (incl. gitleaks, semgrep, trivy), Smoke Test, Security Test Coverage Gate, Acceptance Gate
- **[references/agent-context-lifecycle.md](references/agent-context-lifecycle.md)** — agent-context.md schema, lifecycle, stale detection
- **[references/error-taxonomy.md](references/error-taxonomy.md)** — Unified PipelineError types, output contract validation
- **[references/output-verification.md](references/output-verification.md)** — Structured output contracts, per-agent responsibilities, rejection protocol
- **[references/pipeline-selection.md](references/pipeline-selection.md)** — Pipeline type classification, quick presets, when to skip steps, skill loading

### Gate Summary Table

| Gate | Who Runs It | What It Checks | Failure Action |
|---|---|---|---|
| Build Gate | Implementor | Code compiles | Fix and rebuild |
| Lint Gate | Implementor | Linter/style checks | Fix lint errors |
| Code Quality | Subagent with pmd-scan | PMD + CPD duplicate detection | FAIL gate |
| Test Gate | Implementor | npm test / jest / vitest | Cycle to Fixer |
| Security Scan | Subagent with security-scan | npm audit, secrets, SAST, supply chain | Report/block |
| Smoke Test | QA | App boots without crashing | Critical → Fixer |
| Security Test Cov. Gate | QA + Verifier | >=80% security test coverage | <50% → QA loop |
| Plan Verify | Verifier | Plan manifest compliance >=80% | <80% → Fixer loop |

### Error Routing Table

| Build Error Type | Route To |
|---|---|
| `import-error` | **Integrator** (fix import paths) |
| `type-error` | **Fixer** (fix type signatures) |
| `syntax-error` | **Implementor** (fix syntax) |
| `config-error` | **Orchestrator** (fix tsconfig/ESLint config) |
| `dependency-error` | **User** (fix package.json) |
| `lint-error` | **Implementor** (fix code style) |
| `test-failure` | **Fixer** (fix test assertions) |
| `missing-export` | **Implementor** (add missing export) |
| `duplicate-identifier` | **Implementor** (remove duplicate) |
| `unknown-error` | **Implementor** (manual review) |

## Agent Hand-off & Feedback

See **[references/agent-handoff.md](references/agent-handoff.md)** for:
- Complete hand-off checklist (8 steps)
- Evidence format with content hashes
- All example hand-offs (PlanDescriber, Verifier, Fixer, Documentor)
- Evidence Hand-off Protocol
- Fixer Feedback Loop (9-step protocol)
- Root Cause Classifier (5 categories)
- Fix Confidence Score (1-10 scale)

### Feedback Loop Summary

```
QA/Verifier reports → Orchestrator reviews → Fixer diagnoses & fixes → QA re-verifies → Verifier re-verifies
```

### Escalation Criteria

If the same issue resurfaces after 3 Fixer attempts, escalate back to PlanDescriber for roadmap revision.

## Circuit Breaker

See **[references/circuit-breaker.md](references/circuit-breaker.md)** for:
- 3-state circuit breaker (Closed/Open/Half-Open)
- Escalation limits and contextual thresholds
- Counter decay (24h)
- Security-specific thresholds
- Semantic circuit breaker (failure signature tracking)
- Agent Action Audit Trail (tamper-evident audit log)
- Evidence Validation Gate (truthfulness checks, evidence quality scoring)
- Cross-Agent Evidence Provenance tracking
- Failure Summary Format
- Standardized Error Format

## Parallel Dispatch

See **[references/parallel-dispatch.md](references/parallel-dispatch.md)** for:
- Parallelism verification protocol
- Decision tree (fallback)
- Automated dispatch manifest generation
- Integrator Phase 1 merge verification (4-pass)
- Shared Test Manifest for QA + Browser Tester coordination

## Context Optimization

See:
- **[references/context-budgeting.md](references/context-budgeting.md)** — Progressive summarization, per-agent context filtering, granular archival strategy
- **[references/smart-finder.md](references/smart-finder.md)** — Proactive hazard detection, knowledge graph output, familiarity scoring
- **[references/self-reviewing-implementor.md](references/self-reviewing-implementor.md)** — Pre-implementation validation, self-review pass, scope guard

## Plan Manifest & Coverage

### Plan Manifest Versioning

Store manifests under `plan-manifests/<feature>/v<version>-manifest.json`:
- `plan-manifests/user-profile/v1-manifest.json`
- `plan-manifests/user-profile/v2-manifest.json`

**Version Rules:**
- Start at `v1` for initial roadmap creation
- On revision, increment to `v2`, `v3`, etc.
- **Never overwrite a previous version** — always create a new numbered version
- Each manifest's `manifestVersion` field must match the file version number

### Coverage Analysis

| Project Type | Minimum Line Coverage | Critical Paths (auth, payment) |
|---|---|---|
| Library | 70% | 90% |
| Application | 60% | 85% |
| Prototype | 40% (informational) | N/A |

**Coverage Auto-Loop:** If coverage < threshold, Orchestrator dispatches Implementor to add tests, then re-runs QA. After 3 failed attempts, escalate to user.

### Acceptance Criteria Integration

```
Build Gate → Lint Gate → Security Scan → QA → ACCEPTANCE GATE → SECURITY TEST COVERAGE GATE → Verifier → Documentor
```

**Acceptance Gate Protocol:** Check manifest for `acceptanceCriteria` checkpoints. If none exist, skip. If any fail, cycle to Fixer.

### Pipeline Order Fix (Documentor after Verifier)

**Corrected order:**
```
QA → Acceptance Gate → Security Test Coverage Gate → Verifier → Documentor → Orchestrator
```
Documenting code before it's verified is wasteful — always verify first, then document.

## Tooling

| Script | Purpose | Usage |
|---|---|---|
| pipeline-init.ts | Pipeline init + pre-flight | `ts-node .../pipeline-init.ts --feature=...` |
| pipeline-teardown.ts | Pipeline teardown + archive | `ts-node .../pipeline-teardown.ts --feature=...` |
| validate-context.ts | Validate agent-context.md | `ts-node .../validate-context.ts --context=agent-context.md` |
| validate-output-contract.ts | Validate agent output contract | `ts-node .../validate-output-contract.ts --pipeline` |
| check-plan-contract.ts | Pre-implement contract validation | `ts-node .../check-plan-contract.ts --manifest=...` |
| check-plan-adherence.ts | Post-implement adherence gate | `ts-node .../check-plan-adherence.ts --manifest=... --dir=./` |
| plan-diff-report.ts | Plan vs implementation diff | `ts-node .../plan-diff-report.ts --manifest=...` |
| validate-manifest-schema.ts | Validate manifest JSON structure | `ts-node .../validate-manifest-schema.ts --manifest=...` |
| parallel-dispatch.ts | Generate parallel dispatch manifests | `ts-node .../parallel-dispatch.ts --manifest=...` |
| shared-test-manifest.ts | Coordinated QA + Browser testing | `ts-node .../shared-test-manifest.ts --generate ...` |
| pipeline-checkpoint.ts | Git checkpoint after each step | `ts-node .../pipeline-checkpoint.ts --pipeline-id=...` |
| pipeline-replay.ts | Re-run from checkpoints | `ts-node .../pipeline-replay.ts --pipeline-id=...` |
| audit-log.ts | Tamper-evident audit trail | `ts-node .../audit-log.ts init ...` |
| agent-timeout.ts | Heartbeat-based timeout detection | `ts-node .../agent-timeout.ts watch ...` |
| context-lock.ts | Race prevention lock | `ts-node .../context-lock.ts acquire ...` |
| test-gate.ts | Automated test regression detection | `ts-node .../test-gate.ts` |
| pipeline-gitleaks.ts | Automated gitleaks scanning | `ts-node .../pipeline-gitleaks.ts --workspace=...` |
| check-agent-readiness.ts | Pre-flight agent verification | `ts-node .../check-agent-readiness.ts --agents=...` |
| unified-pipeline-error-schema.ts | Error code lookup | `ts-node .../unified-pipeline-error-schema.ts --lookup=...` |
| provenance-tracker.ts | Checkpoint lifecycle tracking | `ts-node .../provenance-tracker.ts --implement --manifest=...` |
| check-handoff.ts | Hand-off completeness validation | `ts-node .../check-handoff.ts --agent=<name> --context="..."` |

## Reference Files

| File | Content |
|---|---|
| `references/pipeline-gates.md` | Build, Lint, Code Quality, Test, Security, Smoke, Coverage, Acceptance gates |
| `references/pipeline-selection.md` | Pipeline types, presets, skill loading |
| `references/agent-handoff.md` | Hand-off protocol, evidence format, fixer feedback loop |
| `references/circuit-breaker.md` | Circuit breaker, audit trail, failure summary, error format |
| `references/parallel-dispatch.md` | Parallel dispatch, merge verification, shared test manifest |
| `references/error-taxonomy.md` | Unified error types, output contract validation |
| `references/output-verification.md` | Structured output contracts, per-agent responsibilities |
| `references/context-budgeting.md` | Progressive summarization, per-agent filtering, archival |
| `references/smart-finder.md` | Hazard detection, knowledge graph, familiarity scoring |
| `references/self-reviewing-implementor.md` | Pre-validation, self-review, scope guard |
| `references/agent-context-lifecycle.md` | agent-context.md schema, lifecycle, stale detection |
| `references/agent-context-schema.md` | Canonical schema (pre-existing) |
| `references/agent-roles.md` | Agent roles reference (pre-existing) |
| `references/output-schema.json` | Output JSON schema (pre-existing) |
| `references/skill-conflict-resolution.md` | Skill loading conflict resolution (pre-existing) |