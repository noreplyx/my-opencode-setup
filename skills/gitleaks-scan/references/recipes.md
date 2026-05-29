# Gitleaks Recipe Reference

All recipes assume the shell wrapper is sourced (`source skills/gitleaks-scan/scripts/gitleaks-wrapper.sh`). Without it, prepend `podman run --rm -v "${PWD}:/src:Z" docker.io/zricethezav/gitleaks:latest` to each command.

## Quick Recipes

### Recipe 1: Quick Git Repo Scan
```bash
gitleaks-docker git --verbose
```

### Recipe 2: Quiet JSON Report
```bash
gitleaks-docker git --report-format=json --report-path=/src/report.json --no-banner
```

### Recipe 3: Directory Scan (No Git History)
```bash
gitleaks-docker dir --source=/src --verbose
```

### Recipe 4: Incremental Baseline Scan (CI-Friendly)
```bash
gitleaks-docker git --baseline-path=/src/baseline.json --report-format=json --report-path=/src/new-findings.json
```

### Recipe 5: Pre-Commit Staged Scan
```bash
gitleaks-docker git --staged --verbose
```

### Recipe 6: SARIF Output for GitHub/VS Code
```bash
gitleaks-docker git --report-format=sarif --report-path=/src/results.sarif
```

### Recipe 7: Custom Config with Multiple Rule Packs
```bash
gitleaks-docker git --config=/src/.gitleaks.toml --verbose
```

### Recipe 8: Scan with Baseline + Custom Config + JSON
```bash
gitleaks-docker git \
  --config=/src/.gitleaks.toml \
  --baseline-path=/src/baseline.json \
  --report-format=json \
  --report-path=/src/findings.json \
  --no-banner
```

### Recipe 9: Stdin Scan from Diff
```bash
git diff HEAD~1 | gitleaks-docker stdin --verbose
```

### Recipe 10: Update Gitleaks Image
```bash
podman pull docker.io/zricethezav/gitleaks:latest
```

## Custom gitleaks.toml Examples

### Extending Default Rules

```toml
title = "Project-specific gitleaks config"

[extend]
useDefault = true
disabledRules = ["generic-api-key", "slack-access-token"]

[[rules]]
id = "my-company-internal-token"
description = "detect internal company API tokens"
regex = '''ACME-[0-9A-Z]{16,32}'''
secretGroup = 0
entropy = 3.0
keywords = ["ACME-"]
tags = ["security", "custom"]

[[allowlists]]
description = "global allowlist for test fixtures"
paths = [
  '''(.*?)__fixtures__/''',
  '''(.*?)test_data/''',
  '''(.*?).gitleaks.toml''',
]
```

### Custom Config Without Defaults

```toml
title = "Minimal custom gitleaks config"

[[rules]]
id = "hardcoded-password"
description = "hardcoded password assignment"
regex = '''password\s*=\s*['\"][^'\"]{6,}['\"]'''
secretGroup = 0
entropy = 2.5
keywords = ["password"]
tags = ["security", "hardcoded"]
```

## .gitleaksignore Format

```gitignore
# One fingerprint per line
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3:src/config.ts:generic-api-key:15
b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3:src/test/fixtures.ts:generic-api-key:42
```

Extract fingerprints from JSON output: `cat report.json | jq -r '.[].Fingerprint'`

## Pre-Commit Hook Script

```bash
#!/bin/bash
echo "Running gitleaks secret scan..."
podman run --rm -v "${PWD}:/src:Z" docker.io/zricethezav/gitleaks:latest \
  git --source=/src --staged --verbose
if [ $? -eq 1 ]; then
  echo "❌ Gitleaks detected secrets. Commit blocked."
  exit 1
fi
echo "✅ No secrets detected."
```
