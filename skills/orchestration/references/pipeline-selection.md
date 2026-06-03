# Pipeline Selection Reference

## Pipeline Type Classification Table

| Task Type | Description | Pipeline | Skip Finder? |
|-----------|-------------|----------|--------------|
| **New Feature (known)** | Adding a new feature in a familiar domain | Full or Standard | Yes, if domain is well-understood |
| **New Feature (unknown)** | Adding a new feature in an unfamiliar domain | Full | No |
| **Bug Fix (known cause)** | Fixing a bug with identified root cause | Fixer -> QA -> Verifier | Yes |
| **Bug Fix (unknown cause)** | Investigating and fixing a bug | Finder -> Fixer -> QA -> Verifier | No |
| **Research** | Understanding existing code, exploring options | Finder only | N/A |
| **Refactor** | Restructuring without changing behavior | PlanDescriber -> Implementor -> Security -> QA -> Verifier | Yes |
| **Config Change** | Simple config or dependency changes | Implementor only | Yes |
| **Security Fix** | Patching a vulnerability | Implementor -> Security Scan -> QA -> Verifier | Yes |
| **UI Bug** | Visual or behavioral bug in frontend | Browser Tester -> Fixer -> QA | Yes |
| **Quick Fix** | One-line fix, config change, typo | Ultra-Quick: Implementor -> Build | Yes |
| **Small Feature** | Small feature with known domain | Quick: Implementor -> Build -> Lint -> QA | Yes |
| **Parallel Feature** | Feature with independent sub-components | Implementor (parallel) -> Integrator -> Build -> Lint -> Security -> QA -> Verifier | Yes |
| **New Feature (TDD)** | Adding a tested feature with tests written first | PlanDescriber -> QA (tests) -> Implementor -> Build -> Lint -> Security -> Verifier | Yes |
| **Micro-Pipeline** | Feature with clear frontend/backend split | Parallel PlanDescriber -> Parallel Implementor -> Merge QA -> Verifier | No (needs Finder to identify split) |
| **Documentation** | Updating docs, README, API docs, or inline comments | Documentor -> report to user | Yes |

---

## When to Skip Steps

| Scenario | Skip | Rationale |
|----------|------|-----------|
| Simple/familiar tasks | Skip Finder | Go directly to PlanDescriber -> Implementor -> Security Scan |
| Exploratory/research tasks | Only Finder | Report findings directly to user |
| Bug fixes (known root cause) | Skip PlanDescriber | Go directly to Fixer for the fix, then QA + Verifier |
| Trivial config changes | Skip all gates | Just delegate to Implementor |
| Documentation updates | Only Documentor | No plan, no tests, no verification |

---

## Specialized Pipelines

### TDD Pipeline (Test-Driven Development)

```
PlanDescriber -> QA (write tests first) -> Implementor -> Build -> Lint -> Security -> Verifier
```

**When to use**: The feature is well-understood but correctness is critical. Tests are written BEFORE implementation. Implementor must pass all pre-written tests.

### Parallel Micro-Pipeline (Frontend + Backend Split)

```
Pipeline A: PlanDescriber(frontend) -> Implementor(frontend) -> Build(frontend)
Pipeline B: PlanDescriber(backend)  -> Implementor(backend)  -> Build(backend)
                |                          |
                +-------- MERGE -----------+
                            |
                     Integration QA -> Full Verifier
```

**When to use**: A feature has a clear frontend/backend boundary with no shared data dependency. Both pipelines run simultaneously. The Orchestrator waits for both to reach the MERGE gate. Each micro-pipeline gets its own `agent-context.md` (suffixed: `-frontend`, `-backend`).

---

## Quick Pipeline Presets

| Pipeline Type | Steps | When to Use | Includes Documentor? |
|---------------|-------|-------------|----------------------|
| **Ultra-Quick** | Implementor -> Build | Typo fixes, one-line changes, config edits, package.json updates | No |
| **Quick** | Implementor -> Build -> Lint -> QA | Small bug fix with known cause, trivial feature addition | No |
| **Review** | Implementor -> Build -> Lint -> Security -> QA | Small feature that needs the safety net but no plan needed | No |
| **Standard** | PlanDescriber -> Implementor -> Build -> Lint -> Security -> QA -> Verifier -> Documentor | New feature in a familiar domain | Yes |
| **Full** | Finder -> Brainstorm -> PlanDescriber -> Implementor (parallel) -> Integrator -> Build -> Lint -> Security -> QA -> Verifier -> Documentor | New feature in unfamiliar domain, complex changes, or parallel sub-tasks | Yes |
| **Fixer-Only** | Fixer -> Build -> Lint -> Test -> QA -> Verifier | Bug with known root cause | No |
| **Research** | Finder -> report to user | Understanding code, exploring options | No |
| **Docs** | Documentor -> report to user | Documentation only | N/A |

### Selection Rule

Always choose the **shortest viable pipeline**. The Orchestrator should ask: "Can this task be done with an Ultra-Quick pipeline?" If yes, use it. If the task proves more complex mid-pipeline, escalate to the next level.

> **Note**: All pipelines that include both `QA` and `Verifier` implicitly include the **Security Test Coverage Gate** between them. QA reports `securityTestCoverage`, the Orchestrator validates >= 80% coverage, and Verifier cross-checks during Pass 2.6.

---

## When to Load Skills

| Pipeline Step | Skill to Load | Why |
|---------------|---------------|-----|
| Brainstorming | `plan-brainstorm` | Structured option exploration |
| Plan Describer | `plan-describe` + `code-philosophy` | Comprehensive roadmap creation |
| Implementation | `code-philosophy`, `backend-code-philosophy`, `frontend-code-philosophy` | Code quality adherence |
| Implementation (UI) | `accessibility` | When building UI components |
| Security Scan | `security-scan` + `semgrep-scan` + `gitleaks-scan` + `trivy-scan` (all auto-loaded) or `security-workflow` | Dependency + SAST + secret + vuln/misconfig scanning |
| OWASP ZAP DAST | `owasp-zap-scan` (optional, post-deployment) | Web application DAST scanning — requires running app URL |
| Code Quality Gate | `pmd-scan` | MANDATORY — Static code analysis for Java/Apex/JS/Kotlin/Swift/PLSQL |
| QA | `quality-assurance` | Testing methodology and reporting |
| Verification | `plan-verification` | Plan compliance checking |
| Browser Testing | `playwright-cli` | Browser automation |
| Documentation | `api-documentation` | README, API docs, inline comments, ADRs |
| Pre-Flight | `smart-finder` | Proactive hazard detection |