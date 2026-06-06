# Pipeline Registry

This document is the canonical index of all pipeline types, their agent sequences, required scripts, and expected outputs.

## Mandatory Gates Policy

The following three gates are **MANDATORY for every pipeline that creates or modifies code**:

| Gate | Why Mandatory | Exception |
|------|---------------|-----------|
| **PlanDescriber** | Every code change must follow a structured plan manifest with verifiable checkpoints | Fixer-only (plan already exists), exploratory, documentation, architecture pipelines |
| **Security Scan Gate** | Every code change must be scanned for vulnerabilities, secrets, and anti-patterns | Exploratory, documentation, architecture pipelines (no functional code) |
| **Verifier Gate** | Every implementation must be verified against its plan manifest for compliance | Exploratory, documentation, architecture pipelines (no code to verify) |

**Enforcement rules:**
1. Orchestrator MUST NOT skip PlanDescriber if the task involves creating or modifying code
2. Orchestrator MUST NOT skip the Security Scan gate after any code change
3. Orchestrator MUST NOT skip the Verifier gate after any implementation step
4. If a pipeline type historically skipped these gates (fixer-only, trivial), the Orchestrator adds them back
5. These gates apply to both primary and parallel pipeline branches

## Pipeline Types

| Pipeline Type | Description | When to Use |
|---|---|---|
| **full** | Complete pipeline with all gates | New features, complex changes |
| **quick** | Skip Finder, go directly to PlanDescriber | Simple/familiar tasks |
| **fixer-only** | Fix existing code — Security Scan + Verifier gates added | Bug fixes with known root cause |
| **trivial** | Minimal code change — PlanDescriber + Security Scan + Verifier added | Config changes, simple edits |
| **tdd** | Tests written before implementation | Test-driven development |
| **parallel** | Frontend + backend split with merge | Large features with clear boundaries |
| **exploratory** | Finder only, report findings directly (no code written) | Research tasks |
| **documentation** | Documentor only (no code written) | Documentation updates |
| **architecture** | Architect only (no code written) | System design, ADRs, C4 diagrams |

## Agent Sequences

### Full Pipeline

```
Finder -> Orchestrator (brainstorm) -> PlanDescriber -> Implementor -> Integrator (Phase 1: verify -> Phase 2: wire) -> Build Gate -> Lint Gate -> Security Self-Review Gate -> Test Gate -> Security Scan -> QA (smoke test + coverage) -> Acceptance Gate -> Verifier -> Documentor -> Orchestrator (report)
```

### Quick Pipeline

```
PlanDescriber -> Implementor -> Security Scan -> QA -> Verifier -> Documentor -> Orchestrator
```

### Fixer-Only Pipeline (SECURITY-HARDENED)

```
Fixer -> Security Scan -> QA -> Verifier -> Documentor -> Orchestrator
```

> **Security note**: PlanDescriber is skipped because the plan manifest already exists from the original pipeline. Security Scan and Verifier are MANDATORY — every bug fix must be scanned for vulnerabilities and verified against the plan.

### Trivial Pipeline (SECURITY-HARDENED)

```
PlanDescriber -> Implementor -> Security Scan -> Verifier -> Orchestrator
```

> **Security note**: Even trivial config changes must have a lightweight plan manifest (minimum: changed files + acceptance criteria), pass security scan, and pass verifier gate. Build/Lint/Test/QA gates may be skipped for non-functional changes.

### TDD Pipeline

```
PlanDescriber -> QA (write tests first) -> Implementor -> Build -> Lint -> Test Gate -> Security Scan -> Verifier -> Documentor -> Orchestrator
```

### Parallel Pipeline

```
Pipeline A: PlanDescriber(frontend) -> Implementor(frontend) -> Build(frontend) -> Security Scan(frontend) -> Verifier(frontend)
Pipeline B: PlanDescriber(backend) -> Implementor(backend) -> Build(backend) -> Security Scan(backend) -> Verifier(backend)
                     |                        |
                  --- MERGE --- Integration QA -> Full Verifier -> Documentor -> Orchestrator
```

### Architecture Pipeline

```
Architect -> (PlanDescriber if implementation follows) -> Orchestrator
```

### Exploratory Pipeline

```
Finder -> Orchestrator (report findings)
```

### Documentation Pipeline

```
Documentor -> Orchestrator
```

## Required Scripts Per Step

| Step | Required Scripts | Purpose |
|---|---|---|
| **Pre-Flight** | `pipeline-init.ts`, `dependency-check.ts`, `check-agent-readiness.ts` | Initialize pipeline, verify dependencies, check agent readiness |
| **Finder** | (none) | Codebase exploration |
| **PlanDescriber** | `validate-manifest-schema.ts` | Validate plan manifest JSON structure |
| **Implementor** | `check-plan-contract.ts` (pre), `check-plan-adherence.ts` (post) | Pre-implementation contract validation, post-implementation adherence gate |
| **Integrator** | (none) | Cross-file consistency verification + wiring |
| **Build Gate** | (none) | `npm run build` or `npx tsc --noEmit` |
| **Lint Gate** | (none) | `npx eslint`, `npx prettier --check`, etc. |
| **Security Self-Review** | `security-self-review-gate.ts` | Enforce implementor security self-review |
| **Test Gate** | `test-gate.ts` | Automated test regression detection |
| **Security Scan** | `pipeline-gitleaks.ts` | Gitleaks scanning, vulnerability scanning |
| **QA** | (none) | Smoke test, coverage analysis, bug discovery |
| **Acceptance Gate** | (none) | Acceptance criteria checkpoints from plan manifest |
| **Verifier** | `plan-quality-score.ts` | Record plan quality score for PlanDescriber feedback |
| **Documentor** | (none) | Documentation generation |
| **Teardown** | `pipeline-teardown.ts`, `pipeline-checkpoint.ts` | Archive logs, create git checkpoint |

## Security Scan Sub-Scans

| Scan | Tool | Auto-Loaded? | Purpose |
|---|---|---|---|
| SAST | semgrep | Yes | Static analysis for security anti-patterns |
| Secrets | gitleaks | Yes | Git history secret scanning |
| Vulnerabilities | trivy | Yes | Container/IaC vulnerability scanning |
| Dependencies | npm audit | Yes | npm dependency vulnerability audit |
| Open Source Vulns | osv-scanner | Yes | Open source vulnerability scanning |
| Anti-Patterns | security-scan (built-in) | Yes | Code anti-pattern detection |
| DAST | OWASP ZAP | No (optional post-deployment) | Dynamic web application scanning |

## Circuit Breaker Thresholds

| Gate | Threshold | Escalation Target |
|---|---|---|
| Build | 3 attempts | Implementor -> Fixer |
| Lint | 3 attempts | Implementor |
| Test | 3 attempts | Fixer |
| Security Scan | 3 attempts | User |
| Smoke Test | 3 attempts | Fixer |
| Verifier | 3 attempts | PlanDescriber |
| Total Pipeline | 5 retries | User |

## Agent Output Contracts

| Agent | Required Output Fields |
|---|---|
| **Finder** | `explorationCache.used`, `explorationCache.lastCommitSha` |
| **PlanDescriber** | `manifestPath`, `manifestVersion`, `phases`, `estimatedEffort`, `riskLevel` |
| **Implementor** | `selfReview`, `securitySelfReview`, `qualitySelfReview`, `checkpointProgress`, `preBuildAdherence` |
| **Integrator** | `filesChecked`, `importIssues`, `typeIssues`, `interfaceIssues`, `reexportIssues`, `blocking`, `consistencyScore`, `wiringSummary` |
| **Fixer** | `rootCauseAnalysis`, `securityFixDetails` (if security-related), `reproduction` |
| **QA** | `projectType`, `smokeTestPassed`, `testFramework`, `coverage`, `securityTestsGenerated`, `securityTestCoverage` |
| **Verifier** | `complianceScore`, `weightedScore`, `totalCheckpoints`, `passedCheckpoints`, `failedCheckpoints`, `qualityDrift`, `securityTestCoverageGate` |
| **Documentor** | `docsCreated`, `docsUpdated`, `apiDocsGenerated`, `changeSummary`, `docsAccuracy` |
| **BrowserTester** | `urlsVisited`, `bugsFound`, `testScriptsCreated`, `sessionSummary`, `findings` |
| **Architect** | `adrCount`, `adrFiles`, `optionsConsidered`, `selectedOption`, `decisionConfidence`, `riskLevel`, `bridgeToPlanDescriber` |
| **Debug** | `diagnostics`, `rootCauseAnalysis` |
