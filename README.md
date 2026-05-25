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
| **Browser Tester** | `agents/subagent/browser-tester.md` | Browser automation with Playwright CLI — explore websites, find UI/UX bugs, verify implementations, create test scripts |
| **Documentor** | `agents/subagent/documentor.md` | Creates documentation — README, API docs, inline comments, architecture docs |
| **PlanDescriber** | `agents/subagent/plandescriber.md` | Creates detailed implementation roadmaps + `plan-manifest.json` |
| **Implementor** | `agents/subagent/implementor.md` | Writes code following the plan; runs mandatory Build Gate + Lint Gate. No thinking — pure execution. |
| **Fixer** | `agents/subagent/fixer.md` | Debugs and fixes bugs. Diagnoses root causes, applies targeted fixes. Has high reasoning effort. |
| **QA** | `agents/subagent/qa.md` | Runs Smoke Test, code review, bug discovery, coverage analysis, quality checks |
| **Verifier** | `agents/subagent/verifier.md` | Compares implementation against plan manifest (structural + behavioral checks) |

## Pipeline

The standard orchestration workflow follows this sequence:

```
Finder → Orchestrator (brainstorm) → PlanDescriber → Implementor → Security Scan → QA → Verifier → Documentor → Orchestrator (report + journal)
                                                  ↓                              ↑
                                            Build Gate + Lint Gate         Fixer (feedback loop)
```

### Validation Gates

| Gate | Owner | What It Checks | Failure Action |
|---|---|---|---|
| **Build Gate** | Implementor | Code compiles without errors | Fix and rebuild before proceeding |
| **Lint Gate** | Implementor | Code passes linter/style checks (eslint, prettier, tsc --noEmit) | Fix lint errors before proceeding |
| **Security Scan** | Orchestrator | npm audit for High/Critical vulns, secrets scan, anti-patterns | Report to user; may fix, except, or block |
| **Smoke Test** | QA | App boots/starts without crashing | Critical bug → cycle to Fixer |
| **Plan Verify** | Verifier | Code matches plan-manifest.json checkpoints (score ≥ 80%) | Score < 80% → cycle to Fixer; 3 attempts → PlanDescriber |

### Fixer Agent

The **Fixer** agent is called when QA discovers bugs or Verifier finds deviations. Unlike the Implementor (which is pure plan-following with no reasoning), the Fixer has `reasoningEffort: "high"` and is explicitly allowed to think and debug.

**Workflow**: Receive bug/deviation report → Diagnose root cause → Apply minimal targeted fix → Build + Lint → Self-check → Report

**Escalation**: If the same issue persists after 3 Fixer attempts, the Orchestrator escalates to PlanDescriber for roadmap revision.

### Skip Shortcuts

- **Simple/familiar tasks**: Skip Finder, go directly to PlanDescriber → Implementor → Security Scan → QA
- **Exploratory/research tasks**: Use only Finder, report findings directly
- **Bug fixes (known root cause)**: Skip PlanDescriber, go directly to Fixer → QA → Verifier
- **Trivial config changes**: Skip all gates — just delegate to Implementor
- **UI/website testing**: Use Browser Tester to explore, find bugs, and verify UI implementations
- **Documentation updates**: Run Documentor after any pipeline that created/modified code but before the final journal entry

### Pre-Flight Check

Before starting any pipeline, the Orchestrator runs a quick pre-flight check:
1. Verify the project currently compiles
2. Check for uncommitted changes (`git status`)
3. Verify essential configs exist (`package.json`, `tsconfig.json`)
4. Read the Project Journal for past work and failure patterns

### Circuit Breaker & Timeout System

The pipeline includes a circuit breaker to prevent infinite agent loops:

| State | Meaning | Action |
|---|---|---|
| **Closed** | Normal operation | Agents execute as normal |
| **Open** | Repeated failures detected | Orchestrator pauses cycling to the same agent |
| **Half-Open** | Probation period | One retry allowed to test resolution |

**Escalation limits**:
- 3 Fixer attempts for same bug → escalate to PlanDescriber
- 3 Verifier failures → escalate to PlanDescriber
- 3 Security Scan failures → escalate to user for direction
- 5 total pipeline retries → pause and report to user

## Project Journal

The Project Journal at `.opencode/journal/journal.yaml` provides cross-session memory. After every pipeline, the Orchestrator appends an entry recording:
- Feature name, pipeline type, result (pass/fail/partial)
- Files changed, key architecture decisions
- Circuit breaker events and failed gates

**Readers**: Finder, PlanDescriber, and Orchestrator all read the journal to understand past work before starting a new session.

## Built-in Skills (14 total)

| Skill | Used By | Description |
|---|---|---|
| `orchestration` | Orchestrator | Multi-agent orchestration, task management, pipeline workflows |
| `plan-brainstorm` | Orchestrator | Collaborative brainstorming with trade-off analysis |
| `skill-creator` | Orchestrator | Skill lifecycle management — create, modify, evaluate AI agent skills |
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

### Browser Tester Agent

The **Browser Tester** agent uses Playwright CLI to automate real browser interactions:

- **Website Feature Discovery** — Open sites, navigate pages, explore UI flows, document features
- **Bug Discovery & Reporting** — Find UI/UX bugs, check console errors, network failures, document with snapshots
- **Implementation Verification** — Confirm UI/API fixes work correctly in the live browser
- **Test Script Creation** — Generate Playwright test scripts from discovered workflows

**Workflow**: Load `playwright-cli` skill → open browser → explore/interact → document findings → close browser → report

### Documentor Agent

The **Documentor** agent creates and maintains project documentation:

- **README & Project Documentation** — Update README.md with new features, usage instructions, config changes
- **API Documentation** — Document new endpoints with request/response schemas using `api-documentation` skill
- **Inline Code Documentation** — Add JSDoc/TSDoc comments for public APIs and complex logic
- **Architecture Decision Records** — Document key architecture decisions and trade-offs

**Workflow**: Load `api-documentation` skill → Review implementation changes → Write docs → Verify accuracy → Report

**When to use**: After any pipeline that creates or modifies code, before the final Orchestrator journal entry.

## Plan Manifests

PlanDescriber produces a machine-readable `plan-manifest.json` alongside every roadmap. The manifest contains checkpoints that the Verifier agent uses to programmatically confirm the implementation matches the plan.

- **Location**: `plan-manifests/<feature>/v<version>-manifest.json` (versioned — never overwrite)
- **Checkpoint types**: structural (files, exports, types, routes, file deletions) and behavioral (error handling, validation, logging, middleware)
- **Compliance score**: `(Passed / (Total - Skipped)) × 100`
- **Schema validation**: Manifests are validated against JSON schema
- **Deletion verification**: Use `fileNotExists` kind to verify files/directories have been successfully removed

## Skill Authoring

Use the `skill-creator` skill (loaded by the Orchestrator) to create, modify, or evaluate AI agent skills. The skill-creator handles:

- Drafting new skills from requirements
- Running evaluations with test cases
- Iterating based on feedback and results
- Optimizing skill descriptions for better triggering

## Configuration

- `opencode.jsonc` — Main platform config (server port, plugins)
- `.gitignore` — Files excluded from version control
- `package.json` — Dependencies (includes `@playwright/cli` for browser automation)

## Improvements & New Capabilities

This section documents improvements implemented on top of the base system.

### Comprehensive Test Suite (7 test files, 150+ tests)

| Test File | Tests | Covers |
|-----------|-------|--------|
| `tests/pipeline-init.test.ts` | 8 | Pre-flight checks, journal parsing, similarity matching, context generation |
| `tests/audit-log.test.ts` | 8 | SHA-256 hash chain integrity, YAML serialization, tamper detection |
| `tests/update-calibration.test.ts` | 47 | Agent calibration database, success tracking, domain breakdowns |
| `tests/validate-output-contract.test.ts` | 42 | Agent output schema validation, YAML frontmatter parsing, type checking |
| `tests/validate-context.test.ts` | 4 | Context file schema validation |
| `tests/shared-utils.test.ts` | 21 | Logger, file I/O utilities, pattern matching |
| `tests/pipeline-teardown.test.ts` | 20 | Retrospective calculation, journal formatting, lesson extraction |

**Run**: `./tests/run-tests.sh` or `npx ts-node tests/<name>.test.ts`

### 8 New Orchestration Scripts

| Script | Purpose | Location |
|--------|---------|----------|
| **plan-quality-score.ts** | Verifier→PlanDescriber feedback loop — computes plan quality from Verifier results, auto-escalates when PlanDescriber drops below 70% | `skills/scripts/orchestration/plan-quality-score.ts` |
| **security-self-review-gate.ts** | Enforces the security self-review gate for Implementor — blocks pipeline if security review fails | `skills/scripts/orchestration/security-self-review-gate.ts` |
| **monitor-pipeline.ts** | Pipeline health monitoring — tracks gates, durations, pass rates, dashboard, stuck pipeline alerts | `skills/scripts/orchestration/monitor-pipeline.ts` |
| **cost-tracker.ts** | Pipeline cost estimation — tracks agent output tokens, estimates API costs, cleanup old records | `skills/scripts/orchestration/cost-tracker.ts` |
| **dependency-check.ts** | Pre-flight dependency verification — checks tool availability, validates script references in SKILL.md | `skills/scripts/orchestration/dependency-check.ts` |
| **auto-rollback.ts** | Automated rollback on consecutive failures — checks out pre-pipeline git state, creates rollback records | `skills/scripts/orchestration/auto-rollback.ts` |
| **pipeline-visualizer.ts** | Generates Mermaid.js pipeline flowcharts from agent history — color-coded by pass/fail/partial | `skills/scripts/orchestration/pipeline-visualizer.ts` |
| **skill-drift-detector.ts** | Detects skill drift by comparing SHA-256 hashes against `skills-lock.json` — alerts on tampered/stale skills | `skills/scripts/orchestration/skill-drift-detector.ts` |

### Key Architectural Improvements

| Improvement | Description |
|-------------|-------------|
| **Verifier→PlanDescriber feedback** | Plan quality scores auto-escalate to PlanDescriber skill updates when quality < 70% |
| **Security self-review gate enforcement** | BLOCK files prevent pipeline progression if Implementor's security review fails |
| **Pipeline monitoring dashboard** | Aggregate view of all pipelines, per-gate pass rates, stuck pipeline alerts |
| **Cost tracking** | Token and cost estimation per agent per pipeline, cleanup of stale records |
| **Pre-flight dependency validation** | Checks required tools (ts-node, tsc, node) and script references BEFORE pipeline starts |
| **Automated rollback** | Detects N consecutive failures, auto-restores pre-pipeline git state |
| **Pipeline visualization** | Auto-generated Mermaid.js diagrams from agent history |
| **Skill drift detection** | SHA-256 hash comparison alerts on tampered or stale agent skills |

### Quick Reference

```bash
# Tests
./tests/run-tests.sh                          # Run all tests
npx ts-node tests/audit-log.test.ts           # Run single test

# Plan Quality (Verifier→PlanDescriber feedback)
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
```
