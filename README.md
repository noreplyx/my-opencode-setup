# OpenCode AI Agent System

This directory contains the configuration for the OpenCode AI agent system.

## Agent Discovery

Agents are auto-discovered by the OpenCode platform from the filesystem:

- **Primary Agent**: `agents/orchestrator.md`
- **Sub-Agents**: All `.md` files under `agents/subagent/`

Each agent file is a markdown document with YAML frontmatter (delimited by `---`) that defines the agent's mode, tools, permissions, and behavior instructions.

## Skills

Skills are stored under `.agents/skills/<skill-name>/SKILL.md` (for learned skills) or `skills/<skill-name>/SKILL.md` (for built-in skills) and registered in `skills/skills-registry.json`.

Available skills:
- `accessibility` — Accessibility guidelines for UI development
- `api-documentation` — API documentation standards
- `backend-code-philosophy` — Backend development principles
- `code-philosophy` — Universal clean code and SOLID principles
- `devops-cicd` — DevOps and CI/CD patterns
- `frontend-code-philosophy` — Frontend development principles
- `orchestration` — Multi-agent orchestration and pipeline workflows
- `plan-brainstorm` — Collaborative brainstorming
- `plan-describe` — Detailed implementation roadmaps
- `quality-assurance` — Software quality assurance

## Audit Logging

Agent actions are logged to `logs/agent-audit.log` for traceability.

## Configuration

- `opencode.jsonc` — Main platform config (server port, plugins)
- `.gitignore` — Files excluded from version control
