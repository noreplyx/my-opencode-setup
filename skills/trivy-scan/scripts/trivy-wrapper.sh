#!/bin/bash
# Trivy Podman Wrapper Script
# Source this file in your shell to use trivy-docker as a native trivy replacement:
#   source /path/to/trivy-wrapper.sh
#   trivy-docker fs --severity CRITICAL --exit-code 1 .
#
# Cross-platform: works on Linux, macOS (via Podman Machine), and Windows (via Git Bash/WSL2).
# On Windows, use Git Bash or WSL2 — not cmd.exe or PowerShell directly.

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

# Podman socket path: configurable via env var
PODMAN_SOCK="${PODMAN_SOCK:-/run/user/$(id -u)/podman/podman.sock}"

# --- End platform detection ---

TRIVY_IMAGE="${TRIVY_IMAGE:-docker.io/aquasec/trivy:latest}"
TRIVY_CACHE_VOLUME="${TRIVY_CACHE_VOLUME:-trivy-cache}"

# Ensure the image is pulled
_trivy_ensure_image() {
  if ! podman image exists "$TRIVY_IMAGE" 2>/dev/null; then
    echo "Pulling Trivy image: $TRIVY_IMAGE ..." >&2
    podman pull "$TRIVY_IMAGE"
  fi
}

# Ensure the cache volume exists
_trivy_ensure_cache() {
  if ! podman volume exists "$TRIVY_CACHE_VOLUME" 2>/dev/null; then
    echo "Creating Trivy cache volume: $TRIVY_CACHE_VOLUME ..." >&2
    podman volume create "$TRIVY_CACHE_VOLUME"
  fi
}

trivy-docker() {
  _trivy_ensure_image

  local target_type=""
  local target_path=""

  # Parse subcommand
  case "${1:-}" in
    image|fs|repo|rootfs|sbom|k8s|version)
      target_type="$1"
      shift
      ;;
    *)
      echo "Usage: trivy-docker <image|fs|repo|rootfs|sbom|k8s> [options] <target>"
      echo ""
      echo "Trivy targets:"
      echo "  image   Scan a container image (uses Podman socket if local)"
      echo "  fs      Scan a filesystem/project directory"
      echo "  repo    Scan a git repository (remote URL)"
      echo "  rootfs  Scan a root filesystem"
      echo "  sbom    Scan an SBOM file"
      echo "  k8s     Scan a Kubernetes resource"
      echo "  version Show Trivy version"
      return 1
      ;;
  esac

  # Special handling for 'image' subcommand - needs Podman socket
  if [ "$target_type" = "image" ]; then
    # For local images, mount the Podman socket
    if [ -S "$PODMAN_SOCK" ]; then
      _trivy_ensure_cache
      podman run --rm \
        -v "$PODMAN_SOCK:/var/run/docker.sock${SELINUX_OPT}" \
        -v "$TRIVY_CACHE_VOLUME:/root/.cache/trivy${SELINUX_OPT}" \
        "$TRIVY_IMAGE" \
        image "$@"
    else
      # For public images, no socket needed
      podman run --rm "$TRIVY_IMAGE" image "$@"
    fi
  elif [ "$target_type" = "version" ]; then
    podman run --rm "$TRIVY_IMAGE" version
  elif [ "$target_type" = "fs" ] || [ "$target_type" = "rootfs" ]; then
    # Filesystem/rootfs - mount current directory, append /src as target
    _trivy_ensure_cache
    podman run --rm \
      -v "$(pwd):/src${SELINUX_OPT}" \
      -v "$TRIVY_CACHE_VOLUME:/root/.cache/trivy${SELINUX_OPT}" \
      "$TRIVY_IMAGE" \
      "$target_type" "$@" /src
  elif [ "$target_type" = "sbom" ]; then
    # SBOM - mount current directory, pass args through (user provides SBOM path)
    _trivy_ensure_cache
    podman run --rm \
      -v "$(pwd):/src${SELINUX_OPT}" \
      -v "$TRIVY_CACHE_VOLUME:/root/.cache/trivy${SELINUX_OPT}" \
      "$TRIVY_IMAGE" \
      "$target_type" "$@"
  else
    # repo, k8s - no mount needed, pass args through directly
    podman run --rm "$TRIVY_IMAGE" "$target_type" "$@"
  fi
}

# Also provide legacy alias (function, not alias, for non-interactive shell support)
trivy-scan() { trivy-docker fs "$@"; }

echo "Trivy wrapper loaded."
echo "  Commands: trivy-docker <fs|image|repo|sbom|k8s> [options]"
echo "  Example:  trivy-docker fs --severity CRITICAL,HIGH --exit-code 1 ."
