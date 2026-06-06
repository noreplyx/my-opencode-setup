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
| **Architect** | `agents/subagent/architect.md` | System architecture design, ADRs, C4 diagrams, trade-off analysis |
| **Finder** | `agents/subagent/finder.md` | Codebase research, web search, information gathering (read-only) |
| **Browser Tester** | `agents/subagent/browser-tester.md` | Browser automation with Playwright CLI -- explore websites, find UI/UX bugs, verify implementations, create test scripts |
| **Documentor** | `agents/subagent/documentor.md` | Creates documentation -- README, API docs, inline comments, architecture docs |
| **PlanDescriber** | `agents/subagent/plandescriber.md` | Creates detailed implementation roadmaps + `plan-manifest.json` |
| **Implementor** | `agents/subagent/implementor.md` | Writes code following the plan; runs mandatory Build Gate + Lint Gate. No thinking -- pure execution. |
| **Fixer** | `agents/subagent/fixer.md` | Debugs and fixes bugs. Diagnoses root causes, applies targeted fixes. Has high reasoning effort. |
| **QA** | `agents/subagent/qa.md` | Runs Smoke Test, code review, bug discovery, coverage analysis, quality checks |
| **Verifier** | `agents/subagent/verifier.md` | Compares implementation against plan manifest (structural + behavioral checks) |
| **Integrator** | `agents/subagent/integrator.md` | Verifies cross-file consistency and wires new files into the project: barrel files, DI, routes |
| **Debug** | `agents/subagent/debug.md` | Deep diagnostics after Fixer exhausts 3 attempts. Read-only -- diagnoses and recommends only. |

## Pipeline

The standard orchestration workflow follows this sequence:

```
Finder -> Orchestrator (brainstorm) -> PlanDescriber -> Evidence Gate -> Implementor (checkpoint-driven: contract validation -> implement per-checkpoint -> self-verify -> adherence gate) -> Evidence Gate -> Integrator (Phase 1: verify -> Phase 2: wire) -> Build Gate -> Lint Gate -> Test Gate -> Security Scan (semgrep SAST + gitleaks + trivy + npm audit + osv-scanner + anti-patterns) -> QA (smoke test + coverage) -> Acceptance Gate -> Evidence Gate -> Verifier (fast-pass if adherence >= 90%) -> Evidence Gate -> Documentor -> Evidence Gate -> Orchestrator (report)
                                                                                         ->                                              ->
                                                                                     Fixer (feedback loop)                       Debug (after 3 Fixers)
```

### Validation Gates

| Gate | Owner | What It Checks | Failure Action |
|---|---|---|---|
| **Pre-Flight** | Orchestrator | Git status, project compilation, stale context, lockfile integrity | Block pipeline |
| **Plan Contract** | Implementor | Pre-implementation contract rules from plan manifest | Fix plan or implementation |
| **Build Gate** | Implementor | Code compiles without errors | Fix and rebuild before proceeding |
| **Lint Gate** | Implementor | Code passes linter/style checks (eslint, prettier, tsc --noEmit) | Fix lint errors before proceeding |
| **Security Scan** | Orchestrator | Semgrep SAST + Gitleaks secrets + Trivy vuln/misconfig + npm audit + OSV-Scanner + anti-patterns | Report to user; may fix, except, or block |
| **Smoke Test** | QA | App boots/starts without crashing | Critical bug -> cycle to Fixer |
| **Acceptance Gate** | Orchestrator | Acceptance criteria checkpoints from plan manifest | Cycle to Fixer |
| **Security Test Coverage** | QA + Verifier | >=80% security test coverage | <50% -> QA loop; 50-79% -> warn |
| **Evidence Gate** | Orchestrator | Evidence quality scoring, content hashes, cross-agent verification | Block pipeline |
| **Evidence Gate** | Orchestrator | Evidence quality and verifiability after every agent hand-off | Score < 80% or critical failures -> agent retry; 2 failures -> escalate to user |
| **Plan Verify** | Verifier | Code matches plan-manifest.json checkpoints (score >=80%) | Score < 80% -> cycle to Fixer; 3 attempts -> PlanDescriber |
| **Test Gate** | Implementor | Runs project test suite (`npm test`, `vitest run`, etc.) and reports pass/fail | Tests fail -> cycle to Fixer |

### Fixer Agent

The **Fixer** agent is called when QA discovers bugs or Verifier finds deviations. Unlike the Implementor (which is pure plan-following with no reasoning), the Fixer has `reasoningEffort: "high"` and is explicitly allowed to think and debug.

**Workflow**: Receive bug/deviation report -> Diagnose root cause -> Apply minimal targeted fix -> Build + Lint -> Self-check -> Report

**Escalation**: If the same issue persists after 3 Fixer attempts, the Orchestrator escalates to PlanDescriber for roadmap revision.

### Pipeline Type Quick Selection

| Task Type | Pipeline | PlanDescriber | Security Scan | Verifier | Evidence Gate | Can Skip |
|-----------|----------|:---:|:---:|:---:|----------|
| **New feature** | full | âœ… MANDATORY | âœ… MANDATORY | âœ… MANDATORY | (none) |
| **Simple/familiar** | quick | âœ… MANDATORY | âœ… MANDATORY | âœ… MANDATORY | Finder |
| **Bug fix (known root cause)** | fixer-only | âœ… plan exists | âœ… MANDATORY | âœ… MANDATORY | Finder, PlanDescriber |
| **Trivial config change** | trivial | âœ… MANDATORY | âœ… MANDATORY | âœ… MANDATORY | Finder, Build, Lint, Test, QA |
| **Test-driven feature** | tdd | âœ… MANDATORY | âœ… MANDATORY | âœ… MANDATORY | Finder |
| **Large feature (split)** | parallel | âœ… MANDATORY | âœ… MANDATORY | âœ… MANDATORY | Finder (optional) |
| **UI/website testing** | browser-test | âŒ no code | âŒ no code | âŒ no code | All |
| **Exploratory/research** | exploratory | âŒ no code | âŒ no code | âŒ no code | All except Finder |
| **Documentation update** | documentation | âŒ no code | âŒ no code | âŒ no code | All except Documentor |
| **Architecture design** | architecture | âŒ no code | âŒ no code | âŒ no code | All except Architect |

> **Hard rule**: PlanDescriber, Security Scan Gate, Verifier Gate, and Evidence Gate are **mandatory** for ANY pipeline that creates or modifies code. The Orchestrator MUST NOT skip them. Pipelines that produce zero code changes (exploratory, documentation, architecture, browser-test) are exempt.

### Pre-Flight Check

Before starting any pipeline, the Orchestrator runs a quick pre-flight check:
1. Verify the project currently compiles
2. Check for uncommitted changes (`git status`)
3. Verify essential configs exist (`package.json`, `tsconfig.json`)
4. Check `package-lock.json` integrity and `npm audit signatures`
5. Verify lockfile age (<7 days since last audit)


### PlanDescriber Quality Feedback Loop

After Verifier completes, the Orchestrator records the plan quality score:
```bash
npx ts-node skills/scripts/orchestration/plan-quality-score.ts --record --pipeline-id=<id> --compliance-score=<score> --plan-omissions=<count>
```
If PlanDescriber's quality score drops below 70% (queried via `--query-plan-describer`), the Orchestrator escalates to the user for plan revision rather than cycling back to PlanDescriber automatically. This prevents infinite loops where PlanDescriber produces the same low-quality plan.

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
| `architecture-workflow` | Architect | System architecture design, ADRs, C4 diagrams, trade-off analysis |
| `plan-brainstorm` | Orchestrator | Collaborative brainstorming with trade-off analysis |
| `skill-creator` | Orchestrator | Skill lifecycle management -- create, modify, evaluate AI agent skills |
| `project-onboarding` | Orchestrator | 5-phase project onboarding: detect, map, document, set up, report |
| `security-scan` | Orchestrator | Dependency vulnerability scanning, secrets detection, anti-pattern checks |
| `plan-describe` | PlanDescriber | Detailed implementation roadmap creation |
| `plan-verification` | Verifier | Plan-to-implementation verification, compliance scoring |
| `qa-workflow` | QA, Browser Tester | Software testing, bug discovery, quality standards (consolidated into qa-workflow (legacy quality-assurance removed)) |
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

### 31 Orchestration Scripts

| Script | Purpose | Location |
|--------|---------|----------|
| **pipeline-init.ts** | Pipeline init + pre-flight checks | `skills/scripts/orchestration/pipeline-init.ts` |
| **pipeline-teardown.ts** | Pipeline teardown + archive | `skills/scripts/orchestration/pipeline-teardown.ts` |
| **pipeline-checkpoint.ts** | Git checkpoint after each agent step | `skills/scripts/orchestration/pipeline-checkpoint.ts` |
| **pipeline-replay.ts** | Re-run pipeline from archived checkpoints | `skills/scripts/orchestration/pipeline-replay.ts` |
| **pipeline-gitleaks.ts** | Automated gitleaks scanning | `skills/scripts/orchestration/pipeline-gitleaks.ts` |
| **pipeline-visualizer.ts** | Generates Mermaid.js pipeline flowcharts | `skills/scripts/orchestration/pipeline-visualizer.ts` |
| **validate-context.ts** | Validate agent-context.md schema | `skills/scripts/orchestration/validate-context.ts` |
| **validate-output-contract.ts** | Validate agent output contract | `skills/scripts/orchestration/validate-output-contract.ts` |
| **validate-transition.ts** | Pipeline state machine transition enforcement | `skills/scripts/orchestration/validate-transition.ts` |
| **validate-manifest-schema.ts** | Validate manifest JSON structure | `skills/scripts/orchestration/validate-manifest-schema.ts` |
| **check-plan-contract.ts** | Pre-implementation plan contract validation | `skills/scripts/orchestration/check-plan-contract.ts` |
| **check-plan-adherence.ts** | Post-implementation checkpoint adherence | `skills/scripts/orchestration/check-plan-adherence.ts` |
| **plan-diff-report.ts** | Human-readable plan vs implementation diff | `skills/scripts/orchestration/plan-diff-report.ts` |
| **plan-quality-score.ts** | Verifier->PlanDescriber feedback loop | `skills/scripts/orchestration/plan-quality-score.ts` |
| **check-agent-readiness.ts** | Pre-flight agent permission/skill verification | `skills/scripts/orchestration/check-agent-readiness.ts` |
| **check-handoff.ts** | Hand-off completeness and evidence chain validation | `skills/scripts/orchestration/check-handoff.ts` |
| **check-evidence-regression.ts** | Historical evidence regression scanning | `skills/scripts/orchestration/check-evidence-regression.ts` |
| **security-self-review-gate.ts** | Enforces security self-review gate | `skills/scripts/orchestration/security-self-review-gate.ts` |
| **monitor-pipeline.ts** | Pipeline health monitoring dashboard | `skills/scripts/orchestration/monitor-pipeline.ts` |
| **cost-tracker.ts** | Pipeline cost estimation | `skills/scripts/orchestration/cost-tracker.ts` |
| **dependency-check.ts** | Pre-flight dependency verification | `skills/scripts/orchestration/dependency-check.ts` |
| **auto-rollback.ts** | Automated rollback on consecutive failures | `skills/scripts/orchestration/auto-rollback.ts` |
| **skill-drift-detector.ts** | SHA-256 hash comparison for skill drift | `skills/scripts/orchestration/skill-drift-detector.ts` |
| **parallel-dispatch.ts** | Native parallel dispatch with phase grouping | `skills/scripts/orchestration/parallel-dispatch.ts` |
| **shared-test-manifest.ts** | QA + Browser Tester coordination | `skills/scripts/orchestration/shared-test-manifest.ts` |
| **unified-pipeline-error-schema.ts** | Typed PipelineError with 30 error codes | `skills/scripts/orchestration/unified-pipeline-error-schema.ts` |
| **audit-log.ts** | Tamper-evident hash-chained audit trail | `skills/scripts/orchestration/audit-log.ts` |
| **agent-timeout.ts** | Heartbeat-based timeout detection | `skills/scripts/orchestration/agent-timeout.ts` |
| **context-lock.ts** | Race prevention lock for agent-context.md | `skills/scripts/orchestration/context-lock.ts` |
| **test-gate.ts** | Automated test regression detection | `skills/scripts/orchestration/test-gate.ts` |
| **test-pipeline.ts** | Pipeline integration test | `skills/scripts/orchestration/test-pipeline.ts` |

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
| **OSV-Scanner integration** | Open source vulnerability scanner auto-loaded during Security Scan gate |
| **Plan Adherence Gate** | Three scripts (`check-plan-contract.ts`, `check-plan-adherence.ts`, `plan-diff-report.ts`) enforce plan-following: pre-implementation contract validation, checkpoint-by-checkpoint implementation with self-verification, and pre-build adherence score (>=90%). |
| **Architect agent** | New subagent for system architecture design, ADRs, C4 diagrams, and trade-off analysis |
| **Debug agent** | Deep diagnostic agent called after Fixer exhausts 3 attempts |

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

# Evidence Gate
npx ts-node skills/scripts/orchestration/evidence-quality-gate.ts --context=agent-context.md
```


