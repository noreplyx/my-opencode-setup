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
| **PlanDescriber** | `agents/subagent/plandescriber.md` | Creates detailed implementation roadmaps + `plan-manifest.json` |
| **Implementor** | `agents/subagent/implementor.md` | Writes code following the plan; runs mandatory Build Gate + Lint Gate |
| **QA** | `agents/subagent/qa.md` | Runs Smoke Test, code review, bug discovery, quality checks |
| **Verifier** | `agents/subagent/verifier.md` | Compares implementation against plan manifest (structural + behavioral checks) |

## Pipeline

The standard orchestration workflow follows this sequence:

```
Finder → Orchestrator (brainstorm) → PlanDescriber → Implementor → QA → Verifier → Orchestrator (report)
                                        ↑                              ↑
                                  Browser Tester                Lint Gate (after Build)
  (website exploration,             (before or after
   bug discovery, testing)          implementation)
```

### Validation Gates

| Gate | Owner | What It Checks | Failure Action |
|---|---|---|---|
| **Build Gate** | Implementor | Code compiles without errors | Fix and rebuild before proceeding |
| **Lint Gate** | Implementor | Code passes linter/style checks (eslint, prettier, tsc --noEmit) | Fix lint errors before proceeding |
| **Smoke Test** | QA | App boots/starts without crashing | Critical bug; cycle back to Implementor |
| **Plan Verify** | Verifier | Code matches plan-manifest.json checkpoints (score ≥ 80%) | Score < 80% → cycle to Implementor or PlanDescriber |

### Skip Shortcuts

- **Simple/familiar tasks**: Skip Finder, go directly to PlanDescriber → Implementor → QA
- **Exploratory/research tasks**: Use only Finder, report findings directly
- **Bug fixes (known root cause)**: Skip PlanDescriber, go directly to Implementor → QA → Verifier
- **UI/website testing**: Use Browser Tester to explore, find bugs, and verify UI implementations

### Circuit Breaker & Timeout System

The pipeline includes a circuit breaker to prevent infinite agent loops:

| State | Meaning | Action |
|---|---|---|
| **Closed** | Normal operation | Agents execute as normal |
| **Open** | Repeated failures detected | Orchestrator pauses cycling to the same agent |
| **Half-Open** | Probation period | One retry allowed to test resolution |

**Escalation limits**: 3 failed attempts for the same bug/agent → escalate to PlanDescriber. 5 total pipeline retries → pause and report to user.

### Built-in Skills (13 total)

| Skill | Used By | Description |
|---|---|---|
| `orchestration` | Orchestrator | Multi-agent orchestration, task management, pipeline workflows |
| `plan-brainstorm` | Orchestrator | Collaborative brainstorming with trade-off analysis |
| `skill-creator` | Orchestrator | Skill lifecycle management — create, modify, evaluate AI agent skills |
| `plan-describe` | PlanDescriber | Detailed implementation roadmap creation |
| `plan-verification` | Verifier | Plan-to-implementation verification, compliance scoring |
| `quality-assurance` | QA, Browser Tester | Software testing, bug discovery, quality standards |
| `code-philosophy` | Implementor, PlanDescriber | SOLID, clean code, clean architecture, security |
| `backend-code-philosophy` | Implementor, PlanDescriber | Backend principles: scaling, caching, database patterns |
| `frontend-code-philosophy` | Implementor, PlanDescriber | Frontend principles: rendering, state management, a11y |
| `accessibility` | Implementor, QA | Accessibility guidelines for UI development |
| `api-documentation` | Implementor | API documentation standards and patterns |
| `devops-cicd` | Implementor | DevOps and CI/CD pipeline patterns |
| `playwright-cli` | Browser Tester, Implementor | Browser automation: navigate, click, fill, snapshot, eval, console, network, etc. |

### Browser Tester Agent

The **Browser Tester** agent uses Playwright CLI to automate real browser interactions:

- **Website Feature Discovery** — Open sites, navigate pages, explore UI flows, document features
- **Bug Discovery & Reporting** — Find UI/UX bugs, check console errors, network failures, document with snapshots
- **Implementation Verification** — Confirm UI/API fixes work correctly in the live browser
- **Test Script Creation** — Generate Playwright test scripts from discovered workflows

**Workflow**: Load `playwright-cli` skill → open browser → explore/interact → document findings → close browser → report

## Plan Manifests

PlanDescriber produces a machine-readable `plan-manifest.json` alongside every roadmap. The manifest contains checkpoints that the Verifier agent uses to programmatically confirm the implementation matches the plan.

- **Location**: `plan-manifests/<feature-name>-manifest.json`
- **Checkpoint types**: structural (files, exports, types, routes, **file deletions**) and behavioral (error handling, validation, logging, middleware)
- **Compliance score**: `(Passed / (Total - Skipped)) × 100`
- **Schema validation**: Manifests are validated against `plan-manifests/plan-manifest-schema.json` (JSON Schema Draft-07)
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
