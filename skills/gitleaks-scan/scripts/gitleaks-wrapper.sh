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
#
# Cross-platform: works on Linux, macOS (via Podman Machine), and Windows (via Git Bash/WSL2).

# --- Platform detection ---
case "$(uname -s)" in
  Linux*)  _OS="linux" ;;
  Darwin*) _OS="macos" ;;
  CYGWIN*|MINGW*|MSYS*) _OS="windows" ;;
  *)       _OS="linux" ;;
esac

# SELinux label: only on Linux, configurable via env var (set SELINUX_OPT="" to disable)
SELINUX_OPT="${SELINUX_OPT:-:Z}"
[ "$_OS" != "linux" ] && SELINUX_OPT=""
# --- End platform detection ---

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
  local last_arg
  last_arg="${@: -1}"
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
  # Skip if --source= is already provided (explicit source path)
  case "$first_arg" in
    git|dir|file|directory)
      if ! $has_path_arg; then
        local has_source=false
        for arg in "$@"; do
          case "$arg" in --source=*) has_source=true ;; esac
        done
        if ! $has_source; then
          set -- "$@" "/src"
        fi
      fi
      ;;
  esac

  podman run --rm \
    -v "$(pwd):/src${SELINUX_OPT}" \
    "$GITLEAKS_IMG" \
    "$@"
}

# Export so sub-shells can use it
export -f gitleaks-docker 2>/dev/null || true
