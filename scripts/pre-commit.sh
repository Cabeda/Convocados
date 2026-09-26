#!/bin/sh
# Pre-commit hook: block secrets before they enter a commit.
# Install with: pnpm setup-hooks
# The scan logic lives in scripts/secret-scan.sh (shared with pre-push).

root="$(git rev-parse --show-toplevel)"
exec sh "$root/scripts/secret-scan.sh" staged
