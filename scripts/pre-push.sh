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

# Secrets scan (gitleaks) — scan unpushed commits only; full history is
# triaged separately (known historical .env finding, tracked for rotation)
if command -v gitleaks >/dev/null 2>&1; then
  echo "→ Secrets scan (gitleaks)..."
  if git rev-parse -q --verify "@{upstream}" >/dev/null 2>&1; then
    GITLEAKS_LOG_OPTS="--log-opts=@{upstream}..HEAD"
  elif git rev-parse -q --verify origin/main >/dev/null 2>&1; then
    GITLEAKS_LOG_OPTS="--log-opts=origin/main..HEAD"
  else
    GITLEAKS_LOG_OPTS="--staged"
  fi
  gitleaks git --verbose --redact --no-banner --config .gitleaks.toml $GITLEAKS_LOG_OPTS
  if [ $? -ne 0 ]; then
    echo "✗ Secrets detected in unpushed commits. Push aborted. Remove the secret and rewrite the commit, or review .gitleaks.toml allowlist."
    exit 1
  fi
else
  echo "⚠ gitleaks not installed, skipping secrets scan (brew install gitleaks)"
fi

# SAST (semgrep) — optional, slow (~60s). Warn-only in pre-push, CI enforces.
if command -v semgrep >/dev/null 2>&1; then
  echo "→ SAST scan (semgrep owasp-top-ten, blocking only)..."
  SEMGREP_OUT="$(mktemp)"
  semgrep --config p/owasp-top-ten --error --quiet --exclude-rule generic.secrets.security.detected-generic-api-key >"$SEMGREP_OUT" 2>&1
  semgrep_status=$?
  if [ "$semgrep_status" -ne 0 ]; then
    head -n 50 "$SEMGREP_OUT"
    echo "⚠ semgrep found findings (see above). Push continues — fix before merge. Run 'semgrep --config p/owasp-top-ten' for details."
  fi
  rm -f "$SEMGREP_OUT"
else
  echo "⚠ semgrep not installed, skipping SAST (brew install semgrep)"
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

# Mutation testing is no longer a pre-push gate. It is run on-demand:
#   - locally:  npm run test:mutation  (slow, ~1-2h)
#   - CI:       manually via the "Mutation" workflow_dispatch job
# It was removed from the pre-push hook because the Stryker run takes 1-2 hours
# and gets OOM-killed in normal worktrees, blocking every push.

echo "✓ All checks passed."
exit 0