#!/bin/bash
# osv-scanner-wrapper.sh — Use OSV-Scanner via Podman container
#
# Source this file in your shell to get the `osv-scanner-docker` command:
#   source skills/osv-scanner/scripts/osv-scanner-wrapper.sh
#
# Then use it just like native osv-scanner (for source/lockfile scanning):
#   osv-scanner-docker scan source -r /src
#   osv-scanner-docker scan source -r --format json /src
#   osv-scanner-docker scan source -L /src/package-lock.json
#
# Optionally set OSV_SCANNER_WORKDIR to scan a different directory:
#   OSV_SCANNER_WORKDIR=/path/to/project osv-scanner-docker scan source -r /src
#
# Add to ~/.zshrc or ~/.bashrc for persistence:
#   source ./skills/osv-scanner/scripts/osv-scanner-wrapper.sh

osv-scanner-docker() {
    local workdir="${OSV_SCANNER_WORKDIR:-$(pwd)}"
    local image="ghcr.io/google/osv-scanner:latest"

    # Ensure the image is pulled
    if ! podman image exists "${image}" 2>/dev/null; then
        echo "[osv-scanner] Pulling ${image}..." >&2
        podman pull "${image}" >&2 || {
            echo "[osv-scanner] ERROR: Failed to pull image" >&2
            return 1
        }
    fi

    podman run --rm \
        -v "${workdir}:/src:Z" \
        --workdir /src \
        "${image}" \
        "$@"
}

# Also provide a shorthand (function, not alias, for non-interactive shell support)
osv-docker() { osv-scanner-docker "$@"; }
