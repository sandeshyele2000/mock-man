#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  printf 'Usage: bash %s <version>\nExample: bash %s 1.0.2\n' "${0##*/}" "${0##*/}" >&2
  exit 1
fi

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$1"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

printf 'Building and pushing Mockman version %s for %s\n' "$VERSION" "$PLATFORMS"

docker buildx build \
  --platform "$PLATFORMS" \
  -f "$PROJECT_ROOT/backend/Dockerfile" \
  --label org.opencontainers.image.source=https://github.com/sandeshyele2000/mock-man \
  -t "ghcr.io/sandeshyele2000/mockman-backend:${VERSION}" \
  --push "$PROJECT_ROOT"

docker buildx build \
  --platform "$PLATFORMS" \
  -f "$PROJECT_ROOT/frontend/Dockerfile" \
  --label org.opencontainers.image.source=https://github.com/sandeshyele2000/mock-man \
  -t "ghcr.io/sandeshyele2000/mockman-dashboard:${VERSION}" \
  --push "$PROJECT_ROOT"

printf 'Successfully pushed both images with version %s\n' "$VERSION"
