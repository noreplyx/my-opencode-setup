---
name: gitleaks-scan
description: "Use when the user asks to scan a Git repository's commit history for leaked secrets (API keys, tokens, passwords, private keys), run gitleaks, or check whether a credential committed in the past was deleted but still lives in history. Detects secrets in git history only (complementing Trivy's working-tree secret leg) via Gitleaks' pure git-object traversal, no repo code executed. Runs Gitleaks via a Podman container (docker.io/zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f) with zero local Go installation. Output formats: JSON, CSV, JUnit, SARIF, template."
---

# Gitleaks Skill (Podman)

## Purpose

Run [Gitleaks](https://github.com/gitleaks/gitleaks) — an open-source secret
detection engine — to find leaked secrets (API keys, tokens, passwords,
private keys) in a **Git repository's commit history**. **All via a Podman
container** with zero local Go installation required. Uses the official
`docker.io/zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` image.

Gitleaks is the git-history secret leg of the pipeline's Stage 5 multi-scanner
security suite, complementing OSV-Scanner (lockfile CVEs), Semgrep
(code-pattern SAST), Trivy (working-tree vulns/misconfig/secrets), and PMD
(Java/JS static analysis). It scans **git history only** — a credential that
was committed and later deleted still lives in history and is reported here.
Gitleaks reads git objects directly (pure git-object traversal); it never
executes repository code.

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick git-history scan** | `gitleaks-docker detect --source /src` |
| **JSON output** | `gitleaks-docker detect --source /src --report-format json --report-path /src/.scans/results.json` |
| **Pipeline invocation** | `gitleaks-docker detect --source /src --report-format json --report-path /src/.scans/final-gitleaks-results.json /src` |
| **Shell wrapper** | Source `scripts/gitleaks-scanner-wrapper.sh` then run `gitleaks-docker ...` |
| **First-time setup** | `podman pull docker.io/zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` |
| **Check version** | `gitleaks-docker --version` |

## Quick Start

```bash
# Pull the image (first time only)
podman pull docker.io/zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f

# Scan a git repo's history for secrets.
# NOTE: this image ships an ENTRYPOINT of `gitleaks`, so the binary name is
# NOT part of the command (the wrapper passes your args straight through).
podman run --rm -v "${PWD}:/src:Z" --workdir /src docker.io/zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f \
  detect --source /src

# Scan with JSON output persisted to the host
podman run --rm -v "${PWD}:/src:Z" --workdir /src docker.io/zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f \
  detect --source /src --report-format json --report-path /src/.scans/final-gitleaks-results.json
```

### Shell Wrapper (Recommended)

Source the included wrapper to avoid repeating the Podman incantation:

```bash
source ./skills/gitleaks-scan/scripts/gitleaks-scanner-wrapper.sh
# Now use like native gitleaks (the wrapper passes args straight through):
gitleaks-docker detect --source /src
gitleaks-docker detect --source /src --report-format json --report-path /src/.scans/final-gitleaks-results.json
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:

```bash
source skills/gitleaks-scan/scripts/gitleaks-scanner-wrapper.sh
```

### Set Custom Working Directory

```bash
# Scan a different directory
GITLEAKS_SCANNER_WORKDIR=/path/to/project gitleaks-docker detect --source /src
```

## Scan Workflow

### Step 1: Run the Scan

```bash
# Standard pipeline invocation (JSON artifact under /src/.scans/)
gitleaks-docker detect --source /src --report-format json --report-path /src/.scans/final-gitleaks-results.json /src

# Human-readable terminal output (no artifact)
gitleaks-docker detect --source /src
```

The target must be a **Git repository** (a `.git` directory present at the
scan root). Gitleaks reads the repository's commit history directly from its
git objects — it does not execute any repository code, hooks, or scripts.

### Step 2: Understand Findings

Each finding in the JSON artifact's `Leaks[]` array carries a `RuleID`
(e.g. `github-pat`, `aws-access-token`, `generic-api-key`), the `File` and
`StartLine` where the secret was introduced, the `Commit` hash, and the
`Secret` value:

| Field | Meaning |
|-------|---------|
| `RuleID` | Which secret rule matched (e.g. `github-pat`) |
| `File` / `StartLine` | Where the secret lives in the tree |
| `Commit` | The commit that introduced the secret |
| `Secret` | The matched secret value (redacted in the artifact when `--redact` is active) |

#### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No leaks found |
| 1 | Leaks found (or an error occurred) |
| 126 | Unknown flag |

In the pipeline **treat exit 1 as "leaks found"** — the authoritative findings
come from the JSON artifact's `Leaks[]` array, and the exit code is the
blocking signal that a secret exists in history.

**Important**: Use `--report-path /src/.scans/<filename>` to persist results
to the host filesystem (inside the `/src` mount). Without this, results go to
stdout. Paths outside `/src/` are lost when the container exits; paths inside
`/src` but outside `.scans/` would persist and could overwrite project files
via the writable mount — which is exactly why the wrapper enforces that output
files must live under the dedicated `/src/.scans/` subdirectory (guarding
`--report-path` in space and `=` forms), so fixed, non-colliding artifact names
cannot overwrite an existing project file.

## Reporting Findings

Structure findings reports like this (secrets: file:line + rule ID only):

```markdown
## Gitleaks Secret Report

### Configuration
- **Runtime**: Podman container (docker.io/zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f)
- **Mode**: git-history scan (`detect --source /src`)
- **Format**: JSON

### Overview
| Total Leaks | Critical |
|-------------|----------|
| 2           | 2        |

### Findings

#### [Critical] github-pat -- config/credentials.txt:3
- **Rule**: github-pat (GitHub Personal Access Token)
- **Commit**: a1b2c3d (introduced the secret)
- **Action**: Rotate the credential and remove it from history (rewrite history or rotate + revoke); report location only, never the value
```

## Hard Rules

- [x] **Always pull first**: `podman image exists ... || podman pull ...`
- [x] **Always mount with SELinux**: `-v "${PWD}:/src:Z"` (`:Z` flag for SELinux systems)
- [x] **Always use `--rm`** to clean up the container
- [x] **Always use `/src` paths** for all file targets inside the container
- [x] **Use `--report-path /src/.scans/<file>`** to persist results to host; the wrapper guards `--report-path` (space and `=` forms)
- [x] **Read-only operation** -- never modify project source files; only write scan artifacts (e.g. via `--report-path /src/.scans/...`)
- [x] **Never execute repository code** -- gitleaks reads git objects directly; the wrapper never runs project scripts or hooks
- [x] **Never quote secret values** -- report file:line + rule ID + commit only; the artifact itself is sensitive

## Performance & Opt-out

A git-history scan reads every commit's diff, so large or long-lived
repositories can take a while. If the gitleaks leg is too slow for a given
project, or its image cannot be pulled, drop it per-tool without blocking the
pipeline: remove its wrapper-source and invocation grants from
`agent/code-security-scanner.md`'s `bash` allowlist (and the mirrored pair in
`agent/verifier.md`) plus its "Run the scans" chain — the other legs still run
and the suite degrades to four tools. A *removed* leg yields **no** "scans
skipped" note (the leg no longer exists; the note is only emitted for a
*configured* leg whose infrastructure fails at run time).

## Key References

| Topic | Location |
|-------|----------|
| GitHub repo | https://github.com/gitleaks/gitleaks |
| Documentation | https://github.com/gitleaks/gitleaks#readme |
| Config reference | https://github.com/gitleaks/gitleaks#configuration |
| Exit codes | https://github.com/gitleaks/gitleaks#exit-codes |
| Wrapper script | `scripts/gitleaks-scanner-wrapper.sh` |

## Tips & Best Practices

1. **Scan git history, not the working tree**: `detect --source /src` finds secrets that were committed and later deleted — the working-tree surface is Trivy's `secret` scanner's job
2. **Use JSON output in CI**: `--report-format json --report-path /src/.scans/<file>` for programmatic processing
3. **Dedup against Trivy**: a secret that still exists in the working tree is reported by both gitleaks (history) and Trivy (working tree) — merge by `file:line` + rule ID, report once at Critical, tagged with both sources
4. **Add a `.gitleaks.toml`** at the project root to allowlist known-false-positive paths (the wrapper injects it as `--config` when present)
5. **Pair with the other legs**: gitleaks finds secrets in history; OSV/Trivy find bad dependency versions; Semgrep finds bad code patterns; PMD finds Java/JS rule violations — findings overlap little by design
