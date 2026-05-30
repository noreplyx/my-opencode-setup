---
name: security-scan
description: Use this skill to perform security scanning on project code and dependencies. It runs automated checks for dependency vulnerabilities (via osv-scanner), hardcoded secrets, SAST via semgrep, gitleaks secret scanning, Trivy vulnerability/misconfiguration scanning, SBOM generation, supply chain checks, and common security anti-patterns. This skill is automatically loaded by the Orchestrator after the Build+Lint+Code Quality gates pass. It loads the semgrep-scan skill, the gitleaks-scan skill, the trivy-scan skill, and the osv-scanner skill as mandatory sub-scans.
---

# Security Scan Skill

## Purpose

The Security Scan gate runs automated security checks on the codebase after the Build Gate passes and before QA begins. Its goal is to catch high-severity security issues early � before they reach production.

This skill is **automatically loaded by the Orchestrator** during every pipeline. It **always loads the `semgrep-scan` skill, the `gitleaks-scan` skill, the `trivy-scan` skill, and the `osv-scanner` skill** as mandatory sub-scans. No user prompt is required to run any of these tools.

## Scan Types

### 0. Semgrep SAST Scan (MANDATORY � Auto-Loaded)

The **Semgrep SAST Gate** is a mandatory sub-gate of the Security Scan. The Orchestrator **always loads the `semgrep-scan` skill** and runs semgrep static analysis:

```bash
# Run semgrep security scan (always runs, no user prompt needed)
semgrep --config p/security-audit --error .
```

**Why it's mandatory:**
- Catches path traversal, command injection, SQL injection, hardcoded secrets in source, insecure crypto, and OWASP Top 10 patterns
- Uses `--error` to fail the pipeline on findings
- Runs before dependency/secret scanning to maximize signal

**Verdict:**
| Exit Code | Meaning | Pipeline Action |
|-----------|---------|-----------------|
| 0 | No findings | ? PASS � proceed to next scan |
| 1 | Findings detected | ? FAIL � block pipeline, report findings |
| 2+ | Tool error | ?? WARN � log, proceed if tool unavailable |

**Hard Rules for semgrep:**
- ? The Orchestrator MUST load `semgrep-scan` skill during every pipeline
- ? The semgrep scan MUST use `--config p/security-audit` (security-focused)
- ? The semgrep scan MUST use `--error` (strict mode)
- ? NEVER modify project files during scanning
- ? NEVER use `--autofix`

### 1. Gitleaks Secret Scan (MANDATORY — Auto-Loaded)

The **Gitleaks Secret Scan Gate** is a mandatory sub-gate of the Security Scan. The Orchestrator **always loads the `gitleaks-scan` skill** and runs gitleaks secret detection:

```bash
# Run gitleaks secret scan (always runs, no user prompt needed)
podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/zricethezav/gitleaks:latest \
  git --source=/src --report-format=json --report-path=- --no-banner --verbose
```

**Why it's mandatory:**
- Detects hardcoded passwords, API keys, tokens, private keys, and credentials using 170+ curated rules with entropy and regex detection
- Scans entire git commit history, not just current file contents
- Catches secrets that basic grep-based scans miss (entropy analysis, base64-encoded tokens, structured patterns)
- Runs after Semgrep SAST and before dependency scanning to maximize signal

**Verdict:**
| Exit Code | Meaning | Pipeline Action |
|-----------|---------|-----------------|
| 0 | No leaks | ✅ PASS — proceed to next scan |
| 1 | Leaks detected | ❌ FAIL — block pipeline, report findings |
| 2+ | Tool error | ⚠️ WARN — log, proceed if tool unavailable |

**Hard Rules for gitleaks:**
- ✅ The Orchestrator MUST load `gitleaks-scan` skill during every pipeline
- ✅ The gitleaks scan MUST use `git` mode (full history scan)
- ✅ The gitleaks scan MUST use JSON output format for machine parsing
- ✅ Always pull the image first: `podman image exists docker.io/zricethezav/gitleaks:latest || podman pull docker.io/zricethezav/gitleaks:latest`
- ✅ NEVER modify project files during scanning
- ✅ NEVER skip the gitleaks scan — it is mandatory

### 2. Dependency Vulnerability Scan (OSV-Scanner)

The **OSV-Scanner Dependency Vulnerability Gate** is a mandatory sub-gate of the Security Scan. The Orchestrator **always loads the `osv-scanner` skill** and runs dependency vulnerability scanning via Podman container:

```bash
# Pull if needed
podman image exists ghcr.io/google/osv-scanner:latest || podman pull ghcr.io/google/osv-scanner:latest

# Run dependency vulnerability scan on the project
podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" ghcr.io/google/osv-scanner:latest 
  scan source -r --format json /src
```

**Why osv-scanner replaces language-specific scanners:**
- **Unified tool**: Single scanner covers 20+ lockfile formats across all ecosystems (npm, pip, Go, Rust, Maven, RubyGems, NuGet, PHP, Dart, Haskell, etc.)
- **No per-language installation**: No need for npm, pip, cargo, or maven — runs entirely in Podman
- **Broader coverage**: Catches vulnerabilities that per-language scanners may miss (different databases, C/C++ commit-level scanning)
- **Consistent output**: Same JSON/SARIF/HTML format across all projects
- **Container image scanning**: Can also scan container OS packages (dpkg, APK) for the same project

**Why it is mandatory:**
- Detects known CVEs in all open-source dependencies using the OSV.dev database
- Supports 11+ ecosystems with auto-detection of lockfiles
- Can also perform license compliance checking and SBOM generation
- Runs after SAST and secret scanning, before anti-pattern scans

**Verdict:**
| Exit Code | Meaning | Pipeline Action |
|-----------|---------|-----------------|
| 0 | No vulnerabilities | ✅ PASS — proceed to next scan |
| 1 | Vulnerabilities found | ❌ FAIL — block pipeline, report findings |
| 128 | No packages found | ⚠️ WARN — check if lockfiles exist |
| 127 | General error | ⚠️ WARN — log, proceed if tool unavailable |

**Hard Rules for osv-scanner:**
- ✅ The Orchestrator MUST load `osv-scanner` skill during every pipeline
- ✅ The osv-scanner scan MUST use recursive mode (`-r`) to find all lockfiles
- ✅ The osv-scanner scan MUST use JSON output format for machine parsing
- ✅ Always pull the image first: `podman image exists ghcr.io/google/osv-scanner:latest || podman pull ghcr.io/google/osv-scanner:latest`
- ✅ NEVER modify project files during scanning
- ✅ NEVER skip the osv-scanner dependency scan — it is mandatory

### 2.5. Trivy Vulnerability & Misconfiguration Scan (MANDATORY — Auto-Loaded)

The **Trivy Vulnerability & Misconfiguration Gate** is a mandatory sub-gate of the Security Scan. The Orchestrator **always loads the `trivy-scan` skill** and runs Trivy vulnerability and misconfiguration scanning via Podman container:

```bash
# Pull if needed
podman image exists docker.io/aquasec/trivy:latest || podman pull docker.io/aquasec/trivy:latest

# Run vulnerability + misconfiguration scan on the project filesystem
podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/aquasec/trivy:latest \
  fs --scanners vuln,misconfig --severity CRITICAL,HIGH --exit-code 1 /src
```

**Why it is mandatory:**
- Detects CVEs in OS packages (dpkg, apk, rpm) and all language dependencies (npm, pip, Go, Maven, etc.) — complementary to OSV-scanner (Trivy uses NVD/GHSA databases)
- Scans IaC misconfigurations in Dockerfiles, Kubernetes manifests, Terraform, CloudFormation, and Helm charts
- Detects hardcoded secrets in files (complementary to gitleaks — Trivy catches additional patterns)
- Performs license compliance scanning
- Can generate CycloneDX/SPDX SBOMs
- Runs after OSV-scanner and before anti-pattern scans

**Why it is NOT a replacement for osv-scanner:** Trivy and OSV-scanner use different vulnerability databases (Trivy: NVD/GHSA/RedHat/Ubuntu; OSV: OSV.dev). Running both provides broader coverage — vulnerabilities missed by one database may be found by the other.

**Verdict:**
| Exit Code | Meaning | Pipeline Action |
|-----------|---------|-----------------|
| 0 | No findings at CRITICAL/HIGH | ✅ PASS — proceed to next scan |
| 1 | Findings detected at CRITICAL/HIGH | ❌ FAIL — block pipeline, report findings |
| 2+ | Tool error | ⚠️ WARN — log, proceed if tool unavailable |

**Hard Rules for Trivy:**
- ✅ The Orchestrator MUST load `trivy-scan` skill during every pipeline
- ✅ The Trivy scan MUST use `--scanners vuln,misconfig` at minimum
- ✅ The Trivy scan MUST use `--severity CRITICAL,HIGH` for pipeline gates
- ✅ The Trivy scan MUST use `--exit-code 1` to block pipeline on findings
- ✅ Always pull the image first: `podman image exists docker.io/aquasec/trivy:latest || podman pull docker.io/aquasec/trivy:latest`
- ✅ NEVER modify project files during scanning
- ✅ NEVER skip the Trivy scan — it is mandatory
- ✅ Use a persistent cache volume for the vulnerability database to speed up scans

### 2.6. OWASP ZAP DAST Scan (OPTIONAL — Post-Deployment)

The **OWASP ZAP DAST Gate** is an **optional** scan that runs after the application is deployed to a test/staging environment. Unlike the mandatory sub-scans above, this scan requires a running application target URL and is triggered only when a test deployment URL is available.

```bash
# Pull if needed
podman image exists ghcr.io/zaproxy/zaproxy:stable || podman pull ghcr.io/zaproxy/zaproxy:stable

# Run baseline scan (passive, CI-safe)
podman run --rm --network host -v "${WORKSPACE_ROOT}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t <APP_URL> -r /zap/wrk/zap-baseline-report.html
```

**Why it's optional:**
- Requires a running application target URL (not available in all pipeline stages)
- Baseline scans are passive and safe for any environment
- Full active scans can be run against staging environments for deeper testing
- API scans support OpenAPI, SOAP, and GraphQL endpoints
- Catches OWASP Top 10 web vulnerabilities: missing security headers, XSS, SQL injection, CSRF, info disclosure, etc.

**Verdict:**
| Exit Code | Meaning | Pipeline Action |
|-----------|---------|-----------------|
| 0 | Success (no FAILs, or all WARN) | ✅ PASS |
| 1 | At least 1 FAIL (from config) | ⚠️ WARN — report findings, proceed |
| 2 | At least 1 WARN, no FAILs | ℹ️ INFO — report findings, proceed |
| 3 | Tool error | ℹ️ INFO — log, proceed |

**Hard Rules for OWASP ZAP:**
- ✅ Always use `--network host` when scanning localhost applications
- ✅ Mount the working directory to `/zap/wrk/` for report output
- ✅ Use `ghcr.io/zaproxy/zaproxy:stable` for production pipelines
- ✅ For CI/CD pipelines, prefer **baseline scan** (passive, safe)
- ✅ NEVER use `zap-full-scan.py` against production targets
- ⚠️ This scan is OPTIONAL — if no target URL is available, skip it

### 3. Hardcoded Secrets Scan

Search for potential secrets (API keys, tokens, passwords) hardcoded in source code:

```bash
# Check for common secret patterns in src/ (not in tests/fixtures)
rg -n --include="*.ts" --include="*.js" --include="*.py" \
  '(?:api[_-]?key|secret|password|auth[_-]?token|private[_-]?key)' \
  --glob '!tests/**' --glob '!**/*.test.*' --glob '!**/*.spec.*' \
  src/ || true
```

This is a **warning-only** scan � it does NOT fail the gate. It reports findings for manual review.

Findings are reported with a **Confidence** level to help prioritize review:

| Confidence | Description | Examples |
|------------|-------------|----------|
| **High** | Literal secret values detected | `sk-...`, private key header, github token prefix |
| **Medium** | Variable names or assignments suggesting secrets | `api_key=`, `password =`, `SECRET_TOKEN=` |
| **Low** | Generic patterns or strings in comments | `password` in a comment, `secret` in a log message |

### 4. Security Anti-Pattern Scan

Check for common security anti-patterns in the modified code:

| Anti-Pattern                     | What to grep for                              | Risk   |
|----------------------------------|-----------------------------------------------|--------|
| `eval()` usage                   | `eval(`                                       | High   |
| Unsafe `innerHTML`               | `innerHTML`                                   | Medium |
| SQL string concatenation         | `"SELECT.*\${` or `'SELECT.*' \${`              | High   |
| Hardcoded JWT secrets            | `jwt.*secret.*=` or `jwtSecret:`              | High   |
| Missing input validation on body | `req.body` without validation check nearby    | Medium |
| `document.write()` usage         | `document.write(`                             | Medium |
| `console.log()` in production    | `console.log`                                 | Low    |

For each finding, report the file and line number.

### 5. Supply Chain Integrity Check

Run the supply chain scanner to check for:
- **Install Script Detection**: Packages with `hasInstallScript: true` can run arbitrary code during install
- **Typosquatting Detection**: Package names that are 1-2 character edits away from popular packages
- **Package Freshness**: New packages (< 30 days old) and stale packages (> 2 years without updates)
- **Deprecated Packages**: Known-deprecated packages still in use
- **Dependency Count**: Warn if transitive dependencies exceed 500

```bash
# Run supply chain integrity check

```

If install scripts are detected (HIGH severity), the scan fails.
All other findings are warnings.

### 6. Software Bill of Materials (SBOM) Generation

After the dependency scan passes (or as a non-blocking step), generate an SBOM for the project:

```bash
# Generate CycloneDX SBOM if cyclonedx-bom is available
npx @cyclonedx/bom --output .opencode/sboms/<pipeline-id>-sbom.json 2>/dev/null || true
```

The SBOM is stored at `.opencode/sboms/<pipeline-id>-sbom.json` and contains:
- All direct and transitive dependencies
- Version numbers and license information
- Dependency relationships

This enables retrospective vulnerability analysis � if a CVE is disclosed tomorrow,
you can check which pipelines were affected by scanning the SBOM archive.

**Non-blocking**: If `@cyclonedx/bom` is not installed, log a warning and proceed.

### 7. Git History Secret Scan

Scan the git commit history for secrets that may have been committed and later removed.
Secrets in git history persist even after removal from the current file contents:

```bash
# Scan commit diffs for secret patterns
git log -p --all -- ':(exclude)package-lock.json' ':(exclude)pnpm-lock.yaml' ':(exclude)yarn.lock' | \
  rg -n \
  '(?:api[_-]?key|apikey|secret|password|auth[_-]?token|private[_-]?key|GITHUB_TOKEN_PREFIX|STRIPE_SECRET_PREFIX|PRIVATE_KEY_HEADER)' \
  || true
```

**Non-blocking** (informational only). If critical secrets found (AWS keys, GitHub tokens in history), emit a WARNING.

## Scan Workflow

1. **Load `semgrep-scan` skill** — The Orchestrator loads the `semgrep-scan` skill automatically (no user prompt)
2. **Run Semgrep SAST Scan (MANDATORY)** — Execute `semgrep --config p/security-audit --error .` — if it fails, block the pipeline
3. **Load `gitleaks-scan` skill** — The Orchestrator loads the `gitleaks-scan` skill automatically (no user prompt)
4. **Run Gitleaks Secret Scan (MANDATORY)** — Run gitleaks via podman container on the repo — if exit code 1 (leaks detected), block the pipeline
5. **Load `trivy-scan` skill** — The Orchestrator loads the `trivy-scan` skill automatically (no user prompt)
6. **Run Trivy Vulnerability & Misconfig Scan (MANDATORY)** — Run Trivy fs scan via podman container with --scanners vuln,misconfig --severity CRITICAL,HIGH --exit-code 1 — if exit code 1, block the pipeline
7. **Detect project type** — Read `package.json`, `requirements.txt`, `Cargo.toml`, etc.
8. **Check for lockfile** — Verify presence of `package-lock.json`, `yarn.lock`, `requirements.txt`, `Cargo.lock`, etc. If missing, emit a warning but do NOT fail.
9. **Run dependency scan (OSV-Scanner)** — Execute osv-scanner via podman container
10. **Parse results** — Extract vulnerability IDs, severity, package, and description
11. **Run secrets scan** — Grep for hardcoded secrets
12. **Run anti-pattern scan** — Grep for security anti-patterns in the changed files
13. **Generate SBOM**
14. **Run supply chain integrity check**
15. **Run git history secret scan**
16. **Report findings** — Use the standard report format below

### Lockfile Warnings

If the project has no lockfile or package manager configuration, emit the following non-blocking warning:

> ?? **No lockfile found** � dependency scan skipped. Consider committing `package-lock.json` or equivalent to enable reproducible and auditable builds.

If the package manager config exists but the lockfile is missing, emit:

> ?? **Lockfile missing** � `package.json` found but `package-lock.json` is absent. Run `npm install` to generate it. Dependency scan will proceed without lockfile verification.

## Report Format

```markdown
## Security Scan Report

### Scan Scope
- **Project Type**: Node.js / Python / Go / Java / Rust
- **Scanned Paths**: src/ (excluding tests/)
- **Semgrep SAST Scan**: ? / ? / ?? Skipped
- **Dependency Scan**: ? / ? / ?? Not applicable

### Semgrep SAST Findings
| Severity | Rule | File | Line | Message | Fix |
|----------|------|------|------|---------|-----|
| ERROR | path-traversal | src/routes/files.ts | 45 | User input in path.join(...) | Validate/sanitize input |

### Dependency Vulnerabilities
| ID | Package | Severity | Description | Fix Available |
|----|---------|----------|-------------|---------------|
| GHSA-xxxx | lodash | HIGH | Prototype pollution | npm audit fix |

### Secrets Warning (Informational)
| File | Line | Pattern | Confidence |
|------|------|---------|------------|
| src/config.ts | 15 | `api_key` | Low (likely env var reference) |

### Security Anti-Patterns
| File | Line | Pattern | Risk |
|------|------|---------|------|
| src/routes/user.ts | 42 | `eval(` | High |

### Supply Chain Integrity
| Check | Result |
|-------|--------|
| Install Scripts | ? None / ? Found |
| Typosquatting | ? None / ?? Warning |
| Stale Packages | ?? N packages |
| SBOM | ? Generated / ?? Skipped |

### Git History Secrets (Informational)
| File | Commit | Pattern | Confidence |
|------|--------|---------|------------|

### Verdict
**? PASS** � No High/Critical vulnerabilities found
**? FAIL** � Semgrep findings or High/Critical vulnerabilities detected � block pipeline
**?? WARN** � Secrets or anti-patterns found (non-blocking, review recommended)
```

## Auto-Remediation Suggestions

When issues are found, the following commands and practices can help resolve them:

| Issue Type | Suggestion |
|------------|------------|
| **Semgrep SAST findings** | Review each finding and fix the root cause (validate input, use parameterized queries, etc.) � re-run `semgrep --config p/security-audit --error .` to confirm |
| **Dependency vulnerabilities** | Use osv-scanner guided remediation: `osv-scanner-docker fix -M package.json -L package-lock.json`. Or update the vulnerable package manually based on the fixed version from the report. |
| **Hardcoded secrets** | Move secrets to environment variables (e.g., `process.env.API_KEY`), a `.env` file (ensure it is `.gitignore`d), or a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault). |
| **`eval()` usage** | Replace with `JSON.parse()`, `Function()` constructor, or a proper parser. Avoid dynamic code evaluation entirely. |
| **`innerHTML` / `document.write()`** | Use safe DOM APIs like `textContent`, `innerText`, or `createElement()` + `appendChild()`. For HTML, use a sanitization library like DOMPurify. |
| **SQL injection risk** | Replace string concatenation with parameterized queries (e.g., prepared statements, ORM query builders). |
| **Hardcoded JWT secrets** | Use environment variables or a key management service. Rotate exposed keys immediately. |
| **Missing input validation** | Add validation using a schema library (e.g., Joi, Zod, Pydantic, `validate`). Never trust `req.body` directly. |
| **`console.log()` in production** | Remove or replace with a structured logger (e.g., Winston, Pino) that supports log levels and can be disabled in production. |
| **Install scripts in dependencies** | Review each package with install scripts. Prefer packages without native build steps. Pin versions to avoid unexpected script changes. |
| **Typosquatting risk** | Verify the package name is correct. Check the package's npm page for legitimacy. Consider using a scoped package from the official organization. |
| **SBOM generation** | Use osv-scanner with --all-packages --format spdx-2-3 or cyclonedx-1-5 to generate SBOMs. No extra tools needed. |
| **Secrets in git history** | Use `git filter-branch` or `bfg-repo-cleaner` to remove secrets from history. Rotate any exposed keys immediately. |
| **Deprecated packages** | Replace with the recommended alternatives listed in the report. |

Remediation is **not** performed automatically by the scan � these suggestions are provided for the Orchestrator or developer to act upon.

## Integration with Pipeline (Automatic)

The Security Scan runs as a gate between **Build Gate** and **QA**, and it **always includes the Semgrep SAST gate, Gitleaks secret scan gate, Trivy vulnerability & misconfig gate, and OSV-Scanner dependency vulnerability gate as mandatory sub-steps**:
```
Build Gate -> Lint Gate -> Code Quality Gate -> SECURITY SCAN -> QA
                                                  |
                                           +-------------+
                                           |   SEMGREP   |
                                           |   SAST GATE |
                                           | (auto-loaded)|
                                           +-------------+
                                                  |
                                           +-------------+
                                           |   GITLEAKS  |
                                           |   SECRET    |
                                           |   SCAN GATE |
                                           | (auto-loaded)|
                                           +-------------+
                                                  |
                                           +-------------+
                                           |   TRIVY     |
                                           | VULN & MIS-  |
                                           | CONFIG GATE |
                                           | (auto-loaded)|
                                           +-------------+
                                                  |
                                           +------------------+
                                           |   OSV-SCANNER    |
                                           | DEPENDENCY VULN  |
                                           | SCAN GATE        |
                                           | (auto-loaded)    |
                                           +------------------+
                                                  |
                                           +-------------+
                                           | SBOM +      |
                                           | SUPPLY CHAIN|
                                           +-------------+
                                                  |
                                           +-------------+
                                           | SECRETS &   |
                                           | ANTI-PATTERN|
                                           +-------------+
```

**Automatic triggering:**
1. After Build + Lint + Code Quality gates pass, the Orchestrator loads the `security-scan` skill
2. The Orchestrator then loads the `semgrep-scan` skill (always as a mandatory sub-step)
3. The Orchestrator runs `semgrep --config p/security-audit --error .`
4. The Orchestrator then loads the `gitleaks-scan` skill (always as a mandatory sub-step)
5. The Orchestrator runs gitleaks via podman: `podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/zricethezav/gitleaks:latest git --source=/src --report-format=json --report-path=- --no-banner --verbose`
6. The Orchestrator then loads the `trivy-scan` skill (always as a mandatory sub-step)
7. The Orchestrator runs Trivy via podman: `podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/aquasec/trivy:latest fs --scanners vuln,misconfig --severity CRITICAL,HIGH --exit-code 1 /src`
8. The Orchestrator then loads the `osv-scanner` skill (always as a mandatory sub-step)
9. The Orchestrator runs osv-scanner via podman: `podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" ghcr.io/google/osv-scanner:latest scan source -r --format json /src`
10. The Orchestrator then proceeds with -> SBOM -> supply chain -> secrets & anti-pattern scans
11. All findings are combined into a single Security Scan Report

If the Security Scan fails (Semgrep findings OR High/Critical vulnerabilities):
- The pipeline is **blocked**
- The Orchestrator is notified with the full report
- The Orchestrator decides whether to:
  a. Fix the vulnerability (delegate to Implementor)
  b. File an exception and proceed (user decision)
  c. Block the pipeline until resolved

## Hard Rules

- ✅ The Security Scan MUST run after build succeeds
- ✅ The `semgrep-scan` skill MUST be loaded as a mandatory sub-scan during every pipeline
- ✅ The `gitleaks-scan` skill MUST be loaded as a mandatory sub-scan during every pipeline
- ✅ The `osv-scanner` skill MUST be loaded as a mandatory sub-scan during every pipeline
- ✅ The `trivy-scan` skill MUST be loaded as a mandatory sub-scan during every pipeline
- ✅ Semgrep MUST run with `--config p/security-audit --error .` (security-focused, strict mode)
- ✅ OSV-Scanner MUST run with recursive mode and JSON output
- ✅ Secrets scan MUST be non-blocking (informational only)
- ✅ The Security Scan MUST NOT modify any files — it is read-only
- ✅ The Security Scan MUST NOT install additional dependencies
- ✅ The Security Scan MUST NOT run on test files or fixture data

## Related Tools

| Tool | Purpose | Location |
|------|---------|----------|
| `semgrep-scan` skill | Deep SAST static analysis (auto-loaded as mandatory sub-scan) | `skills/semgrep-scan/SKILL.md` |
| `osv-scanner` skill | OSV-Scanner dependency vulnerability scanning (auto-loaded as mandatory sub-scan) | `skills/osv-scanner/SKILL.md` |
| `gitleaks-scan` skill | Gitleaks secret scanning (auto-loaded as mandatory sub-scan) | `skills/gitleaks-scan/SKILL.md` |
| `trivy-scan` skill | Trivy vulnerability & misconfiguration scanning (auto-loaded as mandatory sub-scan) | `skills/trivy-scan/SKILL.md` |
| `owasp-zap-scan` skill | OWASP ZAP DAST web application scanning (optional post-deployment) | `skills/owasp-zap-scan/SKILL.md` |
| `validate-output-contract.ts` | Agent output contract validation (cross-checks claims vs disk) | `skills/scripts/orchestration/validate-output-contract.ts` |
| `audit-log.ts` | Tamper-evident agent action audit log (hash chain) | `skills/scripts/orchestration/audit-log.ts` |