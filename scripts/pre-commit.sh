#!/bin/sh
# Pre-commit hook: block secrets before they enter a commit.
# Install with: pnpm setup-hooks
# The scan logic lives in scripts/secret-scan.sh (shared with pre-push).

# A commit on main is almost always a branch-switch that did not happen: this
# session made two (one recovered only because its push failed). The remote
# rejects the push, so the cost is a rebase of work that never belonged there;
# refusing at the commit names the mistake while the fix is `git switch -c`.
branch="$(git symbolic-ref --quiet --short HEAD || echo "")"
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "✗ Refusing to commit on $branch." >&2
  echo "  Create a branch first: git switch -c <feat|fix|chore>/<slug>" >&2
  exit 1
fi

root="$(git rev-parse --show-toplevel)"
exec sh "$root/scripts/secret-scan.sh" staged
