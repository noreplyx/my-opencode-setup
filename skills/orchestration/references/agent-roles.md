---
name: agent-roles
description: Reference document defining all agent roles, purposes, reasoning effort levels, and self-review requirements for the orchestration pipeline.
---

# Agent Roles

*This content was extracted from `skills/orchestration/SKILL.md` to reduce file size and avoid duplication. The Orchestrator can load this reference when it needs the agent role table.*

| Agent | Purpose | Reasoning Effort | Called When | Self-Review? |
|-------|---------|-----------------|-------------|--------------|
| **Finder** | Codebase exploration, research, information gathering. **Smart Finder**: Also reports proactive hazard detection (dead code, deprecated APIs, security anti-patterns). Returns structured knowledge graph. | 0.3 | Start of pipeline  gather context | Yes (self-checks findings) |
| **Orchestrator** | Brainstorming, task assignment, coordination | 0.1 | Always  primary user interface | Yes |
| **PlanDescriber** | Detailed implementation roadmaps + plan-manifest.json with confidence score | High | After brainstorm or direct feature request | Yes (confidence scoring) |
| **Implementor** | Write code following the plan. **Checkpoint-Driven Implementor**: Pre-implementation contract validation, checkpoint-by-checkpoint implementation with self-verification, pre-build plan adherence gate, scope guard. | None | After plan is ready | Yes (mandatory self-review) |
| **Fixer** | Debug and fix bugs. **Root Cause Classifier**: Categorizes bugs into taxonomy (plan-omission, implementation-error, edge-case-miss, integration-mismatch, environment-issue). Reports fix confidence score. | High | After QA or Verifier reports issues | Yes (cross-module check) |
| **QA** | Smoke tests, bug discovery, coverage analysis. **Proactive QA**: Auto-generates edge case tests, runs non-functional checks (perf, a11y, security), performs regression impact analysis. | 0.1 | After build + security scan pass | Yes (edge case generation) |
| **Verifier** | Compare implementation against plan manifest. **Plan Diff Verifier**: Also suggests missing checkpoints, detects plan drift, performs cross-file consistency checks. | 0.1 | After Acceptance Gate passes | Yes (confidence level reporting) |
| **Security Scan** | Dependency vulnerability scan, secrets scan, anti-pattern scan, **+ auto-loaded semgrep SAST + gitleaks secrets + trivy vuln/misconfig**. Reports risk-level classified findings with auto-remediation suggestions. | Read-only | After build + lint pass | N/A (read-only) |
| **Browser Tester** | Playwright CLI browser automation, UI bug discovery | 0.2 | When UI testing is needed | No |
| **Documentor** | Project documentation, API docs, inline comments, ADRs | 0.2 | After Verifier passes  document verified code | Yes (accuracy check) |
| **Integrator** | Cross-file consistency verification (4-pass merge check: imports, type signatures, interfaces, re-exports) + wiring (barrel files, DI registrations, route wiring, import fixes). Absorbs former Merge Coordinator role. Runs after parallel Implementor dispatch, before Build Gate. | 0.1 | After parallel Implementor dispatch, before Build Gate | Yes (self-checks findings, build verifies wiring) |