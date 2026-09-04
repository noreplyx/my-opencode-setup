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
# Self-scan hook: when the scan root carries osv-scanner.self-scan.toml (the
# Stage 5 fixture-exclusion config of THIS config repo) AND the argv contains
# a literal `source` subcommand token, the wrapper passes it as `--config` so
# its [[IgnoredVulns]] apply to every nested lockfile. Other projects have no
# such file and are scanned as a faithful passthrough.
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
    # or trailing-slash values, and dot basenames. The guard covers EVERY
    # output-flag spelling the pinned CLI accepts, so the SKILL's claim that
    # the wrapper enforces /src/.scans/ is true: `--output-file` in space and
    # `=` forms, the Go-style single-dash `-output-file` forms (urfave/cli
    # parses them identically to the double-dash spelling — live-verified
    # 2026-09-04 to write anywhere under /src), and outright rejection of the
    # deprecated `--output`/`-output` aliases plus the `-O` prefix (the pinned
    # 2.5.1 build itself exits 127 on `-O`; rejecting early keeps the claim
    # true against future builds and reports a clean wrapper error).
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

    # Normalize a flag token to its bare name: strip up to two leading dashes
    # and any `=value` suffix (mirrors the trivy wrapper's dash-normalization
    # pattern, restoring guard symmetry across the three wrappers).
    _osv_scanner_flagname() {
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
        if [[ "${prev}" == "--output-file" ]]; then
            _osv_scanner_check_output "${arg}" || return 1
        fi
        if [[ "${arg}" == --output-file=* ]]; then
            _osv_scanner_check_output "${arg#--output-file=}" || return 1
        fi
        # Dash-normalized parity for the two checks above: `-output-file <val>`
        # (space form, caught via prev) and `-output-file=<val>` (equals form,
        # caught on the current token) must not slip past a `--`-prefix-only
        # match. Re-checking an already-guarded double-dash value is idempotent.
        if [[ "${prev}" == -* ]]; then
            prevname="$(_osv_scanner_flagname "${prev}")"
            if [[ "${prevname}" == "output-file" ]]; then
                _osv_scanner_check_output "${arg}" || return 1
            fi
        fi
        if [[ "${arg}" == -* ]]; then
            argname="$(_osv_scanner_flagname "${arg}")"
            if [[ "${argname}" == "output-file" && "${arg}" == *=* ]]; then
                _osv_scanner_check_output "${arg#*=}" || return 1
            elif [[ "${argname}" == "output" ]]; then
                echo "[osv-scanner] ERROR: the deprecated --output/-output flag is not supported; use --output-file /src/.scans/<file> (got '${arg}')" >&2
                return 1
            fi
        fi
        if [[ "${arg}" == -O* ]]; then
            echo "[osv-scanner] ERROR: the -O short form is not supported; use --output-file /src/.scans/<file> (got '${arg}')" >&2
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
        echo "[osv-scanner] ERROR: .scans must not be a symlink" >&2
        return 1
    fi

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

    # Whole-repo self-scan hook (this config repo only, by construction): if
    # the scan root carries osv-scanner.self-scan.toml, pass it as --config so
    # its [[IgnoredVulns]] entries apply to EVERY nested lockfile. osv-scanner
    # 2.5.1 auto-discovers configs only in each lockfile's own directory (no
    # propagation into children — live-verified), so without this explicit
    # pointer the repo-root fixture-exclusion config would be inert for
    # tests/fixtures/ and the seeded advisory would block every self-scan.
    # The file NAME is deliberately non-standard: ordinary pipeline targets
    # have no osv-scanner.self-scan.toml, so this wrapper stays a faithful
    # passthrough for them, and scans whose mount root lacks the marker —
    # including the tests/fixtures/secure-scan-demo e2e legs — are byte-for-
    # byte unaffected. The agent's pinned allow-key invocation never carries
    # --config; the injection happens here. urfave/cli accepts subcommand
    # flags only AFTER the subcommand token (verified live 2026-09-04), so
    # the pair is injected immediately after `source`, and a caller-supplied
    # --config (any dash form) always wins. Authoritative rationale for the
    # marker mechanism lives in the header of osv-scanner.self-scan.toml;
    # this block restates it.
    local scan_args=("$@")
    if [[ -f "${workdir}/osv-scanner.self-scan.toml" ]]; then
        local osv_arg has_config=""
        for osv_arg in "$@"; do
            if [[ "${osv_arg}" == -* ]] && [[ "$(_osv_scanner_flagname "${osv_arg}")" == "config" ]]; then
                has_config="yes"
            fi
        done
        if [[ -z "${has_config}" ]]; then
            scan_args=()
            local injected=""
            for osv_arg in "$@"; do
                scan_args+=("${osv_arg}")
                if [[ -z "${injected}" && "${osv_arg}" == "source" ]]; then
                    scan_args+=(--config /src/osv-scanner.self-scan.toml)
                    injected="yes"
                    # A planted marker must not suppress coverage silently:
                    # announce the injection on stderr (stdout stays clean)
                    # so it is visible in the agent's command output.
                    echo "[osv-scanner] self-scan config active: osv-scanner.self-scan.toml applied (coverage may be ID-suppressed — verify this is your repo, not a third-party tree)" >&2
                fi
            done
        fi
    fi

    podman run --rm \
        -v "${workdir}:/src:Z" \
        --workdir /src \
        "${image}" \
        ${scan_args[@]+"${scan_args[@]}"}
}
