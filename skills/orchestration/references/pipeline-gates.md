# Pipeline Gates Reference

## Build Gate Protocol

The Implementor MUST run the build command after writing code.

### Error Routing Table

| Error Type | Route To | Action |
|------------|----------|--------|
| `import-error` | **Integrator** | Fix import paths |
| `type-error` | **Fixer** | Fix type signatures |
| `syntax-error` | **Implementor** | Fix syntax |
| `config-error` | **Fixer** | Fix tsconfig/ESLint config |
| `dependency-error` | **user** | Fix package.json |
| `lint-error` | **Implementor** | Fix code style |
| `test-failure` | **Fixer** | Fix test assertions |
| `missing-export` | **Implementor** | Add missing export |
| `duplicate-identifier` | **Implementor** | Remove duplicate |
| `unknown-error` | **Implementor** | Manual review |

### Build Output Requirements

- The Implementor MUST return the full build output (stdout + stderr) to the Orchestrator
- If the build fails, the Implementor MUST fix the issue and rebuild before reporting completion
- The Orchestrator MUST inspect the build output to confirm success before proceeding to QA

### Full Build/Lint Output

The Implementor's report MUST include lint output alongside build output so the Orchestrator can confirm both gates passed.

---

## Lint Gate Protocol

- The Implementor MUST run lint commands (e.g., `eslint`, `prettier --check`, `tsc --noEmit`) after the build passes
- The Implementor MUST return the full lint output (stdout + stderr) to the Orchestrator
- If linting fails, the Implementor MUST fix the issues and re-lint before reporting completion
- The Orchestrator MUST inspect the lint output to confirm no errors before proceeding to QA
- If the project has no linter configured, the Implementor should report **"No linter configured"** and proceed

---

## Security Self-Review Gate

### Who Runs It

The Implementor runs this gate AFTER completing the Quality Self-Review but BEFORE running the build. It validates that the mandatory 17-item security + quality self-review checklist was completed and passed.

### What It Checks

| Check | Field | Expected |
|-------|-------|----------|
| Implementor completed | `agentOutputs.implementor.status` | `"completed"` |
| Security items checked | `selfReview.securityItemsPassed` | `> 0` |
| Security items total | `selfReview.securityItemsTotal` | `> 0` |
| Security review passed | `selfReview.securitySelfReviewPassed` | `true` |
| Security review (alt) | `securitySelfReview.passed` | `true` |

### Enforcement Command

```bash
ts-node skills/scripts/orchestration/security-self-review-gate.ts --enforce --pipeline-id=<pipeline-id>
```

### Failure Action

If the security self-review gate fails:
- A BLOCK file is written to `.opencode/gates/BLOCK-<pipeline-id>.gate`
- The pipeline is BLOCKED until the Implementor fixes the failing security items
- The Implementor must re-run the 17-item Quality Self-Review checklist, fix all blocking items, then re-report

### When to Skip

- If the Implementor has not yet run (no implementor output in agent-context.md), the gate is skipped
- Documentation-only and exploratory pipelines skip this gate
- Fixer pipelines skip this gate (Fixer has its own security self-review)

---

## Code Quality Gate

- Load the `pmd-scan` skill: static analysis + CPD (copy-paste detection) duplicate detection via podman
- Auto-detects languages: Java, Apex, JavaScript, Kotlin, Swift, PLSQL
- **Note**: PMD primarily targets Java/Apex projects; for pure JS/TS projects, consider skipping or using an alternative linter
- Runs after Lint Gate, before Security Scan
- Violations **FAIL** the gate (block pipeline)

---

## Test Gate

- Run `ts-node skills/scripts/orchestration/test-gate.ts`
- Equivalent to `npm test` / `jest` / `vitest run`
- Tests fail -> cycle to **Fixer**
- No test framework configured -> skip with warning

---

## Security Scan Protocol

### Who Runs It

After build + lint pass, the Orchestrator delegates the Security Scan to an appropriate subagent (e.g., Fixer with `security-scan` skill loaded, or a dedicated security subagent). The Orchestrator NEVER runs the scan directly.

### Included Scans

| Scan | Tool | Trigger |
|------|------|---------|
| Dependency audit | `npm audit` | Manual |
| Secrets scan | gitleaks (auto-loaded `gitleaks-scan` skill) | Auto |
| SAST analysis | semgrep (auto-loaded `semgrep-scan` skill) | Auto |
| Vulnerability + IaC misconfig | trivy (auto-loaded `trivy-scan` skill) | Auto |
| Code quality | pmd (auto-loaded `pmd-scan` skill) | Auto |
| Post-deployment DAST | OWASP ZAP (`owasp-zap-scan`) | Auto (web projects: full, parallel, tdd, refactor); Skipped (non-web) |

### Severity Mapping

**Gitleaks (Secrets)**:
| Severity | Pipeline Action |
|----------|-----------------|
| High / Critical | FAIL the gate (block pipeline) |
| Secrets | WARN (non-blocking, report findings) |

**SAST (semgrep)**:
| Severity | Pipeline Action |
|----------|-----------------|
| Critical / High | FAIL the gate (block pipeline) |
| Medium | WARN (non-blocking) |
| Low | INFO |

**Dependency (npm audit)**:
| Condition | Pipeline Action |
|-----------|-----------------|
| High/Critical dependency vulnerabilities | FAIL the gate (block pipeline) |
| Install scripts detected in dependencies | FAIL the gate (block pipeline) |

**Trivy**:
| Severity | Pipeline Action |
|----------|-----------------|
| CRITICAL / HIGH | FAIL the gate (block pipeline) |

### Gitleaks Exit Codes

| Code | Meaning | Pipeline Action |
|------|---------|-----------------|
| 0 | No leaks | [x] PASS â€” proceed to next scan |
| 1 | Leaks detected | [ ] FAIL â€” block pipeline, report findings |
| 2 | Tool error (podman missing, image pull failed) | ! WARN â€” log, proceed if gitleaks unavailable |
| 124 | Scan timeout | ! WARN â€” increase `--timeout` or reduce scan scope |
| 255 | Gitleaks crash/error | ! WARN â€” log error, proceed if gitleaks unavailable |

### Other Security Rules

- The Security Scan **MUST NOT** modify any files
- Secrets/anti-pattern findings -> WARN (non-blocking, report findings)

### Re-Audit on Dependency Change

If any agent modifies `package.json`, `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` during the pipeline:

1. The dependency scan MUST be re-run after the modification
2. This applies to the Fixer agent â€” if Fixer installs/updates a package, the security scan must run again
3. The Orchestrator checks `changedFiles` from Fixer/Implementor â€” if any dependency file is in the list, the security scan gate is re-triggered before proceeding to QA

---

## ZAP DAST Auto-Load Protocol

### Who Runs It

The Security Scan subagent auto-loads the `owasp-zap-scan` skill during the Security Scan gate. The ZAP scan runs in parallel with SAST (semgrep) and secrets (gitleaks) scans.

### When It Runs

| Pipeline Type | ZAP DAST Behavior |
|--------------|-------------------|
| full | Auto-load and run |
| parallel | Auto-load and run |
| tdd | Auto-load and run |
| refactor | Auto-load and run |
| quick | Skip (non-blocking) — report "ZAP skipped for quick pipeline" |
| fixer-only | Skip (non-blocking) |
| research | Skip |
| documentation | Skip |
| micro-pipeline | Skip |

### What It Checks

| Check | Description |
|-------|-------------|
| XSS | Cross-site scripting vulnerabilities |
| SQL Injection | SQL injection in form fields/URLs |
| CSRF | Cross-site request forgery tokens |
| Authentication | Weak or missing auth controls |
| Authorization | Insecure direct object references |
| Session Management | Cookie flags, session fixation |
| Information Disclosure | Stack traces, directory listing |

### Severity Mapping

| Severity | Pipeline Action |
|----------|-----------------|
| High / Critical | WARN (non-blocking) — report findings, do NOT block pipeline |
| Medium | WARN — report findings |
| Low | INFO |

### Why Non-Blocking

ZAP DAST is a dynamic scan that requires a running application and may produce false positives depending on the test environment. Findings are informational and included in the combined Security Scan report, but they do NOT block the pipeline. The Orchestrator reviews ZAP findings manually.

### Prerequisites

- The `owasp-zap-scan` skill must be whitelisted in the Orchestrator's tool permissions (already done in agents/orchestrator.md)
- ZAP requires the application to be running (port 8080 or user-specified)
- If ZAP is unavailable (e.g., podman not installed, no running app), the scan is skipped with a warning

---

## Automated Gitleaks Scan Script

The delegated subagent can run gitleaks via the automated script instead of manually loading and invoking the skill:

```bash
ts-node skills/scripts/orchestration/pipeline-gitleaks.ts --workspace="${PWD}" [options]
```

### What It Does Automatically

1. Checks podman availability (exits 2 if missing, with install instructions)
2. Checks if container image exists locally; pulls it if missing (unless `--no-pull`)
3. Runs gitleaks in git mode (full history scan) with configurable options
4. Parses JSON output and classifies findings by severity (critical/high/medium/low)
5. Returns structured JSON report to stdout for machine consumption
6. Exits 0 (no leaks), 1 (leaks detected), or 2 (tool error)

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--workspace=<path>` | `$PWD` | Workspace root to scan |
| `--mode=<mode>` | `git` | Scan mode: `git`, `dir`, or `stdin` |
| `--verbose` | off | Enable verbose gitleaks output |
| `--report-format=<fmt>` | `json` | Output format: `json`, `csv`, `sarif`, `junit` |
| `--no-banner` | true | Suppress gitleaks banner |
| `--baseline=<path>` | none | Baseline for incremental scanning |
| `--config=<path>` | none | Custom `.gitleaks.toml` config |
| `--ignore=<path>` | none | `.gitleaksignore` file path |
| `--max-target-mb=<N>` | 50 | Max target file size in MB |
| `--fail-on-leaks` | true | Exit 1 if leaks found (default) |
| `--no-fail-on-leaks` | false | Exit 0 even if leaks found (informational) |
| `--timeout=<N>` | 300 | Timeout in seconds |
| `--image=<name>` | `docker.io/zricethezav/gitleaks:latest` | Container image |
| `--no-pull` | false | Skip pulling the container image |
| `--markdown` | false | Output human-readable markdown report |

### Exit Code Mapping

| Code | Meaning | Pipeline Action |
|------|---------|-----------------|
| 0 | No leaks | [x] PASS â€” proceed to next scan |
| 1 | Leaks detected | [ ] FAIL â€” block pipeline, report findings |
| 2 | Tool error (podman missing, image pull failed) | ! WARN â€” log, proceed if gitleaks unavailable |
| 124 | Scan timeout | ! WARN â€” increase `--timeout` or reduce scan scope |
| 255 | Gitleaks crash/error | ! WARN â€” log error, proceed if gitleaks unavailable |

### Hard Rules

- [x] The Orchestrator SHOULD use `pipeline-gitleaks.ts` instead of manually running podman commands
- [x] The script MUST be called with `--fail-on-leaks` (default) to properly block on secrets
- [x] The output MUST be parsed to extract findings for the combined Security Scan report
- [x] NEVER modify project files during scanning â€” the script is read-only by design

---

## Smoke Test Protocol

- **Who**: QA runs a simple smoke test
- **Duration**: Smoke test should be fast (< 10 seconds)
- **Check**: Application boots without crashing, or module loads cleanly
- **Failure**: QA reports as a **Critical** severity bug
- **Action**: Orchestrator cycles to the **Fixer agent** for diagnosis and fix
- **After fix**: QA re-runs the smoke test

---

## Security Test Coverage Gate

### QA Reports

- Number of security patterns detected
- Number of tests generated
- Coverage percentage
- Gate pass/fail status

### Verifier Cross-Reference (Pass 2b)

1. Run Security Checkpoint Auto-Detection (§B.2 of `security-scan`) on all modified files
2. Read QA's `securityTestCoverage` from the agent context
3. Cross-reference: every security pattern detected by the Verifier should have a corresponding test generated by QA
4. Report missing test coverage in `securityTestCoverageGate` field
5. If coverage < 50% after cross-reference: Verifier reports failure and pipeline cycles to Fixer/QA

### Coverage Gate Rules

| Coverage | Verdict | Action |
|----------|---------|--------|
| >= 80% | [x] PASS | Proceed to Acceptance Gate |
| 50-79% | [!] WARN | Include in deviation report, proceed |
| < 50% | [ ] FAIL | Block pipeline â€” cycle back to QA with instruction to generate missing security tests |

### Enforcement

- The Orchestrator checks QA's `securityTestCoverage.gatePassed` field
- If `gatePassed: false` and coverage < 50%: the pipeline is blocked, and QA must be re-invoked
- If `gatePassed: false` but coverage 50-79%: the pipeline proceeds with a warning; the Verifier flags this in its final report

---


## Evidence Gate

### Who Runs It

The Orchestrator runs this gate AFTER every agent hand-off and BEFORE dispatching the next agent. It validates that every substantive claim made by the agent is backed by verifiable evidence.

### What It Checks

| Check | Description | Weight |
|-------|-------------|--------|
| **Required fields** | Every evidence entry must have `claim`, `source`, and `method` | Blocking |
| **File existence** | The `source` file path must exist on disk | Blocking |
| **Content hash** | If `contentHash` is provided, it must match the current file's SHA-256 | Blocking |
| **Command re-execution** | If `command` is provided, re-run it and verify output matches the claim | Scoring |
| **Excerpt verification** | If `excerpt` is provided, verify it exists in the source file | Scoring |
| **Path traversal** | Evidence source paths must not escape the workspace root | Blocking |

### Enforcement Command

```bash
ts-node skills/scripts/orchestration/evidence-quality-gate.ts --context=agent-context.md
```

### Scoring

| Score | Verdict | Action |
|-------|---------|--------|
| >= 80% and zero failures | [x] PASS | Proceed — evidence quality is acceptable |
| >= 80% with unverifiable entries | [!] WARN | Proceed with warning — some evidence needs manual review |
| < 80% | [ ] FAIL | Block pipeline — agent must re-submit output with better evidence |
| Any critical failure (file_not_found, hash_mismatch, path_traversal) | [ ] FAIL | Block pipeline — evidence is invalid |

### Failure Action

If the Evidence Gate fails:
1. The Orchestrator rejects the agent's output and does NOT update `agent-context.md`
2. The Orchestrator sends the validation errors back to the agent with clear instructions
3. The agent gets **one retry** to fix the evidence quality
4. If the agent fails twice, the Orchestrator escalates to the user

### When to Skip

- Exploratory, documentation, and architecture pipelines (no code to verify)
- When the agent produced no substantive claims (e.g., trivial config changes)
- When `agent-context.md` does not exist (first agent in pipeline)

### Integration with Existing Tools

The Evidence Gate complements:
- **`validate-output-contract.ts`** — validates output format (field presence/types)
- **`check-evidence-regression.ts`** — scans historical evidence for staleness
- **`check-handoff.ts`** — validates hand-off completeness before dispatch

The Evidence Gate is the **real-time quality check** that runs during the pipeline, while `check-evidence-regression.ts` is the **historical audit** that runs after the pipeline.

---

## Acceptance Gate

### Protocol

1. **Check manifest** for `acceptanceCriteria` checkpoints
2. **If none exist**: Skip gate with note "No acceptance criteria in manifest"
3. **If acceptance criteria exist**:
   - The Orchestrator delegates Acceptance Gate execution to the **QA** agent
   - QA starts the application (`npm run start` or equivalent)
   - QA waits for health check to pass (max 30 seconds)
   - For each `acceptanceCriteria` checkpoint:
     - QA executes the `testCommand`
     - QA captures exit code + stdout/stderr
     - QA records: Pass / Fail / Skipped
   - QA stops the application

### Passing / Blocking

| Outcome | Result |
|---------|--------|
| All acceptance criteria pass | [x] Gate passes â€” proceed to Verifier |
| Any acceptance criteria fail | [ ] Gate blocks â€” cycle to Fixer with the failed test output |
| App could not be started | ! Gate skipped â€” proceed with warning |

### Weight

Acceptance criteria carry **double weight** in the Verifier's compliance score.

---

## Integration Pipeline Flow

```
Implementor → Security Self-Review Gate → Build Gate → Lint Gate → Code Quality Gate → Test Gate → Security Scan (incl. ZAP DAST for web apps) → QA (smoke + security regression) → Security Test Coverage Gate → Acceptance Gate → Verifier
```

---

## Delegation Gate Protocol

### Who Runs It

The Orchestrator runs this gate AFTER every agent hand-off and BEFORE dispatching the next agent. It validates that the Orchestrator delegated all substantive work (research, planning, implementation, verification) to subagents rather than doing it directly.

### What It Checks

| Check | Description | Blocking? |
|-------|-------------|-----------|
| Agent History Review | Every pipeline step should be a subagent, not the orchestrator | Yes |
| Changed Files Check | Orchestrator must not have changed files directly | Yes |
| Implementation Language | Orchestrator output must not say "I created/wrote/implemented/fixed" | Yes |
| Read-Only Verification | Orchestrator should only use read/glob/grep for verification | Warning |
| Hand-off Evidence | Orchestrator must produce evidence of verification for each hand-off | Warning |
| Subagent Coverage | Pipeline must have at least one subagent step beyond orchestrator | Warning |

### Enforcement Command

```bash
ts-node skills/scripts/orchestration/delegation-gate.ts --context=agent-context.md
```

In strict mode (higher scrutiny):
```bash
ts-node skills/scripts/orchestration/delegation-gate.ts --context=agent-context.md --strict
```

### Failure Action

| Result | Action |
|--------|--------|
| Pass | Proceed to next pipeline step |
| Fail | Block pipeline — Orchestrator must re-delegate the work to proper subagents |
| Warning | Proceed with warning — note the risk for manual review |

### When to Skip

- Single-agent pipelines (research only, documentation only)
- When agent-context.md does not exist

---

## Security Pre-Screening Protocol

### Who Runs It

The Orchestrator runs this gate BEFORE dispatching PlanDescriber. It classifies the feature's risk level and produces `securityConsiderations` that get injected into the plan manifest.

### Detection Modes

| Mode | Flag | Input | Use Case |
|------|------|-------|----------|
| Description Analysis | `--feature` + `--description` | Feature name + text description | Before planning, when feature scope is known |
| Source Detection | `--detect-from-source=<dir>` | Source code directory | When existing code is being modified |

### Risk Classification

| Risk Level | Plan Manifest Risk | When | Circuit Breaker Thresholds |
|-----------|-------------------|------|---------------------------|
| standard | low | Basic CRUD, static content, no user data | supplyChain: 3, securityRetries: 1 |
| sensitive | medium | User profiles, auth, PII, sessions | supplyChain: 2, securityRetries: 2 |
| infrastructure | high | Payments, admin, secrets, config | supplyChain: 1, securityRetries: 3 |

### Auto-Generated Security Checkpoints

For `sensitive` and `infrastructure` features, the pre-screening generates security checkpoints (CP-SEC-001, CP-SEC-002, etc.) that the Verifier must check in addition to the functional checkpoints from PlanDescriber.

### Enforcement Command

```bash
ts-node skills/scripts/orchestration/security-prescreen.ts --feature=<name> --description="Feature description..."
```

Output is JSON — the Orchestrator injects the `securityConsiderations` block into the PlanDescriber's instructions for inclusion in the plan manifest.

### When to Skip

- Documentation-only pipelines
- Research pipelines with no code changes
- Fixer-only pipelines (the plan already exists with security considerations)

