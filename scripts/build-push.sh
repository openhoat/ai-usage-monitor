#!/usr/bin/env bash
set -euo pipefail

# Build and push the ai-usage-monitor image to the op3n-cloud registry.
# Uses docker build + skopeo copy (skopeo reads registry credentials
# from ~/.docker/config.json).
# Usage: ./scripts/build-push.sh [version]

REGISTRY="${REGISTRY:-op3n.cloud:5000}"
IMAGE="ai-usage-monitor"

VERSION="${1:-$(node -p "require('./package.json').version")}"
TAG="${REGISTRY}/${IMAGE}:${VERSION}"

echo "Building ${TAG}..."
docker build -t "${TAG}" .

echo "Pushing ${TAG} to registry..."
skopeo copy --dest-tls-verify=false \
  "docker-daemon:${TAG}" \
  "docker://${TAG}"

echo "Done: ${TAG}"