---
name: semgrep-scan
description: "Run Semgrep scans on projects for static analysis security testing (SAST) via a Podman container (no local install needed). This skill triggers automatically as a mandatory step within the orchestration pipeline Security Scan gate -- it does NOT require the user to explicitly request semgrep. During any pipeline, after Build Gate + Lint Gate pass, the Orchestrator loads this skill and runs semgrep SAST scanning automatically via the `docker.io/semgrep/semgrep` container image. Also use when the user manually asks to scan code for security vulnerabilities, run semgrep, perform SAST scanning, check for code security issues, validate custom semgrep rules, or when integrating security scanning into a CI pipeline. Supports auto-detected rules, language-specific packs (p/python, p/javascript, p/java, etc.), security-focused rule packs (p/owasp-top-ten, p/command-injection, p/secrets), custom .yaml rule files, and rule validation with semgrep validate."
---

# Semgrep Scan Skill (Container-Based)

## Purpose

Run Semgrep static analysis on project code to detect security vulnerabilities, enforce coding standards, and find bug patterns -- **all via a Podman container** with zero local installation required. The official `docker.io/semgrep/semgrep` image includes the full semgrep CLI plus jq, bash, curl, python3, and git.

This skill is **automatically loaded by the Orchestrator** during every pipeline's Security Scan gate (after Build + Lint + Code Quality gates pass). It runs as a mandatory SAST sub-scan alongside dependency and secrets scanning.

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick security scan** | `SEMGREP_IMG="docker.io/semgrep/semgrep:latest"; podman run --rm -v "$(pwd):/src" "$SEMGREP_IMG" semgrep scan --config p/security-audit --error .` |
| **Shell wrapper** (simplifies usage) | Add the alias/script below and run `semgrep-docker --config p/security-audit --error .` |
| **First-time setup** | `podman pull docker.io/semgrep/semgrep:latest` |

## Why Container-Based?

- [x] **No local install** -- no pip install, no npm, no version conflicts
- [x] **Isolated** -- runs in its own environment, can't modify project files
- [x] **Bundled tools** -- includes jq, bash, curl, python3, git (v1.162.0+)
- [x] **Reproducible** -- same semgrep version across all environments
- [x] **Auto-updates** -- pull the latest image to get new rules & semgrep versions

## Cross-Platform Compatibility

This skill works on **Linux**, **macOS** (via Podman Machine), and **Windows** (via Git Bash, WSL2, or MSYS2). Key platform notes:

| Concern | Linux | macOS | Windows |
|---------|-------|-------|---------|
| **Shell** | bash/zsh | bash/zsh | Git Bash, WSL2, or MSYS2 (not cmd.exe/PowerShell) |
| **Podman** | Native | Podman Machine | WSL2 or Podman Machine |
| **Volume mount** | `-v "$(pwd):/src:Z"` | `-v "$(pwd):/src"` (omit `:Z`) | `-v "$(pwd):/src"` (omit `:Z`) |
| **`$(pwd)`** | Works in all POSIX shells | Works in all POSIX shells | Works in Git Bash, WSL2, MSYS2 |

> **Tip**: Set `SELINUX_OPT=""` on macOS/Windows to omit the `:Z` flag. The wrapper script handles this automatically.

## Quick Start

Pull the image once (first time only):

```bash
podman pull docker.io/semgrep/semgrep:latest
```

Then run scans via the container:

```bash
# Auto-detect and scan everything
podman run --rm -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  semgrep scan --config auto .

# Scan with security-focused rules, strict mode
podman run --rm -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  semgrep scan --config p/owasp-top-ten --error .

# Scan specific paths with custom rules
podman run --rm -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  semgrep scan --config /src/path/to/my-rules.yaml --error /src/src/
```

> **Platform note**: On Linux, add `:Z` after mount paths for SELinux (e.g., `-v "$(pwd):/src:Z"`). On macOS and Windows, omit `:Z`. The wrapper script handles this automatically.

### Shell Wrapper (Recommended)

Create a helper script or alias to avoid repeating the podman incantation:

```bash
# Add to ~/.zshrc or ~/.bashrc
semgrep-docker() {
  local img="docker.io/semgrep/semgrep:latest"
  local selinux="${SELINUX_OPT:-:Z}"
  [ "$(uname -s)" != "Linux" ] && selinux=""
  podman run --rm -w /src -v "$(pwd):/src${selinux}" "$img" semgrep "$@"
}
```

Then use it like native semgrep:

```bash
semgrep-docker scan --config p/security-audit --error .
semgrep-docker scan --config p/default --sarif --output /src/results.sarif --error .
semgrep-docker validate .semgrep/rules.yaml
```

## Container Image Reference

- **Image**: `docker.io/semgrep/semgrep:latest` (also available as `semgrep/semgrep` -- the newer official location)
- **Mount point**: Your code directory must be mounted at `/src` inside the container
- **Working directory**: The container runs at `/` by default; use `semgrep scan .` (relative) or `/src/...` (absolute) for paths within the mounted volume
- **Output files**: Write to `/src/<filename>` to persist results to the host
- **Git support**: Git is available inside the container. For baseline scans, use `-w /src` to set the working directory
- **Exit codes**: Propagate correctly through podman (0 = pass, 1 = findings, 2 = error, 3-8 = config error)

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
- **Full project scan**: Scan the entire project or working directory (`.`)
- **Targeted scan**: Scan specific files, directories, or a git diff (`/src/src/`, `/src/path/to/file.ts`)
- **Baseline scan**: Scan only changes since a given commit (`--baseline-commit` -- requires `-w /src`)

Check the project layout to understand the codebase:

```bash
ls package.json requirements.txt go.mod Cargo.toml 2>/dev/null
```

### Step 2: Choose Rule Configuration

Pick the right rule source based on the user's goal:

| Use Case | `--config` Value | Best For |
|----------|------------------|----------|
| **Auto-detect** | `auto` | First-time scanning, unknown project type |
| **Full registry** | `p/default` | Comprehensive scan (all rules) |
| **Security only** | `p/owasp-top-ten` or `p/security-audit` | Security vulnerability focus |
| **Language-specific** | `p/python` `p/javascript` `p/java` `p/go` `p/typescript` | Targeted language scan |
| **Secrets** | `p/secrets` | Hardcoded credentials, API keys, tokens |
| **Supply chain** | `p/supply-chain` | Dependency and open-source risks |
| **Custom rules** | `/src/path/to/rules.yaml` | Organization-specific rules (must use `/src/...` path) |
| **Mixed** | chain multiple `--config` flags | Combine pack + custom rules |

**Important**: Custom rule files and config paths must be **inside the mounted volume** and referenced with `/src/...` prefix, e.g. `--config /src/.semgrep/rules.yaml`, not `--config .semgrep/rules.yaml`.

**Recommendation**: Start with `--config p/default` for comprehensive coverage, or `p/security-audit` for security-focused scans.

You can chain multiple `--config` flags:

```bash
# Run OWASP Top 10 + custom company rules + secrets check
semgrep-docker scan \
  --config p/owasp-top-ten \
  --config p/secrets \
  --config /src/.semgrep/rules.yaml \
  --error /src/src/
```

### Step 3: Choose Output Format

| Flag | Description | When to Use |
|------|-------------|-------------|
| *(none)* | Default colorized terminal output | Daily interactive use |
| `--json` | Structured JSON to stdout | Programmatic consumption, CI scripts |
| `--sarif` | SARIF format to stdout | GitHub, VS Code, editor integration |
| `--text` | Plain text (no colors) | Log files, non-TTY environments |
| `--output /src/FILE` | Write output to file (must use `/src/` prefix!) | Save results for later analysis |
| `--json-output /src/FILE` | Write JSON copy to file | CI artifact collection |
| `--sarif-output /src/FILE` | Write SARIF copy to file | Upload to GitHub Advanced Security |
| `--emacs` | Emacs single-line format | Editor integration |

**Output file path rule**: When writing output to a file (via `--output`, `--json-output`, `--sarif-output`), you **must** use the container's `/src/` prefix, e.g. `--output /src/results.sarif` -- NOT `--output results.sarif`. The file will appear at `results.sarif` on the host.

**Smart defaults:**
- Terminal available -> colorized output
- CI environment (no TTY) -> JSON for machine parsing
- SARIF requested -> use `--sarif` with `--sarif-output /src/results.sarif`
- For quick review, use `--json` and pipe to `jq` for filtering

### Step 4: Strict Mode (CI Integration)

Use `--error` to exit with code 1 when findings exist:

```bash
# Block pipeline on any finding
semgrep-docker scan --config p/owasp-top-ten --error .

# Block only on specific severity levels
semgrep-docker scan --config p/security-audit --error . --severity ERROR
```

Exit codes:
| Code | Meaning |
|------|---------|
| 0    | OK -- no findings |
| 1    | Findings detected (with `--error`) |
| 2    | Fatal error |
| 3-8  | Configuration errors |

Exit codes propagate correctly through `podman run --rm`.

### Step 5: Baseline Scanning

Use `--baseline-commit` to scan only changes since a specific commit. This is useful for:
- PR/MR review pipelines
- Scanning only new code additions
- Reducing noise in incremental scans

**Important**: For baseline scans, you **must** add `-w /src` so the container's working directory is the git repository root:

```bash
# Scan only changes since main branch diverged
podman run --rm -w /src -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  semgrep scan --config p/security-audit --baseline-commit origin/main --error .

# Scan only changes in the current PR
podman run --rm -w /src -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  semgrep scan --config p/default --baseline-commit HEAD~1 --error .
```

When `--baseline-commit` is used with `--json`, the JSON output includes baseline metadata showing which findings are new vs pre-existing.

**Important**: Requires a git repository. Aborts if not in a git directory, there are unstaged changes, or the baseline commit doesn't exist. The container includes `git` so this works as long as `.git` is within the mounted volume.

### Step 6: Targeting Specific Files/Paths

```bash
# Scan specific directory (use /src/ prefix for subdirectories within the mount)
semgrep-docker scan --config p/security-audit /src/src/

# Scan specific file types
semgrep-docker scan --config p/javascript --error . --include "*.js" --include "*.tsx"

# Exclude test files
semgrep-docker scan --config p/default --error . --exclude "tests/" --exclude "*.test.*"

# Exclude minified files (large generated files)
semgrep-docker scan --config p/default --error . --exclude-minified-files

# Exclude specific rules
semgrep-docker scan --config p/default --exclude-rule "javascript.lang.security.audit.path-traversal" .
```

### Step 7: Performance Tuning

For large codebases, optimize scan performance:

```bash
# Exclude node_modules and vendor directories (they're ignored by default)
# But you can also explicitly add excludes for speed
semgrep-docker scan --config p/security-audit --error . \
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
- **Runtime**: Podman container (semgrep/semgrep:latest)
- **Rules**: p/owasp-top-ten, p/secrets
- **Target**: . (excluding tests/)
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
- `src/routes/files.ts:45` -- Possible user input in `path.join`
  - **Fix**: Validate/sanitize user input before using in path operations
- `src/utils/upload.ts:102` -- Possible user input in `path.resolve`
  - **Fix**: Use allowlist of approved paths

#### WARNING: Hardcoded Secret (2 occurrences)
- `src/config/defaults.ts:15` -- Possible hardcoded API key
  - **Fix**: Move to environment variable or secrets manager

### Recommendations
1. [Fix] Sanitize user input before path operations
2. [Fix] Remove hardcoded credentials from source code
3. [Review] Audit flagged regex constructions for ReDoS potential
```

For JSON output, use `jq` to filter and summarize. Since jq is included in the container, you can pipe directly:

```bash
# Count findings by severity (pipe through the container's jq)
podman run --rm -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  sh -c 'semgrep scan --config p/security-audit --json . | jq ".results | group_by(.extra.severity) | map({severity: .[0].extra.severity, count: length})"'

# Extract high-severity findings only
podman run --rm -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  sh -c 'semgrep scan --config p/security-audit --json . | jq ".results | map(select(.extra.severity == \"ERROR\")) | .[] | {file: .path, line: .start.line, rule: .check_id, message: .extra.message}"'
```

Or with the wrapper alias, pipe to your host's `jq`:

```bash
semgrep-docker scan --config p/security-audit --json . | jq '.results | group_by(.extra.severity) | map({severity: .[0].extra.severity, count: length})'
```

## Rule Validation

Validate custom semgrep rule files before using them in scans. Rule file paths must use the `/src/` container prefix:

```bash
# Validate a single rule file (via wrapper alias)
semgrep-docker validate /src/path/to/rules.yaml

# Validate all rules in a directory
semgrep-docker validate /src/.semgrep/

# Validate with pro language support (Apex, Elixir)
semgrep-docker validate --pro /src/path/to/rules.yaml
```

Validation checks:
- YAML syntax correctness
- Rule schema compliance (required fields: `id`, `patterns` or `pattern`, `message`, `languages`, `severity`)
- Pattern validity per language
- Metavariable consistency

Validate new rules **before** running scans with them -- this catches syntax errors early.

## Common Scan Recipes

All recipes assume you've set up the `semgrep-docker` shell wrapper. Without it, prepend `podman run --rm -v "$(pwd):/src" docker.io/semgrep/semgrep:latest` to each command.

### Recipe 1: Quick Security Scan (default)
```bash
semgrep-docker scan --config p/security-audit --error .
```

### Recipe 2: Comprehensive Scan
```bash
semgrep-docker scan --config p/default --error .
```

### Recipe 3: Incremental PR Scan
```bash
podman run --rm -w /src -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  semgrep scan --config p/security-audit --baseline-commit origin/main --error .
```

### Recipe 4: Multi-Pack Targeted Scan
```bash
semgrep-docker scan \
  --config p/owasp-top-ten \
  --config p/secrets \
  --config p/command-injection \
  --config /src/.semgrep/custom-rules.yaml \
  --error /src/src/
```

### Recipe 5: SARIF Output for GitHub/CI
```bash
semgrep-docker scan --config p/security-audit --sarif --output /src/results.sarif --error .
```

### Recipe 6: JSON with Baseline for CI
```bash
podman run --rm -w /src -v "$(pwd):/src" docker.io/semgrep/semgrep:latest \
  semgrep scan --config p/security-audit --baseline-commit origin/main \
    --json --output /src/results.json --error .
```

### Recipe 7: Validate then Scan
```bash
semgrep-docker validate /src/.semgrep/rules.yaml \
  && semgrep-docker scan --config /src/.semgrep/rules.yaml --error /src/src/
```

### Recipe 8: Update Semgrep Image (get latest version)
```bash
podman pull docker.io/semgrep/semgrep:latest
```

## Integration with Pipeline (Automatic)

This skill is **automatically loaded by the Orchestrator** during every pipeline as part of the **Semgrep SAST Gate** -- a mandatory sub-gate of the Security Scan gate. No user prompt is required.

### Automatic Triggering

The Orchestrator loads and invokes this skill automatically at this point in the pipeline:

```
Build Gate -> Lint Gate -> Code Quality Gate -> SECURITY SCAN -> QA
                                                   |
                                            +-------------+
                                            | SEMGREP SAST |
                                            |  GATE        |
                                            |  (auto-loaded)|
                                            +-------------+
                                                   |
                                            +-------------+
                                            | DEPENDENCY  |
                                            |  + SECRETS   |
                                            |  SCANNING    |
                                            +-------------+
```

### How the Orchestrator triggers it:

1. After Build + Lint + Code Quality gates pass, the Orchestrator loads the `semgrep-scan` skill via its system prompt's `available_skills`
2. The Orchestrator sets up the shell wrapper or runs the full podman command with the project root mounted at `/src`
3. The Orchestrator runs the security-audit scan:
   ```bash
   podman run --rm -v "${WORKSPACE_ROOT:-$(pwd)}:/src" docker.io/semgrep/semgrep:latest \
     semgrep scan --config p/security-audit --error .
   ```
4. The Orchestrator parses the semgrep output and includes findings in the combined Security Scan report
5. If semgrep exits with code 1 (findings detected with `--error`), the **Semgrep SAST Gate FAILS** -- the pipeline is blocked
6. The Orchestrator reports findings to the user and decides to fix, except, or block

### Container Readiness Check

Before running the scan, the Orchestrator should verify the container image is available:

```bash
podman image exists docker.io/semgrep/semgrep:latest || podman pull docker.io/semgrep/semgrep:latest
```

If the image cannot be pulled (no network), the Orchestrator should report a warning and continue (treat as non-blocking infrastructure issue).

### Pipeline Behavior

| Semgrep Exit Code | Meaning | Pipeline Action |
|-------------------|---------|-----------------|
| 0 | No findings | [x] PASS -- proceed to dependency scan |
| 1 | Findings detected | [X] FAIL -- block pipeline, report to Orchestrator |
| 2 | Fatal error | [!] WARN -- log error, continue (image may not be available) |
| 3-8 | Config error | [!] WARN -- report to Orchestrator |

### Pipeline Scan Defaults

When automatically triggered during a pipeline, the semgrep scan uses these defaults:
- **Image**: `docker.io/semgrep/semgrep:latest`
- **Volume mount**: `$WORKSPACE_ROOT:/src` (add `:Z` on Linux for SELinux)
- **Config**: `p/security-audit` (security-focused)
- **Mode**: `--error` (strict -- fail on any finding)
- **Target**: `.` (inside container at `/src`)
- **Exclusions**: `node_modules/`, `dist/`, `build/`, `tests/`, `*.test.*`, `*.spec.*` (automatic via `.semgrepignore` / `.gitignore`)

## Hard Rules

- [x] Always use `--error` for CI/strict mode -- fails the pipeline on findings
- [x] Always mount the project root with `-v "$(pwd):/src"` (add `:Z` on Linux for SELinux)
- [x] Always use `--rm` to clean up the container after execution
- [x] The Orchestrator loads this skill automatically during every pipeline -- no user prompt required
- [x] Read-only operation -- the container is ephemeral (`--rm`), no persistent changes
- [x] Validate custom rules BEFORE running them in a scan
- [x] Use `.semgrepignore` or `--exclude` to skip irrelevant files (node_modules, dist, build)
- [x] Use `--baseline-commit` with `-w /src` for incremental scans to reduce noise
- [x] NEVER use `--autofix` -- this skill is for scanning only
- [x] NEVER modify project files during scanning
- [x] NEVER run scans without a `--config` flag (will use default config; always be explicit)
- [x] Use `/src/...` prefix for all file paths that reference files inside the mounted volume (custom rules, output paths, scan targets that are subdirectories)
- [x] DO NOT scan minified, generated, or vendored files unless explicitly requested

## Key References

| Topic | Command |
|-------|---------|
| Container image | `docker.io/semgrep/semgrep:latest` |
| Image source | https://hub.docker.com/r/semgrep/semgrep |
| Pull image | `podman pull docker.io/semgrep/semgrep:latest` |
| Semgrep official docs | https://semgrep.dev/docs/ |
| Rule syntax | https://semgrep.dev/docs/writing-rules/rule-syntax |
| Registry | https://semgrep.dev/explore |
| Rule packs index | https://semgrep.dev/packs |
| Semgrep in container | https://semgrep.dev/docs/semgrep-ci/packages-in-semgrep-docker |
