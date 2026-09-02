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
    # Pinned by digest for reproducibility (not a floating :latest tag).
    local image="ghcr.io/google/osv-scanner@sha256:1547b7c2783d4f266b24fe86ab4dfc18d058588244c58384ac9f56dddb304511"

    # Defensive guard: only allow --output-file paths under /src/.scans/ so a
    # misbehaving caller cannot traverse outside the workdir or overwrite
    # project files via the writable mount. Reject path traversal (..), empty
    # or trailing-slash values, and dot basenames.
    _osv_scanner_check_output() {
        local val="$1"
        local base
        if [[ "${val}" != /src/.scans/* ]]; then
            echo "[osv-scanner] ERROR: --output-file must be under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        if [[ "${val}" == *"/../"* || "${val}" == */.. || "${val}" == *"//"* ]]; then
            echo "[osv-scanner] ERROR: --output-file must be a direct path under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        base="${val#/src/.scans/}"
        if [[ -z "${base}" || "${base}" == .* || "${base}" == */ ]]; then
            echo "[osv-scanner] ERROR: --output-file must have a non-empty, non-dot filename under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        return 0
    }

    local prev=""
    for arg in "$@"; do
        if [[ "${prev}" == "--output-file" ]]; then
            _osv_scanner_check_output "${arg}" || return 1
        fi
        if [[ "${arg}" == --output-file=* ]]; then
            _osv_scanner_check_output "${arg#--output-file=}" || return 1
        fi
        prev="${arg}"
    done

    # Ensure the output directory exists so --output-file /src/.scans/<file>
    # works on a fresh checkout (osv-scanner may not create parent dirs).
    mkdir -p "${workdir}/.scans"

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
