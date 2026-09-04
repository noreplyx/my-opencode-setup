#!/bin/bash
# semgrep-scanner-wrapper.sh — Use Semgrep (SAST) via Podman container
#
# Source this file in your shell to get the `semgrep-docker` command:
#   source skills/semgrep-scanner/scripts/semgrep-scanner-wrapper.sh
#
# Then use it just like native semgrep (for SAST scanning):
#   semgrep-docker scan --config p/default /src
#   semgrep-docker scan --json --metrics off --disable-version-check --config p/default --output /src/.scans/results.json /src
#
# Optionally set SEMGREP_SCANNER_WORKDIR to scan a different directory:
#   SEMGREP_SCANNER_WORKDIR=/path/to/project semgrep-docker scan --config p/default /src
#
# Add to ~/.zshrc or ~/.bashrc for persistence:
#   source ./skills/semgrep-scanner/scripts/semgrep-scanner-wrapper.sh

semgrep-docker() {
    local workdir="${SEMGREP_SCANNER_WORKDIR:-$(pwd)}"
    # Pinned by digest for reproducibility (not a floating :latest tag).
    local image="docker.io/semgrep/semgrep@sha256:b94b53d02fd4a022f9eac4e2af1380f5c3c4c21400e79d3336bdff1d1db5e796"

    # Defensive guard: only allow --output paths under /src/.scans/ so a
    # misbehaving caller cannot traverse outside the workdir or overwrite
    # project files via the writable mount. Reject path traversal (..), empty
    # or trailing-slash values, and dot basenames. The `-o` short form is
    # rejected outright (bare, `-o=val`, and `-o<val>`) so no unguarded alias
    # can write outside /src/.scans/.
    _semgrep_scanner_check_output() {
        local val="$1"
        local base
        if [[ "${val}" != /src/.scans/* ]]; then
            echo "[semgrep] ERROR: --output must be under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        if [[ "${val}" == *"/../"* || "${val}" == */.. || "${val}" == *"//"* ]]; then
            echo "[semgrep] ERROR: --output must be a direct path under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        base="${val#/src/.scans/}"
        if [[ -z "${base}" || "${base}" == .* || "${base}" == */ ]]; then
            echo "[semgrep] ERROR: --output must have a non-empty, non-dot filename under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        return 0
    }

    local prev=""
    for arg in "$@"; do
        if [[ "${prev}" == "--output" ]]; then
            _semgrep_scanner_check_output "${arg}" || return 1
        fi
        if [[ "${arg}" == --output=* ]]; then
            _semgrep_scanner_check_output "${arg#--output=}" || return 1
        fi
        if [[ "${arg}" == -o* ]]; then
            echo "[semgrep] ERROR: the -o short-form output flag is not supported; use --output /src/.scans/<file> (got '${arg}')" >&2
            return 1
        fi
        prev="${arg}"
    done

    # Refuse to run when the host-side artifact directory is a symlink
    # BEFORE mkdir -p (otherwise mkdir fails with a raw "File exists"
    # against a dangling symlink instead of this clean error). The guard
    # above is lexical, so a symlinked .scans could otherwise redirect
    # writes outside the project tree despite the /src/.scans/ prefix
    # check (a full container-side realpath fix is deliberately deferred
    # as out of scope).
    if [[ -L "${workdir}/.scans" ]]; then
        echo "[semgrep] ERROR: .scans must not be a symlink" >&2
        return 1
    fi

    # Ensure the output directory exists so --output /src/.scans/<file>
    # works on a fresh checkout (semgrep may not create parent dirs).
    mkdir -p "${workdir}/.scans"

    # Ensure the image is pulled
    if ! podman image exists "${image}" 2>/dev/null; then
        echo "[semgrep] Pulling ${image}..." >&2
        podman pull "${image}" >&2 || {
            echo "[semgrep] ERROR: Failed to pull image" >&2
            return 1
        }
    fi

    # Telemetry/version-check hygiene (mirrors trivy's safe-default
    # injection): the scanner agent's exact invocation already passes these
    # flags and its allow-key is unchanged, but a human `semgrep-docker scan
    # ...` must not send usage metrics (hashed project paths) or
    # version-check egress by default. Injected after the `scan` subcommand
    # token and ahead of the caller's own flags. Injection is CONDITIONAL
    # per flag: semgrep's click parser hard-errors "option '--metrics'
    # cannot be repeated" (exit 2, live-verified against the pinned digest
    # 2026-09-04) when the same flag also appears in the caller's arguments,
    # and the agent's pinned invocation does pass both — so a flag the caller
    # already supplied is never injected again; an absent safe default is.
    # Placement differs from trivy's pre-subcommand position deliberately:
    # Semgrep's CLI is a click group whose top level accepts only
    # --help/--version, while --metrics and --disable-version-check are
    # declared on the scan subcommand, so they must follow the subcommand
    # token.
    local scan_args=("$@")
    if [[ "${1:-}" == "scan" ]]; then
        local semgrep_arg
        local has_metrics="" has_version_check="" safe_defaults=()
        for semgrep_arg in "${@:2}"; do
            case "${semgrep_arg}" in
                --metrics|--metrics=*) has_metrics="yes" ;;
                --disable-version-check) has_version_check="yes" ;;
            esac
        done
        [[ -n "${has_metrics}" ]] || safe_defaults+=(--metrics off)
        [[ -n "${has_version_check}" ]] || safe_defaults+=(--disable-version-check)
        if [[ ${#safe_defaults[@]} -gt 0 ]]; then
            scan_args=(scan "${safe_defaults[@]+"${safe_defaults[@]}"}" "${@:2}")
        fi
    fi

    # Entrypoint adaptation (live-verified against the pinned digest before
    # this wrapper was written): the image ships no ENTRYPOINT (its default
    # Cmd is ["semgrep", "--help"]), so the binary name must be prepended
    # before the caller's arguments; without it the container would try to
    # exec a command literally named "scan" and fail.
    podman run --rm \
        -v "${workdir}:/src:Z" \
        --workdir /src \
        "${image}" \
        semgrep ${scan_args[@]+"${scan_args[@]}"}
}
