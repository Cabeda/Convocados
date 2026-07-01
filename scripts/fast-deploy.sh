#!/bin/sh
# Fast deploy: builds locally with Docker cache, pushes to Fly registry, deploys the image.
# Skips the remote builder entirely. Typically <30s when layers are cached.
#
# Usage: ./scripts/fast-deploy.sh
#
# Prerequisites:
#   - Docker running locally
#   - flyctl authenticated (flyctl auth login)
#   - flyctl auth docker (authenticates Docker to Fly registry)

set -e

APP="convocados"
REGISTRY="registry.fly.io/$APP"
TAG="$(git rev-parse --short HEAD)"
IMAGE="$REGISTRY:$TAG"

echo "→ Building image locally (cached layers)..."
docker build \
  --tag "$IMAGE" \
  --tag "$REGISTRY:latest" \
  --cache-from "$REGISTRY:latest" \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  .

echo "→ Pushing to Fly registry..."
docker push "$IMAGE"
docker push "$REGISTRY:latest"

echo "→ Deploying $IMAGE..."
flyctl deploy --image "$IMAGE" --app "$APP" --strategy immediate --wait-timeout 60s

echo "✓ Deployed $TAG to https://convocados.fly.dev/"
