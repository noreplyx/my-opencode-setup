#!/usr/bin/env bash
# Gitleaks Container Wrapper — use gitleaks via Podman without local install
#
# Usage: gitleaks-docker <command> [options] [path]
#
# Examples:
#   gitleaks-docker git --verbose          # scan current dir (git mode)
#   gitleaks-docker dir --verbose          # scan current dir (file mode)
#   gitleaks-docker version                # show version
#   gitleaks-docker git --report-format=json --report-path=-   # JSON to stdout
#
# Add to ~/.zshrc or ~/.bashrc:
#   source /path/to/gitleaks-wrapper.sh

GITLEAKS_IMG="${GITLEAKS_IMAGE:-docker.io/zricethezav/gitleaks:latest}"

gitleaks-docker() {
  if [ $# -eq 0 ]; then
    podman run --rm "$GITLEAKS_IMG" --help
    return
  fi

  local first_arg="$1"

  # Commands that use the current dir as positional path
  local path_commands="git|dir|file|directory"

  # Check if the last arg is a path (not starting with - and not a subcommand)
  local last_arg="${@: -1}"
  local has_path_arg=false
  case "$last_arg" in
    -*|git|dir|file|directory|detect|protect|stdin|version|completion|help)
      # last arg is a flag or subcommand — no explicit path
      ;;
    *)
      has_path_arg=true
      ;;
  esac

  # If the command uses paths but no path was given, default to /src
  case "$first_arg" in
    git|dir|file|directory|detect|protect)
      if ! $has_path_arg; then
        set -- "$@" "/src"
      fi
      ;;
  esac

  podman run --rm \
    -v "${PWD}:/src:Z" \
    "$GITLEAKS_IMG" \
    "$@"
}

# Export so sub-shells can use it
export -f gitleaks-docker 2>/dev/null || true
