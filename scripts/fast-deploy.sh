#!/bin/sh
# Fast deploy: builds app image on top of cached base, pushes to Fly registry.
# Base image (deps/prisma/litestream) only rebuilds when --rebuild-base is passed.
#
# Usage:
#   ./scripts/fast-deploy.sh              # Fast: app layer only (~5s build + push + deploy)
#   ./scripts/fast-deploy.sh --rebuild-base  # Full: rebuild base + app (after lockfile/schema change)
#
# Prerequisites:
#   - Docker running locally
#   - flyctl auth docker (authenticates Docker to Fly registry)

set -e

APP="convocados"
REGISTRY="registry.fly.io/$APP"
TAG="$(git rev-parse --short HEAD)"

if [ "$1" = "--rebuild-base" ]; then
  echo "→ Rebuilding base image (deps + prisma + litestream)..."
  docker build --tag "$REGISTRY:base" --file Dockerfile.base .
  docker push "$REGISTRY:base"
  echo "✓ Base image pushed"
fi

echo "→ Building app (pre-build required: run 'pnpm build' first)..."
if [ ! -d "dist" ]; then
  echo "  dist/ not found, building..."
  pnpm build
fi

echo "→ Building app image (thin layer on base)..."
docker build \
  --tag "$REGISTRY:$TAG" \
  --tag "$REGISTRY:latest" \
  --file Dockerfile.deploy \
  .

echo "→ Pushing app image..."
docker push "$REGISTRY:$TAG"

echo "→ Deploying..."
flyctl deploy --image "$REGISTRY:$TAG" --app "$APP" --strategy immediate --wait-timeout 60s

echo "✓ Deployed $TAG to https://convocados.fly.dev/"
