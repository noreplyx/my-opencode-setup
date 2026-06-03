---
name: gitleaks-scan
description: "Run Gitleaks secret scanning on projects to detect hardcoded secrets like passwords, API keys, tokens, and private keys in Git repositories and files using a Podman container (no local Go install needed). This skill triggers automatically as a mandatory sub-scan within the orchestration pipeline Security Scan gate -- alongside semgrep SAST. Also use when the user asks to scan for secrets, run gitleaks, check for hardcoded credentials, detect leaked API keys, scan git history for secrets, perform secret detection, or integrate secret scanning into a CI pipeline. Supports three scanning modes: git repository scanning (full history or incremental), directory/file scanning, and stdin scanning. Custom rules via .gitleaks.toml, ignore lists via .gitleaksignore, and multiple output formats (JSON, CSV, SARIF, JUnit)."
---

# Gitleaks Scan Skill (Container-Based)

## Purpose

Run [Gitleaks](https://github.com/gitleaks/gitleaks) secret detection on projects to find hardcoded passwords, API keys, tokens, private keys, and other sensitive data -- **all via a Podman container** with zero local installation required. Uses the official `docker.io/zricethezav/gitleaks` image (v8.30.1+).

This skill is **automatically loaded by the Orchestrator** during every pipeline's Security Scan gate as a **mandatory secret-scanning sub-gate**. It runs alongside semgrep SAST, dependency scanning, and other security checks.

## Why Container-Based?

- [x] **No local Go install** -- no homebrew, no go build, no version conflicts
- [x] **Isolated** -- runs in its own environment, read-only access
- [x] **Reproducible** -- same gitleaks version across all environments
- [x] **Auto-updates** -- pull the latest image to get new rules & gitleaks versions
- [x] **Official image** -- 10M+ Docker pulls, actively maintained

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick git history scan** | `podman run --rm -v "${PWD}:/src:Z" docker.io/zricethezav/gitleaks:latest git --source=/src --verbose` |
| **Quick directory scan** | `podman run --rm -v "${PWD}:/src:Z" docker.io/zricethezav/gitleaks:latest dir --source=/src --verbose` |
| **Shell wrapper** | Source `scripts/gitleaks-wrapper.sh` then run `gitleaks-docker git --verbose` |
| **First-time setup** | `podman pull docker.io/zricethezav/gitleaks:latest` |

## Quick Start

```bash
# Pull the image (first time only)
podman pull docker.io/zricethezav/gitleaks:latest

# Scan git repository history
podman run --rm -v "${PWD}:/src:Z" docker.io/zricethezav/gitleaks:latest git --source=/src --verbose

# Scan a directory (non-git files)
podman run --rm -v "${PWD}:/src:Z" docker.io/zricethezav/gitleaks:latest dir --source=/src --verbose
```

### Shell Wrapper (Recommended)

Source the included wrapper to avoid repeating the podman incantation:

```bash
source skills/gitleaks-scan/scripts/gitleaks-wrapper.sh
# Now use like native gitleaks:
gitleaks-docker git --verbose
gitleaks-docker dir --source=/src/src/ --verbose
gitleaks-docker git --report-format=json --report-path=-
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:
```bash
source /home/oat/.config/opencode/skills/gitleaks-scan/scripts/gitleaks-wrapper.sh
```

## Container Image Reference

| Attribute | Value |
|-----------|-------|
| **Image** | `docker.io/zricethezav/gitleaks:latest` |
| **Pull command** | `podman pull docker.io/zricethezav/gitleaks:latest` |
| **Also available** | `ghcr.io/zricethezav/gitleaks:latest` |
| **Image source** | https://hub.docker.com/r/zricethezav/gitleaks |
| **Current version** | v8.30.1 (check with `gitleaks version`) |
| **Mount point** | Your code directory at `/src` |
| **Entrypoint** | `gitleaks` binary |
| **Git support** | Full git history scanning via `git` subcommand |
| **Filesystem** | Read-only (outputs mount at `/src/<file>` to persist) |

## When to Use This Skill

Triggers **automatically** during every pipeline Security Scan gate. Also triggers when:

- The user wants to **scan for hardcoded secrets** (passwords, API keys, tokens)
- The user asks about **secret detection** or **credential scanning**
- The user wants to **run gitleaks** on a project
- The user wants to **scan git history** for leaked secrets
- The user needs **pre-commit / CI secret scanning**
- The user wants a **secrets report** in JSON/SARIF/CSV
- The user asks about **`.gitleaks.toml`** or **`.gitleaksignore`**

## Scan Workflow

### Step 1: Determine Scan Mode

| Mode | Command | Best For |
|------|---------|----------|
| **Git** | `gitleaks-docker git [flags] [repo]` | Full git history, staged changes, pre-commit |
| **Dir** | `gitleaks-docker dir [flags] [path]` | Non-git directories, specific files |
| **Stdin** | `gitleaks-docker stdin [flags]` | Piped data (diffs, file contents) |

Check the project:
```bash
ls .git 2>/dev/null && echo "Use 'git' mode" || echo "Use 'dir' mode"
```

### Step 2: Run the Scan

#### Git Scan (Full History)
Scans the entire git commit history using `git log -p` internally:
```bash
# Full history
gitleaks-docker git --verbose

# Last 5 commits
gitleaks-docker git --log-opts="--max-count=5" --verbose

# Staged changes only (pre-commit)
gitleaks-docker git --staged --verbose
```

#### Directory Scan (Non-Git)
Scans files without git history:
```bash
# Current directory
gitleaks-docker dir --verbose

# Specific path
gitleaks-docker dir --source=/src/src/ --verbose

# Follow symlinks
gitleaks-docker dir --follow-symlinks --verbose

# Single file
gitleaks-docker dir --source=/src/config/settings.ts --verbose
```

#### Stdin Scan
```bash
cat some_file | gitleaks-docker stdin --verbose
git diff HEAD~1 | gitleaks-docker stdin --verbose
```

### Step 3: Choose Output Format

| Flag | Format | Use Case |
|------|--------|----------|
| *(none)* | Colorized terminal | Interactive use |
| `--report-format=json --report-path=-` | JSON stdout | CI, programmatic |
| `--report-format=json --report-path=/src/r.json` | JSON file | Save results |
| `--report-format=csv --report-path=/src/r.csv` | CSV | Spreadsheets |
| `--report-format=sarif --report-path=/src/r.sarif` | SARIF | GitHub/VS Code |
| `--report-format=junit --report-path=/src/r.xml` | JUnit XML | CI reporting |

**Important**: Use `--report-path=-` for stdout or `--report-path=/src/<filename>` to persist to host. Paths outside `/src/` are lost when the container exits.

### Step 4: Understand Findings

Each finding includes: `Finding`, `Secret`, `RuleID`, `Entropy`, `File`, `Line`, `Commit`, `Author`, `Fingerprint`.

The **Fingerprint** uniquely identifies each finding (format: `commit:file:ruleID:line`). Use it for:
- Adding to `.gitleaksignore` for false positives
- Baseline tracking for incremental scans

### Step 5: Exit Codes

| Code | Meaning | Pipeline Action |
|------|---------|-----------------|
| 0 | No leaks | [x] PASS |
| 1 | Leaks detected | [X] FAIL (configurable via `--exit-code`) |
| 2 | Fatal error | [!]? WARN |

### Step 6: Baseline Scanning (Incremental CI)

```bash
# Step 1: Create baseline
gitleaks-docker git --report-format=json --report-path=/src/baseline.json

# Step 2: Later scans only report NEW findings
gitleaks-docker git --baseline-path=/src/baseline.json --report-format=json --report-path=/src/new-findings.json
```

Baselines let you pre-triage known findings so CI only blocks on new leaks.

### Step 7: Custom Configuration

Place a `.gitleaks.toml` at the project root for auto-detection, or use `--config`:

```toml
# Extend default rules with custom ones
[extend]
useDefault = true

[[rules]]
id = "my-internal-token"
description = "detect internal tokens"
regex = '''ACME-[0-9A-Z]{16,32}'''
entropy = 3.0
keywords = ["ACME-"]
tags = ["security", "custom"]
```

Config loading order: 1. `--config` flag, 2. `GITLEAKS_CONFIG` env, 3. `GITLEAKS_CONFIG_TOML` env, 4. `.gitleaks.toml` in target path.

### Step 8: Ignoring False Positives

Create `.gitleaksignore` at repo root with one fingerprint per line:
```gitignore
a1b2c3d4...:src/config.ts:generic-api-key:15
b2c3d4e5...:src/test/fixtures.ts:generic-api-key:42
```

Extract fingerprints: `cat report.json | jq -r '.[].Fingerprint'`

### Step 9: Suppressing Inline

Add `// gitleaks:allow` comment on the line:
```typescript
const apiKey = "sk-1234"; // gitleaks:allow
```

Use `--ignore-gitleaks-allow` to override and scan these lines anyway.

### Step 10: Limiting Scan Scope

```bash
# Scan only specific rules
gitleaks-docker git --enable-rule=generic-api-key --enable-rule=aws-access-token --verbose

# Skip large files
gitleaks-docker git --max-target-megabytes=5 --verbose

# Timeout after 2 minutes
gitleaks-docker git --timeout=120 --verbose

# Clean output for CI
gitleaks-docker git --no-banner --verbose

# Redact secrets (show first 20%)
gitleaks-docker git --redact=20 --verbose

# Debug mode
gitleaks-docker git --log-level=debug --verbose
```

## Reporting Findings

Structure findings reports like this:

```markdown
## Gitleaks Secret Scan Report

### Configuration
- **Runtime**: Podman container (zricethezav/gitleaks:latest, v8.30.1)
- **Mode**: git (full history)
- **Baseline**: baseline.json (5 pre-existing findings excluded)

### Findings Overview
| Severity | Rule | File | Line |
|----------|------|------|------|
| HIGH | generic-api-key | src/config/settings.ts | 15 |
| MED | aws-access-token | src/deploy/credentials.ts | 42 |

### Detailed Findings

#### HIGH: Generic API Key -- src/config/settings.ts:15
- **Secret**: `sk-1234abcdef...` (entropy: 3.5)
- **Commit**: `a1b2c3d` by Jane Doe (2024-01-15)
- **Fingerprint**: `a1b2c3d:src/config/settings.ts:generic-api-key:15`
- **Fix**: Move to environment variable or secrets manager

### Recommendations
1. [IMPORTANT] Remove hardcoded API keys from source code
2. [IMPORTANT] Rotate any exposed credentials immediately
3. [RECOMMENDED] Add `.gitleaks.toml` for project-specific rules
4. [RECOMMENDED] Add `.gitleaksignore` for confirmed false positives
5. [RECOMMENDED] Set up pre-commit hook to prevent future leaks
```

## Pipeline Integration (Automatic)

This skill is **automatically loaded by the Orchestrator** during every pipeline's Security Scan gate as a mandatory sub-gate:

```
Build -> Lint -> Code Quality -> SECURITY SCAN -> QA
                                   |
                            +-------------+
                            | SEMGREP     |
                            | SAST GATE   |
                            +-------------+
                                   |
                            +-------------+
                            | GITLEAKS    |
                            | SECRET GATE | <- THIS SKILL
                            +-------------+
                                   |
                            +-------------+
                            | DEPENDENCY  |
                            | + SBOM etc  |
                            +-------------+
```

### How the Orchestrator Triggers It

1. After Build + Lint + Code Quality gates pass, the Orchestrator loads the `security-scan` skill
2. The `security-scan` skill runs semgrep SAST, then **loads the `gitleaks-scan` skill** as a mandatory sub-step
3. Pull image if needed:
   ```bash
   podman image exists docker.io/zricethezav/gitleaks:latest || podman pull docker.io/zricethezav/gitleaks:latest
   ```
4. Run gitleaks:
   ```bash
   podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/zricethezav/gitleaks:latest \
     git --source=/src --report-format=json --report-path=- --no-banner --verbose
   ```
5. Parse JSON output -> include in combined Security Scan report
6. If exit code 1 (leaks detected) -> **gate FAILS**, pipeline blocked

### Pipeline Defaults

| Setting | Value |
|---------|-------|
| Image | `docker.io/zricethezav/gitleaks:latest` |
| Volume | `$WORKSPACE_ROOT:/src:Z` |
| Mode | `git` (full history) |
| Format | `json` to stdout |
| Banner | `--no-banner` |
| Verbose | `--verbose` |

## Integration with security-scan Skill

The `security-scan` skill should load `gitleaks-scan` as a mandatory sub-scan alongside `semgrep-scan`. The gitleaks scan serves as a **more thorough replacement** for the basic hardcoded-secrets grep in step 4 -- gitleaks uses 170+ curated rules (regex + entropy), has official maintainers, and catches patterns a simple grep would miss.

Pipeline sequence:
```
security-scan loads:
  1. semgrep-scan skill  (SAST)
  2. gitleaks-scan skill (Secret detection) <- NEW
  3. Dependency scan
  4. Anti-pattern scan
  5. SBOM + Supply chain
```

## Hard Rules

- [x] Always pull first: `podman image exists ... || podman pull ...`
- [x] Always mount with `-v "${PWD}:/src:Z"` -- SELinux `:Z` flag
- [x] Always use `--rm` to clean up
- [x] Always use `--source=/src` for targets in the mounted volume
- [x] Use `--report-path=-` for stdout or `/src/<file>` to persist
- [x] The Orchestrator loads this skill automatically during every pipeline
- [x] Read-only operation -- the container is ephemeral
- [x] Use `--baseline-path` for incremental CI scanning
- [x] Place `.gitleaks.toml` at project root for auto-detection
- [x] NEVER modify project files during scanning

## Key References

| Topic | Location |
|-------|----------|
| GitHub repo | https://github.com/gitleaks/gitleaks |
| Docker Hub | https://hub.docker.com/r/zricethezav/gitleaks |
| Default config | https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml |
| Wrapper script | `skills/gitleaks-scan/scripts/gitleaks-wrapper.sh` |
| Recipe reference | `skills/gitleaks-scan/references/recipes.md` |
| Gitleaks docs | https://github.com/gitleaks/gitleaks#readme |

## Related Skills

| Skill | Purpose | Relationship |
|-------|---------|--------------|
| `semgrep-scan` | SAST vulnerability scanning | Runs alongside in Security Scan gate |
| `security-scan` | Combined security gate | Loads both semgrep-scan and gitleaks-scan |
| `gitleaks-wrapper.sh` | Shell wrapper | Bundled in `scripts/` |
