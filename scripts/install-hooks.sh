#!/bin/sh
# Install git hooks from scripts/ into the git hooks directory.
# Run this once after cloning: pnpm setup-hooks
# Uses --git-path hooks so it works in worktrees too (resolves to the shared
# hooks dir git actually reads from).

HOOKS_DIR="$(git rev-parse --git-path hooks)"
SCRIPTS_DIR="$(dirname "$0")"

echo "Installing git hooks..."

mkdir -p "$HOOKS_DIR"
cp "$SCRIPTS_DIR/pre-commit.sh" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
cp "$SCRIPTS_DIR/pre-push.sh" "$HOOKS_DIR/pre-push"
chmod +x "$HOOKS_DIR/pre-push"

echo "✓ pre-commit hook installed (secret scan)."
echo "✓ pre-push hook installed."
