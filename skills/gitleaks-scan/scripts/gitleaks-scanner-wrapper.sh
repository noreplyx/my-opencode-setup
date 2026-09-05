#!/bin/bash
# gitleaks-scanner-wrapper.sh — Use Gitleaks (git-history secret detection) via Podman container
#
# Source this file in your shell to get the `gitleaks-docker` command:
#   source skills/gitleaks-scan/scripts/gitleaks-scanner-wrapper.sh
#
# Then use it just like native gitleaks (for git-history secret scanning):
#   gitleaks-docker detect --source /src
#   gitleaks-docker detect --source /src --report-format json --report-path /src/.scans/results.json
#
# Optionally set GITLEAKS_SCANNER_WORKDIR to scan a different directory:
#   GITLEAKS_SCANNER_WORKDIR=/path/to/project gitleaks-docker detect --source /src
#
# Self-scan hook: when the scan root carries .gitleaks.toml (the repo-root
# fixture-exclusion config of THIS config repo), the wrapper passes it as
# --config so its [[allowlists]] path exclusions apply to the whole-repo
# self-scan. Other projects have no such file and are scanned as a faithful
# passthrough.
#
# Add to ~/.zshrc or ~/.bashrc for persistence:
#   source ./skills/gitleaks-scan/scripts/gitleaks-scanner-wrapper.sh

gitleaks-docker() {
    local workdir="${GITLEAKS_SCANNER_WORKDIR:-$(pwd)}"
    # Pinned by digest for reproducibility (not a floating :latest tag).
    local image="docker.io/zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

    # Defensive guard: only allow --report-path paths under /src/.scans/ so a
    # misbehaving caller cannot traverse outside the workdir or overwrite
    # project files via the writable mount. Reject path traversal (..), empty
    # or trailing-slash values, and dot basenames.
    _gitleaks_scanner_check_output() {
        local val="$1"
        local base
        if [[ "${val}" != /src/.scans/* ]]; then
            echo "[gitleaks] ERROR: --report-path must be under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        if [[ "${val}" == *"/../"* || "${val}" == */.. || "${val}" == *"//"* ]]; then
            echo "[gitleaks] ERROR: --report-path must be a direct path under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        base="${val#/src/.scans/}"
        if [[ -z "${base}" || "${base}" == .* || "${base}" == */ ]]; then
            echo "[gitleaks] ERROR: --report-path must have a non-empty, non-dot filename under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        return 0
    }

    # Normalize a flag token to its bare name: strip up to two leading dashes
    # and any `=value` suffix (mirrors the osv/trivy wrappers' dash-normalization
    # pattern, restoring guard symmetry across the wrappers).
    _gitleaks_scanner_flagname() {
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
        if [[ "${prev}" == "--report-path" ]]; then
            _gitleaks_scanner_check_output "${arg}" || return 1
        fi
        if [[ "${arg}" == --report-path=* ]]; then
            _gitleaks_scanner_check_output "${arg#--report-path=}" || return 1
        fi
        # `-r` is the legacy `--report` flag (not a --report-path alias), but it
        # still writes a report file, so it must be guarded the same way
        # (validate the value is under /src/.scans/), rather than rejected
        # outright, closing the write-outside hole via the writable mount.
        # Covers `-r <val>` (prev form), `-r=<val>`, and the concatenated
        # `-r<path>` forms (absolute and relative, e.g. `-r.scans/../evil.json`).
        if [[ "${prev}" == "-r" ]]; then
            _gitleaks_scanner_check_output "${arg}" || return 1
        fi
        if [[ "${arg}" == -r=* ]]; then
            _gitleaks_scanner_check_output "${arg#-r=}" || return 1
        fi
        # Broad `-r*` catch for any concatenated `-r<path>` token, validating
        # the remainder by value under /src/.scans/. The `-report*`/`-redact*`
        # long forms are excluded (handled by the dash-normalized parity checks
        # below / not write flags), and `-r=`/bare `-r` are handled above.
        if [[ "${arg}" == -r* && "${arg}" != -report* && "${arg}" != -redact* && "${arg}" != -r=* && "${arg}" != -r ]]; then
            _gitleaks_scanner_check_output "${arg#-r}" || return 1
        fi
        # Dash-normalized parity for the two checks above: `-report-path <val>`
        # (space form, caught via prev) and `-report-path=<val>` (equals form,
        # caught on the current token) must not slip past a `--`-prefix-only
        # match. Re-checking an already-guarded double-dash value is idempotent.
        if [[ "${prev}" == -* ]]; then
            prevname="$(_gitleaks_scanner_flagname "${prev}")"
            if [[ "${prevname}" == "report-path" ]]; then
                _gitleaks_scanner_check_output "${arg}" || return 1
            fi
        fi
        if [[ "${arg}" == -* ]]; then
            argname="$(_gitleaks_scanner_flagname "${arg}")"
            if [[ "${argname}" == "report-path" && "${arg}" == *=* ]]; then
                _gitleaks_scanner_check_output "${arg#*=}" || return 1
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
        echo "[gitleaks] ERROR: .scans must not be a symlink" >&2
        return 1
    fi

    # Ensure the output directory exists so --report-path /src/.scans/<file>
    # works on a fresh checkout (gitleaks may not create parent dirs).
    mkdir -p "${workdir}/.scans"

    # Ensure the image is pulled
    if ! podman image exists "${image}" 2>/dev/null; then
        echo "[gitleaks] Pulling ${image}..." >&2
        podman pull "${image}" >&2 || {
            echo "[gitleaks] ERROR: Failed to pull image" >&2
            return 1
        }
    fi

    # Safe-default injection (mirrors semgrep's conditional safe-default
    # injection): --no-banner suppresses the ASCII banner on stdout and
    # --redact redacts secret values in the report, keeping stdout clean and
    # reducing artifact sensitivity. Injected immediately after the `detect`
    # subcommand token when absent — --no-banner and --redact are flags on the
    # detect subcommand, not persistent root flags, so pre-subcommand
    # placement would make cobra reject them as unknown flags; a caller-
    # supplied flag (any dash form) always wins, so the agent's pinned
    # invocation (which carries neither) gets both defaults.
    local scan_args=("$@")
    local gitleaks_arg
    local has_no_banner="" has_redact="" safe_defaults=()
    # Reject an explicit `--redact=false` (or `--redact=false`-style explicit
    # false) outright: it would silently defeat the safe-default redaction
    # that keeps secret values out of the report artifact. Caller-supplied
    # true/positive forms (`--redact`, `--redact=true`) still win.
    for gitleaks_arg in "$@"; do
        if [[ "${gitleaks_arg}" == --redact=false || "${gitleaks_arg}" == --redact=0 || "${gitleaks_arg}" == --redact=no || "${gitleaks_arg}" == --redact=off ]]; then
            echo "[gitleaks] ERROR: --redact must not be explicitly disabled (got '${gitleaks_arg}')" >&2
            return 1
        fi
    done
    for gitleaks_arg in "$@"; do
        case "${gitleaks_arg}" in
            --no-banner) has_no_banner="yes" ;;
            --redact|--redact=*) has_redact="yes" ;;
        esac
    done
    [[ -n "${has_no_banner}" ]] || safe_defaults+=(--no-banner)
    [[ -n "${has_redact}" ]] || safe_defaults+=(--redact)
    if [[ ${#safe_defaults[@]} -gt 0 ]]; then
        local rebuilt=()
        local injected_defaults=""
        for gitleaks_arg in "${scan_args[@]+"${scan_args[@]}"}"; do
            rebuilt+=("${gitleaks_arg}")
            if [[ -z "${injected_defaults}" && "${gitleaks_arg}" == "detect" ]]; then
                rebuilt+=("${safe_defaults[@]+"${safe_defaults[@]}"}")
                injected_defaults="yes"
            fi
        done
        scan_args=("${rebuilt[@]+"${rebuilt[@]}"}")
    fi

    # Whole-repo self-scan hook (this config repo only, by construction): if
    # the scan root carries .gitleaks.toml, pass it as --config so its
    # [[allowlists]] path exclusions apply to the whole-repo self-scan.
    # gitleaks auto-loads (target path)/.gitleaks.toml, but the explicit
    # --config pointer makes the exclusion deterministic and independent of
    # auto-load behavior. The file NAME is deliberately non-standard for a
    # repo-root config (gitleaks' own auto-load name is .gitleaks.toml, which
    # this IS) — ordinary pipeline targets have no such file, so this wrapper
    # stays a faithful passthrough for them, and scans whose mount root lacks
    # the marker — including the tests/fixtures/gitleaks-demo e2e leg — are
    # byte-for-byte unaffected. The agent's pinned allow-key invocation never
    # carries --config; the injection happens here. A caller-supplied --config
    # (any dash form) always wins. The pair is injected immediately after the
    # `detect` subcommand token (cobra accepts flags there, mirroring the osv
    # wrapper's post-subcommand placement).
    if [[ -f "${workdir}/.gitleaks.toml" ]]; then
        local has_config=""
        for gitleaks_arg in "$@"; do
            if [[ "${gitleaks_arg}" == -* ]] && [[ "$(_gitleaks_scanner_flagname "${gitleaks_arg}")" == "config" ]]; then
                has_config="yes"
            fi
        done
        if [[ -z "${has_config}" ]]; then
            local injected=""
            local rebuilt=()
            for gitleaks_arg in "${scan_args[@]+"${scan_args[@]}"}"; do
                rebuilt+=("${gitleaks_arg}")
                if [[ -z "${injected}" && "${gitleaks_arg}" == "detect" ]]; then
                    rebuilt+=(--config /src/.gitleaks.toml)
                    injected="yes"
                fi
            done
            scan_args=("${rebuilt[@]+"${rebuilt[@]}"}")
            # A planted marker must not suppress coverage silently: announce
            # the injection on stderr (stdout stays clean) so it is visible
            # in the agent's command output.
            echo "[gitleaks] self-scan config active: .gitleaks.toml applied (coverage may be path-suppressed — verify this is your repo, not a third-party tree)" >&2
        fi
    fi

    # The image ships an ENTRYPOINT of `gitleaks` (verified from the upstream
    # Dockerfile), so the caller's arguments pass straight through — no binary
    # name is prepended (prepending would yield `gitleaks gitleaks ...`).
    podman run --rm \
        -v "${workdir}:/src:Z" \
        --workdir /src \
        "${image}" \
        ${scan_args[@]+"${scan_args[@]}"}
}
