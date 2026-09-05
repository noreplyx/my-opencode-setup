---
name: pmd-scan
description: "Use when the user asks to run PMD, perform rule-based static code analysis on Java/JavaScript (and other) source, check for common programming flaws like empty catch blocks, unused variables, or unnecessary object creation, or run a Java/JS ruleset. Runs PMD via a Podman container (docker.io/pmdcode/pmd@sha256:e234f36a0a4b74a257c55f01acb512a9da7a135315446150281190ab1f4969dc) with zero local Java installation. Output formats: text, XML, JSON, CSV, HTML, SARIF, and more."
---

# PMD Skill (Podman)

## Purpose

Run [PMD](https://pmd.github.io) — an extensible multilanguage static code
analyzer — to find common programming flaws (empty catch blocks, unused
variables, unnecessary object creation, and more) in a project's source code.
**All via a Podman container** with zero local Java installation required. Uses
the official `docker.io/pmdcode/pmd@sha256:e234f36a0a4b74a257c55f01acb512a9da7a135315446150281190ab1f4969dc` image.

PMD is the rule-based static-analysis leg of the pipeline's Stage 5
multi-scanner security suite, complementing OSV-Scanner (lockfile CVEs),
Semgrep (pattern-based SAST), Trivy (working-tree vulns/misconfig/secrets),
and Gitleaks (git-history secrets). It is mainly concerned with **Java and
Apex**, but supports 16+ other languages including **JavaScript/TypeScript**
(ecmascript rules).

## Division of labor with Semgrep

Semgrep and PMD both do static analysis but are complementary, not
redundant:

- **Semgrep** = pattern-based SAST across many languages. It matches
  user-defined or registry patterns (injection, XSS, SSRF, hardcoded secrets)
  against source code, and is the pipeline's security-pattern leg.
- **PMD** = rule-based static analysis with its own built-in rulesets
  (400+ rules). It parses source into an AST and runs rules against it to
  find code-quality and correctness flaws (empty catch blocks, unused
  variables, unnecessary object creation, resource leaks). The pipeline's
  default ruleset is Java-focused (`category/java/errorprone.xml`); the
  JavaScript/ecmascript rulesets are available as an option.

Findings from the two tools overlap little by design: Semgrep finds
security-relevant patterns, PMD finds rule-based code flaws.

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick Java scan** | `pmd-docker check -d /src -R category/java/errorprone.xml` |
| **JSON output** | `pmd-docker check -d /src -R category/java/errorprone.xml -f json --report-file /src/.scans/results.json` |
| **Pipeline invocation** | `pmd-docker check -d /src -R category/java/errorprone.xml -f json --report-file /src/.scans/final-pmd-results.json` |
| **Shell wrapper** | Source `scripts/pmd-scanner-wrapper.sh` then run `pmd-docker ...` |
| **First-time setup** | `podman pull docker.io/pmdcode/pmd@sha256:e234f36a0a4b74a257c55f01acb512a9da7a135315446150281190ab1f4969dc` |
| **Check version** | `pmd-docker --version` |

## Quick Start

```bash
# Pull the image (first time only)
podman pull docker.io/pmdcode/pmd@sha256:e234f36a0a4b74a257c55f01acb512a9da7a135315446150281190ab1f4969dc

# Scan a project directory with the Java errorprone ruleset.
# NOTE: this image ships an ENTRYPOINT of `pmd`, so the binary name is NOT
# part of the command (the wrapper passes your args straight through).
podman run --rm -v "${PWD}:/src:Z" --workdir /src docker.io/pmdcode/pmd@sha256:e234f36a0a4b74a257c55f01acb512a9da7a135315446150281190ab1f4969dc \
  check -d /src -R category/java/errorprone.xml

# Scan with JSON output persisted to the host
podman run --rm -v "${PWD}:/src:Z" --workdir /src docker.io/pmdcode/pmd@sha256:e234f36a0a4b74a257c55f01acb512a9da7a135315446150281190ab1f4969dc \
  check -d /src -R category/java/errorprone.xml -f json --report-file /src/.scans/final-pmd-results.json
```

### Shell Wrapper (Recommended)

Source the included wrapper to avoid repeating the Podman incantation:

```bash
source ./skills/pmd-scan/scripts/pmd-scanner-wrapper.sh
# Now use like native pmd (the wrapper passes args straight through):
pmd-docker check -d /src -R category/java/errorprone.xml
pmd-docker check -d /src -R category/java/errorprone.xml -f json --report-file /src/.scans/final-pmd-results.json
```

Add to `~/.zshrc` or `~/.bashrc` for persistence:

```bash
source skills/pmd-scan/scripts/pmd-scanner-wrapper.sh
```

### Set Custom Working Directory

```bash
# Scan a different directory
PMD_SCANNER_WORKDIR=/path/to/project pmd-docker check -d /src -R category/java/errorprone.xml
```

## Scan Workflow

### Step 1: Choose a Ruleset

| Ruleset | Content |
|---------|---------|
| `category/java/errorprone.xml` | Java error-prone rules (what the pipeline uses) |
| `category/java/bestpractices.xml` | Java best-practice rules |
| `category/java/design.xml` | Java design rules |
| `category/java/security.xml` | Java security rules |
| `category/ecmascript/errorprone.xml` | JavaScript/TypeScript error-prone rules |
| `category/ecmascript/bestpractices.xml` | JavaScript/TypeScript best-practice rules |

Rulesets are referenced by their classpath path (e.g.
`category/java/errorprone.xml`), which the image resolves from its bundled
rules. Multiple rulesets can be combined with a comma or by repeating `-R`.

### Step 2: Run the Scan

```bash
# Standard pipeline invocation (JSON artifact under /src/.scans/)
pmd-docker check -d /src -R category/java/errorprone.xml -f json --report-file /src/.scans/final-pmd-results.json

# Multiple rulesets
pmd-docker check -d /src -R category/java/errorprone.xml,category/java/bestpractices.xml -f json --report-file /src/.scans/results.json

# Human-readable terminal output (no artifact)
pmd-docker check -d /src -R category/java/errorprone.xml
```

### Step 3: Understand Findings

Each PMD violation carries a `rule` (e.g. `EmptyCatchBlock`), a `priority`
(1 = High … 5 = Low), and the `beginline`/`endline` location:

| Priority | Meaning | Pipeline mapping |
|----------|---------|------------------|
| 1 | High | Critical |
| 2 | Medium High | Major |
| 3 | Medium | Minor |
| 4-5 | Medium Low / Low | Nit |

#### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No violations found |
| 1 | PMD exited with an exception |
| 2 | Usage error (invalid/missing command-line parameters) |
| 4 | At least one violation detected (unless `--no-fail-on-violation`) |
| 5 | At least one recoverable error occurred (parse/rule failure) |

In the pipeline **treat exit 4 as "violations found"** — the authoritative
findings come from the JSON artifact, and the exit code is the blocking signal
that a violation exists. Exit 5 (recoverable errors) means PMD had trouble
parsing a file or a rule failed; treat it as a tooling note and read the
artifact.

**Important**: Use `--report-file /src/.scans/<filename>` to persist results to the host
filesystem (inside the `/src` mount). Without this, results go to stdout.
Paths outside `/src/` are lost when the container exits; paths inside `/src`
but outside `.scans/` would persist and could overwrite project files via the
writable mount — which is exactly why the wrapper enforces that output files
must live under the dedicated `/src/.scans/` subdirectory (guarding
`--report-file` in space and `=` forms, and rejecting the `-r` short form
outright), so fixed, non-colliding artifact names cannot overwrite an
existing project file.

## Reporting Findings

Structure findings reports like this:

```markdown
## PMD Report

### Configuration
- **Runtime**: Podman container (docker.io/pmdcode/pmd@sha256:e234f36a0a4b74a257c55f01acb512a9da7a135315446150281190ab1f4969dc)
- **Ruleset**: category/java/errorprone.xml
- **Format**: JSON

### Overview
| Total Violations | Critical | Major | Minor | Nit |
|------------------|----------|-------|-------|-----|
| 3                | 0        | 1     | 2     | 0   |

### Findings

#### [Major] EmptyCatchBlock -- app/App.java:12
- **Rule**: EmptyCatchBlock (priority 2)
- **Fix**: Handle the exception or log it; do not leave the catch block empty
```

## Hard Rules

- [x] **Always pull first**: `podman image exists ... || podman pull ...`
- [x] **Always mount with SELinux**: `-v "${PWD}:/src:Z"` (`:Z` flag for SELinux systems)
- [x] **Always use `--rm`** to clean up the container
- [x] **Always use `/src` paths** for all file targets inside the container
- [x] **Use `--report-file /src/.scans/<file>`** to persist results to host; the wrapper guards `--report-file` (space and `=` forms) and rejects the `-r` short form
- [x] **Read-only operation** -- never modify project source files; only write scan artifacts (e.g. via `--report-file /src/.scans/...`)

## Performance & Opt-out

PMD parses every source file in the target, so large projects can take a
while. If the pmd leg is too slow for a given project, or its image cannot be
pulled, drop it per-tool without blocking the pipeline: remove its
wrapper-source and invocation grants from `agent/code-security-scanner.md`'s
`bash` allowlist (and the mirrored pair in `agent/verifier.md`) plus its "Run
the scans" chain — the other legs still run and the suite degrades to four
tools. A *removed* leg yields **no** "scans skipped" note (the leg no longer
exists; the note is only emitted for a *configured* leg whose infrastructure
fails at run time).

## Key References

| Topic | Location |
|-------|----------|
| GitHub repo | https://github.com/pmd/pmd |
| Documentation | https://docs.pmd-code.org/latest/ |
| CLI reference | https://docs.pmd-code.org/latest/pmd_userdocs_cli_reference.html |
| Java rules | https://docs.pmd-code.org/latest/pmd_rules_java.html |
| JavaScript rules | https://docs.pmd-code.org/latest/pmd_rules_ecmascript.html |
| Wrapper script | `scripts/pmd-scanner-wrapper.sh` |

## Tips & Best Practices

1. **Start with `category/java/errorprone.xml`**: it is the pipeline's fixed ruleset and covers the common correctness flaws
2. **Use JSON output in CI**: `-f json --report-file /src/.scans/<file>` for programmatic processing
3. **Don't chase exit codes**: read the JSON artifact for authoritative findings
4. **Add a `pmd.self-scan.marker`** at the project root to exclude the seeded fixture from whole-repo self-scans (the wrapper injects `--exclude-pattern` when present)
5. **Pair with the other legs**: PMD finds rule-based code flaws; Semgrep finds security patterns; OSV/Trivy find bad dependency versions; Gitleaks finds secrets in history — findings overlap little by design
