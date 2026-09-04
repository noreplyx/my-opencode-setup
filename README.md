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
| [Playwright CLI](https://playwright.dev) | 0.1.19 | Browser automation and web testing |

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

### Delegation contract and completion gate

All orchestrator handoffs use `agent/delegation-contract.md` with the fields
Goal, Scope, Constraints, Inputs, Expected output, Completion criteria, and
Risks/ambiguities. The planner owns stable, testable acceptance-criterion IDs;
the coder maps implementation and evidence to them; and the independent
verifier reports `pass`, `fail`, or `not-verifiable` for each item. Completion
requires a passing verifier result and concrete evidence for every criterion;
failed, not-verifiable, or unsupported criteria remain blocked until remediated
or explicitly signed off where allowed. If a review or implementation finding
cannot be fixed without contradicting the approved design, the orchestrator
routes it to the `code-planner` as a design re-issue (a versioned revision that
preserves acceptance-criterion IDs) and re-runs the Stage 3 approval checkpoint
before resuming implementation.

### User-facing communication format

Every message the `code-orchestrator` sends to the user — each blocking
checkpoint issued via the `question` tool, the Stage 1 decision/requirements
presentation, the Stage 5 step 7 escalation, the Stage 6 sign-off, and the
final report — contains the four parts in order: Overview, Non-technical,
Technical, and Summary. The Non-technical part is plain language for a reader
without a programming background; the Technical part carries the precise
files, commands, findings, verifier verdicts, and acceptance-criterion IDs.
When a message's topic calls for more, the orchestrator may also add zero or
more optional topic-labeled parts — for example a Security or Cost impact
section — between the Technical and Summary parts. When the message uses
domain terms or abbreviations a non-specialist reader would not know —
pipeline vocabulary such as verifier or DoD, or engineering vocabulary such
as lockfile or CVE — the orchestrator adds a Terms explained part, after any
optional topic-labeled parts and immediately before the Summary part,
explaining each such term on its own line in plain language. The Summary
part always stays last, so every checkpoint closes with its question, and a
message contains no labeled parts beyond the four required parts, the Terms
explained part when its rule applies, and these optional ones. Parts stay
proportional — one sentence each is enough for a short quick-confirm
checkpoint — but a required part is never omitted.

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

## Security operation notes

- ClickUp access is denied globally and in every authored agent. A dedicated
  approved agent must be introduced before any ClickUp workflow is enabled.
- SearXNG accepts `SEARXNG_SECRET` from the ignored `mcp/searxng/.env` file or
  an explicitly passed container environment value. The Compose service uses
  environment pass-through rather than interpolating the secret into rendered
  configuration. When it is empty or absent, the deployment wrapper
  generates a 256-bit secret in the persistent `searxng-secret` named volume
  and reuses it on restart. Explicit non-empty values always take precedence
  and never modify the fallback file. Missing, unwritable, or malformed
  persistent storage stops startup rather than using an ephemeral secret.
  Remove and recreate that volume to intentionally rotate the fallback secret;
  this invalidates sessions and other data signed with the previous key. The
  previously committed signing key must be rotated wherever it was used. Secret
  rotation is a required external action; this repository cannot verify
  completion of rotation or access to external secret stores.
- Verification is restricted to the verifier agent's reviewed command allowlist:
  explicit test/validation scripts, typecheck, bounded Node and shell syntax
  checks, the reviewed SearXNG Compose lifecycle/inspection commands, the OSV
  wrapper, and read-only Git status/diff checks. If task-runner configuration
  changes, explicit approval is required before verification.
- The SearXNG service is intentionally published only on `127.0.0.1:8080`, and
  its host configuration mount is read-only. Keep populated `mcp/searxng/.env`
  files mode `0600`; security validation rejects weaker modes.

The security remediation also tightened SQL read-only enforcement and requires
TLS for database connections. These are intentional scope expansions because
they close the associated review findings.
