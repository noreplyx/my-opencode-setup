---
name: semgrep-scan
description: "Run Semgrep scans on projects for static analysis security testing (SAST). This skill triggers automatically as a mandatory step within the orchestration pipeline Security Scan gate — it does NOT require the user to explicitly request semgrep. During any pipeline, after Build Gate + Lint Gate pass, the Orchestrator loads this skill and runs semgrep SAST scanning automatically. Also use when the user manually asks to scan code for security vulnerabilities, run semgrep, perform SAST scanning, check for code security issues, validate custom semgrep rules, or when integrating security scanning into a CI pipeline. Supports auto-detected rules, language-specific packs (p/python, p/javascript, p/java, etc.), security-focused rule packs (p/owasp-top-ten, p/command-injection, p/secrets), custom .yaml rule files, and rule validation with semgrep validate."
---

# Semgrep Scan Skill

## Purpose

Run Semgrep static analysis on project code to detect security vulnerabilities, enforce coding standards, and find bug patterns. This skill focuses on making `semgrep scan` fast, efficient, and flexible — with smart defaults that work well locally and in CI environments.

This skill is **automatically loaded by the Orchestrator** during every pipeline's Security Scan gate (after Build + Lint + Code Quality gates pass). It runs as a mandatory SAST sub-scan alongside dependency and secrets scanning.

## Quick Start

```bash
# Auto-detect and scan everything
semgrep --config auto .

# Scan with security-focused rules, strict mode
semgrep --config p/owasp-top-ten --error .

# Scan specific paths with custom rules
semgrep --config path/to/my-rules.yaml --error src/
```

## When to Use This Skill

This skill is **automatically triggered** during every pipeline as part of the Security Scan gate. It also triggers when:

- The user wants to **run semgrep** on a project or specific files
- The user wants to **validate** custom semgrep rules (`.yaml` rule files)
- The user is setting up **CI security scanning** with semgrep
- The user wants to **scan new/modified code** against a baseline (`--baseline-commit`)
- The user needs **output in specific formats** (JSON, SARIF, terminal)
- The user asks about **SAST**, **static analysis**, or **code security scanning**
- The Orchestrator is running a **pipeline** and needs to perform SAST scanning after the Build Gate passes

## Scan Workflow

### Step 1: Understand the Target

First, determine what to scan:
- **Full project scan**: Scan the entire project or working directory
- **Targeted scan**: Scan specific files, directories, or a git diff
- **Baseline scan**: Scan only changes since a given commit (`--baseline-commit`)

Check the project layout to understand the codebase:

```bash
ls package.json requirements.txt go.mod Cargo.toml 2>/dev/null
```

### Step 2: Choose Rule Configuration

Pick the right rule source based on the user's goal:

| Use Case | Command | Best For |
|----------|---------|----------|
| **Auto-detect** | `--config auto` | First-time scanning, unknown project type |
| **Full registry** | `--config p/default` | Comprehensive scan (all rules) |
| **Security only** | `--config p/owasp-top-ten` or `--config p/security-audit` | Security vulnerability focus |
| **Language-specific** | `--config p/python` `--config p/javascript` `--config p/java` `--config p/go` `--config p/typescript` | Targeted language scan |
| **Secrets** | `--config p/secrets` | Hardcoded credentials, API keys, tokens |
| **Supply chain** | `--config p/supply-chain` | Dependency and open-source risks |
| **Custom rules** | `--config /path/to/rules.yaml` | Organization-specific rules |
| **Mixed** | `--config p/owasp-top-ten --config custom-rules/` | Combine pack + custom rules |

**Recommendation**: Start with `--config p/default` for comprehensive coverage, or `p/security-audit` for security-focused scans.

You can chain multiple `--config` flags:

```bash
# Run OWASP Top 10 + custom company rules + secrets check
semgrep --config p/owasp-top-ten --config p/secrets --config .semgrep/rules.yaml --error src/
```

### Step 3: Choose Output Format

| Flag | Description | When to Use |
|------|-------------|-------------|
| *(none)* | Default colorized terminal output | Daily interactive use |
| `--json` | Structured JSON to stdout | Programmatic consumption, CI scripts |
| `--sarif` | SARIF format to stdout | GitHub, VS Code, editor integration |
| `--text` | Plain text (no colors) | Log files, non-TTY environments |
| `--output FILE` | Write output to file | Save results for later analysis |
| `--json-output FILE` | Write JSON copy to file | CI artifact collection |
| `--sarif-output FILE` | Write SARIF copy to file | Upload to GitHub Advanced Security |
| `--emacs` | Emacs single-line format | Editor integration |

**Smart defaults:**
- Terminal available ? colorized output
- CI environment (no TTY) ? JSON for machine parsing
- SARIF requested ? use `--sarif` (also pipe to `--sarif-output` for file)
- For quick review, use `--json` and pipe to `jq` for filtering

### Step 4: Strict Mode (CI Integration)

Use `--error` to exit with code 1 when findings exist:

```bash
# Block pipeline on any finding
semgrep --config p/owasp-top-ten --error src/

# Block only on specific severity levels
semgrep --config p/security-audit --error src/ --severity ERROR
```

Exit codes:
| Code | Meaning |
|------|---------|
| 0    | OK — no findings |
| 1    | Findings detected (with `--error`) |
| 2    | Fatal error |
| 3-8  | Configuration errors |

### Step 5: Baseline Scanning

Use `--baseline-commit` to scan only changes since a specific commit. This is useful for:
- PR/MR review pipelines
- Scanning only new code additions
- Reducing noise in incremental scans

```bash
# Scan only changes since main branch diverged
semgrep --config p/security-audit --baseline-commit origin/main --error .

# Scan only changes in the current PR
semgrep --config p/default --baseline-commit HEAD~1 --error src/
```

When `--baseline-commit` is used with `--json`, the JSON output includes baseline metadata showing which findings are new vs pre-existing.

**Important**: Requires a git repository. Aborts if not in a git directory, there are unstaged changes, or the baseline commit doesn't exist.

### Step 6: Targeting Specific Files/Paths

```bash
# Scan specific directory
semgrep --config p/security-audit src/

# Scan specific file types
semgrep --config p/javascript --error src/ --include "*.js" --include "*.tsx"

# Exclude test files
semgrep --config p/default --error . --exclude "tests/" --exclude "*.test.*"

# Exclude minified files (large generated files)
semgrep --config p/default --error . --exclude-minified-files

# Exclude specific rules
semgrep --config p/default --exclude-rule "javascript.lang.security.audit.path-traversal" .
```

### Step 7: Performance Tuning

For large codebases, optimize scan performance:

```bash
# Exclude node_modules and vendor directories (they're ignored by default)
# But you can also explicitly add excludes for speed
semgrep --config p/security-audit --error src/ \
  --exclude "*.min.*" \
  --exclude "dist/" \
  --exclude "build/"
```

Semgrep automatically ignores `.semgrepignore` patterns, which default to respecting `.gitignore` patterns.

### Step 8: Parsing and Reporting Results

When the user needs help interpreting results, structure the report like this:

```markdown
## Semgrep Scan Report

### Configuration
- **Rules**: p/owasp-top-ten, p/secrets
- **Target**: src/ (excluding tests/)
- **Mode**: Strict (--error)
- **Baseline**: origin/main

### Findings Overview
| Severity | Count |
|----------|-------|
| ERROR    | 3     |
| WARNING  | 7     |
| INFO     | 12    |

### Detailed Findings

#### ERROR: Path Traversal (3 occurrences)
- `src/routes/files.ts:45` — Possible user input in `path.join`
  - **Fix**: Validate/sanitize user input before using in path operations
- `src/utils/upload.ts:102` — Possible user input in `path.resolve`
  - **Fix**: Use allowlist of approved paths

#### WARNING: Hardcoded Secret (2 occurrences)
- `src/config/defaults.ts:15` — Possible hardcoded API key
  - **Fix**: Move to environment variable or secrets manager

### Recommendations
1. [Fix] Sanitize user input before path operations
2. [Fix] Remove hardcoded credentials from source code
3. [Review] Audit flagged regex constructions for ReDoS potential
```

For JSON output, use `jq` to filter and summarize:

```bash
# Count findings by severity
semgrep --config p/security-audit --json src/ | jq '.results | group_by(.extra.severity) | map({severity: .[0].extra.severity, count: length})'

# Extract high-severity findings only
semgrep --config p/security-audit --json src/ | jq '.results | map(select(.extra.severity == "ERROR")) | .[] | {file: .path, line: .start.line, rule: .check_id, message: .extra.message}'
```

## Rule Validation

Validate custom semgrep rule files before using them in scans:

```bash
# Validate a single rule file
semgrep validate path/to/rules.yaml

# Validate all rules in a directory
semgrep validate .semgrep/

# Validate with pro language support (Apex, Elixir)
semgrep validate --pro path/to/rules.yaml
```

Validation checks:
- YAML syntax correctness
- Rule schema compliance (required fields: `id`, `patterns` or `pattern`, `message`, `languages`, `severity`)
- Pattern validity per language
- Metavariable consistency

Validate new rules **before** running scans with them — this catches syntax errors early.

## Common Scan Recipes

### Recipe 1: Quick Security Scan (default)
```bash
semgrep --config p/security-audit --error .
```

### Recipe 2: Comprehensive Scan
```bash
semgrep --config p/default --error .
```

### Recipe 3: Incremental PR Scan
```bash
semgrep --config p/security-audit --baseline-commit origin/main --error .
```

### Recipe 4: Multi-Pack Targeted Scan
```bash
semgrep \
  --config p/owasp-top-ten \
  --config p/secrets \
  --config p/command-injection \
  --config .semgrep/custom-rules.yaml \
  --error src/
```

### Recipe 5: SARIF Output for GitHub/CI
```bash
semgrep --config p/security-audit --sarif --output results.sarif --error .
```

### Recipe 6: JSON with Baseline for CI
```bash
semgrep --config p/security-audit --baseline-commit origin/main --json --output results.json --error .
```

### Recipe 7: Validate then Scan
```bash
semgrep validate .semgrep/rules.yaml && semgrep --config .semgrep/rules.yaml --error src/
```

## Integration with Pipeline (Automatic)

This skill is **automatically loaded by the Orchestrator** during every pipeline as part of the **Semgrep SAST Gate** — a mandatory sub-gate of the Security Scan gate. No user prompt is required.

### Automatic Triggering

The Orchestrator loads and invokes this skill automatically at this point in the pipeline:

```
Build Gate ? Lint Gate ? Code Quality Gate ? SECURITY SCAN ? QA
                                                   ¦
                                            +-------------+
                                            ? SEMGREP SAST ?
                                            ¦  GATE        ¦
                                            ¦  (auto-loaded)¦
                                            +-------------+
                                                   ¦
                                            +-------------+
                                            ? DEPENDENCY  ?
                                            ¦  + SECRETS   ¦
                                            ¦  SCANNING    ¦
                                            +-------------+
```

**How the Orchestrator triggers it:**
1. After Build + Lint + Code Quality gates pass, the Orchestrator loads the `semgrep-scan` skill via its system prompt's `available_skills`
2. The Orchestrator runs: `semgrep --config p/security-audit --error .`
3. The Orchestrator parses the semgrep output and includes findings in the combined Security Scan report
4. If semgrep exits with code 1 (findings detected with `--error`), the **Semgrep SAST Gate FAILS** — the pipeline is blocked
5. The Orchestrator reports findings to the user and decides to fix, except, or block

### Pipeline Behavior

| Semgrep Exit Code | Meaning | Pipeline Action |
|-------------------|---------|-----------------|
| 0 | No findings | ? PASS — proceed to dependency scan |
| 1 | Findings detected | ? FAIL — block pipeline, report to Orchestrator |
| 2 | Fatal error | ?? WARN — log error, continue (tool may not be installed) |
| 3-8 | Config error | ?? WARN — report to Orchestrator |

### Pipeline Scan Defaults

When automatically triggered during a pipeline, the semgrep scan uses these defaults:
- **Config**: `p/security-audit` (security-focused)
- **Mode**: `--error` (strict — fail on any finding)
- **Target**: The workspace root (`.`)
- **Exclusions**: `node_modules/`, `dist/`, `build/`, `tests/`, `*.test.*`, `*.spec.*` (automatic via `.semgrepignore` / `.gitignore`)

## Hard Rules

- ? Always use `--error` for CI/strict mode — fails the pipeline on findings
- ? The Orchestrator loads this skill automatically during every pipeline — no user prompt required
- ? Read-only operation — NEVER use `--autofix` (data loss risk)
- ? Validate custom rules BEFORE running them in a scan
- ? Use `.semgrepignore` or `--exclude` to skip irrelevant files (node_modules, dist, build)
- ? Use `--baseline-commit` for incremental scans to reduce noise
- ? NEVER use `--autofix` — this skill is for scanning only
- ? NEVER modify project files during scanning
- ? NEVER run scans without a `--config` flag (will use default config; always be explicit)
- ? DO NOT scan minified, generated, or vendored files unless explicitly requested

## Key References

| Topic | Command |
|-------|---------|
| Official docs | `semgrep --help` |
| Scan help | `semgrep scan --help` |
| Rule syntax | https://semgrep.dev/docs/writing-rules/rule-syntax |
| Registry | https://semgrep.dev/explore |
| Rule packs index | https://semgrep.dev/packs |
