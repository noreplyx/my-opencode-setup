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

| Skill | Tool Required | Description |
|-------|---------------|-------------|
| trivy-scan | Podman | Container and filesystem vulnerability scanning |
| gitleaks-scan | Podman | Secret detection in Git repositories |
| semgrep-scan | Podman | SAST static code analysis |
| osv-scanner | Podman | Dependency vulnerability scanning |
| owasp-zap-scan | Podman | DAST web application security scanning |
| pmd-scan | Podman | Static code analysis (Java, JS, etc.) |
| playwright-cli | Playwright CLI | Browser automation and testing |
| ast-grep | ast-grep (sg) | Structural code search and rewriting |
| plan-protocol | Bun | Structured implementation planning |
| skill-creator | Python 3 | Skill creation and evaluation |
