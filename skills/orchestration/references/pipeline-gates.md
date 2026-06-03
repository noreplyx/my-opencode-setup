# Pipeline Gates Reference

## Build Gate Protocol

The Implementor MUST run the build command after writing code.

### Error Routing Table

| Error Type | Route To | Action |
|------------|----------|--------|
| `import-error` | **Integrator** | Fix import paths |
| `type-error` | **Fixer** | Fix type signatures |
| `syntax-error` | **Implementor** | Fix syntax |
| `config-error` | **Orchestrator** | Fix tsconfig/ESLint config |
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
| Post-deployment DAST | OWASP ZAP (`owasp-zap-scan` — optional) | Optional |

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
| 0 | No leaks | [x] PASS — proceed to next scan |
| 1 | Leaks detected | [ ] FAIL — block pipeline, report findings |
| 2 | Tool error (podman missing, image pull failed) | ! WARN — log, proceed if gitleaks unavailable |
| 124 | Scan timeout | ! WARN — increase `--timeout` or reduce scan scope |
| 255 | Gitleaks crash/error | ! WARN — log error, proceed if gitleaks unavailable |

### Other Security Rules

- The Security Scan **MUST NOT** modify any files
- Secrets/anti-pattern findings -> WARN (non-blocking, report findings)

### Re-Audit on Dependency Change

If any agent modifies `package.json`, `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` during the pipeline:

1. The dependency scan MUST be re-run after the modification
2. This applies to the Fixer agent — if Fixer installs/updates a package, the security scan must run again
3. The Orchestrator checks `changedFiles` from Fixer/Implementor — if any dependency file is in the list, the security scan gate is re-triggered before proceeding to QA

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
| 0 | No leaks | [x] PASS — proceed to next scan |
| 1 | Leaks detected | [ ] FAIL — block pipeline, report findings |
| 2 | Tool error (podman missing, image pull failed) | ! WARN — log, proceed if gitleaks unavailable |
| 124 | Scan timeout | ! WARN — increase `--timeout` or reduce scan scope |
| 255 | Gitleaks crash/error | ! WARN — log error, proceed if gitleaks unavailable |

### Hard Rules

- [x] The Orchestrator SHOULD use `pipeline-gitleaks.ts` instead of manually running podman commands
- [x] The script MUST be called with `--fail-on-leaks` (default) to properly block on secrets
- [x] The output MUST be parsed to extract findings for the combined Security Scan report
- [x] NEVER modify project files during scanning — the script is read-only by design

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

1. Run Security Checkpoint Auto-Detection (Section 2 of `security-workflow`) on all modified files
2. Read QA's `securityTestCoverage` from the agent context
3. Cross-reference: every security pattern detected by the Verifier should have a corresponding test generated by QA
4. Report missing test coverage in `securityTestCoverageGate` field
5. If coverage < 50% after cross-reference: Verifier reports failure and pipeline cycles to Fixer/QA

### Coverage Gate Rules

| Coverage | Verdict | Action |
|----------|---------|--------|
| >= 80% | [x] PASS | Proceed to Acceptance Gate |
| 50-79% | [!] WARN | Include in deviation report, proceed |
| < 50% | [ ] FAIL | Block pipeline — cycle back to QA with instruction to generate missing security tests |

### Enforcement

- The Orchestrator checks QA's `securityTestCoverage.gatePassed` field
- If `gatePassed: false` and coverage < 50%: the pipeline is blocked, and QA must be re-invoked
- If `gatePassed: false` but coverage 50-79%: the pipeline proceeds with a warning; the Verifier flags this in its final report

---

## Acceptance Gate

### Protocol

1. **Check manifest** for `acceptanceCriteria` checkpoints
2. **If none exist**: Skip gate with note "No acceptance criteria in manifest"
3. **If acceptance criteria exist**:
   - Start the application (`npm run start` or equivalent)
   - Wait for health check to pass (max 30 seconds)
   - For each `acceptanceCriteria` checkpoint:
     - Execute the `testCommand`
     - Capture exit code + stdout/stderr
     - Record: Pass / Fail / Skipped
   - Stop the application

### Passing / Blocking

| Outcome | Result |
|---------|--------|
| All acceptance criteria pass | [x] Gate passes — proceed to Verifier |
| Any acceptance criteria fail | [ ] Gate blocks — cycle to Fixer with the failed test output |
| App could not be started | ! Gate skipped — proceed with warning |

### Weight

Acceptance criteria carry **double weight** in the Verifier's compliance score.

---

## Integration Pipeline Flow

```
Build Gate → Lint Gate → Code Quality Gate → Test Gate → Security Scan → QA (smoke + security regression) → Security Test Coverage Gate → Acceptance Gate → Verifier
```