#!/bin/bash
# zap-scanner-wrapper.sh — Use OWASP ZAP (DAST baseline scan) via Podman container
#
# Source this file in your shell to get the `zap-docker` command:
#   source skills/owasp-zap-scan/scripts/zap-scanner-wrapper.sh
#
# Then use it to run ZAP's baseline scanner against a live target URL:
#   zap-docker -t https://example.com -J /src/.scans/zap-baseline.json
#   zap-docker -t https://example.com -J /src/.scans/zap-baseline.json -r /src/.scans/zap-baseline.html -w /src/.scans/zap-baseline.md
#
# Optionally set ZAP_TARGET instead of passing -t:
#   ZAP_TARGET=https://example.com zap-docker -J /src/.scans/zap-baseline.json
#
# Optionally set ZAP_SCANNER_WORKDIR to report under a different directory:
#   ZAP_SCANNER_WORKDIR=/path/to/project zap-docker -t <url> -J /src/.scans/zap-baseline.json
#
# DAST caveat: the target must be reachable from INSIDE the container (the
# default bridge network). For a host-local app use the host's LAN IP, not
# localhost. A failed or unreachable-target run is informational, not blocking.
#
# Add to ~/.zshrc or ~/.bashrc for persistence:
#   source ./skills/owasp-zap-scan/scripts/zap-scanner-wrapper.sh

zap-docker() {
    local workdir="${ZAP_SCANNER_WORKDIR:-$(pwd)}"
    # Pinned by digest for reproducibility (not a floating :latest tag).
    local image="ghcr.io/zaproxy/zaproxy@sha256:32962a6da25e004a0dba2239e12643085e0f4b4982f3ab3f99143b99326f3377"

    # Optional ZAP_TARGET env: inject `-t <url>` when the caller did not pass
    # a target of their own (space, =, and --target forms all suppress it).
    local args=("$@")
    if [[ -n "${ZAP_TARGET:-}" ]]; then
        local has_target=""
        local zap_arg
        for zap_arg in "$@"; do
            case "${zap_arg}" in
                -t|-t=*|--target|--target=*) has_target="yes" ;;
            esac
        done
        if [[ -z "${has_target}" ]]; then
            args=(-t "${ZAP_TARGET}" "${args[@]+"${args[@]}"}")
        fi
    fi

    # Defensive guard: only allow file-WRITE paths under /src/.scans/ so a
    # misbehaving caller cannot traverse outside the workdir or overwrite
    # project files via the writable mount. Reject path traversal (..), empty
    # or trailing-slash values, and dot basenames. ZAP's baseline write flags
    # -r (HTML), -J (JSON), -w (markdown), -x (XML), -g (generated config),
    # and -p (progress file) are legitimate write flags, so they are validated
    # BY VALUE under /src/.scans/ (mirroring the gitleaks -r value-validation
    # pattern) — never rejected outright. Every spelling is covered for each
    # flag: space (`-r <file>`), equals (`-r=<file>`), and concatenated
    # (`-r<file>`) forms, plus the argparse long forms --report-html,
    # --report-json, --report-md, --report-xml, --gen-conf, and --progress in
    # both their space (`--report-json <file>`) and equals
    # (`--report-json=<file>`) spellings (long flags are not concatenated).
    # The single-dash long-form spellings (-report-html, -report-json,
    # -report-md, -report-xml, -gen-conf, -progress) are also guarded by
    # value in their space and equals forms, and are excluded from the
    # short-flag concatenated catch so they are not false-rejected as
    # concatenated short-flag values. The -a flag is a boolean (include
    # alpha rules), not
    # a write flag, so its bare form is left alone; any value-carrying -a=* /
    # -a<path> token, or a non-flag token following a bare `-a`, is invalid ZAP
    # usage and is rejected outright (fail-closed). The -z / --zap-options flag
    # is a value-carrying raw-option passthrough that could smuggle a write
    # outside /src/.scans/, so it is rejected outright (fail-closed). The -t
    # target flag is a URL, not a report path, and is deliberately left
    # unvalidated.
    _zap_scanner_check_output() {
        local val="$1"
        local base
        if [[ "${val}" != /src/.scans/* ]]; then
            echo "[zap] ERROR: report output must be under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        if [[ "${val}" == *"/../"* || "${val}" == */.. || "${val}" == *"//"* ]]; then
            echo "[zap] ERROR: report output must be a direct path under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        base="${val#/src/.scans/}"
        if [[ -z "${base}" || "${base}" == .* || "${base}" == */ ]]; then
            echo "[zap] ERROR: report output must have a non-empty, non-dot filename under /src/.scans/ (got '${val}')" >&2
            return 1
        fi
        return 0
    }

    # zsh-compat: the loop-local flag-name holders are declared ONCE here in
    # the value-carrying `local NAME=""` form (mirrors the other wrappers).
    local prev="" argname="" prevname="" write_flag="" is_single_dash_long="" sd=""
    local write_short_flags=(-r -J -w -x -g -p)
    local write_long_flags=(--report-html --report-json --report-md --report-xml --gen-conf --progress)
    # argparse also accepts single-dash long options (-report-html, -gen-conf,
    # -progress, ...), so these are guarded by value too and excluded from the
    # short-flag concatenated catch below (mirrors gitleaks' -report*/-redact*
    # exclusion from its -r catch).
    local write_single_dash_long_flags=(-report-html -report-json -report-md -report-xml -gen-conf -progress)
    local write_all_flags=(-r -J -w -x -g -p --report-html --report-json --report-md --report-xml --gen-conf --progress -report-html -report-json -report-md -report-xml -gen-conf -progress)
    for arg in "${args[@]+"${args[@]}"}"; do
        # Space form: the previous arg was a bare write flag (short or long),
        # so this arg is its value.
        for write_flag in "${write_all_flags[@]}"; do
            if [[ "${prev}" == "${write_flag}" ]]; then
                _zap_scanner_check_output "${arg}" || return 1
            fi
        done
        # Equals and (short-only) concatenated forms for each write flag.
        # `-r=<val>` / `--report-json=<val>` are validated with the `=` stripped;
        # any other `-r<path>` token is the concatenated form and is validated
        # with the flag prefix stripped (long flags are never concatenated, but
        # an over-long `--report-json<garbage>` token is caught here and rejected
        # as fail-closed). A bare `-r` (space form) is not a path and is skipped.
        # Single-dash long-form write flags (-report-html, -gen-conf, ...) are
        # excluded from the short-flag concatenated catch so they are not
        # false-rejected as concatenated short-flag values (e.g. -report-html
        # matching the -r catch); they are still guarded by value via their own
        # space/equals entries in write_all_flags.
        is_single_dash_long=""
        for sd in "${write_single_dash_long_flags[@]}"; do
            if [[ "${arg}" == "${sd}" || "${arg}" == "${sd}="* ]]; then
                is_single_dash_long="yes"
                break
            fi
        done
        for write_flag in "${write_all_flags[@]}"; do
            if [[ "${arg}" == "${write_flag}="* ]]; then
                _zap_scanner_check_output "${arg#${write_flag}=}" || return 1
            elif [[ -z "${is_single_dash_long}" && "${arg}" == "${write_flag}"* && "${arg}" != "${write_flag}" ]]; then
                _zap_scanner_check_output "${arg#${write_flag}}" || return 1
            fi
        done
        # -a is a boolean flag (include alpha rules); ZAP never accepts a value
        # for it, so any value-carrying -a=* / -a<path> token, or a non-flag
        # token following a bare `-a`, is invalid usage and is rejected outright
        # (fail-closed) to close any theoretical write smuggling via the -a
        # spelling. The bare boolean -a is left alone, and a flag following `-a`
        # (e.g. the legitimate bare `-a -J /src/.scans/...`) is not its value
        # and passes through.
        if [[ "${arg}" == -a=* || ( "${arg}" == -a* && "${arg}" != -a ) ]]; then
            echo "[zap] ERROR: -a is a boolean flag and takes no value (got '${arg}')" >&2
            return 1
        fi
        if [[ "${prev}" == "-a" && "${arg}" != -* ]]; then
            echo "[zap] ERROR: -a is a boolean flag and takes no value (got '${arg}')" >&2
            return 1
        fi
        # -z / --zap-options is a value-carrying raw-option passthrough that
        # could smuggle a write outside /src/.scans/, so it is rejected outright
        # (fail-closed), like the -a value-carrying rejection. Every spelling
        # (bare, `=`-form, and concatenated short `-z<val>`) is covered.
        if [[ "${arg}" == -z* || "${arg}" == --zap-options* ]]; then
            echo "[zap] ERROR: -z/--zap-options is a raw-option passthrough and is not allowed (got '${arg}')" >&2
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
        echo "[zap] ERROR: .scans must not be a symlink" >&2
        return 1
    fi

    # Ensure the output directory exists so -J /src/.scans/<file> works on a
    # fresh checkout (ZAP may not create parent dirs).
    mkdir -p "${workdir}/.scans"

    # Ensure the image is pulled
    if ! podman image exists "${image}" 2>/dev/null; then
        echo "[zap] Pulling ${image}..." >&2
        podman pull "${image}" >&2 || {
            echo "[zap] ERROR: Failed to pull image" >&2
            return 1
        }
    fi

    # The image ships an ENTRYPOINT of `zap.sh`, which dispatches to
    # zap-baseline.py when it is the first argument, so the caller's
    # arguments pass straight through (no binary name is prepended).
    podman run --rm \
        -v "${workdir}:/src:Z" \
        --workdir /src \
        "${image}" \
        zap-baseline.py \
        ${args[@]+"${args[@]}"}
}
