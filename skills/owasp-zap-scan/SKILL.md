---
name: owasp-zap-scan
description: "Run OWASP ZAP (Zed Attack Proxy) web application security scans -- baseline, full active, and API scans -- via a Podman container (no local Java/ZAP install needed). This skill can be triggered as a pipeline step when a web application or API target URL is available for DAST testing. Use when the user asks to scan a web application for vulnerabilities, run ZAP, perform DAST scanning, run a baseline spider scan, run a full active scan against a web app, scan an API (OpenAPI/SOAP/GraphQL) for security issues, check for OWASP Top 10 vulnerabilities in a running web app, perform authenticated web app scanning, generate ZAP security reports (HTML/Markdown/JSON/XML), or integrate DAST scanning into a CI/CD pipeline. For filesystem/container/dependency vulnerability scanning (not web apps), use the trivy-scan skill instead. Supports three packaged scan scripts: zap-baseline.py (passive, CI-safe), zap-full-scan.py (active spider + attack), and zap-api-scan.py (OpenAPI/SOAP/GraphQL). Supports HTML, Markdown, XML, and JSON report output. Supports custom config files for fail/warn/ignore rule thresholds, context files for authenticated scanning, and scan hooks for custom behavior."
---

# OWASP ZAP Scan Skill (Container-Based)

## Purpose

Run [OWASP ZAP (Zed Attack Proxy)](https://www.zaproxy.org/) -- the world's most widely used web application security scanner -- to perform DAST (Dynamic Application Security Testing) on web applications and APIs -- **all via a Podman container** with zero local Java/ZAP installation needed. Uses the official `ghcr.io/zaproxy/zaproxy:stable` or `docker.io/zaproxy/zap-stable` image.

This skill is designed to be **automatically loaded by the Orchestrator** during pipelines that involve web application security testing -- after the application is built and deployed to a test environment. It can also be triggered manually for ad-hoc web app scanning.

## Why Container-Based?

- [x] **No local Java install** -- no JDK/JRE, no ZAP installation, no version conflicts
- [x] **Isolated** -- runs in its own environment, no interference with local tools
- [x] **Reproducible** -- same ZAP version across all environments (stable/weekly/nightly/bare)
- [x] **Auto-updates** -- pull the latest image to get new rules & ZAP versions
- [x] **Official images** -- actively maintained by the ZAP team at Checkmarx
- [x] **Packaged scan scripts** -- baseline, full, and API scans ready to use
- [x] **Podman-native** -- works with `--network host` for scanning localhost apps

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Baseline scan (passive, CI-safe)** | `ZAP_IMG="ghcr.io/zaproxy/zaproxy:stable"; podman run --rm --network host -v "${PWD}:/zap/wrk/:Z" "$ZAP_IMG" zap-baseline.py -t https://example.com -r report.html` |
| **Full active scan** | `podman run --rm --network host -v "${PWD}:/zap/wrk/:Z" ghcr.io/zaproxy/zaproxy:stable zap-full-scan.py -t https://example.com -r full-report.html` |
| **API scan (OpenAPI)** | `podman run --rm --network host -v "${PWD}:/zap/wrk/:Z" ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py -t https://example.com/openapi.json -f openapi -r api-report.html` |
| **Shell wrapper** | Source `scripts/zap-wrapper.sh` then run `zap-baseline -t https://example.com -r report.html` |
| **First-time setup** | `podman pull ghcr.io/zaproxy/zaproxy:stable` |

## Container Image Reference

| Attribute | Value |
|-----------|-------|
| **Stable image** | `ghcr.io/zaproxy/zaproxy:stable` or `docker.io/zaproxy/zap-stable` |
| **Weekly image** | `ghcr.io/zaproxy/zaproxy:weekly` or `docker.io/zaproxy/zap-weekly` |
| **Bare image (minimal, CI-friendly)** | `ghcr.io/zaproxy/zaproxy:bare` or `docker.io/zaproxy/zap-bare` |
| **Pull command** | `podman pull ghcr.io/zaproxy/zaproxy:stable` |
| **Mount point** | Reports/configs at `/zap/wrk/` inside container |
| **Network** | Use `--network host` to scan localhost/127.0.0.1 targets |
| **Packed scan scripts** | `zap-baseline.py`, `zap-full-scan.py`, `zap-api-scan.py` |
| **Entrypoint** | `/bin/sh` (scripts must be passed as command) |
| **Healthcheck** | Supported; set `ZAP_PORT` if using non-default port |

### Choosing the Right Image

| Image | Update Frequency | Size | Best For |
|-------|-----------------|------|----------|
| **stable** | Monthly | ~600MB | Production CI/CD, most users |
| **bare** | Monthly (same as stable) | ~350MB | Minimal CI/CD, fast pulls |
| **weekly** | Weekly | ~600MB | Early access to new ZAP features |
| **nightly** | Daily | ~600MB | Bleeding edge, testing new rules |

**Bare image note**: The `bare` image contains only the minimum dependencies to run ZAP -- it does NOT include the packaged scan scripts (`zap-baseline.py`, `zap-full-scan.py`, `zap-api-scan.py`). If you need the packaged scans, use `stable`, `weekly`, or `nightly`.



## When NOT to Use This Skill

This skill is for **web application and API DAST scanning** via OWASP ZAP. Do NOT use it when:

- **Scanning filesystems or project directories** for dependency vulnerabilities -- use the `trivy-scan` skill instead
- **Scanning container images** for CVEs -- use the `trivy-scan` skill instead
- **Running SAST on source code** for security bugs -- use the `semgrep-scan` skill instead
- **Scanning git history for leaked secrets** -- use the `gitleaks-scan` skill instead
- **Checking IaC misconfigurations** (Dockerfile, K8s, Terraform) -- use the `trivy-scan` skill instead


## When to Use This Skill

This skill is **designed for automatic pipeline integration** when web application DAST scanning is needed. It also triggers when:

- The user wants to **scan a web application** for OWASP Top 10 vulnerabilities
- The user asks about **ZAP**, **Zed Attack Proxy**, or **DAST scanning**
- The user wants to **run a baseline spider scan** against a target URL
- The user wants to **run a full active scan** (spider + attack)
- The user wants to **scan an API** (OpenAPI, SOAP, or GraphQL)
- The user needs **authenticated scanning** with context files
- The user wants **HTML/Markdown/JSON/XML scan reports**
- The user asks about **web app security testing**, **penetration testing**, or **vulnerability assessment**
- The user wants to **integrate security scanning into CI/CD**

## ZAP Scan Types

### 1. Baseline Scan (`zap-baseline.py`)

A passive scan that runs the ZAP spider against a target URL (default: 1 minute), then waits for passive scanning to complete. **Does NOT perform any actual attacks**. Ideal for CI/CD and production environments.

**Characteristics:**
- [x] Passive only -- no attack payloads sent
- [T] Runs in a few minutes
- [x] CI/CD safe (can run against production)
- [S] Detects: missing security headers, cookie flags, info disclosure, etc.

### 2. Full Scan (`zap-full-scan.py`)

An active scan that runs the ZAP spider + optional AJAX spider, then performs a **full active scan** with attack payloads. **Potentially destructive**.

**Characteristics:**
- [!] Sends attack payloads (SQLi, XSS, command injection, etc.)
- [T] Can run for hours (no time limit by default)
- [X] CI/CD NOT safe for production
- [S] Detects: OWASP Top 10, injection flaws, XSS, CSRF, etc.

### 3. API Scan (`zap-api-scan.py`)

Tuned for scanning APIs defined by OpenAPI, SOAP, or GraphQL. Imports the API definition and runs an Active Scan against discovered endpoints.

**Characteristics:**
- [x] No spidering needed -- endpoints defined by API spec
- [!] Active scan tuned for APIs (skips web-specific checks like XSS)
- [i] Supports OpenAPI (JSON/YAML), SOAP (WSDL), GraphQL (schema)
- [S] Detects: API-specific vulnerabilities, server error codes, content type issues

## Quick Start

```bash
# Pull the stable image (first time only)
podman pull ghcr.io/zaproxy/zaproxy:stable

# Baseline scan (passive, safe for production)
podman run --rm --network host -v "${PWD}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t https://example.com -r baseline-report.html

# Full active scan
podman run --rm --network host -v "${PWD}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-full-scan.py -t https://example.com -r full-report.html

# API scan (OpenAPI)
podman run --rm --network host -v "${PWD}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py -t https://example.com/openapi.json -f openapi -r api-report.html
```

### Shell Wrapper (Recommended)

Source the included wrapper script to avoid repeating the podman incantation:

```bash
source skills/owasp-zap-scan/scripts/zap-wrapper.sh
# Now use like native ZAP scripts:
zap-baseline -t https://example.com -r report.html
zap-full-scan -t https://example.com -r full-report.html
zap-api-scan -t https://example.com/openapi.json -f openapi -r api-report.html
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:
```bash
source ./skills/owasp-zap-scan/scripts/zap-wrapper.sh
```

## Scan Workflow

### Step 1: Determine the Scan Type

Ask the user or check the context to determine which scan type to use:

| Situation | Recommended Scan |
|-----------|-----------------|
| First-time scan, production target, or CI/CD | **Baseline** (passive, safe) |
| Internal/staging app, want thorough testing | **Full scan** (active, may be destructive) |
| REST/GraphQL/SOAP API | **API scan** |
| Web app with login forms | **Baseline or Full** with `-n context_file` |

### Step 2: Identify the Target

**For web applications:**
```bash
# Check if the app is running locally
curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT

# Check for docker-compose/podman-compose services
grep -r "ports:" docker-compose.yml compose.yaml 2>/dev/null | head -5

# Ask user for target URL if not obvious
```

**For APIs:**
```bash
# Check for OpenAPI/Swagger specs
ls openapi.yaml openapi.json swagger.yaml swagger.json api-docs/ 2>/dev/null

# Check for GraphQL endpoint
grep -r "graphql" routes/ app/ src/ 2>/dev/null
```

### Step 3: Run the Scan

#### Baseline Scan

Safe for any environment. Use when you want quick feedback without risk:

```bash
# Minimal baseline scan
zap-baseline -t https://example.com

# Baseline with HTML report
zap-baseline -t https://example.com -r baseline-report.html

# Baseline with multiple report formats
zap-baseline -t https://example.com \
  -r report.html \
  -w report.md \
  -x report.xml \
  -J report.json

# Baseline with config file (set FAIL/IGNORE rules)
zap-baseline -t https://example.com -c /zap/wrk/zap.conf

# Generate default config file first, then customize
zap-baseline -t https://example.com -g zap.conf

# Baseline with short output (no PASSes, no example URLs)
zap-baseline -t https://example.com -s

# Baseline with AJAX spider (for JS-heavy apps)
zap-baseline -t https://example.com -j -r report.html

# Baseline with alpha rules (bleeding edge)
zap-baseline -t https://example.com -a -r report.html
```

#### Full Active Scan

Thorough but potentially destructive. Only use against targets you own:

```bash
# Full scan with HTML report
zap-full-scan -t https://staging.example.com -r full-report.html

# Full scan with AJAX spider (for JS SPA apps)
zap-full-scan -t https://staging.example.com -j -r full-report.html

# Full scan with config file
zap-full-scan -t https://staging.example.com -c /zap/wrk/zap.conf -r full-report.html

# Full scan with alpha rules
zap-full-scan -t https://staging.example.com -a -r full-report.html

# Specify spider time limit (minutes)
zap-full-scan -t https://staging.example.com -m 10 -r full-report.html

# Include alpha and use AJAX spider
zap-full-scan -t https://staging.example.com -a -j -r full-report.html
```

#### API Scan

For REST APIs, GraphQL, and SOAP web services:

```bash
# OpenAPI from URL
zap-api-scan -t https://example.com/openapi.json -f openapi -r api-report.html

# OpenAPI from local file
zap-api-scan -t /zap/wrk/openapi.json -f openapi -r api-report.html

# GraphQL
zap-api-scan -t https://example.com/graphql -f graphql -r api-report.html

# GraphQL with schema file
zap-api-scan -t https://example.com/graphql -f graphql \
  --schema /zap/wrk/schema.graphqls -r api-report.html

# SOAP from WSDL URL
zap-api-scan -t https://example.com/service?wsdl -f soap -r api-report.html

# API scan with safe mode (skip active scan, baseline only)
zap-api-scan -t https://example.com/openapi.json -f openapi -S -r api-report.html

# API scan with host override (for local OpenAPI spec pointing to remote URLs)
zap-api-scan -t /zap/wrk/openapi.json -f openapi \
  -O localhost:8080 -r api-report.html
```

### Step 4: Custom Configuration

Create a configuration file to control which alerts FAIL, WARN, or IGNORE:

```bash
# Generate a default config file
zap-baseline -t https://example.com -g /zap/wrk/zap.conf

# The generated file looks like:
#0    WARN    (Directory Browsing - Active/release)
#10010    WARN    (Cookie No HttpOnly Flag - Passive/release)
#...

# Edit the config to change rules:
# - Change WARN to FAIL to make it block the pipeline
# - Change WARN to IGNORE to skip a rule entirely

# Run with the customized config
zap-baseline -t https://example.com -c /zap/wrk/zap.conf -r report.html
```

### Step 5: Authenticated Scanning

For applications that require login, use a context file:

```bash
# Create a context file that defines authentication
# See: https://www.zaproxy.org/docs/desktop/start/features/contexts/

# Run scan with context file
zap-baseline -t https://example.com -n /zap/wrk/my.context -U testuser -r report.html
zap-full-scan -t https://example.com -n /zap/wrk/my.context -U testuser -r report.html
```

### Step 6: Interpreting Exit Codes

All three scan scripts use the same exit code convention:

| Exit Code | Meaning | Pipeline Action |
|-----------|---------|-----------------|
| 0 | Success (no FAILs, or all WARN) | [x] PASS |
| 1 | At least 1 FAIL (from config) | [X] FAIL -- block pipeline |
| 2 | At least 1 WARN, no FAILs | [!] WARN -- proceed with findings |
| 3 | Tool error / other failure | [X] FAIL -- investigate |

**Important**: By default, all alerts are reported as WARNings. To make specific alerts fail the pipeline, use `-c config_file` and set rules to FAIL.

### Step 7: Scanning Localhost Applications

When the web app runs on localhost, use `--network host`:

```bash
# App running on localhost:3000
podman run --rm --network host -v "${PWD}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://localhost:3000 -r report.html

# App running in another container - use podman container name or IP
podman run --rm --network host -v "${PWD}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://my-app:8080 -r report.html

# Scan app in podman-compose network
ZAP_NET="myapp_default"
podman run --rm --network "$ZAP_NET" -v "${PWD}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://web:3000 -r report.html
```

### Step 8: Custom Scan Hooks

For advanced customization, use Python hooks:

```bash
# Create a hooks.py file
zap-baseline -t https://example.com --hook /zap/wrk/hooks.py -r report.html
```

Hooks allow you to:
- Modify ZAP options before scanning
- Add custom scripts
- Run post-scan processing
- Override scanner behavior

## Parsing and Reporting Results

When reporting ZAP scan results, structure the output like this:

```markdown
## OWASP ZAP Scan Report

### Scan Configuration
- **Scan type**: <baseline/full/api>
- **Target**: <URL>
- **Image**: <ghcr.io/zaproxy/zaproxy:stable>
- **Config file**: <path or none>
- **Exit code**: <0, 1, 2, or 3>

### Summary
- **Total alerts**: <N>
  - FAIL: <N>
  - WARN: <N>
  - INFO: <N>
  - PASS: <N>

### Key Findings
| Alert | Risk Level | Rule ID | URL |
|-------|-----------|---------|-----|
| Missing X-Frame-Options | Medium | 10020 | / |
| Cookie Without Secure Flag | Low | 10011 | /login |
| X-Content-Type-Options Missing | Low | 10021 | /api/* |

### Recommendations
1. Set `X-Frame-Options: DENY` on all responses
2. Add `Secure` flag to all cookies
3. Configure `X-Content-Type-Options: nosniff` header

### Report Files
- HTML: `baseline-report.html`
- JSON: `baseline-report.json`
- Markdown: `baseline-report.md`

### Pipeline Verdict
- [x] PASS / [X] FAIL (based on exit code)
```

## Pipeline Integration

### Orchestration Pipeline Auto-Load

When a web application is deployed to a test/staging environment during a pipeline, the Orchestrator loads this skill:

```bash
# 1. Pull image if needed
podman image exists ghcr.io/zaproxy/zaproxy:stable || podman pull ghcr.io/zaproxy/zaproxy:stable

# 2. Run baseline scan (safe for CI)
podman run --rm --network host -v "${WORKSPACE_ROOT}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t <APP_URL> -r /zap/wrk/zap-report.html
```

### Verdict (Pipeline Gate)

| Exit Code | Meaning | Pipeline Action |
|-----------|---------|-----------------|
| 0 | Success | [x] PASS -- proceed |
| 1 | At least 1 FAIL | [X] FAIL -- block pipeline |
| 2 | At least 1 WARN | [!] WARN -- proceed with findings |
| 3 | Tool error | [X] FAIL -- investigate |

### Hard Rules for OWASP ZAP

- [x] Always use `--network host` when scanning localhost applications
- [x] Mount the working directory to `/zap/wrk/` for report output and config files
- [x] Use `ghcr.io/zaproxy/zaproxy:stable` for production pipelines (monthly updates)
- [x] For CI/CD pipelines, prefer **baseline scan** (passive, safe)
- [x] Always pull the image first: `podman image exists ghcr.io/zaproxy/zaproxy:stable || podman pull ghcr.io/zaproxy/zaproxy:stable`
- [x] NEVER use `zap-full-scan.py` against production targets
- [x] For API scanning, ensure the API spec file is accessible (mount local files or use URL)
- [x] Report files are written to `/zap/wrk/` inside the container and appear in the mounted host directory

## Examples

### Example 1: Quick Baseline Scan

```bash
# Developer wants to check a staging site for OWASP Top 10
source ~/.config/opencode/skills/owasp-zap-scan/scripts/zap-wrapper.sh
zap-baseline -t https://staging.example.com -r baseline.html -J baseline.json
```

### Example 2: Full Active Scan of Internal App

```bash
# Full security audit of internal staging server
zap-full-scan -t http://staging.internal:8080 -j -a -r full-audit.html
```

### Example 3: API Security Scan

```bash
# Scan REST API from OpenAPI spec
zap-api-scan -t /zap/wrk/openapi.json -f openapi -r api-report.html
```

### Example 4: CI/CD Baseline Gate

```bash
# Pipeline gate: fail on any FAIL-level alert
zap-baseline -t https://staging.example.com -c /zap/wrk/ci.conf -r report.html
```

### Example 5: Scan Local Dev Server

```bash
# App running on localhost:3000
zap-baseline -t http://localhost:3000 -r dev-scan.html

# App in container named 'web' on network 'myapp'
podman run --rm --network myapp -v "${PWD}:/zap/wrk/:Z" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://web:3000 -r /zap/wrk/dev-scan.html
```

## References

- [ZAP Docker User Guide](https://www.zaproxy.org/docs/docker/)
- [ZAP Baseline Scan](https://www.zaproxy.org/docs/docker/baseline-scan/)
- [ZAP Full Scan](https://www.zaproxy.org/docs/docker/full-scan/)
- [ZAP API Scan](https://www.zaproxy.org/docs/docker/api-scan/)
- [ZAP Docker Images](https://www.zaproxy.org/docs/docker/about/)
- [ZAP GitHub](https://github.com/zaproxy/zaproxy)
- [OWASP ZAP Wiki](https://github.com/zaproxy/zaproxy/wiki)
- [Docker Hub: zaproxy/zap-stable](https://hub.docker.com/r/zaproxy/zap-stable)
- [Scan Hooks Documentation](https://www.zaproxy.org/docs/docker/scan-hooks/)
