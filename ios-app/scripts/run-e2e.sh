#!/usr/bin/env bash
# Run the iOS e2e UI test on the simulator against a local dev server.
set -euo pipefail

cd "$(dirname "$0")/.."

DEVICE="${1:-iPhone 17 Pro}"

echo "==> Ensuring dev server is running on :4321"
if ! curl -sf http://localhost:4321/api/health > /dev/null; then
  echo "Dev server not running. Start it first: npm run dev (from repo root)"
  exit 1
fi

echo "==> Generating Xcode project"
xcodegen generate

echo "==> Running e2e UI tests on '$DEVICE'"
xcodebuild \
  -project Convocados.xcodeproj \
  -scheme Convocados \
  -destination "platform=iOS Simulator,name=$DEVICE" \
  -derivedDataPath build/DerivedData \
  test

echo "==> E2E tests passed"
