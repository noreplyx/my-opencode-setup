#!/bin/bash
# trivy-scanner-wrapper.sh — Use Trivy (dependency vulns, misconfig, secrets) via Podman container
#
# Source this file in your shell to get the `trivy-docker` command:
#   source skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh
#
# Then use it just like native trivy (for filesystem scanning):
#   trivy-docker fs --scanners vuln,misconfig,secret /src
#   trivy-docker fs --scanners vuln,misconfig,secret --format json --output /src/.scans/results.json /src
#
# Optionally set TRIVY_SCANNER_WORKDIR to scan a different directory:
#   TRIVY_SCANNER_WORKDIR=/path/to/project trivy-docker fs --scanners vuln,misconfig,secret /src
#
# Optionally override the whole-scan timeout (default 10m):
#   TRIVY_TIMEOUT=15m trivy-docker fs --scanners vuln,misconfig,secret /src
#
# Add to ~/.zshrc or ~/.bashrc for persistence:
#   source ./skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh

trivy-docker() {
    local workdir="${TRIVY_SCANNER_WORKDIR:-$(pwd)}"
    # Pinned by digest for reproducibility (not a floating :latest tag).
    local image="docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969"

    # Defensive guard: only allow --output paths under /src/.scans/ so a
    # misbehaving caller cannot traverse outside the workdir or overwrite
    # project files via the writable mount. Reject path traversal (..), empty
    # or trailing-slash values, and dot basenames. The `-o` short form is
    # rejected outright (bare, `-o=val`, and `-o<val>`) so no unguarded alias
    # can write outside /src/.scans/. The guard covers the documented
    # write-side flags only: --output (and -o) are path-checked, while
    # --cache-dir/--tmp-dir (single- or double-dash, space and `=` forms)
    # are rejected outright
    # because the wrapper already forces the trivy-cache volume and
    # TRIVY_TIMEOUT; either flag would otherwise redirect root-owned writes
    # to arbitrary locations inside the project tree via the writable mount.
    _trivy_scanner_check_output() {
        local val="$1"
        local base
        if [[ "${val}" != /src/.scans/* ]]; then
            echo "[trivy] ERROR: --output must be under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        if [[ "${val}" == *"/../"* || "${val}" == */.. || "${val}" == *"//"* ]]; then
            echo "[trivy] ERROR: --output must be a direct path under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        base="${val#/src/.scans/}"
        if [[ -z "${base}" || "${base}" == .* || "${base}" == */ ]]; then
            echo "[trivy] ERROR: --output must have a non-empty, non-dot filename under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        return 0
    }

    # Normalize a flag token to its bare name: strip up to two leading dashes
    # and any `=value` suffix. Shared by the current-arg and prev-arg
    # cache/tmp-dir checks below (previously duplicated inline).
    _trivy_scanner_flagname() {
        local name="${1#-}"
        name="${name#-}"
        printf '%s' "${name%%=*}"
    }

    # zsh-compat: flag-name holders declared ONCE here in the value-carrying
    # `local NAME=""` form — a bare `local NAME` re-executed inside the loop
    # is silent in bash but makes zsh's `local` echo the existing value
    # ("flagname=scanners") to stdout, polluting valid invocations.
    local prev="" flagname="" prevname=""
    for arg in "$@"; do
        if [[ "${prev}" == "--output" ]]; then
            _trivy_scanner_check_output "${arg}" || return 1
        fi
        if [[ "${arg}" == --output=* ]]; then
            _trivy_scanner_check_output "${arg#--output=}" || return 1
        fi
        if [[ "${arg}" == -o* ]]; then
            echo "[trivy] ERROR: the -o short-form output flag is not supported; use --output /src/.scans/<file> (got '${arg}')" >&2
            return 1
        fi
        # Reject --cache-dir/--tmp-dir in every spelling the CLI may accept:
        # dash-normalize the flag name before comparing, so `-cache-dir
        # /src/x` and `-tmp-dir=/src/x` cannot slip past a `--`-prefix-only
        # match in the space form or the `=` form, for either the current arg
        # or the previous arg (whose value this arg then is). Rejection
        # messages name the offending flag, never the caller's value.
        if [[ "${arg}" == -* ]]; then
            flagname="$(_trivy_scanner_flagname "${arg}")"
            if [[ "${flagname}" == "cache-dir" || "${flagname}" == "tmp-dir" ]]; then
                echo "[trivy] ERROR: --cache-dir and --tmp-dir are not allowed; the wrapper forces the trivy-cache volume (flag '--${flagname}')" >&2
                return 1
            fi
        fi
        if [[ "${prev}" == -* ]]; then
            prevname="$(_trivy_scanner_flagname "${prev}")"
            if [[ "${prevname}" == "cache-dir" || "${prevname}" == "tmp-dir" ]]; then
                echo "[trivy] ERROR: --cache-dir and --tmp-dir are not allowed; the wrapper forces the trivy-cache volume (flag '--${prevname}')" >&2
                return 1
            fi
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
        echo "[trivy] ERROR: .scans must not be a symlink" >&2
        return 1
    fi

    # Ensure the output directory exists so --output /src/.scans/<file>
    # works on a fresh checkout (trivy may not create parent dirs).
    mkdir -p "${workdir}/.scans"

    # Persistent Trivy cache (vulnerability DBs, check bundles) kept in a
    # named volume rather than under .scans/ so scan artifacts and the cache
    # never collide and DB downloads amortize across scans.
    if ! podman volume exists trivy-cache 2>/dev/null; then
        echo "[trivy] Creating trivy-cache volume..." >&2
        podman volume create trivy-cache >/dev/null || {
            echo "[trivy] ERROR: Failed to create trivy-cache volume" >&2
            return 1
        }
    fi

    # Ensure the image is pulled
    if ! podman image exists "${image}" 2>/dev/null; then
        echo "[trivy] Pulling ${image}..." >&2
        podman pull "${image}" >&2 || {
            echo "[trivy] ERROR: Failed to pull image" >&2
            return 1
        }
    fi

    # Never re-scan prior scan artifacts: inject the directory-skip flag
    # ahead of the caller's arguments. The pinned Trivy build (0.74.x)
    # rejects `--exclude` with "unknown flag" (live-verified), so this uses
    # its supported equivalent `--skip-dirs`. Gated on the filesystem
    # subcommand token appearing anywhere in the argument list — not just
    # `$1` — so a leading global flag (`trivy-docker --quiet fs ...`) still
    # gets the injection, while sanity-check invocations with no fs or
    # filesystem token (e.g. `trivy --version`) stay unaffected because
    # `--skip-dirs` is not accepted alongside them. The pre-subcommand
    # position was re-verified live on 2026-09-04 against the pinned
    # 0.74.0 digest with the exact pipeline invocation (exit 0, valid
    # artifact): Trivy's cobra parser strips the injected `--skip-dirs
    # /src/.scans` pair when locating the `fs` command and then accepts
    # the flag on the `fs` subcommand's own parser, so it must stay
    # injected as this adjacent pair immediately before "$@".
    local inject=()
    local trivy_arg
    for trivy_arg in "$@"; do
        if [[ "${trivy_arg}" == "fs" || "${trivy_arg}" == "filesystem" ]]; then
            inject=(--skip-dirs /src/.scans)
            break
        fi
    done

    podman run --rm \
        -v "${workdir}:/src:Z" \
        -v trivy-cache:/root/.cache/trivy:Z \
        -e "TRIVY_TIMEOUT=${TRIVY_TIMEOUT:-10m}" \
        --workdir /src \
        "${image}" \
        ${inject[@]+"${inject[@]}"} \
        "$@"
}
