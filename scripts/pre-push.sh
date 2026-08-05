#!/bin/sh
# Pre-push hook: run lint, typecheck and tests before pushing to catch CI failures early
# Install: npm run setup-hooks (or run scripts/install-hooks.sh)

echo "Running pre-push checks..."

# Lint (zero errors allowed; warnings tracked but not blocking)
echo "→ Linting..."
npx eslint src/ --max-warnings 259

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
  echo ""
  echo "Coverage detail (files below 94% line threshold):"
  sh "$(dirname "$0")/coverage-report.sh" 94
  exit 1
fi

# Mutation testing — dead-code gate. A surviving mutant is code whose behaviour
# no test cares about (dead or untested). Stryker's `break` threshold (80) fails
# the run when the mutation score drops below it, so dead code can't be pushed.
# The dry run can SIGSEGV intermittently (better-sqlite3 native addon + vitest
# threads pool under the stryker sandbox) — retry once on a crashed dry run.
echo "→ Running mutation testing (dead-code gate)..."
npm run test:mutation
if [ $? -ne 0 ]; then
  echo "  Mutation run failed. Retrying once (intermittent SIGSEGV in dry run)..."
  npm run test:mutation
  if [ $? -ne 0 ]; then
    echo "✗ Mutation testing failed. Dead code detected or mutation score below break threshold. Push aborted."
    echo "  Run 'npm run test:mutation' locally and inspect reports/mutation/index.html."
    exit 1
  fi
fi

echo "✓ All checks passed."
exit 0