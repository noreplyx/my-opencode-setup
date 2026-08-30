---
name: osv-scanner
description: "Use when the user asks to scan code for dependency vulnerabilities, run osv-scanner, check for known CVEs in packages, or perform software composition analysis (SCA) on lockfiles (package-lock.json, Cargo.lock, go.mod, Gemfile.lock, requirements.txt, pom.xml, and more). Runs Google's OSV-Scanner via a Podman container (ghcr.io/google/osv-scanner:latest) with zero local Go installation. Output formats: table, markdown, vertical, JSON, SARIF, HTML."
---

# OSV-Scanner Skill (Podman)

## Purpose

Run [OSV-Scanner](https://github.com/google/osv-scanner) -- Google's open-source vulnerability scanner -- to find known vulnerabilities in a project's dependencies by scanning lockfiles. **All via a Podman container** with zero local Go installation required. Uses the official `ghcr.io/google/osv-scanner:latest` image.

OSV-Scanner maps your lockfiles to the [OSV.dev](https://osv.dev) vulnerability database, covering 11+ package ecosystems (npm, PyPI, Go, Rust, Maven, RubyGems, NuGet, etc.).

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick source scan** | `osv-scanner-docker scan source -r .` |
| **Single lockfile** | `osv-scanner-docker scan source -L /src/package-lock.json` |
| **JSON output** | `osv-scanner-docker scan source -r --format json /src` |
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
```

### Shell Wrapper (Recommended)

Source the included wrapper to avoid repeating the Podman incantation:

```bash
source ./skills/osv-scanner/scripts/osv-scanner-wrapper.sh
# Now use like native osv-scanner:
osv-scanner-docker scan source -r .
osv-scanner-docker scan source -r --format json /src
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:

```bash
source skills/osv-scanner/scripts/osv-scanner-wrapper.sh
```

### Set Custom Working Directory

```bash
# Scan a different directory
OSV_SCANNER_WORKDIR=/path/to/project osv-scanner-docker scan source -r /src
```

## Scan Workflow

### Step 1: Detect Lockfiles

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

```bash
# Recursive scan (auto-detect all lockfiles in subdirectories)
osv-scanner-docker scan source -r /src

# Scan with JSON output
osv-scanner-docker scan source -r --format json /src

# Scan specific lockfiles
osv-scanner-docker scan source -L /src/package-lock.json -L /src/Cargo.lock

# Scan with config override
osv-scanner-docker scan source -r --config /src/osv-scanner.toml /src

# Save output to file (persists inside the /src mount)
osv-scanner-docker scan source -r --format json --output-file /src/results.json /src

# Exclude test/vendor directories for faster scans
osv-scanner-docker scan source -r \
  --experimental-exclude=test \
  --experimental-exclude=vendor \
  /src
```

### Step 3: Choose Output Format

| Flag | Format | Use Case |
|------|--------|----------|
| `--format table` | ASCII table (default) | Terminal viewing |
| `--format markdown` | Markdown table | PR comments, docs |
| `--format vertical` | Vertical list | Detailed per-package view |
| `--format json` | JSON | CI, programmatic processing |
| `--format sarif` | SARIF v2.1.0 | Code Scanning integration |
| `--format html` | HTML (interactive) | Rich vulnerability analysis |

**Important**: Use `--output-file /src/<filename>` to persist results to the host filesystem (inside the `/src` mount). Without this, results go to stdout. Paths outside `/src/` are lost when the container exits.

### Step 4: Understand Findings

Each vulnerability finding includes:
- **OSV URL**: Link to the osv.dev entry (e.g., `https://osv.dev/GHSA-xxxx-xxxx-xxxx`)
- **CVSS**: CVSS v3 severity score
- **Ecosystem**: Which package ecosystem (npm, PyPI, Go, crates.io, etc.)
- **Package**: Name of the vulnerable package
- **Version**: Installed version
- **Fixed Version**: Version containing the fix (or `--` if no fix available)
- **Source**: Path to the lockfile where the package originated

#### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No vulnerabilities found |
| 1 | Vulnerabilities found |
| 127 | General error |
| 128 | No packages found (check scan target) |

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
```

## Reporting Findings

Structure findings reports like this:

```markdown
## OSV-Scanner Vulnerability Report

### Configuration
- **Runtime**: Podman container (ghcr.io/google/osv-scanner:latest)
- **Mode**: Source scan (recursive)
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
- **Fix**: Update to lodash@4.17.21

### Recommendations
1. [CRITICAL] Update lodash to 4.17.21 immediately
2. [HIGH] Update golang.org/x/crypto to v0.17.0
3. [MEDIUM] Review ignored vulnerabilities in osv-scanner.toml -- remove expired ignoreUntil dates
```

## Hard Rules

- [x] **Always pull first**: `podman image exists ... || podman pull ...`
- [x] **Always mount with SELinux**: `-v "${PWD}:/src:Z"` (`:Z` flag for SELinux systems)
- [x] **Always use `--rm`** to clean up the container
- [x] **Always use `/src` paths** for all file targets inside the container
- [x] **Use `--output-file /src/<file>`** to persist results to host
- [x] **Read-only operation** -- never modify project source files; only write scan artifacts (e.g. via `--output-file /src/...`)
- [x] **Place `osv-scanner.toml`** at project root for project-specific config

## Key References

| Topic | Location |
|-------|----------|
| GitHub repo | https://github.com/google/osv-scanner |
| Documentation | https://google.github.io/osv-scanner/ |
| Supported formats | https://google.github.io/osv-scanner/supported-languages-and-lockfiles/ |
| Output formats | https://google.github.io/osv-scanner/output/ |
| Configuration | https://google.github.io/osv-scanner/configuration/ |
| OSV database | https://osv.dev |
| Wrapper script | `scripts/osv-scanner-wrapper.sh` |

## Tips & Best Practices

1. **Start with recursive scan**: `osv-scanner-docker scan source -r .` -- it auto-detects everything
2. **Use JSON output in CI**: `--format json` for easy parsing
3. **Pair with lockfiles**: OSV-Scanner works best when lockfiles are committed to the repo
4. **Run regularly**: Vulnerability databases update frequently -- scan at least weekly
5. **Use `--experimental-exclude`**: Exclude test/vendor directories for faster scans in large projects
