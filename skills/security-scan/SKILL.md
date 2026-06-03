---
name: security-scan
description: |
  UNIFIED SECURITY SKILL (consolidated from security-scan + security-workflow)

  Provides:
  - Tool Execution: semgrep SAST, gitleaks secrets, Trivy vuln/misconfig, OSV-Scanner deps,
    anti-pattern scan, supply chain, SBOM, git history secrets (from security-scan)
  - Knowledge & Workflows: self-review checklist, auto-detection tables, regression test generation,
    severity classification, anti-pattern fixes, parallel scan, structured reporting (from security-workflow)

  Auto-loaded by Orchestrator after Build+Lint+Code Quality gates pass.
  Subagents load relevant sections for their role.
---

# UNIFIED SECURITY SKILL

> **Consolidated from** `security-scan` (tool execution) and `security-workflow` (knowledge/workflows).
> This is the canonical security skill. The old skills remain in place for backward compatibility.
> All subagents MUST load this skill when performing security-sensitive work.

---

## Navigation

| Section | Title | Origin | Primary Consumer |
|---------|-------|--------|------------------|
| [§A](#part-a-pipeline--tool-execution) | Pipeline & Tool Execution | security-scan | Security Scanner, Orchestrator |
| §A.1 | Purpose | security-scan | All |
| §A.2 | Lazy-Loading Rules | security-scan | Security Scanner |
| §A.3 | Lazy-Loading Detection | security-scan | Security Scanner |
| §A.4 | Parallel Scan Execution | security-scan | Security Scanner |
| §A.5 | Scan Failure Handling | security-scan | Security Scanner, Orchestrator |
| §A.6 | Semgrep SAST Integration | security-scan | Security Scanner |
| §A.7 | Gitleaks Integration | security-scan | Security Scanner |
| §A.8 | Trivy Integration | security-scan | Security Scanner |
| §A.9 | OSV-Scanner Integration | security-scan | Security Scanner |
| §A.10 | Supply Chain Integrity | security-scan | Security Scanner |
| §A.11 | SBOM Generation | security-scan | Security Scanner |
| §A.12 | Anti-Pattern Scan | security-scan | Security Scanner |
| §A.13 | Git History Secret Scan | security-scan | Security Scanner |
| §A.14 | Auto-Remediation Suggestions | security-scan | Implementor, Fixer |
| [§B](#part-b-knowledge--workflows) | Knowledge & Workflows | security-workflow | All Subagents |
| §B.1 | Security Self-Review Checklist | security-workflow | Implementor, Fixer |
| §B.2 | Security Auto-Detection Table | security-workflow | Verifier |
| §B.3 | Security Regression Tests | security-workflow | QA, Verifier |
| §B.4 | Security Test Coverage Gate | security-workflow | QA, Verifier, Orchestrator |
| §B.5 | Severity Classification | security-workflow | All |
| §B.6 | Anti-Pattern Fixes | security-workflow | Implementor, Fixer |
| §B.7 | Structured Report Output | security-workflow | All (output contract) |
| §B.8 | Agent Workflow Integration | security-workflow | All |
| [§C](#part-c-hard-rules) | Hard Rules | Both | All |
| [§D](#part-d-related-skills) | Related Skills | Both | All |

---

# Part A: Pipeline & Tool Execution

> Origin: `security-scan` skill — automated tool execution, lazy-loading, parallel dispatch.

## A.1 Purpose

The Security Scan gate runs automated security checks on the codebase after the Build Gate passes and before QA begins. Its goal is to catch high-severity security issues early — before they reach production.

This skill is **automatically loaded by the Orchestrator** during every pipeline. It uses **lazy-loading** — each sub-scan skill is loaded only when the project characteristics justify it. Scans that are independent of each other run **in parallel** for maximum throughput. No user prompt is required to run any of these tools.

## A.2 Lazy-Loading Rules

| Scan | Load Condition | Why |
|------|---------------|-----|
| **Semgrep SAST** | Source files exist (`src/` directory or `*.ts`/`*.js` files in root) | No source code = nothing to analyze |
| **Gitleaks Secrets** | Git history exists with ≥1 commit | Fresh repos with no commits have no history to scan |
| **Trivy Vuln & Misconfig** | Dockerfile, K8s manifest, Terraform, or lockfile exists | No artifacts = nothing to scan |
| **OSV-Scanner Dependencies** | Lockfile exists (`package-lock.json`, `yarn.lock`, `Cargo.lock`, etc.) | No dependencies = no vulnerabilities |
| **Anti-Pattern Scan** | Source files were changed in this pipeline | Only scan what's new |
| **Supply Chain** | Lockfile exists | No dependencies = no supply chain |
| **SBOM Generation** | `@cyclonedx/bom` is available in the project | Skip if tool not installed |
| **Git History Scans** | Git history exists | Fresh repos have no history |

## A.3 Lazy-Loading Detection

Before running any scan, detect what's available in the project:

```bash
# Check for source files
has_source=false
if [ -d "src" ] || ls *.ts *.js 2>/dev/null | head -1 > /dev/null 2>&1; then
  has_source=true
fi

# Check for git history
has_git_history=false
if git log --oneline -1 2>/dev/null | head -1 > /dev/null 2>&1; then
  has_git_history=true
fi

# Check for Docker/K8s/Terraform artifacts
has_infra_artifacts=false
if ls Dockerfile* *.yaml *.yml *.tf 2>/dev/null | head -1 > /dev/null 2>&1; then
  has_infra_artifacts=true
fi

# Check for lockfile
has_lockfile=false
for lf in package-lock.json yarn.lock pnpm-lock.yaml requirements.txt Cargo.lock go.sum Gemfile.lock poetry.lock composer.lock; do
  if [ -f "$lf" ]; then has_lockfile=true; break; fi
done

# Check if cyclonedx-bom available
has_sbom_tool=false
if npx @cyclonedx/bom --help 2>/dev/null | head -1 > /dev/null 2>&1; then
  has_sbom_tool=true
fi
```

## A.4 Parallel Scan Execution

### Phase 1: Detection
1. Run the lazy-loading detection script to determine which scans are applicable
2. Build an execution plan of enabled scans

### Phase 2: Parallel Dispatch (Independent Scans)

Launch these scans in parallel when their conditions are met:

```
┌─────────────────────────────────────────────────┐
│                 PARALLEL LAUNCH                  │
├──────────────┬──────────────┬────────────────────┤
│  SEMGREP     │  GITLEAKS    │  TRIVY             │
│  SAST Scan   │  Secrets     │  Vuln & Misconfig  │
│  (if source) │  (if history)│  (if artifacts)    │
├──────────────┼──────────────┼────────────────────┤
│  OSV-SCANNER │              │                    │
│  Dependency  │              │                    │
│  Vuln Scan   │              │                    │
│  (if lockfile)│              │                    │
└──────────────┴──────────────┴────────────────────┘
```

**All 4 mandatory scans run in parallel** (provided their lazy-load conditions are met). Each runs in its own process/container.

```bash
# Launch semgrep (if source exists)
if [ "$has_source" = true ]; then
  semgrep --config p/security-audit --error . &
  semgrep_pid=$!
fi

# Launch gitleaks (if git history exists)
if [ "$has_git_history" = true ]; then
  podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/zricethezav/gitleaks:latest \
    git --source=/src --report-format=json --report-path=- --no-banner --verbose &
  gitleaks_pid=$!
fi

# Launch trivy (if infra artifacts exist)
if [ "$has_infra_artifacts" = true ] || [ "$has_lockfile" = true ]; then
  podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/aquasec/trivy:latest \
    fs --scanners vuln,misconfig --severity CRITICAL,HIGH --exit-code 1 /src &
  trivy_pid=$!
fi

# Launch osv-scanner (if lockfile exists)
if [ "$has_lockfile" = true ]; then
  podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" ghcr.io/google/osv-scanner:latest \
    scan source -r --format json /src &
  osv_pid=$!
fi

# Wait for all parallel scans to complete
wait
```

### Phase 3: Sequential Lightweight Scans

After all parallel scans complete, run the lighter-weight scans sequentially:

1. **Hardcoded Secrets Scan** (if source was changed) — grep-based, fast
2. **Security Anti-Pattern Scan** (if source was changed) — grep-based, fast
3. **Supply Chain Integrity Check** (if lockfile exists)
4. **SBOM Generation** (if cyclonedx-bom available)
5. **Git History Secret Scan** (if git history exists)

### Phase 4: Aggregate & Report

1. Collect results from all scans (parallel + sequential)
2. Combine into single Security Scan Report (see [§B.7](#b7-structured-security-report-output) for format)
3. Determine overall verdict based on all results (see [§A.5](#a5-scan-failure-handling))

### Pipeline Integration

```
Build Gate → Lint Gate → Code Quality Gate → SECURITY SCAN → QA
                                                  │
                                          ┌───────┴────────┐
                                          │  LAZY-LOADING  │
                                          │  DETECTION     │
                                          │  (Phase 1)     │
                                          └───────┬────────┘
                                                  │
                                   ┌──────────────┼──────────────┐
                                   │              │              │
                            ┌──────┴──────┐ ┌─────┴─────┐ ┌──────┴──────┐
                            │   SEMGREP   │ │  GITLEAKS │ │   TRIVY     │
                            │  SAST GATE  │ │  SECRET   │ │ VULN & MIS- │
                            │ (lazy: if   │ │  SCAN     │ │ CONFIG GATE │
                            │  source)    │ │ (lazy: if │ │ (lazy: if   │
                            └──────┬──────┘ │  history) │ │  artifacts) │
                                   │        └─────┬─────┘ └──────┬──────┘
                                   │              │              │
                            ┌──────┴──────────────┴──────────────┴──────┐
                            │            OSV-SCANNER                    │
                            │       DEPENDENCY VULN SCAN               │
                            │       (lazy: if lockfile)                │
                            │                                           │
                            │    ALL 4 RUN IN PARALLEL (Phase 2)       │
                            └──────────────────┬───────────────────────┘
                                               │
                            ┌──────────────────┴───────────────────────┐
                            │      PHASE 3: Sequential Lightweight     │
                            │  ┌──────────┬──────────┬──────────────┐ │
                            │  │ Secrets  │ Anti-    │ Supply Chain │ │
                            │  │ Scan     │ Pattern  │ Integrity    │ │
                            │  ├──────────┼──────────┼──────────────┤ │
                            │  │ SBOM Gen │ Git Hist │              │ │
                            │  │          │ Secrets  │              │ │
                            │  └──────────┴──────────┘              │ │
                            └──────────────────┬───────────────────────┘
                                               │
                            ┌──────────────────┴───────────────────────┐
                            │      PHASE 4: Aggregate & Report        │
                            └──────────────────────────────────────────┘
```

**Automatic triggering:**
1. After Build + Lint + Code Quality gates pass, the Orchestrator loads the `security-scan` skill
2. **Phase 1 (Detection)**: Run lazy-loading detection to determine which scans are applicable
3. **Phase 2 (Parallel Dispatch)**: Launch independent scans simultaneously:
   - Semgrep SAST (if source files exist): `semgrep --config p/security-audit --error .`
   - Gitleaks (if git history exists): `podman run ... gitleaks ...`
   - Trivy (if artifacts/lockfiles exist): `podman run ... trivy fs ...`
   - OSV-Scanner (if lockfile exists): `podman run ... osv-scanner ...`
4. Wait for all parallel scans to complete
5. **Phase 3 (Sequential)**: Run lightweight scans: secrets, anti-pattern, supply chain, SBOM, git history
6. **Phase 4 (Aggregate)**: Combine all findings into a single Security Scan Report
7. All findings are combined into the final report

If the Security Scan fails (High/Critical vulnerabilities):
- The pipeline is **blocked**
- The Orchestrator is notified with the full report
- The Orchestrator decides whether to:
  a. Fix the vulnerability (delegate to Implementor)
  b. File an exception and proceed (user decision)
  c. Block the pipeline until resolved

## A.5 Scan Failure Handling

Each independent scan sets its own fail flag. The combined verdict logic is:

| Condition | Verdict |
|-----------|---------|
| Any scan finds CRITICAL vulnerability | **FAIL** — block pipeline |
| Any scan finds HIGH vulnerability | **FAIL** — block pipeline |
| Secrets or anti-patterns found (no CRITICAL/HIGH) | **WARN** — non-blocking, review recommended |
| All scans pass with no findings | **PASS** — proceed to QA |

### Lockfile Warnings

If the project has no lockfile or package manager configuration, emit the following non-blocking warning:

> **No lockfile found** — dependency scan skipped. Consider committing `package-lock.json` or equivalent to enable reproducible and auditable builds.

If the package manager config exists but the lockfile is missing, emit:

> **Lockfile missing** — `package.json` found but `package-lock.json` is absent. Run `npm install` to generate it. Dependency scan will proceed without lockfile verification.

## A.6 Semgrep SAST Integration

Auto-loads `semgrep-scan` skill when source files exist.

**Command flags:**
```
semgrep --config p/security-audit --error .
```

| Flag | Purpose |
|------|---------|
| `--config p/security-audit` | Security-focused rule set (OWASP top 10, CWE top 25) |
| `--error` | Exit with code 1 on any finding with error severity |
| `.` | Scan entire project |

**Exit code mapping:**

| Exit Code | Meaning |
|-----------|---------|
| 0 | No findings |
| 1 | Findings with error severity detected |
| 2+ | Error running semgrep |

## A.7 Gitleaks Integration

Auto-loads `gitleaks-scan` skill when git history exists.

**Command:**
```bash
podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/zricethezav/gitleaks:latest \
  git --source=/src --report-format=json --report-path=- --no-banner --verbose
```

| Flag | Purpose |
|------|---------|
| `--source=/src` | Scan the mounted source directory |
| `--report-format=json` | Structured JSON output for parsing |
| `--report-path=-` | Output to stdout (for capture) |
| `--no-banner` | Clean output without banner |
| `--verbose` | Include detailed findings |

## A.8 Trivy Integration

Auto-loads `trivy-scan` skill when infra artifacts or lockfiles exist.

**Command:**
```bash
podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/aquasec/trivy:latest \
  fs --scanners vuln,misconfig --severity CRITICAL,HIGH --exit-code 1 /src
```

| Flag | Purpose |
|------|---------|
| `--scanners vuln,misconfig` | Scan for vulnerabilities and misconfigurations |
| `--severity CRITICAL,HIGH` | Only report CRITICAL and HIGH severity |
| `--exit-code 1` | Exit with 1 if findings detected |

## A.9 OSV-Scanner Integration

Auto-loads `osv-scanner` skill when a lockfile exists.

**Command:**
```bash
podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" ghcr.io/google/osv-scanner:latest \
  scan source -r --format json /src
```

**Exit code mapping:**

| Exit Code | Meaning |
|-----------|---------|
| 0 | No vulnerabilities found |
| 1 | Vulnerabilities found |
| 2+ | Error running OSV-Scanner |

## A.10 Supply Chain Integrity Checks

Run the supply chain scanner to check for:

| Check | Description | Severity if Found |
|-------|-------------|-------------------|
| **Install Script Detection** | Packages with `hasInstallScript: true` can run arbitrary code during install | HIGH (fails scan) |
| **Typosquatting Detection** | Package names that are 1-2 character edits away from popular packages | MEDIUM (warning) |
| **Package Freshness** | New packages (< 30 days old) and stale packages (> 2 years without updates) | LOW (warning) |
| **Deprecated Packages** | Known-deprecated packages still in use | MEDIUM (warning) |
| **Dependency Count** | Warn if transitive dependencies exceed 500 | LOW (warning) |

If install scripts are detected (HIGH severity), the scan **fails**.
All other findings are warnings.

## A.11 SBOM Generation

Generate a CycloneDX Software Bill of Materials after the dependency scan passes (or as a non-blocking step):

```bash
# Generate CycloneDX SBOM if cyclonedx-bom is available
npx @cyclonedx/bom --output .opencode/sboms/<pipeline-id>-sbom.json 2>/dev/null || true
```

The SBOM is stored at `.opencode/sboms/<pipeline-id>-sbom.json` and contains:
- All direct and transitive dependencies
- Version numbers and license information
- Dependency relationships

This enables retrospective vulnerability analysis — if a CVE is disclosed tomorrow, you can check which pipelines were affected by scanning the SBOM archive.

**Non-blocking**: If `@cyclonedx/bom` is not installed, log a warning and proceed.

## A.12 Anti-Pattern Scan

Check for common security anti-patterns in the modified code:

| Anti-Pattern | What to grep for | Risk |
|-------------|------------------|------|
| `eval()` usage | `eval(` | High |
| Unsafe `innerHTML` | `innerHTML` | Medium |
| SQL string concatenation | `"SELECT.*\${` or `'SELECT.*' \${` | High |
| Hardcoded JWT secrets | `jwt.*secret.*=` or `jwtSecret:` | High |
| Missing input validation on body | `req.body` without validation check nearby | Medium |
| `document.write()` usage | `document.write(` | Medium |
| `console.log()` in production | `console.log` | Low |

For each finding, report the file and line number.

## A.13 Git History Secret Scan

Scan the git commit history for secrets that may have been committed and later removed. Secrets in git history persist even after removal from the current file contents:

```bash
# Scan commit diffs for secret patterns
git log -p --all -- ':(exclude)package-lock.json' ':(exclude)pnpm-lock.yaml' ':(exclude)yarn.lock' | \
  rg -n \
  '(?:api[_-]?key|apikey|secret|password|auth[_-]?token|private[_-]?key|GITHUB_TOKEN_PREFIX|STRIPE_SECRET_PREFIX|PRIVATE_KEY_HEADER)' \
  || true
```

**Non-blocking** (informational only). If critical secrets found (AWS keys, GitHub tokens in history), emit a WARNING.

### Hardcoded Secrets Scan (grep-based)

Search for potential secrets (API keys, tokens, passwords) hardcoded in source code:

```bash
# Check for common secret patterns in src/ (not in tests/fixtures)
rg -n --include="*.ts" --include="*.js" --include="*.py" \
  '(?:api[_-]?key|secret|password|auth[_-]?token|private[_-]?key)' \
  --glob '!tests/**' --glob '!**/*.test.*' --glob '!**/*.spec.*' \
  src/ || true
```

This is a **warning-only** scan — it does NOT fail the gate. It reports findings for manual review.

Findings are reported with a **Confidence** level to help prioritize review:

| Confidence | Description | Examples |
|------------|-------------|----------|
| **High** | Literal secret values detected | `sk-...`, private key header, github token prefix |
| **Medium** | Variable names or assignments suggesting secrets | `api_key=`, `password =`, `SECRET_TOKEN=` |
| **Low** | Generic patterns or strings in comments | `password` in a comment, `secret` in a log message |

## A.14 Auto-Remediation Suggestions

When issues are found, the following commands and practices can help resolve them:

| Issue Type | Suggestion |
|------------|------------|
| **Dependency vulnerabilities** | Run `npm audit fix` (Node.js), `pip audit --fix` (Python), `cargo audit fix` (Rust), or update the vulnerable package manually. |
| **Hardcoded secrets** | Move secrets to environment variables (e.g., `process.env.API_KEY`), a `.env` file (ensure it is `.gitignore`d), or a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault). |
| **`eval()` usage** | Replace with `JSON.parse()`, `Function()` constructor, or a proper parser. Avoid dynamic code evaluation entirely. |
| **`innerHTML` / `document.write()`** | Use safe DOM APIs like `textContent`, `innerText`, or `createElement()` + `appendChild()`. For HTML, use a sanitization library like DOMPurify. |
| **SQL injection risk** | Replace string concatenation with parameterized queries (e.g., prepared statements, ORM query builders). |
| **Hardcoded JWT secrets** | Use environment variables or a key management service. Rotate exposed keys immediately. |
| **Missing input validation** | Add validation using a schema library (e.g., Joi, Zod, Pydantic, `validate`). Never trust `req.body` directly. |
| **`console.log()` in production** | Remove or replace with a structured logger (e.g., Winston, Pino) that supports log levels and can be disabled in production. |
| **Install scripts in dependencies** | Review each package with install scripts. Prefer packages without native build steps. Pin versions to avoid unexpected script changes. |
| **Typosquatting risk** | Verify the package name is correct. Check the package's npm page for legitimacy. Consider using a scoped package from the official organization. |
| **SBOM generation** | Install cyclonedx-bom: `npm install --save-dev @cyclonedx/bom` and add SBOM generation to CI. |
| **Secrets in git history** | Use `git filter-branch` or `bfg-repo-cleaner` to remove secrets from history. Rotate any exposed keys immediately. |
| **Deprecated packages** | Replace with the recommended alternatives listed in the report. |

Remediation is **not** performed automatically by the scan — these suggestions are provided for the Orchestrator or developer to act upon.

---

# Part B: Knowledge & Workflows

> Origin: `security-workflow` skill — self-review, auto-detection, regression tests, severity classification, anti-pattern fixes, reporting.

## B.1 Security Self-Review Checklist

After writing or modifying code, run this mandatory 15-item self-review against every created/modified file. Answer each question for every file.

> **Note for Implementor agents**: Integrate this into your Security Self-Review step after writing code and before the Pre-Build Import Validation.
>
> **Note for Fixer agents**: Re-run the self-review after applying any security-related fix. Report the results in `securityFixDetails.selfReviewPassed`.

### The Checklist

- [ ] **Parameterized Queries** — Are all database queries parameterized (no string concatenation in SQL/NoSQL queries)?
- [ ] **Input Validation** — Is all user input validated against a schema (Zod, Joi, class-validator, or equivalent)?
- [ ] **Secrets Management** — Are secrets (API keys, DB passwords, JWT secrets) accessed ONLY via environment variables (`process.env.*`)?
- [ ] **Path Traversal** — Are file operations using path traversal protections (`path.resolve` + prefix check)?
- [ ] **Authentication** — Is authentication enforced on all protected routes?
- [ ] **Authorization** — Is authorization checked on every resource access (not just auth — verify ownership)?
- [ ] **Error Sanitization** — Are error messages sanitized (no stack traces, no internal details in production responses)?
- [ ] **Security Headers** — Are all HTTP responses setting security headers where applicable (CSP, HSTS, X-Frame-Options)?
- [ ] **Rate Limiting** — Is there a rate limiting or input size limit on user-submitted data?
- [ ] **No Eval** — Is `eval()` avoided? If used, is it absolutely necessary and sanitized?
- [ ] **IDOR Prevention** — Is there any direct object reference (IDOR) where a user could access another user's data by changing an ID?
- [ ] **Third-Party URLs** — Are all third-party URLs/fetches using an allowlist or validated against expected domains?
- [ ] **SSRF Protection** — Are dynamic URLs constructed from user input protected against Server-Side Request Forgery (SSRF)?
- [ ] **Prototype Pollution** — Is bracket notation assignment `obj[variable]` validated to prevent prototype pollution (e.g., `__proto__`, `constructor` key blocking)?
- [ ] **File Upload Validation** — Are file uploads validated for type (MIME), size, and content (magic bytes)?

### Scoring

| Result | Criteria | Action |
|--------|----------|--------|
| **Pass** | 15/15 YES | Proceed to build |
| **Fail** | Any NO | Fix each failure before proceeding |
| **Defer** | Cannot fix without plan changes | Flag as deviation, report to Orchestrator |

### Output Format in Agent Reports

```yaml
securitySelfReview:
  passed: true | false
  itemsPassed: 15
  itemsTotal: 15
  failures:
    - file: "src/services/user.ts"
      line: 42
      check: "Parameterized queries"
      detail: "String concatenation in db.query()"
      fixed: true | false
```

## B.2 Security Checkpoint Auto-Detection Table

Used by verifier agents during Pass 2b (security checkpoint detection). For each security pattern, grep the modified files and determine if the checkpoint passes or fails.

### Detection Patterns (13 total)

| # | Checkpoint | Detection Pattern (grep) | Pass Condition | Risk if Missed |
|---|------------|--------------------------|----------------|----------------|
| 1 | Parameterized Queries | `\.query\(` or `execute\(` | Not preceded by template literal (`` ` ``) or `+` concat on same line | SQL Injection |
| 2 | Input Validation | `validate\|z\.object\|Joi\.object\|class-validator` | Present in route handler or middleware | Mass Assignment, Injection |
| 3 | Secrets from Env | `process\.env\.` | Secret-like var (key, secret, password, token) reads from env | Credential Leak |
| 4 | Path Traversal | `path\.resolve\|path\.join` | Followed by `.startsWith` check with allowed prefix | Arbitrary File Read |
| 5 | Auth Middleware | `authenticate\|requireAuth\|authMiddleware\|@UseGuards` | Present on protected route definitions | Unauthenticated Access |
| 6 | Authorization Check | `authorize\|checkRole\|checkOwnership\|userId.*===` | Present after auth on resource access | Privilege Escalation |
| 7 | Safe Error Handling | `catch\|\.error\|next\(err\)` | No `stack` in production response | Information Disclosure |
| 8 | Security Headers | `helmet\|csp\|Content-Security-Policy\|X-Frame-Options\|HSTS\|Strict-Transport-Security` | Present in server config or middleware | XSS, Clickjacking |
| 9 | Rate Limiting | `rateLimit\|express-rate-limit\|limiter` | Present on routes or globally | DoS, Brute Force |
| 10 | No Eval | `eval\(\)` | Absent from source (whitelist if necessary) | Code Injection |
| 11 | SSRF Protection | `fetch\|http\.get\|axios\.get\|request` with user-provided URL | URL validated against allowlist or hostname resolver; DNS rebinding protection | SSRF |
| 12 | Prototype Pollution | `\[.*\]` (bracket assign) or `Object\.assign` or spread `{...obj}` | Key validated against `__proto__`, `constructor`, `prototype` blacklist | Prototype Pollution |
| 13 | Zip Slip | `unzip\|extractAll\|adm-zip\|decompress\|unzipper` with archive extraction | Extracted file path validated against destination prefix | Arbitrary File Write |

## B.3 Security Regression Test Generation Table

Used by QA agents to generate security regression tests. For each pattern detected in modified code, generate a companion test.

### Test Mapping (13 total)

| # | Pattern | Test to Generate | What to Assert |
|---|---------|------------------|----------------|
| 1 | SQL Query | SQL injection test | Attempt `' OR 1=1 --` and confirm no data leak |
| 2 | Input Validation | Schema validation test | Send invalid/malformed payload, expect 400 |
| 3 | Env Secrets | Secrets exposure test | Verify process.env does not appear in test config or fixtures |
| 4 | Path Traversal | Path traversal test | Attempt `../../../etc/passwd` and confirm rejection |
| 5 | Auth | Auth bypass test | Call protected route without token, expect 401 |
| 6 | Authorization | Horizontal privilege test | User A tries to access User B's resource, expect 403 |
| 7 | Error Handler | Error disclosure test | Trigger error, verify no stack trace in response body |
| 8 | Security Headers | Header presence test | Make request, assert CSP/HSTS/X-Frame-Options headers |
| 9 | Rate Limiter | Rate limit test | Send N+1 rapid requests, expect 429 on last |
| 10 | Eval | Eval injection test | If eval is present, verify input sanitization with malicious payload |
| 11 | SSRF | SSRF test | Send URL pointing to `169.254.169.254` (metadata IP), `127.0.0.1`, or custom DNS; verify blocked |
| 12 | Prototype Pollution | Prototype pollution test | Send payload with `{"__proto__": {"admin": true}}`, verify no pollute |
| 13 | Zip Slip | Zip slip test | Create zip with symlink or `../` paths, verify extraction fails |

## B.4 Security Test Coverage Gate

After generating tests for the detected patterns, produce a **security test coverage report** that the Verifier will use to gate the pipeline:

```yaml
securityTestCoverage:
  patternsDetected: 5             # Number of security patterns found in modified code (from Section B.2 auto-detection)
  testsGenerated: 4               # Number of tests actually created
  coverage: 80.0                  # Percentage (testsGenerated / patternsDetected * 100)
  gatePassed: true                # true if coverage >= 80%
  missingTests:
    - pattern: "SSRF Protection"
      file: "src/services/http.ts"
      risk: "High"
      reason: "SSRF pattern detected but user-input URL flow too complex to test without mocking infrastructure"
```

### Coverage Calculation Rules

| Scenario | Coverage | Notes |
|----------|----------|-------|
| All patterns tested | 100% | ✅ Full coverage |
| Some patterns skipped (valid reason) | 80-99% | ✅ Pass gate with note |
| Some patterns skipped (no valid reason) | < 80% | ❌ Fail gate — block pipeline |
| No patterns detected | N/A | ⏭️ Gate skipped (not applicable) |
| No tests generated at all | 0% | ❌ Fail gate — block pipeline |

### Valid Skip Reasons

When a pattern cannot be tested, it MUST have a documented valid reason:

| Reason | Description |
|--------|-------------|
| `not_applicable` | Pattern not relevant to this code change (e.g., Zip Slip in a JSON API) |
| `needs_mock_infrastructure` | Requires mocking that doesn't exist |
| `already_covered_by_existing_test` | Existing test already covers this pattern |
| `blocked_by_dependency` | Can't test without a dependency that isn't installed |

**Invalid reasons** (these fail the gate):
- `ran_out_of_time`
- `too_difficult`
- `not_important`

## B.5 Security Vulnerability Severity Classification

When a vulnerability is found, classify it by severity and respond according to the table below:

| Severity | Description | Response | Timeframe |
|----------|-------------|----------|-----------|
| **Critical** | Remote code execution, SQL injection with data exfiltration, authentication bypass, secret leak to production | Block pipeline, fix immediately | < 1 hour |
| **High** | Stored XSS, privilege escalation, IDOR with sensitive data, SSRF to internal services | Block pipeline, fix before next gate | < 4 hours |
| **Medium** | Reflected XSS, missing security headers, information disclosure (non-sensitive), CSRF on non-critical actions | Warn, fix in next iteration | < 1 week |
| **Low** | Verbose error messages, missing rate limiting, `console.log` in production, outdated dependency (no known CVE) | Log, fix when convenient | Best effort |

### Severity Determination Flow

```
Is there direct data access or code execution?
  ├─ Yes → Can it be triggered remotely without auth?
  │   ├─ Yes → CRITICAL
  │   └─ No  → HIGH
  └─ No  → Can it lead to data exposure indirectly?
      ├─ Yes → MEDIUM
      └─ No  → LOW
```

## B.6 Common Security Anti-Patterns with Fixes

| Anti-Pattern | Risk | Fix | Example |
|-------------|------|-----|---------|
| **SQL Injection** | Data breach, RCE | Parameterized queries (prepared statements, ORM) | `db.query('SELECT * FROM users WHERE id = $1', [id])` instead of string concat |
| **XSS (Cross-Site Scripting)** | Session hijacking, data theft | Output encoding (escape HTML entities) + CSP headers | Use `textContent` instead of `innerHTML`; set `Content-Security-Policy` header |
| **CSRF (Cross-Site Request Forgery)** | Unauthorized state changes | CSRF tokens (per-request) + SameSite cookies (Lax/Strict) | `res.cookie('csrf-token', token, { sameSite: 'strict' })` |
| **Insecure Deserialization** | RCE, data tampering | Schema validation before `JSON.parse()` | `z.string().parse(raw)` before parsing or `JSON.parse(safeString)` |
| **Command Injection** | RCE, server compromise | Use `execFile`/`spawn` with args array, not shell string | `spawn('ls', ['-la', filepath])` instead of `` exec(`ls -la ${filepath}`) `` |
| **Path Traversal** | Arbitrary file read/write | `path.resolve` + prefix `.startsWith` check | `const resolved = path.resolve(base, input); if (!resolved.startsWith(base)) throw Error()` |
| **SSRF (Server-Side Request Forgery)** | Internal network scan, cloud metadata access | URL allowlist + DNS rebinding protection (resolve + validate IP) | Parse URL, check hostname against allowlist, resolve to IP, verify not private range |
| **Prototype Pollution** | Property injection, auth bypass | `Object.create(null)`, `Object.freeze`, key validation | `const obj = Object.create(null);` or freeze `Object.freeze(Object.prototype)`; validate keys against `__proto__`/`constructor`/`prototype` |
| **Zip Slip** | Arbitrary file write via archive extraction | Validate extracted paths against destination prefix | `const entryPath = path.resolve(dest, entry.fileName); if (!entryPath.startsWith(dest)) throw Error()` |

### Quick Reference: Safe vs Unsafe Code

```typescript
// ❌ UNSAFE
const query = `SELECT * FROM users WHERE id = ${req.params.id}`;
const output = `<div>${userInput}</div>`;
exec(`rm -rf ${userPath}`);
const data = JSON.parse(userInput);
const resolved = path.resolve(userInput);

// ✅ SAFE
const query = 'SELECT * FROM users WHERE id = $1';
const output = `<div>${escapeHtml(userInput)}</div>`;
spawn('rm', ['-rf', sanitizedPath]);
const data = schema.parse(JSON.parse(userInput));
const resolved = path.resolve(allowedBase, userInput);
if (!resolved.startsWith(allowedBase)) throw new Error('Path traversal detected');
```

## B.7 Structured Security Report Output

When producing a security report (from parallel scan or individual scan), use this standardized format:

```yaml
securityReport:
  scanId: "<pipeline-id>-<timestamp>"
  scannedAt: "<ISO-8601 timestamp>"
  scanType: "parallel" | "single"
  verdict: "PASS" | "FAIL" | "WARN"
  summary:
    totalFindings: 0
    critical: 0
    high: 0
    medium: 0
    low: 0
  scans:
    dependencyVulnerabilities:
      status: "passed" | "failed" | "skipped"
      findings:
        - id: "GHSA-xxxx"
          package: "lodash"
          severity: "HIGH"
          description: "Prototype pollution in lodash"
          fixAvailable: true
    hardcodedSecrets:
      status: "passed" | "warning" | "skipped"
      findings:
        - file: "src/config.ts"
          line: 15
          pattern: "api_key"
          confidence: "Low"
    antiPatterns:
      status: "passed" | "warning" | "skipped"
      findings:
        - file: "src/routes/user.ts"
          line: 42
          pattern: "eval("
          risk: "High"
    supplyChain:
      status: "passed" | "failed" | "warning" | "skipped"
      findings:
        - check: "Install Scripts"
          result: "found" | "none"
          details: ""
    sbom:
      status: "generated" | "skipped"
      path: ".opencode/sboms/<pipeline-id>-sbom.json" | null
    gitHistorySecrets:
      status: "passed" | "warning" | "skipped"
      findings: []
```

This format is consumed by the QA agent for test generation, the Verifier for scoring, and the Orchestrator for pipeline decisions.

### Markdown Report Format (for human readability)

```markdown
## Security Scan Report

### Scan Scope
- **Project Type**: Node.js / Python / Go / Java / Rust
- **Scanned Paths**: src/ (excluding tests/)
- **Dependency Scan**: ✅ / ❌ / ⚠️ Not applicable

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
| Install Scripts | ✅ None / ❌ Found |
| Typosquatting | ✅ None / ⚠️ Warning |
| Stale Packages | ⚠️ N packages |
| SBOM | ✅ Generated / ⚠️ Skipped |

### Git History Secrets (Informational)
| File | Commit | Pattern | Confidence |
|------|--------|---------|------------|

### Verdict
**✅ PASS** — No High/Critical vulnerabilities found
**❌ FAIL** — High/Critical vulnerabilities detected — block pipeline
**⚠️ WARN** — Secrets or anti-patterns found (non-blocking, review recommended)
```

---

# Part C: Hard Rules

> Combined rules from both `security-scan` and `security-workflow`.

## Pipeline & Execution Rules

- ✅ The Security Scan MUST run after build succeeds
- ✅ The `semgrep-scan` skill is lazy-loaded — only loaded when source files exist
- ✅ The `gitleaks-scan` skill is lazy-loaded — only loaded when git history exists
- ✅ The `osv-scanner` skill is lazy-loaded — only loaded when a lockfile exists
- ✅ The `trivy-scan` skill is lazy-loaded — only loaded when infra artifacts or lockfiles exist
- ✅ Semgrep MUST run with `--config p/security-audit --error .` (security-focused, strict mode) when loaded
- ✅ OSV-Scanner MUST run with recursive mode and JSON output when loaded
- ✅ Secrets scan MUST be non-blocking (informational only)
- ✅ Independent scans MUST run in parallel (Phase 2) for maximum throughput
- ❌ The Security Scan MUST NOT modify any files — it is read-only
- ❌ The Security Scan MUST NOT install additional dependencies
- ❌ The Security Scan MUST NOT run on test files or fixture data

## Self-Review & Workflow Rules

- ✅ Section B.1 (Self-Review Checklist) MUST be run by Implementor agents after every code modification
- ✅ Section B.1 (Self-Review Checklist) MUST be re-run by Fixer agents after every security-related fix
- ✅ Section B.2 (Auto-Detection) MUST be used by Verifier during Pass 2b
- ✅ Section B.3 (Test Generation) MUST be used by QA when creating security regression tests
- ✅ Section B.4 (Security Test Coverage Gate) MUST be reported by QA in every pipeline that touches security-sensitive code
- ✅ Section B.4 (Security Test Coverage Gate) MUST be verified by Verifier during its Pass 2b check
- ✅ Section A.4 (Parallel Scan) is the PREFERRED method for running security scans
- ✅ Section B.5 (Severity Classification) MUST be used to determine pipeline blocking decisions

## Integration with Agent Workflows

| Agent | When to Load This Skill | What to Use |
|-------|------------------------|-------------|
| **Implementor** | After writing code, before build | §B.1 (Self-Review Checklist) |
| **Fixer** | When fixing security-related bugs | §B.1 (Self-Review — re-run after fix), §B.5 (Severity), §B.6 (Anti-Pattern Fixes) |
| **Verifier** | Pass 2b — security checkpoint detection and security test coverage gate | §B.2 (Auto-Detection Table), §B.3 (Test Generation Table — for coverage reconciliation), §B.4 (Coverage Gate) |
| **QA** | Security regression test generation | §B.3 (Test Generation Table + Coverage Gate output format) |
| **Security Scanner** | Running parallel security scans | §A (Pipeline & Tool Execution), §B.7 (Report Format) |
| **Orchestrator** | Pipeline decisions on security findings, security test coverage gate enforcement | §B.5 (Severity Classification), §B.4 (Coverage Gate rules) |

---

# Part D: Related Skills

| Skill | Relationship |
|-------|-------------|
| `semgrep-scan` | Semgrep SAST analysis (lazy-loaded when source files exist) — `skills/semgrep-scan/SKILL.md` |
| `gitleaks-scan` | Gitleaks secret scanning (lazy-loaded when git history exists) — `skills/gitleaks-scan/SKILL.md` |
| `trivy-scan` | Trivy vulnerability & misconfiguration scanning (lazy-loaded when artifacts/lockfiles exist) — `skills/trivy-scan/SKILL.md` |
| `osv-scanner` | OSV-Scanner dependency vulnerability scanning (lazy-loaded when lockfile exists) — `skills/osv-scanner/SKILL.md` |
| `security-workflow` | **Legacy skill** — kept for backward compatibility; use this unified skill instead |
| `security-scan` | **Legacy skill (this file)** — this is the canonical location |
| `code-philosophy` | General coding standards — this skill provides the security-specific subset |
| `backend-code-philosophy` | Backend-specific coding philosophy — security is part of that |
| `frontend-code-philosophy` | Frontend-specific coding philosophy — includes XSS, CSP, DOM security |
| `shared-agent-workflow` | Startup protocol and output contract — this skill is loaded AFTER `shared-agent-workflow` |
| `validate-output-contract.ts` | Agent output contract validation (cross-checks claims vs disk) — `skills/scripts/orchestration/validate-output-contract.ts` |
| `audit-log.ts` | Tamper-evident agent action audit log (hash chain) — `skills/scripts/orchestration/audit-log.ts` |