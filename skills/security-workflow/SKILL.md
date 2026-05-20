---
name: security-workflow
description: Shared security workflow for all subagents. Provides security self-review checklist, auto-detection tables for security anti-patterns, security regression test generation mapping, security test coverage gate, vulnerability severity classification, common anti-pattern fixes, and parallel security scan protocol. Load this skill when performing any security-sensitive task: implementation, fixing, verification, or QA testing.
---

# Security Workflow Skill

A shared security knowledge base that consolidates patterns, anti-patterns, scanning procedures, and severity classification used across implementor, fixer, QA, and verifier agents. This is the single source of truth for security concerns — all subagents MUST load this skill when performing security-sensitive work.

## 1. Security Self-Review Checklist

After writing or modifying code, run this mandatory 15-item self-review against every created/modified file. Answer each question for every file.

> **Note for Implementor agents**: Integrate this into your Security Self-Review step after writing code and before the Pre-Build Import Validation.

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

## 2. Security Checkpoint Auto-Detection Table

Used by verifier agents during Pass 2b (security checkpoint detection). For each security pattern, grep the modified files and determine if the checkpoint passes or fails.

### Detection Patterns (13 total)

| # | Checkpoint | Detection Pattern (grep) | Pass Condition | Risk if Missed |
|---|------------|--------------------------|----------------|----------------|
| 1 | Parameterized Queries | `\.query\(` or `execute\(` | Not preceded by template literal (`\``) or `+` concat on same line | SQL Injection |
| 2 | Input Validation | `validate\|z\.object\|Joi\.object\|class-validator` | Present in route handler or middleware | Mass Assignment, Injection |
| 3 | Secrets from Env | `process\.env\.` | Secret-like var (key, secret, password, token) reads from env | Credential Leak |
| 4 | Path Traversal | `path\.resolve\|path\.join` | Followed by `.startsWith` check with allowed prefix | Arbitrary File Read |
| 5 | Auth Middleware | `authenticate\|requireAuth\|authMiddleware\|@UseGuards` | Present on protected route definitions | Unauthenticated Access |
| 6 | Authorization Check | `authorize\|checkRole\|checkOwnership\|userId.*===` | Present after auth on resource access | Privilege Escalation |
| 7 | Safe Error Handling | `catch\|\.error\|next\(err\)` | No `stack` in production response | Information Disclosure |
| 8 | Security Headers | `helmet\|csp\|Content-Security-Policy\|X-Frame-Options\|HSTS\|Strict-Transport-Security` | Present in server config or middleware | XSS, Clickjacking |
| 9 | Rate Limiting | `rateLimit\|express-rate-limit\|limiter` | Present on routes or globally | DoS, Brute Force |
| 10 | No Eval | `eval\(\)` | Absent from source (whitelist if necessary) | Code Injection |
| 11 | **SSRF Protection** | `fetch\|http\.get\|axios\.get\|request` with user-provided URL | URL validated against allowlist or hostname resolver; DNS rebinding protection | SSRF |
| 12 | **Prototype Pollution** | `\[.*\]` (bracket assign) or `Object\.assign` or spread `{...obj}` | Key validated against `__proto__`, `constructor`, `prototype` blacklist | Prototype Pollution |
| 13 | **Zip Slip** | `unzip\|extractAll\|adm-zip\|decompress\|unzipper` with archive extraction | Extracted file path validated against destination prefix | Arbitrary File Write |

## 3. Security Regression Test Generation Table

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
| 11 | **SSRF** | SSRF test | Send URL pointing to `169.254.169.254` (metadata IP), `127.0.0.1`, or custom DNS; verify blocked |
| 12 | **Prototype Pollution** | Prototype pollution test | Send payload with `{"__proto__": {"admin": true}}`, verify no pollute |
| 13 | **Zip Slip** | Zip slip test | Create zip with symlink or `../` paths, verify extraction fails |

### Security Test Coverage Gate (NEW)

After generating tests for the detected patterns, produce a **security test coverage report** that the Verifier will use to gate the pipeline:

```yaml
securityTestCoverage:
  patternsDetected: 5             # Number of security patterns found in modified code (from Section 2 auto-detection)
  testsGenerated: 4               # Number of tests actually created
  coverage: 80.0                  # Percentage (testsGenerated / patternsDetected * 100)
  gatePassed: true                # true if coverage >= 80%
  missingTests:
    - pattern: "SSRF Protection"
      file: "src/services/http.ts"
      risk: "High"
      reason: "SSRF pattern detected but user-input URL flow too complex to test without mocking infrastructure"
```

#### Coverage Calculation Rules

| Scenario | Coverage | Notes |
|----------|----------|-------|
| All patterns tested | 100% | ✅ Full coverage |
| Some patterns skipped (valid reason) | 80-99% | ✅ Pass gate with note |
| Some patterns skipped (no valid reason) | < 80% | ❌ Fail gate — block pipeline |
| No patterns detected | N/A | ⏭️ Gate skipped (not applicable) |
| No tests generated at all | 0% | ❌ Fail gate — block pipeline |

#### Valid Skip Reasons

When a pattern cannot be tested, it MUST have a documented valid reason:
- `not_applicable` — Pattern not relevant to this code change (e.g., Zip Slip in a JSON API)
- `needs_mock_infrastructure` — Requires mocking that doesn't exist
- `already_covered_by_existing_test` — Existing test already covers this pattern
- `blocked_by_dependency` — Can't test without a dependency that isn't installed

Invalid reasons (these fail the gate):
- `ran_out_of_time`
- `too_difficult`
- `not_important`

## 4. Parallel Security Scan Protocol

To run all six security scans in parallel against the codebase, use the parallel security scan script:

```bash
# Run all 6 scans in parallel (dependency, secrets, anti-patterns, supply chain, SBOM, git history)
ts-node skills/scripts/orchestration/parallel-security-scan.ts --dir=./
```

This script executes the following scans concurrently:

| Scan | Description | Blocking? |
|------|-------------|-----------|
| Dependency Vulnerability | `npm audit --audit-level=high` | Yes — fails on High/Critical |
| Hardcoded Secrets | Regex scan for secret patterns | No — informational |
| Security Anti-Patterns | SAST-style pattern detection | No — informational |
| Supply Chain Integrity | Install scripts, typosquatting, package age | Yes — fails on install scripts |
| SBOM Generation | CycloneDX bill of materials | No — informational |
| Git History Secrets | Secret scan of commit diffs | No — informational |

Results are aggregated into a single Security Scan Report (see Section 7 for output format).

### Fallback
If `parallel-security-scan.ts` is unavailable, run scans sequentially using the individual commands documented in the `security-scan` skill.

## 5. Security Vulnerability Severity Classification

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

## 6. Common Security Anti-Patterns with Fixes

| Anti-Pattern | Risk | Fix | Example |
|-------------|------|-----|---------|
| **SQL Injection** | Data breach, RCE | Parameterized queries (prepared statements, ORM) | `db.query('SELECT * FROM users WHERE id = $1', [id])` instead of string concat |
| **XSS (Cross-Site Scripting)** | Session hijacking, data theft | Output encoding (escape HTML entities) + CSP headers | Use `textContent` instead of `innerHTML`; set `Content-Security-Policy` header |
| **CSRF (Cross-Site Request Forgery)** | Unauthorized state changes | CSRF tokens (per-request) + SameSite cookies (Lax/Strict) | `res.cookie('csrf-token', token, { sameSite: 'strict' })` |
| **Insecure Deserialization** | RCE, data tampering | Schema validation before `JSON.parse()` | `z.string().parse(raw)` before parsing or `JSON.parse(safeString)` |
| **Command Injection** | RCE, server compromise | Use `execFile`/`spawn` with args array, not shell string | `spawn('ls', ['-la', filepath])` instead of `exec(\`ls -la ${filepath}\`)` |
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

## 7. Structured Security Report Output

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

## 8. Integration with Agent Workflows

| Agent | When to Load This Skill | What to Use |
|-------|------------------------|-------------|
| Implementor | After writing code, before build | Section 1 (Self-Review Checklist) |
| Fixer | When fixing security-related bugs | Section 1 (Self-Review — re-run after fix), Section 5 (Severity), Section 6 (Anti-Pattern Fixes) |
| Verifier | Pass 2b — security checkpoint detection and security test coverage gate | Section 2 (Auto-Detection Table), Section 3 (Test Generation Table — for coverage reconciliation) |
| QA | Security regression test generation | Section 3 (Test Generation Table + Coverage Gate output format) |
| Security Scanner | Running parallel security scans | Section 4 (Parallel Scan Protocol), Section 7 (Report Format) |
| Orchestrator | Pipeline decisions on security findings, security test coverage gate enforcement | Section 5 (Severity Classification), Section 3 (Coverage Gate rules) |

## Hard Rules

- ✅ Section 1 (Self-Review Checklist) MUST be run by Implementor agents after every code modification
- ✅ Section 1 (Self-Review Checklist) MUST be re-run by Fixer agents after every security-related fix
- ✅ Section 2 (Auto-Detection) MUST be used by Verifier during Pass 2b
- ✅ Section 3 (Test Generation) MUST be used by QA when creating security regression tests
- ✅ Section 3 (Security Test Coverage Gate) MUST be reported by QA in every pipeline that touches security-sensitive code
- ✅ Section 3 (Security Test Coverage Gate) MUST be verified by Verifier during its Pass 2b check
- ✅ Section 4 (Parallel Scan) is the PREFERRED method for running security scans
- ✅ Section 5 (Severity Classification) MUST be used to determine pipeline blocking decisions
- ❌ This skill MUST NOT be treated as a replacement for the `security-scan` skill — it complements it (security-scan handles tool execution, this skill handles knowledge and workflows)

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `security-scan` | Tool execution (dependency scan, secrets scan, supply chain) — this skill provides the knowledge layer |
| `code-philosophy` | General coding standards — this skill provides the security-specific subset |
| `backend-code-philosophy` | Backend-specific coding philosophy — security is part of that |
| `shared-agent-workflow` | Startup protocol and output contract — this skill is loaded AFTER shared-agent-workflow |
