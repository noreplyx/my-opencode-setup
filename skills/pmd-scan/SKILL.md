---
name: pmd-scan
description: "Run PMD static code analysis on Java, Apex, JavaScript, Kotlin, Swift, PLSQL, and more languages via a Podman container (no local install needed). Use this skill whenever the user asks to run PMD, check code quality with PMD, find code style issues, detect common programming flaws (unused variables, empty catch blocks, unnecessary object creation), perform static analysis, run CPD (Copy/Paste Detector) for duplicate code detection, generate PMD violation reports, scan code for best-practice violations, or integrate PMD quality gates into a pipeline. Covers the official pmdcode/pmd container image workflow, shell wrapper alias, ruleset selection guidance, multi-language support, report format options (text, XML, HTML, CSV, SARIF, JSON), and CPD copy-paste detection — all through Podman with zero local Java or PMD installation."
---

# PMD Scan Skill (Container-Based)

## Purpose

Run [PMD](https://pmd.github.io/) static code analysis on project source code to detect common programming flaws, code style issues, unused variables, empty catch blocks, unnecessary object creation, and more — **all via a Podman container** with zero local installation required. The official `docker.io/pmdcode/pmd` image includes the full PMD CLI plus CPD (Copy/Paste Detector).

PMD supports **17+ languages**: Java, Apex, JavaScript, TypeScript, JSP, Kotlin, Swift, Scala, PLSQL, HTML, XML, XSL, Velocity, Visualforce, Modelica, Maven POM, WSDL.

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Quick Java scan** | `podman run --rm -v "${PWD}:/src:Z" docker.io/pmdcode/pmd:latest check -d /src -R rulesets/java/quickstart.xml` |
| **Shell wrapper** (recommended) | Add the `pmd-docker` alias below and run `pmd-docker check -d /src -R rulesets/java/quickstart.xml` |
| **First-time setup** | `podman pull docker.io/pmdcode/pmd:latest` |
| **Check version** | `podman run --rm docker.io/pmdcode/pmd:latest --version` |
| **Run CPD** | `podman run --rm -v "${PWD}:/src:Z" docker.io/pmdcode/pmd:latest cpd --minimum-tokens 100 --language java --dir /src` |

## Why Container-Based?

- ✅ **No local install** — no Java SDK, no PMD binary, no version conflicts
- ✅ **Isolated** — runs in its own environment, can't modify project files
- ✅ **Bundled** — includes all PMD rulesets for all languages
- ✅ **Reproducible** — same PMD version across all environments
- ✅ **Auto-updates** — pull the latest image to get new PMD versions & rules

## Quick Start

Pull the image once (first time only):

```bash
podman pull docker.io/pmdcode/pmd:latest
```

Then run a scan:

```bash
# Check version
podman run --rm docker.io/pmdcode/pmd:latest --version

# Quick Java scan with quickstart rules
podman run --rm -v "${PWD}:/src:Z" docker.io/pmdcode/pmd:latest \
  check -d /src -R rulesets/java/quickstart.xml

# Scan with XML output report
podman run --rm -v "${PWD}:/src:Z" docker.io/pmdcode/pmd:latest \
  check -d /src/src/main/java -R rulesets/java/quickstart.xml \
  -r /src/target/pmd-report.xml -f xml

# Scan with HTML report
podman run --rm -v "${PWD}:/src:Z" docker.io/pmdcode/pmd:latest \
  check -d /src -R rulesets/java/quickstart.xml \
  -r /src/target/pmd-report.html -f html
```

### Shell Wrapper (Recommended)

Create a helper function to avoid repeating the podman incantation:

```bash
# Add to ~/.zshrc or ~/.bashrc
pmd-docker() {
  local img="docker.io/pmdcode/pmd:latest"
  podman run --rm -v "${PWD}:/src:Z" "$img" "$@"
}
```

Then use it like native PMD:

```bash
# PMD check
pmd-docker check -d /src -R rulesets/java/quickstart.xml

# With custom ruleset file in the project
pmd-docker check -d /src -R /src/config/my-ruleset.xml

# CPD (copy-paste detection)
pmd-docker cpd --minimum-tokens 100 --language java --dir /src

# Write report to file
pmd-docker check -d /src -R rulesets/java/quickstart.xml -r /src/pmd-report.json -f json
```

## Container Image Reference

- **Image**: `docker.io/pmdcode/pmd:latest`
- **Mount point**: Your code directory must be mounted at `/src` inside the container
- **Working directory**: The container uses `/` by default; mount at `/src` and use `/src/...` paths
- **Output files**: Write to `/src/<filename>` to persist results to the host
- **Custom rules/jars**: Mount custom rule JARs at `/custom-pmd-libs`:
  ```bash
  podman run --rm -v "${PWD}:/src:Z" -v "/path/to/custom-rules:/custom-pmd-libs:Z" \
    docker.io/pmdcode/pmd:latest check -d /src -R rulesets/java/quickstart.xml
  ```
- **Cache for incremental analysis**: Speeds up subsequent scans
  ```bash
  podman run --rm -v "${PWD}:/src:Z" docker.io/pmdcode/pmd:latest \
    check -d /src -R rulesets/java/quickstart.xml --cache /src/.pmd-cache
  ```

## PMD CLI Reference

PMD's CLI command is `check`. Below is a quick-reference table for the most useful options.

| Option | Description | Default |
|--------|-------------|---------|
| `-d <path>` | **Required.** Source directory or file to scan | — |
| `-R <rulesets>` | **Required.** Path to ruleset XML file. Can repeat or comma-separate multiple | — |
| `-f <format>` | Report format (text, xml, html, csv, json, sarif) | text |
| `-r <file>` | Write report to file instead of stdout | — |
| `--cache <file>` | Cache path for incremental analysis (speeds up repeat scans) | — |
| `--use-version <lang-version>` | Set language version (e.g., `java-21`, `java-17`, `java-11`, `java-8`) | latest |
| `--force-language <lang>` | Force language for all files (e.g., `xml` for non-standard XML files) | — |
| `--minimum-priority <n>` | Minimum rule priority (1=highest, 5=lowest). Lower priority violations suppressed | — |
| `--aux-classpath <cp>` | Java classpath for type resolution (colon-separated paths or file: URL) | — |
| `--no-fail-on-violation` | Exit with 0 even if violations found | fail (exit 4) |
| `--no-fail-on-error` | Exit with 0 even if recoverable errors occur | fail (exit 5) |
| `-v` / `--verbose` | Verbose/debug log output | — |
| `-b` / `--benchmark` | Output benchmark report to stderr | — |
| `--help` | Show help | — |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No violations, no errors |
| 1 | Usage error (bad args) |
| 4 | Violations found (with `--fail-on-violation`, which is default) |
| 5 | Recoverable errors occurred |

## Choosing Rulesets

PMD bundles rulesets for each language under `rulesets/<language>/`. All paths are relative to PMD's classpath — they work out of the box inside the container.

### Java Rulesets

| Ruleset | Focus |
|---------|-------|
| `rulesets/java/quickstart.xml` | All Java rules (best practices, code style, design, documentation, error prone, multithreading, performance, security) — **start here** |
| `rulesets/java/bestpractices.xml` | Best practices (e.g., avoid using hard-coded literals, use try-with-resources) |
| `rulesets/java/codestyle.xml` | Code style (e.g., naming conventions, unnecessary imports, modifier order) |
| `rulesets/java/design.xml` | Design (e.g., excessive method length, too many fields, tight coupling) |
| `rulesets/java/errorprone.xml` | Error-prone (e.g., empty catch blocks, unused variables, close resource) |
| `rulesets/java/multithreading.xml` | Multithreading (e.g., avoid synchronized, use notify correctly) |
| `rulesets/java/performance.xml` | Performance (e.g., inefficient string operations, avoid array copies) |
| `rulesets/java/security.xml` | Security (e.g., code vulnerable to injection, insecure cryptography) |

### Other Language Rulesets

| Language | Built-in Ruleset Path |
|----------|----------------------|
| **Apex (Salesforce)** | `rulesets/apex/quickstart.xml` |
| **JavaScript** | `rulesets/ecmascript/quickstart.xml` |
| **Kotlin** | `rulesets/kotlin/quickstart.xml` |
| **Swift** | `rulesets/swift/quickstart.xml` |
| **PLSQL** | `rulesets/plsql/quickstart.xml` |
| **JSP** | `rulesets/jsp/quickstart.xml` |
| **HTML** | `rulesets/html/quickstart.xml` |
| **XML** | `rulesets/xml/quickstart.xml` |
| **Maven POM** | `rulesets/pom/quickstart.xml` |
| **Velocity** | `rulesets/velocity/quickstart.xml` |
| **Visualforce** | `rulesets/visualforce/quickstart.xml` |
| **Modelica** | `rulesets/modelica/quickstart.xml` |
| **Scala** | `rulesets/scala/quickstart.xml` |

### Using Multiple Rulesets

```bash
# Comma-separated
pmd-docker check -d /src -R rulesets/java/quickstart.xml,rulesets/java/codestyle.xml

# Repeat the -R flag
pmd-docker check -d /src -R rulesets/java/quickstart.xml -R rulesets/java/security.xml
```

### Using a Custom Ruleset File

If you have a custom `pmd-ruleset.xml` in your project:

```bash
pmd-docker check -d /src -R /src/pmd-ruleset.xml
```

Example custom ruleset file (`pmd-ruleset.xml`) — **PMD 7.x compatible**:

> **⚠️ PMD 6.x vs 7.x Ruleset Paths:** PMD 7.x changed rule paths from `rulesets/java/errorprone.xml` to `category/java/errorprone.xml`.
> If you see errors like `No such ruleset`, update your paths to use `category/<language>/<category>.xml` format.
> Use `category/java/bestpractices.xml`, `category/java/codestyle.xml`, `category/java/design.xml`, `category/java/documentation.xml`,
> `category/java/errorprone.xml`, `category/java/multithreading.xml`, `category/java/performance.xml`, `category/java/security.xml`.

```xml
<?xml version="1.0"?>
<ruleset name="Custom Rules"
    xmlns="http://pmd.sourceforge.net/ruleset/2.0.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://pmd.sourceforge.net/ruleset/2.0.0 https://pmd.sourceforge.io/ruleset_2_0_0.xsd">
    <description>Custom ruleset for my project</description>

    <!-- Include all quickstart rules (auto-selects best for language) -->
    <rule ref="category/java/bestpractices.xml"/>
    <rule ref="category/java/codestyle.xml"/>
    <rule ref="category/java/design.xml"/>
    <rule ref="category/java/documentation.xml"/>
    <rule ref="category/java/errorprone.xml"/>
    <rule ref="category/java/multithreading.xml"/>
    <rule ref="category/java/performance.xml"/>
    <rule ref="category/java/security.xml"/>

    <!-- Exclude specific rules -->
    <rule ref="category/java/codestyle.xml">
        <exclude name="LongVariable"/>
        <exclude name="ShortVariable"/>
        <exclude name="OnlyOneReturn"/>
    </rule>

    <!-- Configure rule properties -->
    <rule ref="category/java/design.xml/ExcessiveParameterList">
        <properties>
            <property name="minimum" value="8"/>
        </properties>
    </rule>

    <!-- Suppress warnings in test code -->
    <exclude-pattern>.*/test/.*</exclude-pattern>
</ruleset>
```

## Report Formats

| Format | Flag | Use Case |
|--------|------|----------|
| `text` | `-f text` | Human-readable terminal output (default) |
| `xml` | `-f xml` | CI integration, further processing |
| `html` | `-f html` | Visual report to share with team |
| `csv` | `-f csv` | Spreadsheet import |
| `json` | `-f json` | Programmatic consumption |
| `sarif` | `-f sarif` | SARIF-compatible tools / GitHub code scanning |

```bash
# Generate all report types
pmd-docker check -d /src -R rulesets/java/quickstart.xml -r /src/pmd-report.xml -f xml
pmd-docker check -d /src -R rulesets/java/quickstart.xml -r /src/pmd-report.html -f html
pmd-docker check -d /src -R rulesets/java/quickstart.xml -r /src/pmd-report.json -f json
pmd-docker check -d /src -R rulesets/java/quickstart.xml -r /src/pmd-report.sarif -f sarif
```

## Language Version Selection

Use `--use-version <lang-version>` to target a specific language version. This affects rule applicability (some rules only apply to certain versions).

```bash
# Java 21
pmd-docker check -d /src -R rulesets/java/quickstart.xml --use-version java-21

# Java 17
pmd-docker check -d /src -R rulesets/java/quickstart.xml --use-version java-17

# Java 11
pmd-docker check -d /src -R rulesets/java/quickstart.xml --use-version java-11

# Java 8
pmd-docker check -d /src -R rulesets/java/quickstart.xml --use-version java-8
```

## CPD: Copy/Paste Detector

> **⚠️ PMD 7.x Flag Changes:** The container runs PMD 7.x which uses `--dir <path>` (instead of the legacy `--files`) for specifying source directories,
> and `--report-file <path>` or `-r <path>` (instead of legacy `--file`) for writing the report. The examples below use the PMD 7.x syntax.


PMD includes CPD for finding duplicate code blocks. It works with many of PMD's supported languages.

### Quick CPD Examples

```bash
# Basic CPD run (Java, minimum 100 tokens)
pmd-docker cpd --minimum-tokens 100 --language java --dir /src

# CPD with XML report output
pmd-docker cpd --minimum-tokens 100 --language java --dir /src \
  --format xml --report-file /src/target/cpd-report.xml

# CPD with CSV output
pmd-docker cpd --minimum-tokens 100 --language java --dir /src \
  --format csv --report-file /src/target/cpd-report.csv

# CPD across multiple directories
pmd-docker cpd --minimum-tokens 100 --language java \
  --dir /src/src/main --dir /src/src/test

# CPD with JavaScript
pmd-docker cpd --minimum-tokens 50 --language ecmascript --dir /src
```

### CPD Key Options

| Option | Description | Default |
|--------|-------------|---------|
| `--minimum-tokens <n>` | Minimum token count for a duplicate block | 100 |
| `--language <lang>` | Language to analyze (java, ecmascript, cpp, cs, go, kotlin, ruby, swift, etc.) | — |
| `--dir <path>` / `--files <path>` | Directory to scan (can repeat). PMD 7.x uses `--dir`; legacy PMD 6.x used `--files` | — |
| `--encoding <charset>` | File encoding | UTF-8 |
| `--format <format>` | Output format (text, xml, csv, json, vs) | text |
| `--report-file <path>` / `-r <path>` | Output report file path (PMD 7.x). Legacy used `--file <path>` | stdout |
| `--skip-lexical-errors` | Skip files with lexical errors | — |
| `--no-skip-blocks` | Do not skip duplicate blocks | — |

### Languages Supported by CPD

Java, JSP, C/C++, C#, CSS, Dart, Fortran, Go, Gherkin, HTML, JavaScript (ecmascript), Julia, Kotlin, Lua, MATLAB, Modelica, Objective-C, Perl, PHP, PLSQL, Python, Ruby, Rust, Scala, Swift, T-SQL, TypeScript, Velocity, XML.

## Common Workflows

### 1. Scan Java Project Before Code Review

```bash
pmd-docker check -d /src -R rulesets/java/quickstart.xml \
  -f html -r /src/target/pmd-report.html \
  --use-version java-21
```

### 2. Scan Multiple Languages

```bash
pmd-docker check -d /src \
  -R rulesets/java/quickstart.xml \
  -R rulesets/ecmascript/quickstart.xml \
  -f text
```

### 3. Focus on Security-Only Rules

```bash
pmd-docker check -d /src -R rulesets/java/security.xml -f text
```

### 4. Use as a Quality Gate (CI Pipeline)

```bash
# Fails with exit code 4 if violations found (default behavior)
pmd-docker check -d /src -R rulesets/java/quickstart.xml -f xml -r /src/pmd-report.xml

# Check exit code in script
if [ $? -eq 4 ]; then
  echo "❌ PMD violations found — quality gate failed"
  exit 1
fi
```

### 5. Incremental Analysis (Faster Repeat Scans)

```bash
pmd-docker check -d /src -R rulesets/java/quickstart.xml --cache /src/.pmd-cache
# Second run is much faster — only re-analyzes changed files
pmd-docker check -d /src -R rulesets/java/quickstart.xml --cache /src/.pmd-cache
```

### 6. Run with Priority Filter (Only High-Priority Violations)

```bash
# Only show priority 1 and 2 (high severity) violations
pmd-docker check -d /src -R rulesets/java/quickstart.xml --minimum-priority 2
```

### 7. Benchmark Mode

```bash
pmd-docker check -d /src -R rulesets/java/quickstart.xml -b 2>/tmp/pmd-benchmark.txt
