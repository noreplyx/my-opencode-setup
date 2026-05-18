---
name: security-scan
description: Use this skill to perform security scanning on project code and dependencies. It runs automated checks for dependency vulnerabilities, hardcoded secrets, and common security anti-patterns.
---

# Security Scan Skill

## Purpose

The Security Scan gate runs automated security checks on the codebase after the Build Gate passes and before QA begins. Its goal is to catch high-severity security issues early — before they reach production.

## Scan Types

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

## Scan Workflow

1. **Detect project type** — Read `package.json`, `requirements.txt`, `Cargo.toml`, etc.
2. **Check for lockfile** — Verify presence of `package-lock.json`, `yarn.lock`, `requirements.txt`, `Cargo.lock`, etc. If missing, emit a warning but do NOT fail.
3. **Run dependency scan** — Execute the appropriate command (if lockfile or package manager config is found; otherwise skip with a warning)
4. **Parse results** — Extract vulnerability IDs, severity, package, and description
5. **Run secrets scan** — Grep for hardcoded secrets
6. **Run anti-pattern scan** — Grep for security anti-patterns in the changed files
7. **Report findings** — Use the standard report format below

### Lockfile Warnings

If the project has no lockfile or package manager configuration, emit the following non-blocking warning:

> ⚠️ **No lockfile found** — dependency scan skipped. Consider committing `package-lock.json` or equivalent to enable reproducible and auditable builds.

If the package manager config exists but the lockfile is missing, emit:

> ⚠️ **Lockfile missing** — `package.json` found but `package-lock.json` is absent. Run `npm install` to generate it. Dependency scan will proceed without lockfile verification.

## Report Format

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

### Verdict
**✅ PASS** — No High/Critical vulnerabilities found
**❌ FAIL** — High/Critical vulnerabilities detected — block pipeline
**⚠️ WARN** — Secrets or anti-patterns found (non-blocking, review recommended)
```

## Auto-Remediation Suggestions

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

Remediation is **not** performed automatically by the scan — these suggestions are provided for the Orchestrator or developer to act upon.

## Integration with Pipeline

The Security Scan runs as a gate between **Build Gate** and **QA**:

```
Build Gate → Security Scan → QA → Verifier
```

If the Security Scan fails (High/Critical vulnerabilities):
- The pipeline is **blocked**
- The Orchestrator is notified with the full report
- The Orchestrator decides whether to:
  a. Fix the vulnerability (delegate to Implementor)
  b. File an exception and proceed (user decision)
  c. Block the pipeline until resolved

## Hard Rules

- ✅ The Security Scan MUST run after build succeeds
- ✅ Dependency vulnerability scans MUST use `--audit-level=high` or equivalent
- ✅ Secrets scan MUST be non-blocking (informational only)
- ❌ The Security Scan MUST NOT modify any files — it is read-only
- ❌ The Security Scan MUST NOT install additional dependencies
- ❌ The Security Scan MUST NOT run on test files or fixture data
