---
name: trivy-scanner
description: "Use when the user asks to run Trivy, scan a filesystem or project for dependency vulnerabilities plus misconfigurations (Dockerfiles, Terraform/Kubernetes/Helm) and leaked secrets, or scan container images/configs. Runs Aqua Security's Trivy via a Podman container (docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969) with zero local installation. Output formats: table, JSON, SARIF, template."
---

# Trivy Skill (Podman)

## Purpose

Run [Trivy](https://trivy.dev) -- Aqua Security's scanner -- to find
**dependency vulnerabilities**, **misconfigurations** (Dockerfiles,
Terraform, Kubernetes, Helm, cloud config), and **leaked secrets** in a
project's filesystem. **All via a Podman container** with zero local
installation required. Uses the official `docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969` image.

Trivy is the multi-surface leg of the pipeline's Stage 5 multi-scanner
security suite, complementing OSV-Scanner (lockfile CVEs) and Semgrep
(code-pattern SAST) with its own vuln DB, misconfig rules, and secret rules.

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick fs scan (all three scanners)** | `trivy-docker fs --scanners vuln,misconfig,secret /src` |
| **JSON output** | `trivy-docker fs --scanners vuln,misconfig,secret --format json --output /src/.scans/results.json /src` |
| **Pipeline invocation** | `trivy-docker fs --scanners vuln,misconfig,secret --format json --output /src/.scans/final-trivy-results.json /src` |
| **Shell wrapper** | Source `scripts/trivy-scanner-wrapper.sh` then run `trivy-docker ...` |
| **First-time setup** | `podman pull docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969` |
| **Check version** | `trivy-docker --version` |

## Quick Start

```bash
# Pull the image (first time only)
podman pull docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969

# Scan a project directory (vuln + misconfig + secret)
podman run --rm -v "${PWD}:/src:Z" -v trivy-cache:/root/.cache/trivy:Z \
  --workdir /src docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 \
  fs --scanners vuln,misconfig,secret /src

# Save output to file (persists inside the /src mount, under /src/.scans/)
podman run --rm -v "${PWD}:/src:Z" -v trivy-cache:/root/.cache/trivy:Z \
  --workdir /src docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 \
  fs --scanners vuln,misconfig,secret --format json --output /src/.scans/final-trivy-results.json /src
```

### Shell Wrapper (Recommended)

Source the included wrapper to avoid repeating the Podman incantation:

```bash
source ./skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh
# Now use like native trivy:
trivy-docker fs --scanners vuln,misconfig,secret /src
trivy-docker fs --scanners vuln,misconfig,secret --format json --output /src/.scans/final-trivy-results.json /src
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:

```bash
source skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh
```

### Set Custom Working Directory

```bash
# Scan a different directory
TRIVY_SCANNER_WORKDIR=/path/to/project trivy-docker fs --scanners vuln,misconfig,secret /src
```

## Cache, Timeout, and Exclusions (wrapper-managed)

- **Vuln DB download needs network**: on the first run Trivy downloads its
  vulnerability database (~60 MB) and misconfig check bundle before scanning.
  These are cached in the **`trivy-cache` named volume** mounted at
  `/root/.cache/trivy`, so subsequent runs (and pipeline passes) reuse them
  and can work against a stale-but-present DB. The wrapper creates the volume
  if missing (`podman volume exists trivy-cache || podman volume create trivy-cache`).
- **`TRIVY_TIMEOUT` defaults to `10m`** (injected by the wrapper with `-e
  TRIVY_TIMEOUT="${TRIVY_TIMEOUT:-10m}"`). It applies to the **whole scan**
  (DB download included), not per-request. Override: `TRIVY_TIMEOUT=15m ...`.
- **Prior artifacts are never re-scanned**: the wrapper injects
  `--skip-dirs /src/.scans` ahead of your arguments on `fs` scans so Trivy
  cannot ingest earlier OSV/Semgrep/Trivy artifacts as inputs. (The pinned
  Trivy build rejects the older `--exclude` flag with "unknown flag" —
  `--skip-dirs` is its live-verified equivalent.)

### ⚠ Secret-Scan Sensitivity

**`final-trivy-results.json` contains unredacted secret-adjacent context
lines.** Trivy's secret findings embed several lines of surrounding file
content in the `Code` metadata so humans can judge the match. Treat the
artifact as **sensitive material**: keep `.scans/` gitignored — this repo's
own `.gitignore` covers scans *of this repo*, but that protection is
repo-local, so every scanned **target project** must carry its own
`.scans/` ignore entry (the scanner agent pre-flights for it and reports a
missing one as a Major) — never commit, paste, or forward the raw artifact,
and when reporting secret findings cite **only** `file:line` and the rule ID
(plus the matcher name where present) — never quote the `Code` snippet.

## Scan Workflow

### Step 1: Run the Scan

```bash
# Standard pipeline invocation (JSON artifact under /src/.scans/)
trivy-docker fs --scanners vuln,misconfig,secret --format json --output /src/.scans/final-trivy-results.json /src

# Table output for terminal viewing
trivy-docker fs --scanners vuln,misconfig,secret /src
```

### Step 2: Understand Findings

The JSON artifact groups `Results[]` by target, each with `Vulnerabilities[]`
(`PkgName`, `InstalledVersion`, `FixedVersion`, `VulnerabilityID`,
`Severity`), `Misconfigurations[]` (`Type`, `Title`, `Severity`,
`Resolution`), and `Secrets[]` (`RuleID`, `Category`, `Location` — and the
sensitive `Code` context described above).

| Severity (Trivy) | Meaning | Pipeline mapping |
|------------------|---------|------------------|
| `CRITICAL` | Known exploitable flaw / bad practice | Critical |
| `HIGH` | Significant risk | Major |
| `MEDIUM` | Needs review | Minor |
| `LOW` | Informational | Nit |
| *(secret rule match)* | Credential material in a file | **Always Critical (blocking)** |

#### Exit Codes (informational only)

Trivy exits `0` even when findings exist — its default `--exit-code` gate is
`0`, so findings are printed but never change the exit status (live-verified
on the pinned 0.74.0 digest: 8 findings, exit 0). Non-zero exits mean
errors/timeouts (or an explicitly raised `--exit-code` gate in CI). In the
pipeline **treat any non-zero exit as informational** — authoritative
findings come from the JSON artifact, not the exit code.

**Important**: Use `--output /src/.scans/<filename>` to persist results to the
host filesystem (inside the `/src` mount). Without this, results go to stdout.
Paths outside `/src/` are lost when the container exits; paths inside `/src`
but outside `.scans/` would persist and could overwrite project files via the
writable mount — which is exactly why the wrapper enforces that output files
must live under the dedicated `/src/.scans/` subdirectory (and rejects the
`-o` short form entirely), so fixed, non-colliding artifact names cannot
overwrite an existing project file.

## Reporting Findings

Structure findings reports like this (secrets: file:line + rule ID only):

```markdown
## Trivy Report

### Configuration
- **Runtime**: Podman container (docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969)
- **Scanners**: vuln, misconfig, secret
- **Format**: JSON

### Overview
| Vulnerabilities | Misconfigurations | Secrets | Critical | High | Medium | Low |
|-----------------|-------------------|---------|----------|------|--------|-----|
| 4               | 3                 | 1       | 2        | 3    | 2      | 1   |

### Critical Findings

#### [Critical] GHSA-vh95-rmgr-6w4m -- minimist (npm)
- **Installed**: 1.2.0 / **Fixed in**: 1.2.6
- **Fix**: Bump minimist via lockfile regeneration

#### [Critical] Secret leak -- config/settings.yaml:3
- **Rule**: github-pat (GitHub Personal Access Token)
- **Action**: Rotate the credential and remove it from source; report location only, never the value

### Recommendations
1. [CRITICAL] Rotate and remove the leaked credential (file:line above)
2. [CRITICAL] Update minimist to >=1.2.6
3. [HIGH] Pin the Dockerfile base image by digest
```

## Hard Rules

- [x] **Always pull first**: `podman image exists ... || podman pull ...`
- [x] **Always mount with SELinux**: `-v "${PWD}:/src:Z"` (`:Z` flag for SELinux systems)
- [x] **Always mount the cache**: `-v trivy-cache:/root/.cache/trivy:Z` (wrapper-managed)
- [x] **Always use `--rm`** to clean up the container
- [x] **Always use `/src` paths** for all file targets inside the container
- [x] **Use `--output /src/.scans/<file>`** to persist results to host; `-o` is rejected by the wrapper
- [x] **Read-only operation** -- never modify project source files; only write scan artifacts (e.g. via `--output /src/.scans/...`)
- [x] **Never quote secret snippets**: report file:line + rule ID only; the artifact itself is sensitive

## Performance & Opt-out

The first pass pays the vuln-DB/check-bundle download (network); later passes
reuse the `trivy-cache` volume. If the DB download **fails persistently**
(air-gapped network, registry mirror outage), users may drop the trivy leg
per-tool without blocking the pipeline: remove its wrapper-source and
invocation grants from `agent/code-security-scanner.md`'s `bash` allowlist
(and the mirrored pair in `agent/verifier.md`) plus its "Run the scans"
chain -- the other legs still run and the suite degrades to two tools,
OSV-Scanner + Semgrep. A *removed* leg yields **no** "scans skipped" note
(the leg no longer exists; the note is only emitted for a *configured* leg
whose infrastructure fails at run time). `TRIVY_TIMEOUT=10m` keeps a hung
download from wedging the pass regardless.

## Key References

| Topic | Location |
|-------|----------|
| GitHub repo | https://github.com/aquasecurity/trivy |
| Documentation | https://trivy.dev/latest/ |
| Secret scanning | https://trivy.dev/latest/docs/scanner/secret/ |
| Misconfiguration | https://trivy.dev/latest/docs/scanner/misconfiguration/ |
| Supported libs (vuln) | https://trivy.dev/latest/docs/coverage/ |
| Wrapper script | `scripts/trivy-scanner-wrapper.sh` |

## Tips & Best Practices

1. **Run all three scanners together** (`vuln,misconfig,secret`) in one pass — one DB warm-up, one artifact
2. **Use JSON output in CI**: `--format json --output /src/.scans/<file>` for programmatic processing
3. **Don't chase exit codes**: read the JSON artifact for authoritative findings
4. **Keep the cache volume around**: deleting `trivy-cache` re-pays the DB download
5. **Dedup against OSV**: Trivy's `vuln` results overlap OSV-Scanner findings by design — merge by package@version + CVE/GHSA ID
