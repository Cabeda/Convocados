#!/bin/sh
# Pre-push hook: every cheap gate, then the suite.
# Install: pnpm setup-hooks (or run scripts/install-hooks.sh)
#
# Ordering is deliberate: the expensive check runs last, so a lint or coverage
# failure does not make you wait four minutes to find out. Gate 1 is defined here
# and in scripts/factory/gate.sh, and src/test/gate-parity.test.ts fails if the
# two disagree about the cheap set — "Gate 1 passed" has to mean one thing.
#
# The lint warning cap lives in package.json's `lint` script, not here: it was
# duplicated as a literal in this file and in gate.sh, at 259 against a real
# count of 187, so 72 warnings could land before anything blocked. CI never had a
# cap at all.

set -u

echo "Running pre-push checks..."
root="$(git rev-parse --show-toplevel)"
failed=0

# ── Cheap checks first ──────────────────────────────────────────────────────

echo "→ Linting..."
if ! pnpm lint; then
  echo "✗ Lint failed. Push aborted."
  failed=1
fi

# Secrets scan (gitleaks) — scans the commits actually being pushed, read from stdin.
# Scanning the index here would be useless: at push time it is empty.
sh "$root/scripts/secret-scan.sh" push
if [ $? -ne 0 ]; then
  echo "✗ Secrets detected. Push aborted. Review .gitleaks.toml allowlist or remove secret."
  failed=1
fi

# Dex ledger integrity — .dex/tasks.jsonl is merge=union, so a rebase/merge
# across main can splice duplicate task lines silently. Warn only: the check
# reads the working tree, and a duplicate sitting in it should not block a push
# unrelated to the ledger. The `dex-ledger` CI job is the blocking backstop.
echo "→ Checking dex ledger for duplicates..."
node "$root/scripts/dex-dedupe.mjs" --check
if [ $? -ne 0 ]; then
  echo "⚠ Duplicate task id in .dex/tasks.jsonl — run 'node scripts/dex-dedupe.mjs' and commit. CI will fail otherwise."
fi

echo "→ Route coverage..."
if ! bash "$root/scripts/route-coverage.sh"; then
  echo "✗ Route coverage failed. Push aborted."
  failed=1
fi

echo "→ Feature parity docs..."
if ! pnpm check:feature-parity; then
  echo "✗ docs/feature-parity.md is out of date. Run 'pnpm sync:feature-parity-docs' and commit. Push aborted."
  failed=1
fi

echo "→ Generated API client..."
if ! pnpm check:api-client; then
  echo "✗ src/lib/api/generated.ts is out of date. Run 'pnpm generate:api-client' and commit. Push aborted."
  failed=1
fi

echo "→ Play listing assets..."
if ! pnpm check:play-listing; then
  echo "✗ Play listing assets failed. Push aborted."
  failed=1
fi

echo "→ Play screenshots..."
if ! pnpm check:play-screenshots; then
  echo "✗ Play screenshots failed. Push aborted."
  failed=1
fi

# A fresh CVE in a transitive dependency is not repairable by editing our code,
# so it must fail here rather than burn a CI loop (AGENTS.md → Gates).
echo "→ Dependency audit (high)..."
if ! pnpm audit --audit-level high; then
  echo "✗ Dependency audit failed. Push aborted."
  failed=1
fi

# SAST (semgrep) — optional, slow (~60s). Warn-only in pre-push, CI enforces.
if command -v semgrep >/dev/null 2>&1; then
  echo "→ SAST scan (semgrep owasp-top-ten, blocking only)..."
  semgrep --config p/owasp-top-ten --error --quiet --exclude-rule generic.secrets.security.detected-generic-api-key 2>&1 | head -n 50
  if [ $? -ne 0 ]; then
    echo "⚠ semgrep found findings (see above). Push continues — fix before merge. Run 'semgrep --config p/owasp-top-ten' for details."
  fi
else
  echo "⚠ semgrep not installed, skipping SAST (brew install semgrep)"
fi

# ── Then the two that cost minutes ──────────────────────────────────────────

echo "→ Type checking..."
if ! pnpm typecheck; then
  echo "✗ Type check failed. Push aborted."
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "→ Running tests with coverage..."
if ! pnpm vitest run --coverage; then
  echo "✗ Tests failed. Push aborted."
  echo ""
  echo "Coverage detail (files below 94% line threshold):"
  sh "$root/scripts/coverage-report.sh" 94
  exit 1
fi

# Mutation testing is no longer a pre-push gate. It is run on-demand:
#   - locally:  pnpm test:mutation  (slow, ~1-2h)
#   - CI:       manually via the "Mutation" workflow_dispatch job
# It was removed from the pre-push hook because the Stryker run takes 1-2 hours
# and gets OOM-killed in normal worktrees, blocking every push.

echo "✓ All checks passed."
exit 0
