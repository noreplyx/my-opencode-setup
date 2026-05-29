#!/bin/bash
# osv-scanner-wrapper.sh — Use OSV-Scanner via Podman container
#
# Source this file in your shell to get the `osv-scanner-docker` command:
#   source skills/osv-scanner/scripts/osv-scanner-wrapper.sh
#
# Then use it just like native osv-scanner:
#   osv-scanner-docker scan source -r .
#   osv-scanner-docker scan image alpine:latest
#   osv-scanner-docker --format json -L ./package-lock.json
#
# Add to ~/.zshrc or ~/.bashrc for persistence:
#   source /home/oat/.config/opencode/skills/osv-scanner/scripts/osv-scanner-wrapper.sh

OSV_SCANNER_IMAGE="ghcr.io/google/osv-scanner:latest"

osv-scanner-docker() {
    local workdir="${OSV_SCANNER_WORKDIR:-${PWD}}"

    # Ensure the image is pulled
    if ! podman image exists "${OSV_SCANNER_IMAGE}" 2>/dev/null; then
        echo "[osv-scanner] Pulling ${OSV_SCANNER_IMAGE}..." >&2
        podman pull "${OSV_SCANNER_IMAGE}" >&2 || {
            echo "[osv-scanner] ERROR: Failed to pull image" >&2
            return 1
        }
    fi

    podman run --rm \
        -v "${workdir}:/src:Z" \
        "${OSV_SCANNER_IMAGE}" \
        "$@"
}

# Also provide a shorthand alias
alias osv-docker=osv-scanner-docker
