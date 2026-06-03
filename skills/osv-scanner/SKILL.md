---
name: osv-scanner
description: "Run OSV-Scanner (Google's open-source vulnerability scanner) on projects to detect known vulnerabilities in dependencies, scan container images for OS-level and application CVEs, check license compliance, and perform offline vulnerability matching -- all via a Podman container with zero local Go installation. This skill triggers as a dependency vulnerability scanner within the orchestration pipeline Security Scan gate. Also use when the user asks to scan for dependency vulnerabilities, run osv-scanner, check for known CVEs in packages, scan container images for vulnerabilities, check open-source license compliance, perform software composition analysis (SCA), generate SBOMs in SPDX/CycloneDX format, or scan offline against a local vulnerability database. Supports scanning source code (lockfiles: package-lock.json, Cargo.lock, go.mod, Gemfile.lock, requirements.txt, pom.xml, and 20+ formats), container images (Debian, Ubuntu, Alpine), and archived images. Output formats: table, markdown, vertical, JSON, SARIF, HTML, SPDX, CycloneDX."
---

# OSV-Scanner Skill (Container-Based)

## Purpose

Run [OSV-Scanner](https://github.com/google/osv-scanner) -- Google's open-source vulnerability scanner -- to find known vulnerabilities in your project's dependencies, container images, and license compliance issues. **All via a Podman container** with zero local Go installation required. Uses the official `ghcr.io/google/osv-scanner:latest` image (v2.3.8+).

OSV-Scanner connects your project's list of dependencies to the [OSV.dev](https://osv.dev) vulnerability database, which covers vulnerabilities across 11+ package ecosystems (npm, PyPI, Go, Rust, Maven, RubyGems, NuGet, etc.), container OS packages (dpkg, APK), and includes C/C++ commit-level scanning.

## Why Container-Based?

- [x] **No local Go install** -- no go build, no version conflicts
- [x] **Isolated** -- runs in its own ephemeral environment, read-only access
- [x] **Reproducible** -- same osv-scanner version across all environments
- [x] **Auto-updates** -- pull the latest image to get new rules & scanner versions
- [x] **Official Google image** -- GHCR-hosted, actively maintained

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick source scan** | `osv-scanner-docker scan source -r .` |
| **Quick container scan** | See "Container Image Scanning" section below for two methods (archive or socket) |
| **JSON output** | `osv-scanner-docker --format json -L ./package-lock.json` |
| **Shell wrapper** | Source `scripts/osv-scanner-wrapper.sh` then run `osv-scanner-docker ...` |
| **First-time setup** | `podman pull ghcr.io/google/osv-scanner:latest` |
| **Check version** | `osv-scanner-docker --version` |

## Quick Start

```bash
# Pull the image (first time only)
podman pull ghcr.io/google/osv-scanner:latest

# Scan a project directory (auto-detects lockfiles)
podman run --rm -v "${PWD}:/src:Z" ghcr.io/google/osv-scanner:latest \
  scan source -r /src

# Scan a specific lockfile
podman run --rm -v "${PWD}:/src:Z" ghcr.io/google/osv-scanner:latest \
  scan source --lockfile=/src/package-lock.json

# Scan a container image (use archive method -- no socket needed)
podman save --format=docker-archive alpine:latest -o /tmp/alpine.tar && \
podman run --rm -v /tmp:/tmp:Z -v "${PWD}:/src:Z" \
  ghcr.io/google/osv-scanner:latest scan image --archive /tmp/alpine.tar
```

### Shell Wrapper (Recommended)

Source the included wrapper to avoid repeating the Podman incantation:

```bash
source skills/osv-scanner/scripts/osv-scanner-wrapper.sh
# Now use like native osv-scanner (for source scanning):
osv-scanner-docker scan source -r .
osv-scanner-docker --format json -L ./package-lock.json
osv-scanner-docker --licenses="MIT,Apache-2.0" .
# For container image scanning, see "Container Image Scanning" section below
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:
```bash
source /home/oat/.config/opencode/skills/osv-scanner/scripts/osv-scanner-wrapper.sh
```

### Set Custom Working Directory

```bash
# Scan a different directory
OSV_SCANNER_WORKDIR=/path/to/project osv-scanner-docker scan source -r /src
```

## Container Image Reference

| Attribute | Value |
|-----------|-------|
| **Image** | `ghcr.io/google/osv-scanner:latest` |
| **Pull command** | `podman pull ghcr.io/google/osv-scanner:latest` |
| **Image source** | https://github.com/google/osv-scanner/pkgs/container/osv-scanner |
| **Current version** | v2.3.8 (check with `--version`) |
| **Mount point** | Your code directory at `/src` |
| **Entrypoint** | `osv-scanner` binary |
| **Scan modes** | `scan source` (default), `scan image`, `fix` (guided remediation) |
| **Filesystem** | Read-only (output to stdout or `/src/<file>` to persist) |
| **Docker sock** | Mount `/var/run/docker.sock` for container image scanning |

## When to Use This Skill

Triggers **automatically** during every pipeline Security Scan gate as the dependency vulnerability scanner. Also triggers when:

- The user wants to **scan dependencies for known CVEs**
- The user asks about **software composition analysis (SCA)**
- The user wants to **run osv-scanner** on a project
- The user wants to **scan container images** for OS-level and application vulnerabilities
- The user needs **license compliance checking** (SPDX allowlist)
- The user wants **offline vulnerability scanning** (local databases, no network)
- The user asks about **SBOM generation** in SPDX or CycloneDX format
- The user needs **guided remediation** (auto-update vulnerable deps)
- The user wants to **check for known vulnerabilities** in npm, pip, Go, Rust, Maven, etc.
- The user asks about `osv-scanner.toml` config, `--licenses`, or `--offline-vulnerabilities`

## Scan Workflow

### Step 1: Determine Scan Target

| Target | Command | Use Case |
|--------|---------|----------|
| **Source directory** | `osv-scanner-docker scan source -r .` | Auto-detect all lockfiles |
| **Specific lockfile** | `osv-scanner-docker scan source -L ./package-lock.json` | Single lockfile scan |
| **Multiple lockfiles** | `osv-scanner-docker scan source -L ./Cargo.lock -L ./go.mod` | Multi-ecosystem projects |
| **Container image** | (requires raw `podman run` -- see below) | Container vulnerability scan |
| **Exported image** | (requires raw `podman run` -- see below) | Pre-exported image archive |
| **Git repo** | (auto-detected when scanning source) | C/C++ submodules + vendored code |

Detect the project type:
```bash
ls package-lock.json 2>/dev/null && echo "npm/yarn"
ls Cargo.lock 2>/dev/null && echo "Rust"
ls go.mod 2>/dev/null && echo "Go"
ls Gemfile.lock 2>/dev/null && echo "Ruby"
ls requirements.txt 2>/dev/null && echo "Python"
ls pom.xml 2>/dev/null && echo "Java/Maven"
ls composer.lock 2>/dev/null && echo "PHP"
```

### Step 2: Run the Scan

#### Source Scanning (Lockfiles + Dependencies)

```bash
# Recursive scan (auto-detect all lockfiles in subdirectories)
osv-scanner-docker scan source -r /src

# Scan with JSON output
osv-scanner-docker scan source -r --format json /src

# Scan specific lockfiles
osv-scanner-docker scan source -L /src/package-lock.json -L /src/Cargo.lock

# Scan with config override
osv-scanner-docker scan source -r --config /src/osv-scanner.toml /src

# Scan HTML output and serve locally
osv-scanner-docker scan source -r --serve /src

# Scan with all packages listed (SPDX/CycloneDX)
osv-scanner-docker scan source -r --all-packages --format spdx-2-3 /src

# Save output to file
osv-scanner-docker scan source -r --format json --output-file /src/results.json /src
```

#### Container Image Scanning

> **Note**: Container image scanning requires either Docker socket access or a pre-exported archive. The wrapper only mounts `$PWD:/src`, so container scanning requires raw `podman run` commands.

```bash
# Method 1: Direct image scan (requires docker.sock mounted)
# osv-scanner will call `docker save` internally, so mount the socket:
podman run --rm \
  -v "${PWD}:/src:Z" \
  -v /var/run/docker.sock:/var/run/docker.sock:Z \
  ghcr.io/google/osv-scanner:latest scan image alpine:latest

# Method 2: Scan from exported archive (recommended -- no socket needed)
# Step A: Export the image first using Podman
podman save --format=docker-archive alpine:latest -o /tmp/alpine.tar

# Step B: Scan the archive (mount the directory containing the tar)
podman run --rm \
  -v /tmp:/tmp:Z \
  -v "${PWD}:/src:Z" \
  ghcr.io/google/osv-scanner:latest scan image --archive /tmp/alpine.tar

# HTML output for container scans (best format for layered analysis)
podman run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock:Z \
  -v "${PWD}:/src:Z" \
  ghcr.io/google/osv-scanner:latest scan image --format html alpine:latest
```

#### License Scanning

```bash
# Show license summary
osv-scanner-docker --licenses /src

# Check against an SPDX allowlist
osv-scanner-docker --licenses="MIT,Apache-2.0,BSD-3-Clause" /src

# License scan with override config
osv-scanner-docker --licenses="MIT,Apache-2.0" --config /src/osv-scanner.toml /src
```

#### Offline Vulnerability Scanning

Useful for air-gapped environments or CI without network access:

```bash
# Step 1: Download offline databases (requires network)
osv-scanner-docker --offline-vulnerabilities --download-offline-databases /src

# Step 2: Scan offline (no network required)
osv-scanner-docker --offline /src

# Or scan vulnerabilities offline but allow network for other features
osv-scanner-docker --offline-vulnerabilities /src
```

The databases are cached at the standard OS cache directory inside the container. For persistent offline databases, mount a cache directory:

```bash
podman run --rm \
  -v "${PWD}:/src:Z" \
  -v "${HOME}/.cache/osv-scanner:/root/.cache/osv-scanner:Z" \
  ghcr.io/google/osv-scanner:latest --offline /src
```

#### Guided Remediation (Experimental)

> **Warning**: May trigger package manager scripts. Only use on trusted projects.

```bash
# Fix vulnerabilities in a Node.js project
osv-scanner-docker fix -M /src/package.json -L /src/package-lock.json

# Fix vulnerabilities in a Python project
osv-scanner-docker fix -M /src/requirements.txt -L /src/requirements.txt
```

### Step 3: Choose Output Format

| Flag | Format | Use Case |
|------|--------|----------|
| `--format table` | ASCII table (default) | Terminal viewing |
| `--format markdown` | Markdown table | PR comments, docs |
| `--format vertical` | Vertical list | Detailed per-package view |
| `--format json` | JSON | CI, programmatic processing |
| `--format sarif` | SARIF v2.1.0 | GitHub/VS Code Code Scanning |
| `--format html` | HTML (interactive) | Rich vulnerability analysis |
| `--serve` | HTML served on port 8000 | Interactive browser viewing |
| `--format spdx-2-3` | SPDX SBOM | SBOM generation (no vulns) |
| `--format cyclonedx-1-5` | CycloneDX SBOM | SBOM + vulnerabilities |

**Important**: Use `--output-file /src/<filename>` to persist results to the host filesystem (inside the `/src` mount). Without this, results go to stdout. Paths outside `/src/` are lost when the container exits.

### Step 4: Understand Findings

Each vulnerability finding includes:
- **OSV URL**: Link to the osv.dev entry (e.g., `https://osv.dev/GHSA-xxxx-xxxx-xxxx`)
- **CVSS**: CVSS v3 severity score
- **Ecosystem**: Which package ecosystem (npm, PyPI, Go, crates.io, etc.)
- **Package**: Name of the vulnerable package
- **Version**: Installed version
- **Fixed Version**: Version containing the fix (or `--` if no fix available)
- **Source**: Path to the lockfile/SBOM where the package originated

For container image scans, additionally:
- **Introduced Layer**: Which container layer introduced the package
- **In Base Image**: Whether the package comes from base image or was added

#### Exit Codes

| Code | Meaning | Pipeline Action |
|------|---------|-----------------|
| 0 | No vulnerabilities found | [x] PASS |
| 1 | Vulnerabilities found | [X] FAIL (block pipeline) |
| 127 | General error | [!] WARN |
| 128 | No packages found | [!] WARN (check scan target) |

### Step 5: Configuration (osv-scanner.toml)

Place an `osv-scanner.toml` file at the project root, or use `--config` to override:

```toml
# Ignore specific vulnerabilities
[[IgnoredVulns]]
id = "GO-2022-0968"
reason = "No SSH servers are connected to or hosted in Go"

[[IgnoredVulns]]
id = "GHSA-xxxx-xxxx-xxxx"
ignoreUntil = 2025-12-31
reason = "Awaiting upstream fix"

# Override packages
[[PackageOverrides]]
name = "internal-lib"
ignore = true
reason = "Internal package, not published"

[[PackageOverrides]]
name = "test-.*"
nameIsRegex = true
ignore = true
reason = "Test fixtures, not shipped"

# Override license detection
[[PackageOverrides]]
name = "old-package"
license.override = ["MIT"]
reason = "Actually MIT licensed despite SPDX mismatch"

# Override Go version (if auto-detection fails)
GoVersionOverride = "1.22.0"
```

### Step 6: SBOM Generation

Generate SBOMs without vulnerability data:

```bash
# SPDX v2.3
osv-scanner-docker scan source -r --all-packages --format spdx-2-3 \
  --output-file /src/sbom.spdx.json /src

# CycloneDX v1.5
osv-scanner-docker scan source -r --all-packages --format cyclonedx-1-5 \
  --output-file /src/sbom.cdx.json /src
```

### Step 7: Advanced Flags

```bash
# Skip git-ignored files
osv-scanner-docker scan source -r --no-ignore /src

# Include root git directories
osv-scanner-docker scan source -r --include-git-root /src

# Exclude specific paths (experimental)
osv-scanner-docker scan source -r \
  --experimental-exclude=test \
  --experimental-exclude=vendor \
  /src

# Transitive dependency resolution (default: on, disable with --no-resolve)
osv-scanner-docker scan source -r --no-resolve /src

# Call analysis (Go only by default; enable for Rust too)
osv-scanner-docker scan source -r --call-analysis=all /src

# Verbosity control
osv-scanner-docker scan source -r --verbosity info /src
osv-scanner-docker scan source -r --verbosity error /src

# Custom port for HTML server
osv-scanner-docker scan source -r --serve --port 9000 /src
```

## Reporting Findings

Structure findings reports like this:

```markdown
## OSV-Scanner Vulnerability Report

### Configuration
- **Runtime**: Podman container (ghcr.io/google/osv-scanner:latest, v2.3.8)
- **Mode**: Source scan (recursive)
- **Scanned paths**: /src (excluding .gitignore'd files)
- **Format**: JSON

### Overview
| Total Packages | Vulnerable | Critical | High | Medium | Low | Fixes Available |
|---------------|------------|----------|------|--------|-----|-----------------|
| 142           | 5          | 1        | 2    | 1      | 1   | 3               |

### Critical Findings

#### CVE-2024-XXXX -- lodash (npm)
- **Severity**: CRITICAL (CVSS: 9.8)
- **Installed**: 4.17.20
- **Fixed in**: 4.17.21
- **OSV**: https://osv.dev/GHSA-xxxx-xxxx-xxxx
- **Fix**: Update to lodash@4.17.21 (use `osv-scanner-docker fix` for guided remediation)

### High Findings

#### CVE-2024-YYYY -- golang.org/x/crypto (Go)
- **Severity**: HIGH (CVSS: 7.5)
- **Installed**: v0.14.0
- **Fixed in**: v0.17.0
- **OSV**: https://osv.dev/GHSA-yyyy-yyyy-yyyy
- **Fix**: Update to golang.org/x/crypto@v0.17.0

### Recommendations
1. [CRITICAL] Update lodash to 4.17.21 immediately -- actively exploited in the wild
2. [HIGH] Update golang.org/x/crypto to v0.17.0
3. [MEDIUM] Review ignored vulnerabilities in osv-scanner.toml -- remove expired ignoreUntil dates
4. [INFO] Add `--licenses` flag for license compliance check
5. [INFO] Generate SBOM for retrospective vulnerability analysis
```

## Pipeline Integration (Automatic)

This skill is a dependency vulnerability scanner that integrates into the pipeline Security Scan gate:

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
                            | SECRET GATE |
                            +-------------+
                                   |
                            +-------------+
                            | OSV-SCANNER | <- THIS SKILL
                            | DEP VULN    |
                            +-------------+
                                   |
                            +-------------+
                            | SBOM +      |
                            | SUPPLY CHAIN|
                            +-------------+
```

### How to Run in a Pipeline

```bash
# Pull if needed
podman image exists ghcr.io/google/osv-scanner:latest || \
  podman pull ghcr.io/google/osv-scanner:latest

# Run the scan
podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" \
  ghcr.io/google/osv-scanner:latest \
  scan source -r --format json /src

# Check exit code
# 0 = no vulnerabilities -> PASS
# 1 = vulnerabilities found -> FAIL pipeline
```

## Hard Rules

- [x] **Always pull first**: `podman image exists ... || podman pull ...`
- [x] **Always mount with SELinux**: `-v "${PWD}:/src:Z"` (`:Z` flag for SELinux systems)
- [x] **Always use `--rm`** to clean up the container
- [x] **Always use `/src` paths** for all file targets inside the container
- [x] **Use `--output-file /src/<file>`** to persist results to host
- [x] **Read-only operation** -- never modify project files during scanning
- [x] **Place `osv-scanner.toml`** at project root for project-specific config
- [x] **Use `--serve`** for interactive HTML vulnerability analysis of container images
- [x] **Use exported archives** (`--archive`) for container image scanning without Docker/Podman socket
- [x] **Never mount with write access** beyond the output directory
- [!] **Guided remediation (`fix`)** -- only run on trusted projects (executes package manager scripts)
- [!] **Call analysis for Rust** -- will execute build scripts (`build.rs`) in dependencies

## Container Image Scanning: Socket vs Archive

| Method | Requires | Pros | Cons |
|--------|----------|------|------|
| **Direct** (`scan image <name>:<tag>`) | Docker socket mounted | Simple one-liner | Needs socket access |
| **Archive** (`scan image --archive ./img.tar`) | Pre-exported `.tar` | No socket needed, fully isolated | Extra export step |

The archive method is **recommended for pipeline usage** since it doesn't require the Docker socket:

```bash
# Export + scan in one go
podman save --format=docker-archive my-image:latest -o /tmp/img.tar && \
podman run --rm -v /tmp:/tmp:Z -v "${PWD}:/src:Z" \
  ghcr.io/google/osv-scanner:latest scan image --archive /tmp/img.tar
```

## Key References

| Topic | Location |
|-------|----------|
| GitHub repo | https://github.com/google/osv-scanner |
| Documentation | https://google.github.io/osv-scanner/ |
| Supported formats | https://google.github.io/osv-scanner/supported-languages-and-lockfiles/ |
| Container scanning | https://google.github.io/osv-scanner/usage/scan-image |
| Output formats | https://google.github.io/osv-scanner/output/ |
| Offline mode | https://google.github.io/osv-scanner/usage/offline-mode/ |
| Configuration | https://google.github.io/osv-scanner/configuration/ |
| License scanning | https://google.github.io/osv-scanner/usage/license-scanning/ |
| Guided remediation | https://google.github.io/osv-scanner/experimental/guided-remediation/ |
| OSV database | https://osv.dev |
| Wrapper script | `scripts/osv-scanner-wrapper.sh` |
| Recipe reference | `references/recipes.md` |

## Related Skills

| Skill | Purpose | Relationship |
|-------|---------|--------------|
| `security-scan` | Combined security gate | Loads this skill as dependency vulnerability scanner |
| `semgrep-scan` | SAST vulnerability scanning | Runs alongside for source-level issues |
| `gitleaks-scan` | Secret detection | Runs alongside for credential leaks |

## Tips & Best Practices

1. **Start with recursive scan**: `osv-scanner-docker scan source -r .` -- it auto-detects everything
2. **Use JSON output in CI**: `--format json` for easy parsing
3. **Use `--serve` for deep analysis**: The HTML report has filtering, severity breakdown, and full advisory entries
4. **Pair with lockfile checks**: OSV-Scanner works best when lockfiles are committed to the repo
5. **Run regularly**: Vulnerability databases update frequently -- scan at least weekly
6. **Combine with `fix`**: After identifying vulnerabilities, use `osv-scanner-docker fix` for guided remediation
7. **Cache offline databases**: Mount a persistent volume for `OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY` to avoid re-downloading
8. **Use `experimental-exclude`**: Exclude test/vendor directories for faster scans in large projects
