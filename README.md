# OpenCode AI Agent Configuration

This repository contains the configuration, agents, skills, and plugins for an [OpenCode](https://opencode.ai) AI agent system.

## Prerequisites

The following tools must be installed to use this system:

| Tool | Version | Purpose |
|------|---------|---------|
| [OpenCode](https://opencode.ai) | latest | Core AI agent framework |
| [Bun](https://bun.sh) | latest | JavaScript runtime (plan-protocol scripts, MCP commands) |
| [Node.js](https://nodejs.org) | 18+ | Package dependencies, Playwright CLI, ts-node |
| [Podman](https://podman.io) | latest | Container runtime for security scanning skills |
| [ast-grep](https://ast-grep.net) | 0.42+ | Structural AST-based code search, linting, and rewriting |
| [Python 3](https://python.org) | 3.10+ | Skill evaluation and benchmarking scripts |
| [Playwright CLI](https://playwright.dev) | latest | Browser automation and web testing |

### Optional MCP Services

- **SearXNG** — Local web search instance (expected at `http://localhost:8080`)
- **ClickUp** — Project management (remote MCP, requires authentication)
- **GitHub Copilot** — GitHub integration (remote MCP, OAuth)

## Quick Start

```bash
# Install dependencies
bun install

# Run the OpenCode agent
opencode
```

## Skills Overview

Only **`osv-scanner`** is present on disk as an authored skill file. The other
skills listed below are documented for reference but are **not** authored as
skill files in this repository.

| Skill | Tool Required | Description | On Disk |
|-------|---------------|-------------|---------|
| osv-scanner | Podman | Dependency vulnerability scanning (OSV-Scanner) | ✅ |
| trivy-scan | Podman | Container and filesystem vulnerability scanning | — |
| gitleaks-scan | Podman | Secret detection in Git repositories | — |
| semgrep-scan | Podman | SAST static code analysis | — |
| owasp-zap-scan | Podman | DAST web application security scanning | — |
| pmd-scan | Podman | Static code analysis (Java, JS, etc.) | — |
| playwright-cli | Playwright CLI | Browser automation and testing | — |
| ast-grep | ast-grep (sg) | Structural code search and rewriting | — |
| plan-protocol | Bun | Structured implementation planning | — |
| skill-creator | Python 3 | Skill creation and evaluation | — |

## Agents

The `code-orchestrator` drives the brainstorm → plan → approve → implement →
verify → iterate pipeline by delegating to subagents. Key agents:

- **`code-security-scanner`** — Stage 5 dependency scanner. Runs OSV-Scanner via
  a pinned Podman container with a writable `/src` mount restricted to scan
  artifacts
  (`ghcr.io/google/osv-scanner@sha256:1547b7c2783d4f266b24fe86ab4dfc18d058588244c58384ac9f56dddb304511`)
  against the project's lockfiles. Returns findings in the same
  Critical / Major / Minor / Nit taxonomy as the static `security-reviewer`, so
  the orchestrator merges them into the same fix+verify loop. It runs once per
  outer-loop pass and degrades gracefully (returns a non-blocking "scans
  skipped" note) if Podman or the image is unavailable.
- **`brainstormer`** / **`code-planner`** — granted tool-level access to the
  **searxng** MCP (web search) for grounding decisions in current docs/best
  practices. Neither has access to the **clickup** MCP (it is denied to keep
  their surface read-only). Both are best-effort and non-blocking.

## Operational Prerequisites

- **Podman** — required for the `code-security-scanner` subagent (OSV-Scanner
  container). If Podman or the image is unavailable, the scanner reports
  "scans skipped" and the pipeline continues.
- **SearXNG** — local web search instance (expected at `http://localhost:8080`),
  used by the brainstormer/planner for grounding. Best-effort; a failure does
  not block the pipeline.
- **ClickUp** — remote MCP (requires authentication). Not granted to the
  brainstormer or planner (denied to keep their surface read-only).
  Best-effort; a failure does not block the pipeline.
