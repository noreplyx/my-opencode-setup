---
name: semgrep-scanner
description: "Use when the user asks to run Semgrep, perform SAST / static application security testing on source code, scan for injection or hardcoded-secret code patterns, or run static analysis with rule configs like p/default. Runs Semgrep via a Podman container (docker.io/semgrep/semgrep@sha256:b94b53d02fd4a022f9eac4e2af1380f5c3c4c21400e79d3336bdff1d1db5e796) with zero local Python installation. Output formats: text, JSON, SARIF, Emacs, Vim, GitLab SAST, GitLab DAST, SARIF (2.1)."
---

# Semgrep Skill (Podman)

## Purpose

Run [Semgrep](https://semgrep.dev) -- an open-source static analysis (SAST)
engine -- to find security-relevant code patterns (injection, XSS, SSRF,
hardcoded secrets, unsafe deserialization, and more) in a project's source
code. **All via a Podman container** with zero local Python installation
required. Uses the official `docker.io/semgrep/semgrep@sha256:b94b53d02fd4a022f9eac4e2af1380f5c3c4c21400e79d3336bdff1d1db5e796` image.

Semgrep is the SAST leg of the pipeline's Stage 5 multi-scanner security
suite, complementing OSV-Scanner (known CVEs in lockfiles) and Trivy
(dependency vulns, misconfig, secrets).

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick source scan** | `semgrep-docker scan --config p/default /src` |
| **JSON output** | `semgrep-docker scan --json --config p/default --output /src/.scans/results.json /src` |
| **Pipeline invocation** | `semgrep-docker scan --json --metrics off --disable-version-check --config p/default --output /src/.scans/final-semgrep-results.json /src` |
| **Shell wrapper** | Source `scripts/semgrep-scanner-wrapper.sh` then run `semgrep-docker ...` |
| **First-time setup** | `podman pull docker.io/semgrep/semgrep@sha256:b94b53d02fd4a022f9eac4e2af1380f5c3c4c21400e79d3336bdff1d1db5e796` |
| **Check version** | `semgrep-docker --version` |

## Quick Start

```bash
# Pull the image (first time only)
podman pull docker.io/semgrep/semgrep@sha256:b94b53d02fd4a022f9eac4e2af1380f5c3c4c21400e79d3336bdff1d1db5e796

# Scan a project directory with the default community ruleset.
# NOTE: this image has no ENTRYPOINT, so the `semgrep` binary name must be
# part of the command (the wrapper does this for you).
podman run --rm -v "${PWD}:/src:Z" --workdir /src docker.io/semgrep/semgrep@sha256:b94b53d02fd4a022f9eac4e2af1380f5c3c4c21400e79d3336bdff1d1db5e796 \
  semgrep scan --config p/default /src

# Scan with JSON output persisted to the host
podman run --rm -v "${PWD}:/src:Z" --workdir /src docker.io/semgrep/semgrep@sha256:b94b53d02fd4a022f9eac4e2af1380f5c3c4c21400e79d3336bdff1d1db5e796 \
  semgrep scan --json --metrics off --disable-version-check --config p/default \
  --output /src/.scans/final-semgrep-results.json /src
```

### Shell Wrapper (Recommended)

Source the included wrapper to avoid repeating the Podman incantation:

```bash
source ./skills/semgrep-scanner/scripts/semgrep-scanner-wrapper.sh
# Now use like native semgrep (the wrapper prepends the `semgrep` binary):
semgrep-docker scan --config p/default /src
semgrep-docker scan --json --metrics off --disable-version-check --config p/default --output /src/.scans/final-semgrep-results.json /src
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:

```bash
source skills/semgrep-scanner/scripts/semgrep-scanner-wrapper.sh
```

### Set Custom Working Directory

```bash
# Scan a different directory
SEMGREP_SCANNER_WORKDIR=/path/to/project semgrep-docker scan --config p/default /src
```

## Scan Workflow

### Step 1: Choose a Ruleset

| Ruleset | Content |
|---------|---------|
| `p/default` | Semgrep's default community rules (what the pipeline uses) |
| `p/security-audit` | High-confidence security rules only |
| `p/secrets` | Leaked-secret patterns in source |
| `p/owasp-top-ten` | OWASP Top 10 coverage |
| `p/<language>` | Per-language packs, e.g. `p/python`, `p/javascript` |

**Ruleset note**: `--config p/default` (and any `p/...` pack) **fetches rules
over the network at runtime** from the Semgrep registry. No login is required
for public packs, and `--metrics off` keeps usage analytics silent. Offline or
air-gapped runs must instead point `--config` at local rule files/directories
(e.g. `--config /src/.semgrep/`).

### Step 2: Run the Scan

```bash
# Standard pipeline invocation (JSON artifact under /src/.scans/)
semgrep-docker scan --json --metrics off --disable-version-check --config p/default --output /src/.scans/final-semgrep-results.json /src

# Multiple rulesets
semgrep-docker scan --json --metrics off --config p/default --config p/secrets /src

# Human-readable terminal output (no artifact)
semgrep-docker scan --config p/default /src
```

### Step 3: Understand Findings

Each Semgrep finding carries a rule ID (e.g.
`python.lang.security.audit.subprocess-shell-true.subprocess-shell-true`), a
**per-rule severity**, and the `file:line` location of the match:

| Severity | Meaning | Pipeline mapping |
|----------|---------|------------------|
| `ERROR` | Likely a real vulnerability | Major (elevate to Critical for injection/RCE/hardcoded-secret patterns) |
| `WARNING` | Suspicious pattern needing review | Minor |
| `INFO` | Informational | Nit |

#### Exit Codes (informational only)

Semgrep exits `0` whether or not findings exist (live-verified on the pinned
digest: 3 findings, exit 0) unless CI explicitly opts into a gate such as
`--error` or `--severity`; other non-zero codes indicate errors. In the
pipeline **treat any non-zero exit as informational, not authoritative** —
the **findings come from the JSON artifact** at
`/src/.scans/final-semgrep-results.json` (`results[].check_id`,
`results[].path`, `results[].start.line`, `results[].extra.severity`), and
the exit code is not the oracle for whether the scan "passed".

**Important**: Use `--output /src/.scans/<filename>` to persist results to the
host filesystem (inside the `/src` mount). Without this, results go to stdout.
Paths outside `/src/` are lost when the container exits; paths inside `/src`
but outside `.scans/` would persist and could overwrite project files via the
writable mount — which is exactly why the wrapper enforces that output files
must live under the dedicated `/src/.scans/` subdirectory (and rejects the
`-o` short form entirely), so fixed, non-colliding artifact names cannot
overwrite an existing project file.

## Reporting Findings

Structure findings reports like this:

```markdown
## Semgrep SAST Report

### Configuration
- **Runtime**: Podman container (docker.io/semgrep/semgrep@sha256:b94b53d02fd4a022f9eac4e2af1380f5c3c4c21400e79d3336bdff1d1db5e796)
- **Ruleset**: p/default
- **Format**: JSON

### Overview
| Total Findings | ERROR | WARNING | INFO |
|----------------|-------|---------|------|
| 12             | 2     | 7       | 3    |

### Findings

#### [Major] subprocess-shell-true -- app/server.py:42
- **Rule**: python.lang.security.audit.subprocess-shell-true.subprocess-shell-true
- **Severity**: ERROR → Major
- **Fix**: Pass an argument list and set `shell=False`

### Recommendations
1. [Major] Fix the two ERROR findings immediately
2. [Minor] Review WARNING findings; file follow-ups where intentional
```

## Hard Rules

- [x] **Always pull first**: `podman image exists ... || podman pull ...`
- [x] **Always mount with SELinux**: `-v "${PWD}:/src:Z"` (`:Z` flag for SELinux systems)
- [x] **Always use `--rm`** to clean up the container
- [x] **Always use `/src` paths** for all file targets inside the container
- [x] **Always pass the `semgrep` binary name** after the image (no ENTRYPOINT in this image; the wrapper does it)
- [x] **Use `--output /src/.scans/<file>`** to persist results to host; `-o` is rejected by the wrapper
- [x] **Read-only operation** -- never modify project source files; only write scan artifacts (e.g. via `--output /src/.scans/...`)
- [x] **`--metrics off --disable-version-check`** for quiet, reproducible pipeline runs

## Performance & Opt-out

`p/default` scans every recognized source file. On large projects a Semgrep
pass can exceed ~2 minutes (rule download + parse + match). If it is too
slow for a given project:

- Narrow the ruleset (`p/security-audit`) or target subpaths instead of `/src`.
- To disable just the semgrep leg without blocking the pipeline, remove the
  Semgrep scan from the Stage 5 suite: the `code-security-scanner` agent
  treats each tool independently, so dropping its semgrep wrapper-source and
  invocation grants (and its "Run the scans" chain) makes the suite degrade
  to two tools, OSV-Scanner + Trivy -- the other tools still count and the
  pipeline never blocks on this. Note: a *removed* leg yields **no** "scans
  skipped" note (that note is only emitted for a *configured* leg whose
  infrastructure fails at run time); the suite simply runs with two tools.

## Key References

| Topic | Location |
|-------|----------|
| GitHub repo | https://github.com/semgrep/semgrep |
| Documentation | https://semgrep.dev/docs/ |
| Rule registry (packs) | https://semgrep.dev/r |
| Exit codes | https://semgrep.dev/docs/cli-reference/ |
| Wrapper script | `scripts/semgrep-scanner-wrapper.sh` |

## Tips & Best Practices

1. **Start with `p/default`**: it is the pipeline's fixed ruleset and covers the common OWASP-style patterns
2. **Use JSON output in CI**: `--json --output /src/.scans/<file>` for programmatic processing
3. **Don't chase exit codes**: read the JSON artifact for authoritative findings
4. **Add a `.semgrepignore`** at the project root to skip vendor/test trees (Semgrep honors it natively)
5. **Pair with the other legs**: Semgrep finds bad code patterns; OSV/Trivy find bad dependency versions — findings overlap little by design
