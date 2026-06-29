#!/bin/bash
# OWASP ZAP Podman Wrapper Script
# Source this file in your shell to run ZAP scans easily:
#   source /path/to/zap-wrapper.sh
#   zap-baseline -t https://example.com -r report.html
#   zap-full-scan -t https://staging.example.com -r full-report.html
#   zap-api-scan -t /zap/wrk/openapi.json -f openapi -r api-report.html
#
# Cross-platform: works on Linux, macOS (via Podman Machine), and Windows (via Git Bash/WSL2).

# --- Platform detection ---
case "$(uname -s)" in
  Linux*)  _OS="linux" ;;
  Darwin*) _OS="macos" ;;
  CYGWIN*|MINGW*|MSYS*) _OS="windows" ;;
  *)       _OS="linux" ;;
esac

# SELinux label: only on Linux, configurable via env var (set SELINUX_OPT="" to disable)
SELINUX_OPT="${SELINUX_OPT:-:Z}"
[ "$_OS" != "linux" ] && SELINUX_OPT=""
# --- End platform detection ---

ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"

# Ensure the image is pulled
_zap_ensure_image() {
  if ! podman image exists "$ZAP_IMAGE" 2>/dev/null; then
    echo "Pulling ZAP image: $ZAP_IMAGE ..." >&2
    podman pull "$ZAP_IMAGE"
  fi
}

# Generic ZAP runner
_zap_run() {
  _zap_ensure_image
  local script="$1"
  shift

  podman run --rm \
    --network host \
    -v "$(pwd):/zap/wrk${SELINUX_OPT}" \
    "$ZAP_IMAGE" \
    "$script" "$@"
}

# Baseline scan - passive, safe for CI/CD and production
# Usage: zap-baseline -t https://example.com [-r report.html] [-J report.json] [-c config] [-g gen_config]
zap-baseline() {
  _zap_run "zap-baseline.py" "$@"
}

# Full active scan - spider + active scanning (potentially destructive)
# Usage: zap-full-scan -t https://staging.example.com [-r report.html] [-j] [-a] [-c config] [-m minutes]
zap-full-scan() {
  _zap_run "zap-full-scan.py" "$@"
}

# API scan - for OpenAPI, SOAP, or GraphQL APIs
# Usage: zap-api-scan -t <url> -f <openapi|soap|graphql> [-r report.html] [-S safe-mode]
zap-api-scan() {
  _zap_run "zap-api-scan.py" "$@"
}

# ZAP version check
zap-version() {
  _zap_ensure_image
  podman run --rm "$ZAP_IMAGE" zap.sh -version
}

echo "OWASP ZAP wrapper loaded."
echo "  Commands available:"
echo "    zap-baseline  - Passive spider scan (CI-safe)"
echo "    zap-full-scan - Active scan with attack payloads"
echo "    zap-api-scan  - API-focused scan (OpenAPI/SOAP/GraphQL)"
echo "    zap-version   - Show ZAP version"
echo ""
echo "  Example: zap-baseline -t https://example.com -r report.html"
