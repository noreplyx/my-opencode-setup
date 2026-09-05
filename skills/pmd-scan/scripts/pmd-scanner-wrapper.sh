#!/bin/bash
# pmd-scanner-wrapper.sh — Use PMD (rule-based static analysis) via Podman container
#
# Source this file in your shell to get the `pmd-docker` command:
#   source skills/pmd-scan/scripts/pmd-scanner-wrapper.sh
#
# Then use it just like native pmd (for Java/JS static analysis):
#   pmd-docker check -d /src -R category/java/errorprone.xml
#   pmd-docker check -d /src -R category/java/errorprone.xml -f json --report-file /src/.scans/results.json
#
# Optionally set PMD_SCANNER_WORKDIR to scan a different directory:
#   PMD_SCANNER_WORKDIR=/path/to/project pmd-docker check -d /src -R category/java/errorprone.xml
#
# Self-scan hook: when the scan root carries pmd.self-scan.marker (the
# fixture-exclusion marker of THIS config repo), the wrapper injects
# `--exclude-pattern 'tests/fixtures/'` so whole-repo self-scans skip the
# seeded fixture. Other projects have no such file and are scanned as a
# faithful passthrough.
#
# Add to ~/.zshrc or ~/.bashrc for persistence:
#   source ./skills/pmd-scan/scripts/pmd-scanner-wrapper.sh

pmd-docker() {
    local workdir="${PMD_SCANNER_WORKDIR:-$(pwd)}"
    # Pinned by digest for reproducibility (not a floating :latest tag).
    local image="docker.io/pmdcode/pmd@sha256:e234f36a0a4b74a257c55f01acb512a9da7a135315446150281190ab1f4969dc"

    # Defensive guard: only allow --report-file paths under /src/.scans/ so a
    # misbehaving caller cannot traverse outside the workdir or overwrite
    # project files via the writable mount. Reject path traversal (..), empty
    # or trailing-slash values, and dot basenames. The `-r` short form is
    # rejected outright (bare, `-r=val`, and `-r<val>`) so no unguarded alias
    # can write outside /src/.scans/.
    _pmd_scanner_check_output() {
        local val="$1"
        local base
        if [[ "${val}" != /src/.scans/* ]]; then
            echo "[pmd] ERROR: --report-file must be under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        if [[ "${val}" == *"/../"* || "${val}" == */.. || "${val}" == *"//"* ]]; then
            echo "[pmd] ERROR: --report-file must be a direct path under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        base="${val#/src/.scans/}"
        if [[ -z "${base}" || "${base}" == .* || "${base}" == */ ]]; then
            echo "[pmd] ERROR: --report-file must have a non-empty, non-dot filename under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        return 0
    }

    # Normalize a flag token to its bare name: strip up to two leading dashes
    # and any `=value` suffix (mirrors the osv/trivy wrappers' dash-normalization
    # pattern, restoring guard symmetry across the wrappers).
    _pmd_scanner_flagname() {
        local name="${1#-}"
        name="${name#-}"
        printf '%s' "${name%%=*}"
    }

    # zsh-compat: the loop-local flag-name holders are declared ONCE here in
    # the value-carrying `local NAME=""` form. A bare `local NAME` re-executed
    # inside the loop is silent in bash but makes zsh's `local` echo the
    # existing value ("argname=r") to stdout, polluting valid invocations.
    local prev="" argname="" prevname=""
    for arg in "$@"; do
        if [[ "${prev}" == "--report-file" ]]; then
            _pmd_scanner_check_output "${arg}" || return 1
        fi
        if [[ "${arg}" == --report-file=* ]]; then
            _pmd_scanner_check_output "${arg#--report-file=}" || return 1
        fi
        # Dash-normalized parity for the two checks above: `-report-file <val>`
        # (space form, caught via prev) and `-report-file=<val>` (equals form,
        # caught on the current token) must not slip past a `--`-prefix-only
        # match. Re-checking an already-guarded double-dash value is idempotent.
        if [[ "${prev}" == -* ]]; then
            prevname="$(_pmd_scanner_flagname "${prev}")"
            if [[ "${prevname}" == "report-file" ]]; then
                _pmd_scanner_check_output "${arg}" || return 1
            fi
        fi
        if [[ "${arg}" == -* ]]; then
            argname="$(_pmd_scanner_flagname "${arg}")"
            if [[ "${argname}" == "report-file" && "${arg}" == *=* ]]; then
                _pmd_scanner_check_output "${arg#*=}" || return 1
            fi
        fi
        if [[ "${arg}" == -r* ]]; then
            echo "[pmd] ERROR: the -r short-form report flag is not supported; use --report-file /src/.scans/<file> (got '${arg}')" >&2
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
        echo "[pmd] ERROR: .scans must not be a symlink" >&2
        return 1
    fi

    # Ensure the output directory exists so --report-file /src/.scans/<file>
    # works on a fresh checkout (pmd may not create parent dirs).
    mkdir -p "${workdir}/.scans"

    # Ensure the image is pulled
    if ! podman image exists "${image}" 2>/dev/null; then
        echo "[pmd] Pulling ${image}..." >&2
        podman pull "${image}" >&2 || {
            echo "[pmd] ERROR: Failed to pull image" >&2
            return 1
        }
    fi

    # Whole-repo self-scan hook (this config repo only, by construction): if
    # the scan root carries pmd.self-scan.marker, inject `--exclude-pattern
    # 'tests/fixtures/'` so whole-repo self-scans skip the seeded fixture.
    # The marker NAME is deliberately non-standard: ordinary pipeline targets
    # have no pmd.self-scan.marker, so this wrapper stays a faithful
    # passthrough for them, and scans whose mount root lacks the marker —
    # including the tests/fixtures/secure-scan-demo e2e leg — are byte-for-
    # byte unaffected. The agent's pinned allow-key invocation never carries
    # --exclude-pattern; the injection happens here. A caller-supplied
    # --exclude-pattern (any dash form) always wins.
    local scan_args=("$@")
    if [[ -f "${workdir}/pmd.self-scan.marker" ]]; then
        local pmd_arg has_exclude=""
        for pmd_arg in "$@"; do
            if [[ "${pmd_arg}" == -* ]] && [[ "$(_pmd_scanner_flagname "${pmd_arg}")" == "exclude-pattern" ]]; then
                has_exclude="yes"
            fi
        done
        if [[ -z "${has_exclude}" ]]; then
            scan_args+=(--exclude-pattern 'tests/fixtures/')
            # A planted marker must not suppress coverage silently: announce
            # the injection on stderr (stdout stays clean) so it is visible
            # in the agent's command output.
            echo "[pmd] self-scan marker active: pmd.self-scan.marker applied (coverage may be path-suppressed — verify this is your repo, not a third-party tree)" >&2
        fi
    fi

    # The image ships an ENTRYPOINT of `pmd` (verified from the upstream
    # Dockerfile), so the caller's arguments pass straight through — no binary
    # name is prepended (prepending would yield `pmd pmd ...`).
    podman run --rm \
        -v "${workdir}:/src:Z" \
        --workdir /src \
        "${image}" \
        ${scan_args[@]+"${scan_args[@]}"}
}
