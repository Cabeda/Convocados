#!/bin/sh
# Install git hooks from scripts/ into .git/hooks/
# Run this once after cloning: npm run setup-hooks

HOOKS_DIR="$(git rev-parse --git-dir)/hooks"
SCRIPTS_DIR="$(dirname "$0")"

echo "Installing git hooks..."

cp "$SCRIPTS_DIR/pre-push.sh" "$HOOKS_DIR/pre-push"
chmod +x "$HOOKS_DIR/pre-push"

echo "✓ pre-push hook installed."
