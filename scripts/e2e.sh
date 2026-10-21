#!/bin/sh
# Playwright, with the arguments the caller means.
#
# pnpm passes a literal `--` through to the script, and Playwright reads it as
# "end of options": everything after it becomes a *file filter*. So
# `pnpm test:e2e -- --grep "Skill Rating"` silently ran the whole suite
# instead of the one test. Drop the separator.
#
# Usage: pnpm test:e2e [playwright args]
set -eu

if [ "${1:-}" = "--" ]; then
  shift
fi

exec pnpm exec playwright test "$@"
