---
name: owasp-zap-scan
description: "Use when the user asks to run OWASP ZAP, perform DAST (dynamic application security testing) on a live web application or API, run a baseline or active scan against a reachable target URL, or check for live web vulnerabilities like XSS, SQLi, and CSRF. Runs ZAP's zap-baseline.py via a Podman container (ghcr.io/zaproxy/zaproxy@sha256:32962a6da25e004a0dba2239e12643085e0f4b4982f3ab3f99143b99326f3377) with zero local Java/installation. Output formats: JSON (-J), HTML (-r), markdown (-w). This is a STANDALONE opt-in skill, NOT a Stage 5 loop member."
---
# OWASP ZAP Skill (Podman) — DAST

## Purpose

Run [OWASP ZAP](https://www.zaproxy.org/) — the open-source web application
security scanner — to perform **DAST (Dynamic Application Security Testing)**
against a **live, reachable target URL** (a running web app or API) for
runtime-detectable issues such as XSS, SQL injection, CSRF, missing headers,
and exposed components. **All via a Podman container** with zero local Java or
ZAP installation. Uses the official `ghcr.io/zaproxy/zaproxy@sha256:32962a6da25e004a0dba2239e12643085e0f4b4982f3ab3f99143b99326f3377` image.

ZAP is a **standalone opt-in capability**, NOT a Stage 5 loop member: DAST
needs a live target URL the code-review loop does not have (the loop scans
static checkouts, and there is no containerized DAST target in the fixture),
so forcing it into the loop would break the live-e2e gate. It is invoked on
demand, exactly like the SonarQube deferral rationale ("needs a persistent
server URL/token") applied to ZAP.

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Baseline scan (JSON)** | `zap-docker -t <url> -J /src/.scans/zap-baseline.json` |
| **Baseline + HTML + markdown** | `zap-docker -t <url> -J /src/.scans/zap-baseline.json -r /src/.scans/zap-baseline.html -w /src/.scans/zap-baseline.md` |
| **Target via env** | `ZAP_TARGET=<url> zap-docker -J /src/.scans/zap-baseline.json` |
| **Shell wrapper** | Source `scripts/zap-scanner-wrapper.sh` then run `zap-docker ...` |
| **First-time setup** | `podman pull ghcr.io/zaproxy/zaproxy@sha256:32962a6da25e004a0dba2239e12643085e0f4b4982f3ab3f99143b99326f3377` |

## Quick Start

```bash
# Pull the image (first time only)
podman pull ghcr.io/zaproxy/zaproxy@sha256:32962a6da25e004a0dba2239e12643085e0f4b4982f3ab3f99143b99326f3377

# Run the baseline scan against a reachable target, saving JSON under /src/.scans/
podman run --rm -v "${PWD}:/src:Z" --workdir /src \
  ghcr.io/zaproxy/zaproxy@sha256:32962a6da25e004a0dba2239e12643085e0f4b4982f3ab3f99143b99326f3377 \
  zap-baseline.py -t https://example.com -J /src/.scans/zap-baseline.json
```

### Shell Wrapper (Recommended)

Source the included wrapper to avoid repeating the Podman incantation:

```bash
source ./skills/owasp-zap-scan/scripts/zap-scanner-wrapper.sh
# Now use like native ZAP baseline:
zap-docker -t https://example.com -J /src/.scans/zap-baseline.json
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:

```bash
source skills/owasp-zap-scan/scripts/zap-scanner-wrapper.sh
```

### Set Custom Working Directory

```bash
# Write reports under a different project's .scans/
ZAP_SCANNER_WORKDIR=/path/to/project zap-docker -t https://example.com -J /src/.scans/zap-baseline.json
```

## Target URL input and the reachability caveat

The target URL is supplied via `-t <url>` (or the `ZAP_TARGET` env var, which
the wrapper injects as `-t <url>` when no target flag is present).

**The target must be reachable from INSIDE the container.** ZAP runs on the
Podman default **bridge network**, so `http://localhost:<port>` inside the
container is the container's own localhost, not your host. For a host-local
web app, use the host's **LAN IP** (e.g. `http://192.168.1.20:<port>`), not
`localhost` or `127.0.0.1`. If the target is unreachable, ZAP still produces a
report but it will not contain the expected findings — treat that run as
informational and re-run with a correct reachable target.

## Scan Workflow

### Step 1: Run the Scan

```bash
# Baseline scan, JSON report under /src/.scans/
zap-docker -t https://example.com -J /src/.scans/zap-baseline.json

# Baseline scan with all three report formats
zap-docker -t https://example.com \
  -J /src/.scans/zap-baseline.json \
  -r /src/.scans/zap-baseline.html \
  -w /src/.scans/zap-baseline.md
```

### Step 2: Understand Findings

The JSON artifact (`-J`) is the authoritative report: a list of alerts, each
with `alert`, `riskdesc`, `confidence`, `url`, `cweid`, `wascid`, and evidence.
The HTML (`-r`) and markdown (`-w`) reports are human-readable renderings of
the same alerts.

| ZAP risk | Meaning | Pipeline mapping |
|----------|---------|------------------|
| High | Exploitable flaw (e.g. confirmed XSS/SQLi) | Critical/Major |
| Medium | Needs review | Minor |
| Low | Informational hardening | Nit |
| Informational | No actionable risk | Nit |

#### Graceful degradation (informational, non-blocking)

A baseline run against an **unreachable target**, or a run where the image
could not be pulled or ZAP exited non-zero, is **informational** — it is a
standalone opt-in scan, not a loop gate. The wrapper prints a `[zap]` note to
stderr and returns non-zero, but you should **read the report artifact, not
the exit code**: the JSON/HTML/markdown file under `/src/.scans/` is what
tells you what (if anything) ZAP actually observed. Do not treat a non-zero
exit or an empty report as a "clean" signal — confirm the target was reachable.

**Important**: Reports are written under `/src/.scans/` (the mounted host
directory) so they persist after the container exits. The wrapper **validates
by value** that every ZAP file-*write* flag path lives under `/src/.scans/`
(covering space, `=`, and short-form concatenated spellings, plus the argparse
long forms in both space and `=` spellings), so a fixed, non-colliding artifact
name cannot overwrite an existing project file or escape the project tree via
the writable mount. The guarded write flags are `-r`/`--report-html` (HTML),
`-J`/`--report-json` (JSON), `-w`/`--report-md` (markdown),
`-x`/`--report-xml` (XML), `-g`/`--gen-conf` (generated config), and
`-p`/`--progress` (progress file).
The `-a` flag is a boolean (include alpha rules) and takes no value, so any
value-carrying `-a=*`/`-a<path>` token, or a non-flag token following a bare
`-a`, is rejected outright (the legitimate bare `-a -J /src/.scans/...` is
preserved). The `-z`/`--zap-options` flag is a raw-option passthrough and is
rejected outright (fail-closed) so it cannot smuggle a write outside
`/src/.scans/`.

## Reporting Findings

Structure findings reports like this:

```markdown
## ZAP DAST Report

### Configuration
- **Runtime**: Podman container (ghcr.io/zaproxy/zaproxy@sha256:32962a6da25e004a0dba2239e12643085e0f4b4982f3ab3f99143b99326f3377)
- **Target**: https://example.com
- **Mode**: baseline scan
- **Format**: JSON (-J)

### Overview
| High | Medium | Low | Informational |
|------|--------|-----|---------------|
| 1    | 2      | 4   | 3             |

### High Findings

#### Cross-Site Scripting (XSS) — /search
- **Risk**: High
- **CWE**: 79
- **Evidence**: `<script>alert(1)</script>` reflected in the response
- **Action**: Sanitize/encode user-controlled output; add a CSP
```

## Hard Rules

- [x] **Always pull first**: `podman image exists ... || podman pull ...`
- [x] **Always mount with SELinux**: `-v "${PWD}:/src:Z"` (`:Z` flag for SELinux systems)
- [x] **Always use `--rm`** to clean up the container
- [x] **Always use `/src` paths** for all file targets inside the container
- [x] **Keep reports under `/src/.scans/`**: the wrapper validates `-r`, `-J`, `-w`, `-x`, `-g`, `-p` by value
- [x] **Target must be reachable from inside the container** (use the host's LAN IP for host-local apps)
- [x] **Read-only operation** -- ZAP only *reads* the target over HTTP; never modify target source
- [x] **Standalone opt-in**: NOT a Stage 5 loop leg; run it deliberately against a live target
- [x] **Graceful degradation** -- a failed/unreachable run is informational; read the artifact, not the exit code

## Key References

| Topic | Location |
|-------|----------|
| OWASP ZAP | https://www.zaproxy.org/ |
| GitHub repo | https://github.com/zaproxy/zaproxy |
| Baseline scanner docs | https://www.zaproxy.org/docs/docker/ |
| Wrapper script | `scripts/zap-scanner-wrapper.sh` |

## Tips & Best Practices

1. **Point ZAP at a real reachable URL** — a running dev/staging instance, reached via the host's LAN IP, not `localhost`
2. **Use JSON output in CI**: `-J /src/.scans/<file>` for programmatic processing
3. **Don't chase exit codes**: read the report artifact; ZAP exits non-zero on a failed/unreachable run
4. **This is DAST, not a loop leg**: unlike the five static scanners, ZAP needs a live target and is invoked on demand
5. **Complement the static suite**: ZAP finds runtime issues (XSS/SQLi/headers) that OSV/Semgrep/Trivy/PMD cannot see in a static checkout
