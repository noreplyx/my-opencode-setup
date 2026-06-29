#!/bin/bash
# Trivy Podman Wrapper Script
# Source this file in your shell to use trivy-docker as a native trivy replacement:
#   source /path/to/trivy-wrapper.sh
#   trivy-docker fs --severity CRITICAL --exit-code 1 .

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
    local podman_sock="/run/user/$(id -u)/podman/podman.sock"
    if [ -S "$podman_sock" ]; then
      _trivy_ensure_cache
      podman run --rm \
        -v "$podman_sock:/var/run/docker.sock:Z" \
        -v "$TRIVY_CACHE_VOLUME:/root/.cache/trivy:Z" \
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
      -v "${PWD}:/src:Z" \
      -v "$TRIVY_CACHE_VOLUME:/root/.cache/trivy:Z" \
      "$TRIVY_IMAGE" \
      "$target_type" "$@" /src
  elif [ "$target_type" = "sbom" ]; then
    # SBOM - mount current directory, pass args through (user provides SBOM path)
    _trivy_ensure_cache
    podman run --rm \
      -v "${PWD}:/src:Z" \
      -v "$TRIVY_CACHE_VOLUME:/root/.cache/trivy:Z" \
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
