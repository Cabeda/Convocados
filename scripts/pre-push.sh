#!/bin/sh
# Pre-push hook: run lint, typecheck and tests before pushing to catch CI failures early
# Install: npm run setup-hooks (or run scripts/install-hooks.sh)

echo "Running pre-push checks..."

# Lint (zero errors allowed; warnings tracked but not blocking)
echo "→ Linting..."
npx eslint src/ --max-warnings 530
if [ $? -ne 0 ]; then
  echo "✗ Lint failed. Push aborted."
  exit 1
fi

# Type check
echo "→ Type checking..."
npm run typecheck
if [ $? -ne 0 ]; then
  echo "✗ Type check failed. Push aborted."
  exit 1
fi

# Tests with coverage
echo "→ Running tests with coverage..."
npx vitest run --coverage
if [ $? -ne 0 ]; then
  echo "✗ Tests failed. Push aborted."
  exit 1
fi

echo "✓ All checks passed."
exit 0