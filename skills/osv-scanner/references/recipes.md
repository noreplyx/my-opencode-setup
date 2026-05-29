# OSV-Scanner Recipe Reference

Quick copy-paste recipes for common OSV-Scanner tasks via Podman.

## Prerequisites

```bash
# Ensure the image is pulled
podman pull ghcr.io/google/osv-scanner:latest

# Source the wrapper (recommended)
source ../scripts/osv-scanner-wrapper.sh
```

---

## Source Scanning

### Scan a Single Lockfile
```bash
osv-scanner-docker scan source -L /src/package-lock.json
```

### Scan a Directory Recursively
```bash
osv-scanner-docker scan source -r /src
```

### Scan with All Available Ecoystem Detection
```bash
osv-scanner-docker scan source -r --verbosity info /src
```

### Scan and Generate JSON Report
```bash
osv-scanner-docker scan source -r --format json --output-file /src/report.json /src
```

### Scan and Host HTML Report
```bash
osv-scanner-docker scan source -r --serve /src
```

### Scan with SBOM Output (SPDX)
```bash
osv-scanner-docker scan source -r --all-packages --format spdx-2-3 --output-file /src/sbom.spdx.json /src
```

### Scan with SBOM Output (CycloneDX)
```bash
osv-scanner-docker scan source -r --all-packages --format cyclonedx-1-5 --output-file /src/sbom.cdx.json /src
```

### Scan with Custom Config
```bash
osv-scanner-docker scan source -r --config /src/osv-scanner.toml /src
```

### Scan Excluding Test/Vendor Directories
```bash
osv-scanner-docker scan source -r \
  --experimental-exclude=test \
  --experimental-exclude=vendor \
  --experimental-exclude=docs \
  /src
```

### Scan with Call Analysis (Go + Rust)
```bash
osv-scanner-docker scan source -r --call-analysis=all /src
```

### Multi-Ecosystem Scan
```bash
osv-scanner-docker scan source \
  -L /src/package-lock.json \
  -L /src/Cargo.lock \
  -L /src/go.mod \
  -L /src/Gemfile.lock
```

### Scan and Fix with Guided Remediation
```bash
osv-scanner-docker fix -M /src/package.json -L /src/package-lock.json
```

---

## Container Image Scanning

### Scan Image Directly (With Docker Socket)
```bash
podman run --rm \
  -v "${PWD}:/src:Z" \
  -v /var/run/docker.sock:/var/run/docker.sock:Z \
  ghcr.io/google/osv-scanner:latest \
  scan image alpine:latest
```

### Scan Image from Exported Archive (Recommended)
```bash
# Export
podman save --format=docker-archive alpine:latest -o /tmp/alpine.tar

# Scan
podman run --rm \
  -v /tmp:/tmp:Z \
  -v "${PWD}:/src:Z" \
  ghcr.io/google/osv-scanner:latest \
  scan image --archive /tmp/alpine.tar
```

### Scan Image with HTML Report
```bash
podman run --rm \
  -v "${PWD}:/src:Z" \
  -v /var/run/docker.sock:/var/run/docker.sock:Z \
  ghcr.io/google/osv-scanner:latest \
  scan image --format html alpine:latest
```

### Scan Multiple Images (Export Loop)
```bash
for img in alpine:latest debian:bookworm ubuntu:24.04; do
  podman save --format=docker-archive "$img" -o "/tmp/${img//[:\/]/_}.tar"
done

for archive in /tmp/*.tar; do
  osv-scanner-docker scan image --archive "/src/${archive#/tmp/}" 2>&1 || true
done
# Note: archives need to be under /src mount
```

---

## License Scanning

### Show License Summary
```bash
osv-scanner-docker --licenses /src
```

### Check Against Allowlist
```bash
osv-scanner-docker --licenses="MIT,Apache-2.0,BSD-3-Clause,0BSD,ISC" /src
```

### License Scan with Override Config
```bash
osv-scanner-docker --licenses="MIT,Apache-2.0" --config /src/osv-scanner.toml /src
```

---

## Offline Scanning

### Download + Scan Offline
```bash
osv-scanner-docker --offline-vulnerabilities --download-offline-databases /src
```

### Scan Offline Only (No Network)
```bash
osv-scanner-docker --offline /src
```

### Scan with Persistent Offline DB Cache
```bash
podman run --rm \
  -v "${PWD}:/src:Z" \
  -v "${HOME}/.cache/osv-scanner:/root/.cache/osv-scanner:Z" \
  ghcr.io/google/osv-scanner:latest \
  --offline /src
```

---

## CI/CD Integration

### GitLab CI Job
```yaml
osv-scanner:
  image: ghcr.io/google/osv-scanner:latest
  script:
    - osv-scanner scan source -r --format json --output-file report.json .
  artifacts:
    paths:
      - report.json
```

### GitHub Actions Step
```yaml
- name: Run OSV-Scanner
  uses: docker://ghcr.io/google/osv-scanner:latest
  with:
    args: scan source -r --format sarif --output-file /github/workspace/osv-report.sarif .
```

### Pre-Commit Hook
```yaml
repos:
  - repo: https://github.com/google/osv-scanner/
    rev: v2.3.8
    hooks:
      - id: osv-scanner
        args:
          - "scan"
          - "source"
          - "--format=vertical"
          - "--verbosity=error"
          - "--recursive"
          - "."
```

---

## Wrapper Usage Examples

```bash
# Source the wrapper
source scripts/osv-scanner-wrapper.sh

# Quick scan
osv-scanner-docker scan source -r .

# JSON report
osv-scanner-docker --format json -L ./package-lock.json > report.json

# Container scan (no socket — use archive)
podman save --format=docker-archive node:20 -o /tmp/node20.tar
cp /tmp/node20.tar ./
osv-scanner-docker scan image --archive /src/node20.tar

# License check
osv-scanner-docker --licenses="MIT,Apache-2.0" .

# Scan with custom workdir
OSV_SCANNER_WORKDIR=/home/user/project osv-scanner-docker scan source -r /src

# Check version
osv-scanner-docker --version
```

---

## Scripting with Exit Codes

```bash
# In a script, use the exit code
if osv-scanner-docker scan source -r --format json /src > report.json; then
  echo "✅ No vulnerabilities found"
else
  code=$?
  if [ $code -eq 1 ]; then
    echo "❌ Vulnerabilities found! Check report.json"
  elif [ $code -eq 128 ]; then
    echo "⚠️ No packages found — check scan target"
  else
    echo "⚠️ Error (exit code: $code)"
  fi
fi
```
