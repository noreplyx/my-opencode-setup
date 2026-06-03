# OpenCode AI Agent System

This directory contains the configuration for the OpenCode AI agent system.

## Agents

Agents are auto-discovered by the OpenCode platform from the filesystem:

- **Primary Agent**: `agents/orchestrator.md`
- **Sub-Agents**: All `.md` files under `agents/subagent/`

Each agent file is a markdown document with YAML frontmatter (delimited by `---`) that defines the agent's mode, tools, permissions, and behavior instructions.

### Agent Roles

| Agent | File | Role |
|---|---|---|
| **Orchestrator** | `agents/orchestrator.md` | Delegates tasks, coordinates agents, reviews results, reports to user |
| **Finder** | `agents/subagent/finder.md` | Codebase research, web search, information gathering (read-only) |
| **Browser Tester** | `agents/subagent/browser-tester.md` | Browser automation with Playwright CLI -- explore websites, find UI/UX bugs, verify implementations, create test scripts |
| **Documentor** | `agents/subagent/documentor.md` | Creates documentation -- README, API docs, inline comments, architecture docs |
| **PlanDescriber** | `agents/subagent/plandescriber.md` | Creates detailed implementation roadmaps + `plan-manifest.json` |
| **Implementor** | `agents/subagent/implementor.md` | Writes code following the plan; runs mandatory Build Gate + Lint Gate. No thinking -- pure execution. |
| **Fixer** | `agents/subagent/fixer.md` | Debugs and fixes bugs. Diagnoses root causes, applies targeted fixes. Has high reasoning effort. |
| **QA** | `agents/subagent/qa.md` | Runs Smoke Test, code review, bug discovery, coverage analysis, quality checks |
| **Verifier** | `agents/subagent/verifier.md` | Compares implementation against plan manifest (structural + behavioral checks) |
| **Integrator** | `agents/subagent/integrator.md` | Verifies cross-file consistency and wires new files into the project: barrel files, DI, routes |

## Pipeline

The standard orchestration workflow follows this sequence:

```
Finder -> Orchestrator (brainstorm) -> PlanDescriber -> Implementor (checkpoint-driven: contract validation -> implement per-checkpoint -> self-verify -> adherence gate) -> Integrator -> Build Gate -> Lint Gate -> Test Gate -> Security Scan -> QA -> Acceptance Gate -> Verifier (fast-pass if adherence >= 90%) -> Documentor -> Orchestrator (report)
                                                                                         ->                                              ->
                                                                                     Fixer (feedback loop)                       Debug (after 3 Fixers)
``````

### Validation Gates

| Gate | Owner | What It Checks | Failure Action |
|---|---|---|---|
| **Build Gate** | Implementor | Code compiles without errors | Fix and rebuild before proceeding |
| **Lint Gate** | Implementor | Code passes linter/style checks (eslint, prettier, tsc --noEmit) | Fix lint errors before proceeding |
| **Security Scan** | Orchestrator | Semgrep SAST + Gitleaks secrets + Trivy vuln/misconfig + npm audit + anti-patterns | Report to user; may fix, except, or block |
| **Smoke Test** | QA | App boots/starts without crashing | Critical bug -> cycle to Fixer |
| **Plan Verify** | Verifier | Code matches plan-manifest.json checkpoints (score >=80%) | Score < 80% -> cycle to Fixer; 3 attempts -> PlanDescriber |
| **Test Gate** | Implementor | Runs project test suite (`npm test`, `vitest run`, etc.) and reports pass/fail | Tests fail -> cycle to Fixer |

### Fixer Agent

The **Fixer** agent is called when QA discovers bugs or Verifier finds deviations. Unlike the Implementor (which is pure plan-following with no reasoning), the Fixer has `reasoningEffort: "high"` and is explicitly allowed to think and debug.

**Workflow**: Receive bug/deviation report -> Diagnose root cause -> Apply minimal targeted fix -> Build + Lint -> Self-check -> Report

**Escalation**: If the same issue persists after 3 Fixer attempts, the Orchestrator escalates to PlanDescriber for roadmap revision.

### Skip Shortcuts

- **Simple/familiar tasks**: Skip Finder, go directly to PlanDescriber -> Implementor -> Security Scan -> QA
- **Exploratory/research tasks**: Use only Finder, report findings directly
- **Bug fixes (known root cause)**: Skip PlanDescriber, go directly to Fixer -> QA -> Verifier
- **Trivial config changes**: Skip all gates -- just delegate to Implementor
- **UI/website testing**: Use Browser Tester to explore, find bugs, and verify UI implementations
- **Documentation updates**: Run Documentor after any pipeline that created/modified code

### Pre-Flight Check

Before starting any pipeline, the Orchestrator runs a quick pre-flight check:
1. Verify the project currently compiles
2. Check for uncommitted changes (`git status`)
3. Verify essential configs exist (`package.json`, `tsconfig.json`)

### Circuit Breaker & Timeout System

The pipeline includes a circuit breaker to prevent infinite agent loops:

| State | Meaning | Action |
|---|---|---|
| **Closed** | Normal operation | Agents execute as normal |
| **Open** | Repeated failures detected | Orchestrator pauses cycling to the same agent |
| **Half-Open** | Probation period | One retry allowed to test resolution |

**Escalation limits**:
- 3 Fixer attempts for same bug -> escalate to PlanDescriber
- 3 Verifier failures -> escalate to PlanDescriber
- 3 Security Scan failures -> escalate to user for direction
- 5 total pipeline retries -> pause and report to user

## Built-in Skills

| Skill | Used By | Description |
|---|---|---|
| `orchestration` | Orchestrator | Multi-agent orchestration, task management, pipeline workflows |
| `plan-brainstorm` | Orchestrator | Collaborative brainstorming with trade-off analysis |
| `skill-creator` | Orchestrator | Skill lifecycle management -- create, modify, evaluate AI agent skills |
| `project-onboarding` | Orchestrator | 5-phase project onboarding: detect, map, document, set up, report |
| `security-scan` | Orchestrator | Dependency vulnerability scanning, secrets detection, anti-pattern checks |
| `plan-describe` | PlanDescriber | Detailed implementation roadmap creation |
| `plan-verification` | Verifier | Plan-to-implementation verification, compliance scoring |
| `quality-assurance` | QA, Browser Tester | Software testing, bug discovery, quality standards |
| `code-philosophy` | Implementor, Fixer, PlanDescriber | SOLID, clean code, clean architecture, security |
| `backend-code-philosophy` | Implementor, Fixer, PlanDescriber | Backend principles: scaling, caching, database patterns |
| `frontend-code-philosophy` | Implementor, Fixer, PlanDescriber | Frontend principles: rendering, state management, a11y |
| `accessibility` | Implementor, QA | Accessibility guidelines for UI development |
| `api-documentation` | Implementor, Documentor | API documentation standards and patterns |
| `devops-cicd` | Implementor | DevOps and CI/CD pipeline patterns |
| `playwright-cli` | Browser Tester, Implementor | Browser automation: navigate, click, fill, snapshot, eval, console, network, etc. |
| `trivy-scan` | Orchestrator | Vulnerability + IaC misconfiguration scanning via Trivy in Podman. Auto-loaded in Security Scan gate. |
| gitleaks-scan | Orchestrator | Git history secret scanning |
| semgrep-scan | Orchestrator (auto-loaded) | SAST static analysis -- auto-loaded during Security Scan gate |
| ast-grep | Implementor, Fixer | AST-based pattern matching for code analysis |
| osv-scanner | Orchestrator | Open Source Vulnerability scanner |
| pmd-scan | Orchestrator | PMD static analysis scanner |
| `owasp-zap-scan` | Orchestrator | OWASP ZAP DAST web application scanning -- baseline, full active, and API scans via Podman (optional post-deployment). |

### Browser Tester Agent

The **Browser Tester** agent uses Playwright CLI to automate real browser interactions:

- **Website Feature Discovery** -- Open sites, navigate pages, explore UI flows, document features
- **Bug Discovery & Reporting** -- Find UI/UX bugs, check console errors, network failures, document with snapshots
- **Implementation Verification** -- Confirm UI/API fixes work correctly in the live browser
- **Test Script Creation** -- Generate Playwright test scripts from discovered workflows

**Workflow**: Load `playwright-cli` skill -> open browser -> explore/interact -> document findings -> close browser -> report

### Documentor Agent

The **Documentor** agent creates and maintains project documentation:

- **README & Project Documentation** -- Update README.md with new features, usage instructions, config changes
- **API Documentation** -- Document new endpoints with request/response schemas using `api-documentation` skill
- **Inline Code Documentation** -- Add JSDoc/TSDoc comments for public APIs and complex logic
- **Architecture Decision Records** -- Document key architecture decisions and trade-offs

**Workflow**: Load `api-documentation` skill -> Review implementation changes -> Write docs -> Verify accuracy -> Report

**When to use**: After any pipeline that creates or modifies code.

## Plan Manifests

PlanDescriber produces a machine-readable `plan-manifest.json` alongside every roadmap. The manifest contains checkpoints that the Verifier agent uses to programmatically confirm the implementation matches the plan.

- **Location**: `plan-manifests/<feature>/v<version>-manifest.json` (versioned -- never overwrite)
- **Checkpoint types**: structural (files, exports, types, routes, file deletions) and behavioral (error handling, validation, logging, middleware)
- **Compliance score**: `(Passed / (Total - Skipped)) x100`
- **Schema validation**: Manifests are validated against JSON schema
- **Deletion verification**: Use `fileNotExists` kind to verify files/directories have been successfully removed

## Merge Coordinator

Merge Coordinator responsibilities have been merged into the Integrator agent. The Integrator now performs Phase 1 (read-only cross-file consistency verification) before Phase 2 (write wiring).

## Integrator

After parallel Implementor dispatch, the **Integrator** agent runs in two phases:
- **Phase 1 (Read-Only Verification)**: Verifies cross-file consistency -- checking imports resolve, type signatures match, interfaces align, and barrel file re-exports are complete. Does not modify any files.
- **Phase 2 (Write Wiring)**: Updates barrel files, DI registrations, route wiring, and fixes import paths. The Build Gate then verifies the wiring.

Phase 1 replaces the former Merge Coordinator step. If blocking issues are found in Phase 1, the Integrator reports them to the Orchestrator without proceeding to Phase 2.

## Skill Authoring

Use the `skill-creator` skill (loaded by the Orchestrator) to create, modify, or evaluate AI agent skills. The skill-creator handles:

- Drafting new skills from requirements
- Running evaluations with test cases
- Iterating based on feedback and results
- Optimizing skill descriptions for better triggering

## Configuration

- `opencode.jsonc` -- Main platform config (server port, plugins)
- `.gitignore` -- Files excluded from version control
- `package.json` -- Dependencies (includes `@playwright/cli` for browser automation)

## Improvements & New Capabilities

This section documents improvements implemented on top of the base system.

### Comprehensive Test Suite (16 test files, 300+ tests)

| Test File | Tests | Covers |
|-----------|-------|--------|
| `tests/pipeline-init.test.ts` | 8 | Pre-flight checks, similarity matching, context generation |
| `tests/audit-log.test.ts` | 8 | SHA-256 hash chain integrity, YAML serialization, tamper detection |
| `tests/validate-output-contract.test.ts` | 42 | Agent output schema validation, YAML frontmatter parsing, type checking |
| `tests/validate-context.test.ts` | 4 | Context file schema validation |
| `tests/test-gate.test.ts` | 38 | Test framework detection, output parsing, flow validation |
| `tests/shared-utils.test.ts` | 21 | Logger, file I/O utilities, pattern matching |
| `tests/pipeline-teardown.test.ts` | 20 | Pipeline teardown, archival, cleanup |
| `tests/parallel-dispatch.test.ts` | 20+ | Parallel dispatch analysis, manifest generation, verify mode |
| `tests/validate-transition.test.ts` | 20+ | Pipeline state transition matrix, YAML frontmatter parsing |
| `tests/shared-test-manifest.test.ts` | 20+ | Shared test manifest creation, status, wait |
| `tests/security-self-review-gate.test.ts` | 20+ | Security self-review context parsing, enforcement |
| `tests/auto-rollback.test.ts` | 20+ | Auto-rollback check, restore, status |
| `tests/plan-quality-score.test.ts` | 20+ | Plan quality recording, querying, aggregation |
| `tests/check-agent-readiness.test.ts` | 20+ | Agent permission/skill verification |
| `tests/check-handoff.test.ts` | 20+ | Hand-off completeness, evidence chain validation |
| `tests/check-evidence-regression.test.ts` | 20+ | Historical evidence regression scanning |

**Run**: `./tests/run-tests.sh` or `npx ts-node tests/<name>.test.ts`

### 16+ Orchestration Scripts

| Script | Purpose | Location |
|--------|---------|----------|
| **plan-quality-score.ts** | Verifier->PlanDescriber feedback loop -- computes plan quality from Verifier results, auto-escalates when PlanDescriber drops below 70% | `skills/scripts/orchestration/plan-quality-score.ts` |
| **security-self-review-gate.ts** | Enforces the security self-review gate for Implementor -- blocks pipeline if security review fails | `skills/scripts/orchestration/security-self-review-gate.ts` |
| **monitor-pipeline.ts** | Pipeline health monitoring -- tracks gates, durations, pass rates, dashboard, stuck pipeline alerts | `skills/scripts/orchestration/monitor-pipeline.ts` |
| **cost-tracker.ts** | Pipeline cost estimation -- tracks agent output tokens, estimates API costs, cleanup old records | `skills/scripts/orchestration/cost-tracker.ts` |
| **dependency-check.ts** | Pre-flight dependency verification -- checks tool availability, validates script references in SKILL.md | `skills/scripts/orchestration/dependency-check.ts` |
| **auto-rollback.ts** | Automated rollback on consecutive failures -- checks out pre-pipeline git state, creates rollback records | `skills/scripts/orchestration/auto-rollback.ts` |
| `check-plan-contract.ts` | Pre-implementation plan contract validation -- runs contract rules before coding | `skills/scripts/orchestration/check-plan-contract.ts` |
| `check-plan-adherence.ts` | Post-implementation, pre-build checkpoint adherence verification (score >=90%) | `skills/scripts/orchestration/check-plan-adherence.ts` |
| `plan-diff-report.ts` | Human-readable diff report between plan manifest and implementation | `skills/scripts/orchestration/plan-diff-report.ts` |
| **pipeline-visualizer.ts** | Generates Mermaid.js pipeline flowcharts from agent history -- color-coded by pass/fail/partial | `skills/scripts/orchestration/pipeline-visualizer.ts` |
| **skill-drift-detector.ts** | Detects skill drift by comparing SHA-256 hashes against `skills-lock.json` -- alerts on tampered/stale skills | `skills/scripts/orchestration/skill-drift-detector.ts` |
| **validate-transition.ts** | Pipeline state machine -- enforces valid agent step transitions | `skills/scripts/orchestration/validate-transition.ts` |
| **parallel-dispatch.ts** | Native parallel dispatch with phase grouping and dependency analysis | `skills/scripts/orchestration/parallel-dispatch.ts` |
| **shared-test-manifest.ts** | QA + Browser Tester coordination via shared manifest | `skills/scripts/orchestration/shared-test-manifest.ts` |
| **unified-pipeline-error-schema.ts** | Typed PipelineError with 30 error codes | `skills/scripts/orchestration/unified-pipeline-error-schema.ts` |
| **check-agent-readiness.ts** | Pre-flight agent permission and skill verification | `skills/scripts/orchestration/check-agent-readiness.ts` |
| **check-handoff.ts** | Hand-off completeness and evidence chain validation | `skills/scripts/orchestration/check-handoff.ts` |
| **check-evidence-regression.ts** | Historical evidence regression scanning | `skills/scripts/orchestration/check-evidence-regression.ts` |

### Key Architectural Improvements

| Improvement | Description |
|-------------|-------------|
| **Verifier->PlanDescriber feedback** | Plan quality scores auto-escalate to PlanDescriber skill updates when quality < 70% |
| **Security self-review gate enforcement** | BLOCK files prevent pipeline progression if Implementor's security review fails |
| **Pipeline monitoring dashboard** | Aggregate view of all pipelines, per-gate pass rates, stuck pipeline alerts |
| **Cost tracking** | Token and cost estimation per agent per pipeline, cleanup of stale records |
| **Pre-flight dependency validation** | Checks required tools (ts-node, tsc, node) and script references BEFORE pipeline starts |
| **Automated rollback** | Detects N consecutive failures, auto-restores pre-pipeline git state |
| **Pipeline visualization** | Auto-generated Mermaid.js diagrams from agent history |
| **Skill drift detection** | SHA-256 hash comparison alerts on tampered or stale agent skills |
| **Trivy + OWASP ZAP pipeline integration** | Trivy auto-loaded as mandatory sub-scan in Security Gate. OWASP ZAP available as optional post-deployment DAST scan. |
| **Plan Adherence Gate** | Three new scripts (`check-plan-contract.ts`, `check-plan-adherence.ts`, `plan-diff-report.ts`) enforce plan-following: pre-implementation contract validation, checkpoint-by-checkpoint implementation with self-verification, and pre-build adherence score (>=90%). |

### Quick Reference

```bash
# Tests
./tests/run-tests.sh                          # Run all tests
npx ts-node tests/audit-log.test.ts           # Run single test

# Plan Quality (Verifier->PlanDescriber feedback)
npx ts-node skills/scripts/orchestration/plan-quality-score.ts --record --pipeline-id=<id> --compliance-score=85 --plan-omissions=1
npx ts-node skills/scripts/orchestration/plan-quality-score.ts --query-plan-describer   # Exits 2 if < 70%

# Security Gate
npx ts-node skills/scripts/orchestration/security-self-review-gate.ts --check-context=agent-context.md
npx ts-node skills/scripts/orchestration/security-self-review-gate.ts --enforce --pipeline-id=<id>

# Monitoring & Cost
npx ts-node skills/scripts/orchestration/monitor-pipeline.ts --dashboard
npx ts-node skills/scripts/orchestration/cost-tracker.ts --report --pipeline-id=<id>

# Pre-flight & Rollback
npx ts-node skills/scripts/orchestration/dependency-check.ts --verify
npx ts-node skills/scripts/orchestration/auto-rollback.ts --check --pipeline-id=<id> --threshold=3

# Visualization & Drift
npx ts-node skills/scripts/orchestration/pipeline-visualizer.ts --from-context=agent-context.md
npx ts-node skills/scripts/orchestration/skill-drift-detector.ts --check

# Plan Adherence (NEW)
npx ts-node skills/scripts/orchestration/check-plan-contract.ts --manifest=plan-manifests/<feature>/v1-manifest.json --mode=pre-implement
npx ts-node skills/scripts/orchestration/check-plan-adherence.ts --manifest=plan-manifests/<feature>/v1-manifest.json --dir=./
npx ts-node skills/scripts/orchestration/plan-diff-report.ts --manifest=plan-manifests/<feature>/v1-manifest.json
```

