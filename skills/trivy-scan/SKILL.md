---
name: trivy-scan
description: "Run Trivy vulnerability, misconfiguration, secret, and license scanning on projects, container images, filesystems, and git repositories via a Podman container (no local Trivy install needed). This skill triggers automatically as a mandatory sub-scan within the orchestration pipeline Security Scan gate -- alongside semgrep, gitleaks, and osv-scanner -- after Build Gate + Lint Gate pass. It runs container image scans, filesystem scans, git repository scans, IaC misconfiguration checks, secret detection, SBOM generation, and license compliance checks. Use also when the user asks to scan container images for CVEs, run Trivy, check for vulnerabilities, perform container security scanning, scan Dockerfiles/Podmanfiles for misconfigurations, generate SBOMs, check software licenses, scan Kubernetes manifests, or integrate vulnerability scanning into a CI/CD pipeline. Supports multiple targets: image, filesystem, repository, and SBOM. Supports scanners: vuln, misconfig, secret, license. Supports severity filtering (CRITICAL, HIGH, MEDIUM, LOW) and multiple output formats (table, json, sarif, template)."
---

# Trivy Scan Skill (Container-Based)

## Purpose

Run [Trivy](https://github.com/aquasecurity/trivy) -- the comprehensive open-source security scanner by Aqua Security -- on container images, filesystems, git repositories, and IaC configurations -- **all via a Podman container** with zero local installation required. Uses the official `docker.io/aquasec/trivy:latest` image.

This skill is **automatically loaded by the Orchestrator** during every pipeline's Security Scan gate (after Build + Lint + Code Quality gates pass) as a **mandatory vulnerability and misconfiguration scanning sub-gate**. It runs alongside semgrep SAST, gitleaks secret scanning, and OSV dependency scanning.

## Why Container-Based?

- [x] **No local install** -- no rpm/deb/apk, no Go toolchain, no version conflicts
- [x] **Isolated** -- runs in its own environment, read-only access to project files
- [x] **Reproducible** -- same Trivy version across all environments
- [x] **Auto-updates** -- pull the latest image to get fresh vulnerability database & Trivy versions
- [x] **Official image** -- 1B+ pulls, actively maintained by Aqua Security
- [x] **Podman-native** -- works with Podman socket for local container image scanning

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Scan filesystem (project dir)** | `TRIVY_IMG="docker.io/aquasec/trivy:latest"; podman run --rm -v "${PWD}:/src:Z" "$TRIVY_IMG" fs /src` |
| **Scan container image** | `podman run --rm -v /run/user/$(id -u)/podman/podman.sock:/var/run/docker.sock:Z docker.io/aquasec/trivy:latest image <image-name>` |
| **Scan with critical/high only** | `podman run --rm -v "${PWD}:/src:Z" docker.io/aquasec/trivy:latest fs --severity CRITICAL,HIGH --exit-code 1 /src` |
| **Shell wrapper** | Source `scripts/trivy-wrapper.sh` then run `trivy-docker fs .` |
| **First-time setup** | `podman pull docker.io/aquasec/trivy:latest` |

## Container Image Reference

| Attribute | Value |
|-----------|-------|
| **Image** | `docker.io/aquasec/trivy:latest` |
| **Pull command** | `podman pull docker.io/aquasec/trivy:latest` |
| **Also available** | `ghcr.io/aquasecurity/trivy:latest` |
| **Image source** | https://hub.docker.com/r/aquasec/trivy |
| **Mount point** | Your code directory at `/src` |
| **Entrypoint** | `trivy` binary (all subcommands available) |
| **Cache dir** | Trivy downloads vulnerability DB to `~/.cache/trivy/` inside container (consider mounting `trivy-cache` volume for speed) |
| **Read-only** | Project directory should be mounted read-only for filesystem scans |

### Cache Volume (Performance)

The Trivy vulnerability database is downloaded on first run (~40MB). To avoid re-downloading every scan:

```bash
# Create a persistent cache volume (one time)
podman volume create trivy-cache

# Use it in all subsequent scans
podman run --rm -v "${PWD}:/src:Z" -v trivy-cache:/root/.cache/trivy:Z \
  docker.io/aquasec/trivy:latest fs /src
```

## When to Use This Skill

Triggers **automatically** during every pipeline Security Scan gate. Also triggers when:

- The user wants to **scan container images** for vulnerabilities
- The user asks about **Trivy** or **container security scanning**
- The user wants to **scan project filesystem** (lock files, dependencies)
- The user asks about **IaC misconfigurations** (Dockerfile, K8s manifests, Terraform)
- The user wants to **generate SBOMs** or check **software licenses**
- The user wants to **scan git repositories** for vulnerabilities
- The user needs a **vulnerability report** in JSON/SARIF/HTML/table
- The user asks about **CVE scanning**, **supply chain security**, or **container image vulnerabilities**
- The Orchestrator is running a **pipeline** and needs vulnerability/misconfiguration scanning


## When NOT to Use This Skill

This skill is for **Trivy** scanning. Do NOT use it when:

- **Scanning for web application vulnerabilities** (XSS, SQLi, CSRF) -- use the `owasp-zap-scan` skill instead
- **Running SAST on source code** (pattern matching for security bugs) -- use the `semgrep-scan` skill instead
- **Scanning git history for leaked secrets** -- use the `gitleaks-scan` skill instead
- **Quick dependency audit** via OSV database -- the `osv-scanner` skill (lighter weight) may be faster for just lockfile scanning


## Trivy Targets

Trivy supports multiple scanning **targets** (what to scan):

| Target | Subcommand | Best For |
|--------|-----------|----------|
| **Filesystem** | `fs <path>` | Project directories, lock files, source code |
| **Container Image** | `image <name>` | Local/remote container images |
| **Repository** | `repo <url>` | Remote git repositories |
| **Rootfs** | `rootfs <path>` | Full filesystem scan (needs --rootfs) |
| **SBOM** | `sbom <file>` | Existing SPDX/CycloneDX SBOM files |
| **Kubernetes** | `k8s <resource>` | Kubernetes clusters, namespaces |

## Trivy Scanners

Each target supports one or more **scanners** (what to look for):

| Scanner | Flag | Detects |
|---------|------|---------|
| **Vulnerabilities** | `--scanners vuln` | CVEs in OS packages (dpkg, apk, rpm) and language deps (npm, pip, Go, Maven, etc.) |
| **Misconfigurations** | `--scanners misconfig` | IaC issues in Dockerfile, K8s, Terraform, CloudFormation |
| **Secrets** | `--scanners secret` | Hardcoded secrets, API keys, tokens |
| **License** | `--scanners license` | Software license compliance of dependencies |

Combine multiple scanners: `--scanners vuln,misconfig,secret`

## Quick Start

```bash
# Pull the image (first time only)
podman pull docker.io/aquasec/trivy:latest

# Scan a local project for vulnerabilities + misconfigurations
podman run --rm -v "${PWD}:/src:Z" docker.io/aquasec/trivy:latest \
  fs --scanners vuln,misconfig /src

# Scan a container image (using Podman socket)
podman run --rm \
  -v /run/user/$(id -u)/podman/podman.sock:/var/run/docker.sock:Z \
  docker.io/aquasec/trivy:latest image nginx:latest

# Scan with severity filter and non-zero exit code (CI mode)
podman run --rm -v "${PWD}:/src:Z" docker.io/aquasec/trivy:latest \
  fs --severity CRITICAL,HIGH --exit-code 1 /src
```

### Shell Wrapper (Recommended)

Source the included wrapper script to avoid repeating the podman incantation:

```bash
source ./skills/trivy-scan/scripts/trivy-wrapper.sh
# Now use like native trivy:
trivy-docker fs .
trivy-docker image nginx:latest
trivy-docker fs --severity CRITICAL --exit-code 1 .
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:
```bash
source skills/trivy-scan/scripts/trivy-wrapper.sh
```

## Scan Workflow

### Step 1: Determine the Target

First, understand what the user wants to scan:

```bash
# Check if project has lockfiles (filesystem scan candidate)
ls package.json requirements.txt go.mod Cargo.toml Gemfile composer.json 2>/dev/null

# Check if Dockerfile/Podmanfile exists (IaC misconfig candidate)
ls Dockerfile Containerfile 2>/dev/null

# Check if K8s manifests exist
ls *.yaml k8s/ deploy/ 2>/dev/null | head -5

# List available Podman images (container image scan candidate)
podman images
```

Choose the target based on what's found:

| Found | Recommended target |
|-------|-------------------|
| Lock files (package.json, requirements.txt, go.mod, etc.) | `fs /src` |
| Dockerfile, Containerfile, K8s YAML, Terraform | `fs /src` with `--scanners misconfig` |
| Running containers or local images | `image <name>` |
| Remote repository URL | `repo <url>` |

### Step 2: Choose Scanners and Options

```bash
# Scan vulnerabilities + misconfigurations + secrets together
trivy-docker fs --scanners vuln,misconfig,secret /src

# Scan only vulnerabilities (fastest)
trivy-docker fs --scanners vuln /src

# Scan only IaC misconfigurations
trivy-docker fs --scanners misconfig /src

# Scan only secrets
trivy-docker fs --scanners secret /src

# Scan licenses
trivy-docker fs --scanners license /src
```

### Step 3: Severity Filtering

Control the noise level by filtering severity:

```bash
# Only CRITICAL and HIGH (CI/CD gate)
trivy-docker fs --severity CRITICAL,HIGH --exit-code 1 /src

# All severities including MEDIUM and LOW
trivy-docker fs --severity CRITICAL,HIGH,MEDIUM,LOW /src

# Only CRITICAL (strictest gate)
trivy-docker fs --severity CRITICAL --exit-code 1 /src
```

**Exit codes** (with `--exit-code 1`):
| Exit Code | Meaning |
|-----------|---------|
| 0 | No findings at specified severity |
| 1 | Findings detected at specified severity |

Without `--exit-code`, Trivy always exits 0 regardless of findings.

### Step 4: Output Format

```bash
# Table format (default, human-readable)
trivy-docker fs /src

# JSON (programmatic consumption, CI artifacts)
trivy-docker fs --format json /src

# SARIF (GitHub code scanning, VS Code)
trivy-docker fs --format sarif /src

# HTML (human-readable report file)
trivy-docker fs --format template --template "@contrib/html.tpl" --output /src/trivy-report.html /src

# Write JSON to file
trivy-docker fs --format json --output /src/trivy-report.json /src
```

**Important**: When using `--output`, prefix paths with `/src/` (inside container mount) so files persist to the host.

### Step 5: Container Image Scanning

Trivy can scan local container images by talking to the Podman socket:

```bash
# 1. Scan a locally built/pulled image
podman run --rm \
  -v /run/user/$(id -u)/podman/podman.sock:/var/run/docker.sock:Z \
  docker.io/aquasec/trivy:latest image nginx:latest

# 2. Scan with severity filter
podman run --rm \
  -v /run/user/$(id -u)/podman/podman.sock:/var/run/docker.sock:Z \
  docker.io/aquasec/trivy:latest image --severity CRITICAL,HIGH --exit-code 1 my-app:latest

# 3. Scan by image ID
podman run --rm \
  -v /run/user/$(id -u)/podman/podman.sock:/var/run/docker.sock:Z \
  docker.io/aquasec/trivy:latest image sha256:abc123...

# 4. Scan remote registry image (no socket needed for public registries)
podman run --rm docker.io/aquasec/trivy:latest image docker.io/library/alpine:latest
```

**Rootless Podman socket path**: `/run/user/$(id -u)/podman/podman.sock`

If the socket path differs, find it with:
```bash
podman info | grep -A2 podman.sock
```

### Step 6: IaC Misconfiguration Scanning

Scan Infrastructure as Code files for security misconfigurations:

```bash
# Scan all IaC files in project
trivy-docker fs --scanners misconfig /src

# Scan specific IaC type
trivy-docker fs --scanners misconfig --misconfig-scanners dockerfile /src
trivy-docker fs --scanners misconfig --misconfig-scanners kubernetes /src
trivy-docker fs --scanners misconfig --misconfig-scanners terraform /src

# Include all IaC checks (including cloud)
trivy-docker fs --scanners misconfig --misconfig-scanners all /src

# Include cloudformation, arm, helm in scan
trivy-docker fs --scanners misconfig --misconfig-scanners all /src
```

### Step 7: SBOM (Software Bill of Materials)

Generate or scan SBOM documents:

```bash
# Generate CycloneDX SBOM from filesystem
trivy-docker fs --format cyclonedx --output /src/sbom.cdx.json /src

# Generate SPDX SBOM
trivy-docker fs --format spdx-json --output /src/sbom.spdx.json /src

# Scan an existing SBOM file
trivy-docker sbom /src/sbom.cdx.json

# Scan container image and output SBOM
trivy-docker image --format cyclonedx --output /src/image-sbom.cdx.json alpine:latest
```

### Step 8: Vulnerability Database Management

```bash
# Download/update vulnerability database (without scanning)
podman run --rm -v trivy-cache:/root/.cache/trivy:Z docker.io/aquasec/trivy:latest image --download-db-only alpine:latest

# Clear cache
podman volume rm trivy-cache
```

### Step 9: CI/CD Pipeline Integration

For blocking pipelines on findings:

```bash
# Gate: fail on any CRITICAL or HIGH
trivy-docker fs --severity CRITICAL,HIGH --exit-code 1 /src

# Gate: fail on any CRITICAL
trivy-docker fs --severity CRITICAL --exit-code 1 /src

# Non-blocking: report all findings, always pass
trivy-docker fs --severity CRITICAL,HIGH,MEDIUM,LOW --exit-code 0 /src

# Ignore unfixed/unpatchable vulnerabilities
trivy-docker fs --severity CRITICAL,HIGH --exit-code 1 --ignore-unfixed /src

# Scan only new changes since last scan (Trivy's built-in diff cache, not git diff)
trivy-docker fs --severity CRITICAL,HIGH --exit-code 1 /src
```

### Step 10: Custom Configurations

Trivy supports a config file (`trivy.yaml` or `--config`):

```bash
# Use a project-level trivy.yaml config file
trivy-docker fs --config /src/trivy.yaml /src

# Ignore specific vulnerabilities
trivy-docker fs --ignorefile /src/.trivyignore /src
```

`.trivyignore` format:
```
# Ignore specific CVEs
CVE-2023-12345
CVE-2024-67890

# Ignore with optional comment
CVE-2023-ABCDE until fix is released
```

### Step 11: Advanced Options

```bash
# Skip specific directories (performance)
trivy-docker fs --skip-dirs /src/node_modules --skip-dirs /src/.git /src

# Set timeout for slow scans
trivy-docker fs --timeout 5m /src

# Scan only specific files/packages (not recursive by default for files)
trivy-docker fs --file-patterns "pom.xml" /src

# Output verbose info (including dependency tree)
trivy-docker fs --verbose /src

# Show only remediated/fixed version info
trivy-docker fs --show-ignored /src
```

## Parsing and Reporting Results

When the user needs help interpreting Trivy scan results, structure the report like this:

```markdown
## Trivy Scan Report

### Configuration
- **Runtime**: Podman container (aquasec/trivy:latest)
- **Target**: <fs/image/repo>
- **Scanners**: <vuln, misconfig, secret, license>
- **Severity level**: <CRITICAL/HIGH/MEDIUM/LOW>
- **Exit code**: <0 or 1>

### Summary
- **Total vulnerabilities**: <N>
  - CRITICAL: <N>
  - HIGH: <N>
  - MEDIUM: <N>
  - LOW: <N>
- **Misconfigurations**: <N>
- **Secrets**: <N>
- **License issues**: <N>

### Top Critical/High Findings
| Package/File | Vulnerability | Severity | Fixed Version |
|-------------|---------------|----------|---------------|
| libssl | CVE-2024-XXXX | CRITICAL | 1.1.1w-r1 |
| express | CVE-2024-YYYY | HIGH | 4.19.0 |

### Recommendations
1. Update <pkg> to <version> to fix <N> critical vulnerabilities
2. Fix misconfiguration in <file>: <description>
3. Address <N> hardcoded secrets found in <files>

### Pipeline Verdict
- [x] PASS / [X] FAIL (based on severity threshold and exit code)
```

## Pipeline Integration

### Orchestration Pipeline Auto-Load

This skill is **automatically loaded** by the Orchestrator during every pipeline's Security Scan gate. The Orchestrator runs:

```bash
# 1. Pull image if needed
podman image exists docker.io/aquasec/trivy:latest || podman pull docker.io/aquasec/trivy:latest

# 2. Run filesystem vulnerability + misconfig scan
podman run --rm -v "${WORKSPACE_ROOT}:/src:Z" docker.io/aquasec/trivy:latest \
  fs --scanners vuln,misconfig --severity CRITICAL,HIGH --exit-code 1 /src
```

### Verdict (Pipeline Gate)

| Exit Code | Meaning | Pipeline Action |
|-----------|---------|-----------------|
| 0 | No findings at CRITICAL/HIGH | [x] PASS -- proceed to next scan |
| 1 | Findings detected | [X] FAIL -- block pipeline, report findings |
| 2+ | Tool error | [!] WARN -- log, proceed if tool unavailable |

### Hard Rules for Trivy

- [x] The Orchestrator MUST load `trivy-scan` skill during every pipeline as a mandatory sub-scan
- [x] The Trivy scan MUST use `--scanners vuln,misconfig` at minimum
- [x] The Trivy scan MUST use `--severity CRITICAL,HIGH` for pipeline gates
- [x] The Trivy scan MUST use `--exit-code 1` to block pipeline on findings
- [x] Always pull the image first: `podman image exists docker.io/aquasec/trivy:latest || podman pull docker.io/aquasec/trivy:latest`
- [x] NEVER modify project files during scanning
- [x] NEVER skip the Trivy scan -- it is mandatory
- [x] Use a persistent cache volume for the vulnerability database to speed up scans
- [x] For container image scanning, use Podman socket: `/run/user/$(id -u)/podman/podman.sock`

## Examples

### Example 1: Quick Vulnerability Scan During Development

```bash
# Developer wants to check for known CVEs in current project
source ~/.config/opencode/skills/trivy-scan/scripts/trivy-wrapper.sh
trivy-docker fs --scanners vuln --severity CRITICAL,HIGH .
```

### Example 2: Full Security Audit

```bash
# Comprehensive scan of project + IaC + secrets
trivy-docker fs --scanners vuln,misconfig,secret --severity CRITICAL,HIGH,MEDIUM \
  --format json --output /src/audit-report.json /src
```

### Example 3: Container Image Security Gate

```bash
# Before deploying a container image, scan it
trivy-docker image --severity CRITICAL,HIGH --exit-code 1 my-app:latest
```

### Example 4: SBOM Generation for Compliance

```bash
# Generate CycloneDX SBOM for compliance/audit
trivy-docker fs --format cyclonedx --output /src/sbom.cdx.json /src
```

### Example 5: CI Pipeline Gate

```bash
# Fail pipeline if any CRITICAL or HIGH vulnerability found (ignore unfixed/patchless)
trivy-docker fs --scanners vuln,misconfig --severity CRITICAL,HIGH \
  --exit-code 1 --ignore-unfixed /src

# Fail only on fixed vulnerabilities (stricter -- includes unfixed too)
trivy-docker fs --scanners vuln,misconfig --severity CRITICAL,HIGH \
  --exit-code 1 /src

# Non-blocking report for visibility
trivy-docker fs --scanners vuln,misconfig --severity CRITICAL,HIGH,MEDIUM \
  --exit-code 0 --format json --output /src/trivy-ci-report.json /src
```

## References

- [Trivy Official Docs](https://trivy.dev/)
- [Trivy GitHub](https://github.com/aquasecurity/trivy)
- [Trivy Docker Hub](https://hub.docker.com/r/aquasec/trivy)
- [Trivy Configuration](https://trivy.dev/docs/latest/configuration/)
- [Trivy Filters & Severity](https://trivy.dev/docs/latest/configuration/filter/)
- [OWASP Top 10 Container Security](https://owasp.org/www-project-kubernetes-top-10/)
