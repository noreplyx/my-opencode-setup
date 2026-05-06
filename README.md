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
| **PlanDescriber** | `agents/subagent/plandescriber.md` | Creates detailed implementation roadmaps + `plan-manifest.json` |
| **Implementor** | `agents/subagent/implementor.md` | Writes code following the plan; runs mandatory Build Gate |
| **QA** | `agents/subagent/qa.md` | Runs Smoke Test, code review, bug discovery, quality checks |
| **Verifier** | `agents/subagent/verifier.md` | Compares implementation against plan manifest (structural + behavioral checks) |
| **SkillScribe** | `agents/subagent/skillscribe.md` | Distills conversation knowledge into reusable skill files |

## Pipeline

The standard orchestration workflow follows this sequence:

```
Finder → Orchestrator (brainstorm) → PlanDescriber → Implementor → QA → Verifier → Orchestrator (report)
```

### Validation Gates

| Gate | Owner | What It Checks | Failure Action |
|---|---|---|---|
| **Build Gate** | Implementor | Code compiles without errors | Fix and rebuild before proceeding |
| **Smoke Test** | QA | App boots/starts without crashing | Critical bug; cycle back to Implementor |
| **Plan Verify** | Verifier | Code matches plan-manifest.json checkpoints (score ≥ 80%) | Score < 80% → cycle to Implementor or PlanDescriber |

### Skip Shortcuts

- **Simple/familiar tasks**: Skip Finder, go directly to PlanDescriber → Implementor → QA
- **Exploratory/research tasks**: Use only Finder, report findings directly
- **Bug fixes (known root cause)**: Skip PlanDescriber, go directly to Implementor → QA → Verifier

## Skills

Skills are stored under `.agents/skills/<skill-name>/SKILL.md` (for learned skills) or `skills/<skill-name>/SKILL.md` (for built-in skills) and registered in `skills/skills-registry.json`.

### Built-in Skills (11 total)

| Skill | Used By | Description |
|---|---|---|
| `orchestration` | Orchestrator | Multi-agent orchestration, task management, pipeline workflows |
| `plan-brainstorm` | Orchestrator | Collaborative brainstorming with trade-off analysis |
| `plan-describe` | PlanDescriber, SkillScribe | Detailed implementation roadmap creation |
| `plan-verification` | Verifier | Plan-to-implementation verification, compliance scoring |
| `quality-assurance` | QA | Software testing, bug discovery, quality standards |
| `code-philosophy` | Implementor, PlanDescriber, SkillScribe | SOLID, clean code, clean architecture, security |
| `backend-code-philosophy` | Implementor, PlanDescriber | Backend principles: scaling, caching, database patterns |
| `frontend-code-philosophy` | Implementor, PlanDescriber | Frontend principles: rendering, state management, a11y |
| `accessibility` | Implementor, QA | Accessibility guidelines for UI development |
| `api-documentation` | Implementor | API documentation standards and patterns |
| `devops-cicd` | Implementor | DevOps and CI/CD pipeline patterns |

## Plan Manifests

PlanDescriber produces a machine-readable `plan-manifest.json` alongside every roadmap. The manifest contains checkpoints that the Verifier agent uses to programmatically confirm the implementation matches the plan.

- **Location**: `plan-manifests/<feature-name>-manifest.json`
- **Checkpoint types**: structural (files, exports, types, routes) and behavioral (error handling, validation, logging, middleware)
- **Compliance score**: `(Passed / (Total - Skipped)) × 100`

## Configuration

- `opencode.jsonc` — Main platform config (server port, plugins)
- `.gitignore` — Files excluded from version control
