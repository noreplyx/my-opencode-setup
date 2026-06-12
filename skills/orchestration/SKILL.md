--
name: orchestration
description: Use this skill to orchestrate multiple agents to resolve complex problems and achieve overarching goals. This skill now uses modular reference docs for deep protocol details - load the skill for the nav hub, then load individual reference docs as needed.
---

# Skill: orchestration

> **Canonical orchestrator instructions are in `agents/orchestrator.md`.**
> This skill is a **navigation hub** - it provides the Quick Reference, Tooling table, and Reference Files index.
> Load the orchestrator agent config for the full protocol details (pipeline workflow, gates, hand-off, circuit breaker, etc.).

## Quick Reference - New in v2.0

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
| **Finder Workflow** | `skills/finder-workflow/SKILL.md` | Decoupled workflow for Finder - exploration methodology, hazard detection, evidence gathering |
| **QA Workflow** | `skills/qa-workflow/SKILL.md` | Decoupled workflow for QA |
| **Verifier Workflow** | `skills/verifier-workflow/SKILL.md` | Decoupled workflow for Verifier |
| **Security Scan (Unified)** | `skills/security-scan/SKILL.md` | Unified security: self-review, auto-detection, regression tests, severity, anti-pattern fixes, tool execution (SAST, secrets, deps, supply chain) |
| **Semgrep SAST Scan** | skills/semgrep-scan/SKILL.md | Auto-loaded SAST analysis (no user trigger needed) |
| **Output Schema v2** | `references/output-schema.json` | Adds sources, pipelineError, rollback, checkpointResults |
| **Plan Manifest Generator** | `plan-manifest-generator.ts` | Structured plan-manifest.json with acceptance criteria |
| **Pipeline Selection Classifier** | `pipeline-selector.ts` | Auto-classifies task type -> pipeline type |
| **Smart Circuit Breaker** | Enhanced `circuit-breaker` in references | Failure signature tracking, pattern detection, contextual thresholds |
| **Hand-off Completeness Check** | `check-handoff.ts` | Validates mandatory hand-off fields before dispatch |
| **Evidence Gate** | `evidence-quality-gate.ts` | Real-time evidence quality validation after every agent hand-off |
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

---

## Standard Workflow Pipeline

The full standard pipeline orchestrates the following agents and quality gates in sequence:

```
┌──────────────────────────────────────────────────────────────────────┐
│                       STANDARD WORKFLOW PIPELINE                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                PLANNING & EXPLORATION PHASE                   │    │
│  │                                                              │    │
│  │  Finder ──► Orchestrator (brainstorm) ──► PlanDescriber       │    │
│  └──────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                  IMPLEMENTATION PHASE                         │    │
│  │                                                              │    │
│  │  Implementor                                                  │    │
│  │       │                                                      │    │
│  │       ▼                                                      │    │
│  │  Integrator (Phase 1: Verify Cross-References)               │    │
│  │       │                                                      │    │
│  │       ▼                                                      │    │
│  │  Integrator (Phase 2: Wire - barrel files, DI, routes)       │    │
│  └──────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                  QUALITY GATE SEQUENCE                        │    │
│  │                                                              │    │
│  │  1. Build Gate                                                │    │
│  │       ▼                                                      │    │
│  │  2. Lint Gate                                                 │    │
│  │       ▼                                                      │    │
│  │  3. Security Self-Review Gate   (17-item checklist)           │    │
│  │       ▼                                                      │    │
│  │  4. Code Quality Gate           (PMD static analysis + CPD)   │    │
│  │       ▼                                                      │    │
│  │  5. Test Gate                   (automated regression detect) │    │
│  │       ▼                                                      │    │
│  │  6. Security Scan Gate          (SAST, secrets, deps, vulns)  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │               QA & VERIFICATION PHASE                         │    │
│  │                                                              │    │
│  │  QA (Smoke Test + Security Regression)                       │    │
│  │       │                                                      │    │
│  │       ▼                                                      │    │
│  │  Security Test Coverage Gate                                 │    │
│  │       │                                                      │    │
│  │       ▼                                                      │    │
│  │  Acceptance Gate                                             │    │
│  │       │                                                      │    │
│  │       ▼                                                      │    │
│  │  Verifier (plan compliance + drift detection)                │    │
│  └──────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                   FINALIZATION PHASE                          │    │
│  │                                                              │    │
│  │  Documentor ──► Orchestrator (report + teardown)             │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Gate Descriptions

| Gate | What It Does | Who Runs It | Failure Action |
|------|-------------|-------------|----------------|
| **Build Gate** | `npm run build` / `npx tsc --noEmit` | Implementor | Fix build errors, retry |
| **Lint Gate** | `eslint`, `prettier --check`, etc. | Implementor | Fix lint errors, retry |
| **Security Self-Review Gate** | Validates 17-item security + quality checklist | Implementor | Pipeline blocked until all items pass |
| **Code Quality Gate** | PMD static analysis + copy-paste detection | Implementor / Subagent | Violations fail the gate |
| **Test Gate** | `npm test` / `jest` / `vitest run` | Subagent | Cycle to Fixer |
| **Security Scan Gate** | SAST (semgrep), secrets (gitleaks), vulns (trivy, npm audit) | Security Subagent | Severity-based pass/fail |

## Protocol Reference

All orchestration protocols are defined in `agents/orchestrator.md`:

| Protocol | Section in orchestrator.md |
|----------|---------------------------|
| Pre-Flight Check | Setup -> Pre-Flight Check |
| Cross-Session Learning | Setup -> Cross-Session Learning |
| Calibration-Conscious Dispatch | Setup -> Agent Calibration Database |
| Context Window Budgeting | Setup -> Context Window Budgeting |
| Rollback | Setup -> Rollback Protocol |
| Parallel Dispatch | Setup -> Parallel Dispatch Workflow |
| agent-context.md tracking | Setup -> Agent Context |
| Project Journal | Setup -> Project Journal Protocol |
| Pipeline Selection | Setup -> Pipeline Selection Protocol |
| Brainstorming | Setup -> Orchestrator as Brainstormer |
| Security Scan | Setup -> Security Scan Protocol |
| Test Gate | Setup -> Test Gate Protocol |
| Verification | Setup -> Verification Protocol |
| Failure Escalation | Setup -> Failure Summary & Escalation |
| Pipeline Retrospective | Setup -> Pipeline Retrospective Protocol |
| Pipeline Init/Teardown | Setup -> Pipeline Init & Teardown Scripts |
| Integrator Cross-File Consistency | Setup -> Integrator Phase 1 |
| Context Validation | Setup -> Context Validator |
| Pre-Flight Security | Setup -> Pre-Flight Check (step 5) |
| Security Self-Review | Setup -> Implementor Security Self-Review |
| Security Checkpoint Auto-Detection | Setup -> Verifier Pass 2b |
| Security Regression Tests | Setup -> QA Security Test Generation |
| Supply Chain Security | Setup -> Supply Chain Security |
| Agent Action Audit Trail | Setup -> Agent Action Audit Trail |
| Output Contract Validation | Setup -> Output Verification |
| Security Tool Self-Test | Setup -> security-scan skill |
| Dry-Run Mode | Setup -> shared-agent-workflow skill |
| Reproduction Command | Setup -> shared-agent-workflow skill |
| Error Reproduction Packets | Setup -> shared-agent-workflow skill |
| Git Checkpoints | Setup -> pipeline-checkpoint.ts |
| Pipeline Replay | Setup -> pipeline-replay.ts |
| Debug Agent | Setup -> Debug Agent |
| Fixer Diagnostics | Setup -> Fixer Automated Diagnostics Protocol |
| Shared Agent Workflow | Setup -> shared-agent-workflow skill |
| Evidence Gate | Setup -> Evidence Gate (pipeline-gates.md) |
| PlanDescriber Quality Feedback | Setup -> plan-quality-score.ts |

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
| security-self-review-gate.ts | Enforce implementor security self-review gate | `ts-node .../security-self-review-gate.ts --enforce --pipeline-id=<id>` |
| check-agent-readiness.ts | Pre-flight agent verification | `ts-node .../check-agent-readiness.ts --agents=...` |
| unified-pipeline-error-schema.ts | Error code lookup | `ts-node .../unified-pipeline-error-schema.ts --lookup=...` |
| provenance-tracker.ts | Checkpoint lifecycle tracking | `ts-node .../provenance-tracker.ts --implement --manifest=...` |
| evidence-quality-gate.ts | Validate evidence quality and verifiability after every agent hand-off | `ts-node .../evidence-quality-gate.ts --context=agent-context.md` |
| check-handoff.ts | Hand-off completeness validation | `ts-node .../check-handoff.ts --agent=<name> --context="..."` |
| auto-rollback.ts | Automatic rollback on pipeline failure | `ts-node .../auto-rollback.ts --pipeline-id=<id> --manifest=...` |
| check-evidence-regression.ts | Scan historical evidence for staleness | `ts-node .../check-evidence-regression.ts --manifest=...` |
| circuit-breaker.ts | Circuit breaker state management | `ts-node .../circuit-breaker.ts --status --pipeline-id=<id>` |
| cost-tracker.ts | Track pipeline execution costs | `ts-node .../cost-tracker.ts --pipeline-id=<id>` |
| delegation-gate.ts | Validate orchestrator delegated all work | `ts-node .../delegation-gate.ts --context=agent-context.md` |
| dependency-check.ts | Check dependency graph for conflicts | `ts-node .../dependency-check.ts --manifest=...` |
| monitor-pipeline.ts | Real-time pipeline monitoring | `ts-node .../monitor-pipeline.ts --pipeline-id=<id>` |
| pipeline-selector.ts | Auto-classify task type into pipeline | `ts-node .../pipeline-selector.ts --description="..."` |
| pipeline-visualizer.ts | Generate pipeline visualization | `ts-node .../pipeline-visualizer.ts --pipeline-id=<id>` |
| plan-quality-score.ts | Verifier-PlanDescriber feedback score | `ts-node .../plan-quality-score.ts --record --pipeline-id=<id> --compliance-score=<score>` |
| security-prescreen.ts | Pre-plan security risk classification | `ts-node .../security-prescreen.ts --feature=<name> --description="..."` |
| skill-drift-detector.ts | Detect skill definition drift | `ts-node .../skill-drift-detector.ts --skill=<name>` |
| test-pipeline.ts | Integration test for pipeline | `ts-node .../test-pipeline.ts --pipeline-type=<type>` |
| validate-transition.ts | Validate pipeline step transitions | `ts-node .../validate-transition.ts --from=<step> --to=<step> --type=<pipeline>` |

## Reference Files

| File | Content |
|---|---|
| `references/pipeline-gates.md` | Build, Lint, Security Self-Review, Code Quality, Test, Security, Smoke, Coverage, Acceptance gates |
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

Scripts referenced in this skill use workspace-root-relative paths: `skills/scripts/orchestration/<script>.ts`
Reference files are relative to this skill's directory: `skills/orchestration/references/<file>.md`


