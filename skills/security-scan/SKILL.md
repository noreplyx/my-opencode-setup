---
name: security-scan
description: Use this skill to perform security scanning on project code and dependencies. It runs automated checks for dependency vulnerabilities, hardcoded secrets, SAST via semgrep, and common security anti-patterns. This skill is automatically loaded by the Orchestrator after the Build+Lint+Code Quality gates pass. It loads the semgrep-scan skill as a mandatory sub-scan.
---

# Security Scan Skill

## Purpose

The Security Scan gate runs automated security checks on the codebase after the Build Gate passes and before QA begins. Its goal is to catch high-severity security issues early — before they reach production.

This skill is **automatically loaded by the Orchestrator** during every pipeline. It **always loads the `semgrep-scan` skill** as a mandatory sub-scan. No user prompt is required to run semgrep.

## Scan Types

### 0. Semgrep SAST Scan (MANDATORY — Auto-Loaded)

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
| 0 | No findings | ? PASS — proceed to next scan |
| 1 | Findings detected | ? FAIL — block pipeline, report findings |
| 2+ | Tool error | ?? WARN — log, proceed if tool unavailable |

**Hard Rules for semgrep:**
- ? The Orchestrator MUST load `semgrep-scan` skill during every pipeline
- ? The semgrep scan MUST use `--config p/security-audit` (security-focused)
- ? The semgrep scan MUST use `--error` (strict mode)
- ? NEVER modify project files during scanning
- ? NEVER use `--autofix`

### 1. Dependency Vulnerability Scan

Run the appropriate tool based on project language:

| Language    | Command                                      |
|-------------|----------------------------------------------|
| Node.js     | `npm audit --audit-level=high`               |
| Python      | `pip audit` or `safety check`                |
| Go          | `govulncheck ./...`                          |
| Java/Maven  | `mvn dependency-check:check`                 |
| Rust        | `cargo audit`                                |

If `npm audit` reports High or Critical vulnerabilities, the scan fails.

### 2. Hardcoded Secrets Scan

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

### 3. Security Anti-Pattern Scan

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

### 4. Supply Chain Integrity Check

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

### 5. Software Bill of Materials (SBOM) Generation

After the dependency scan passes (or as a non-blocking step), generate an SBOM for the project:

```bash
# Generate CycloneDX SBOM if cyclonedx-bom is available
npx @cyclonedx/bom --output .opencode/sboms/<pipeline-id>-sbom.json 2>/dev/null || true
```

The SBOM is stored at `.opencode/sboms/<pipeline-id>-sbom.json` and contains:
- All direct and transitive dependencies
- Version numbers and license information
- Dependency relationships

This enables retrospective vulnerability analysis — if a CVE is disclosed tomorrow,
you can check which pipelines were affected by scanning the SBOM archive.

**Non-blocking**: If `@cyclonedx/bom` is not installed, log a warning and proceed.

### 6. Git History Secret Scan

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
3. **Detect project type** — Read `package.json`, `requirements.txt`, `Cargo.toml`, etc.
4. **Check for lockfile** — Verify presence of `package-lock.json`, `yarn.lock`, `requirements.txt`, `Cargo.lock`, etc. If missing, emit a warning but do NOT fail.
5. **Run dependency scan** — Execute the appropriate command (if lockfile or package manager config is found; otherwise skip with a warning)
6. **Parse results** — Extract vulnerability IDs, severity, package, and description
7. **Run secrets scan** — Grep for hardcoded secrets
8. **Run anti-pattern scan** — Grep for security anti-patterns in the changed files
9. **Generate SBOM (NEW)**
10. **Run supply chain integrity check (NEW)**
11. **Run git history secret scan (NEW)**
12. **Report findings** — Use the standard report format below

### Lockfile Warnings

If the project has no lockfile or package manager configuration, emit the following non-blocking warning:

> ?? **No lockfile found** — dependency scan skipped. Consider committing `package-lock.json` or equivalent to enable reproducible and auditable builds.

If the package manager config exists but the lockfile is missing, emit:

> ?? **Lockfile missing** — `package.json` found but `package-lock.json` is absent. Run `npm install` to generate it. Dependency scan will proceed without lockfile verification.

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
**? PASS** — No High/Critical vulnerabilities found
**? FAIL** — Semgrep findings or High/Critical vulnerabilities detected — block pipeline
**?? WARN** — Secrets or anti-patterns found (non-blocking, review recommended)
```

## Auto-Remediation Suggestions

When issues are found, the following commands and practices can help resolve them:

| Issue Type | Suggestion |
|------------|------------|
| **Semgrep SAST findings** | Review each finding and fix the root cause (validate input, use parameterized queries, etc.) — re-run `semgrep --config p/security-audit --error .` to confirm |
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

## Integration with Pipeline (Automatic)

The Security Scan runs as a gate between **Build Gate** and **QA**, and it **always includes the Semgrep SAST gate as a mandatory sub-step**:

```
Build Gate ? Lint Gate ? Code Quality Gate ? SECURITY SCAN ? QA
                                                  ¦
                                           +-------------+
                                           ? SEMGREP SAST ?
                                           ¦  (auto-loaded) ¦
                                           +-------------+
                                                  ¦
                                           +-------------+
                                           ? DEPENDENCY  ?
                                           ¦  VULN SCAN   ¦
                                           +-------------+
                                                  ¦
                                           +-------------+
                                           ? SECRETS &   ?
                                           ¦ ANTI-PATTERN ¦
                                           +-------------+
                                                  ¦
                                           +-------------+
                                           ? SBOM +      ?
                                           ¦ SUPPLY CHAIN ¦
                                           +-------------+
```

**Automatic triggering:**
1. After Build + Lint + Code Quality gates pass, the Orchestrator loads the `security-scan` skill
2. The Orchestrator then loads the `semgrep-scan` skill (always — as a mandatory sub-step)
3. The Orchestrator runs `semgrep --config p/security-audit --error .`
4. The Orchestrator then proceeds with dependency scan ? secrets scan ? anti-pattern scan ? SBOM ? supply chain ? git history scan
5. All findings are combined into a single Security Scan Report

If the Security Scan fails (Semgrep findings OR High/Critical vulnerabilities):
- The pipeline is **blocked**
- The Orchestrator is notified with the full report
- The Orchestrator decides whether to:
  a. Fix the vulnerability (delegate to Implementor)
  b. File an exception and proceed (user decision)
  c. Block the pipeline until resolved

## Hard Rules

- ? The Security Scan MUST run after build succeeds
- ? The `semgrep-scan` skill MUST be loaded as a mandatory sub-scan during every pipeline
- ? Semgrep MUST run with `--config p/security-audit --error .` (security-focused, strict mode)
- ? Dependency vulnerability scans MUST use `--audit-level=high` or equivalent
- ? Secrets scan MUST be non-blocking (informational only)
- ? The Security Scan MUST NOT modify any files — it is read-only
- ? The Security Scan MUST NOT install additional dependencies
- ? The Security Scan MUST NOT run on test files or fixture data

## Related Tools

| Tool | Purpose | Location |
|------|---------|----------|
| `semgrep-scan` skill | Deep SAST static analysis (auto-loaded as mandatory sub-scan) | `skills/semgrep-scan/SKILL.md` |
| `validate-output-contract.ts` | Agent output contract validation (cross-checks claims vs disk) | `skills/scripts/orchestration/validate-output-contract.ts` |
| `audit-log.ts` | Tamper-evident agent action audit log (hash chain) | `skills/scripts/orchestration/audit-log.ts` |