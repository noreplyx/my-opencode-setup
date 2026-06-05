# Pipeline Registry

This document is the canonical index of all pipeline types, their agent sequences, required scripts, and expected outputs.

## Pipeline Types

| Pipeline Type | Description | When to Use |
|---|---|---|
| **full** | Complete pipeline with all gates | New features, complex changes |
| **quick** | Skip Finder, go directly to PlanDescriber | Simple/familiar tasks |
| **fixer-only** | Skip PlanDescriber, go directly to Fixer | Bug fixes with known root cause |
| **trivial** | Skip all gates, delegate to Implementor | Config changes, simple edits |
| **tdd** | Tests written before implementation | Test-driven development |
| **parallel** | Frontend + backend split with merge | Large features with clear boundaries |
| **exploratory** | Finder only, report findings directly | Research tasks |
| **documentation** | Documentor only | Documentation updates |
| **architecture** | Architect only | System design, ADRs, C4 diagrams |

## Agent Sequences

### Full Pipeline

```
Finder -> Orchestrator (brainstorm) -> PlanDescriber -> Implementor -> Integrator (Phase 1: verify -> Phase 2: wire) -> Build Gate -> Lint Gate -> Test Gate -> Security Scan -> QA (smoke test + coverage) -> Acceptance Gate -> Verifier -> Documentor -> Orchestrator (report)
```

### Quick Pipeline

```
PlanDescriber -> Implementor -> Security Scan -> QA -> Verifier -> Documentor -> Orchestrator
```

### Fixer-Only Pipeline

```
Fixer -> QA -> Verifier -> Documentor -> Orchestrator
```

### TDD Pipeline

```
PlanDescriber -> QA (write tests first) -> Implementor -> Build -> Lint -> Security Scan -> Verifier
```

### Parallel Pipeline

```
Pipeline A: PlanDescriber(frontend) -> Implementor(frontend) -> Build(frontend)
Pipeline B: PlanDescriber(backend) -> Implementor(backend) -> Build(backend)
                     |                        |
                  --- MERGE --- Integration QA -> Full Verifier -> Documentor -> Orchestrator
```

### Architecture Pipeline

```
Architect -> (PlanDescriber if implementation follows) -> Orchestrator
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
| **Test Gate** | `test-gate.ts` | Automated test regression detection |
| **Security Scan** | `pipeline-gitleaks.ts`, `security-self-review-gate.ts` | Gitleaks scanning, security self-review enforcement |
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
