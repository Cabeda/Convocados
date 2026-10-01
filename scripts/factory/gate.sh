#!/usr/bin/env bash
# Gate 1 — the local Gate, in one sequential script.
#
# This script is the single source of truth for what a Change must clear before
# it is pushed. It lives in a script, not in a prompt, because a prompt can be
# ignored and a script that exits non-zero cannot. Every rule about a measured
# number (Core Principle 6, ADR 0047) is enforced here; if you change a
# threshold or a scenario, change it here in the same PR.
#
# Usage:  bash scripts/factory/gate.sh [--base <ref>] [--skip-android] [--skip-e2e]
#
# Exit codes: 0 green · 1 a Gate failed · 2 the Change is too big to be
# reviewable in one sitting (split and hand back — never truncate).
set -euo pipefail

BASE="${FACTORY_BASE_REF:-main}"
SKIP_ANDROID=0
SKIP_E2E=0
MAX_LINES=400   # AGENTS.md: a Change over this fails Gate 1
MAX_FILES=20    # AGENTS.md: a Change over this fails Gate 1

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --skip-android) SKIP_ANDROID=1; shift ;;
    --skip-e2e) SKIP_E2E=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

LOG_DIR="${FACTORY_GATE_LOG_DIR:-.factory-gate}"
mkdir -p "$LOG_DIR"

step=0
failed=""

run_gate() {
  # run_gate <name> <command...> — sequential by design (Core Principle 6:
  # measurements that contend for resources produce numbers nobody can trust).
  step=$((step + 1))
  local name="$1"; shift
  local log="$LOG_DIR/$(printf '%02d' "$step")-$name.log"
  echo "── Gate 1 [$step] $name"
  if "$@" >"$log" 2>&1; then
    echo "   green  ($log)"
  else
    local code=$?
    echo "   RED    ($log, exit $code)" >&2
    echo "--- tail of $name ---" >&2
    tail -n 40 "$log" >&2
    failed="$name"
    return 1
  fi
}

# ── Scope: split-and-hand-back ───────────────────────────────────────────────
# Measured before anything else, because a Change too big to read should never
# spend the Gate's time. Diffed against the working tree, not just HEAD: an
# agent that forgets to commit must still be measured, or the cap silently
# measures nothing.
git fetch --quiet origin "$BASE" || true
if git diff --quiet "origin/$BASE" -- . 2>/dev/null; then
  echo "── Gate 1 [0] scope: no diff against origin/$BASE"
  exit 0
fi
changed_files=$(git diff --name-only "origin/$BASE" -- . | wc -l | tr -d ' ')
changed_lines=$(git diff --numstat "origin/$BASE" -- . | awk '{a+=$1; d+=$2} END {print a+d+0}')
echo "── Gate 1 [0] scope: $changed_lines changed lines across $changed_files files (max $MAX_LINES lines / $MAX_FILES files)"
if [ "$changed_lines" -gt "$MAX_LINES" ] || [ "$changed_files" -gt "$MAX_FILES" ]; then
  cat >&2 <<EOF
   RED    scope: $changed_lines lines / $changed_files files exceeds ${MAX_LINES}/${MAX_FILES}.

A Change over that size is not reviewable in one sitting. Split the work and
hand back: file the sub-issues, or open one Change for the first coherent slice
and say in the Handoff what the rest is. Never truncate the work to fit a budget,
and never raise the cap to make this pass.
EOF
  exit 2
fi

# ── The Gates ───────────────────────────────────────────────────────────────
run_gate lint pnpm lint --max-warnings 259 || exit 1
run_gate typecheck pnpm typecheck || exit 1
run_gate vitest-coverage pnpm vitest run --coverage || exit 1
run_gate route-coverage pnpm test:route-coverage || exit 1
run_gate feature-parity pnpm sync:feature-parity-docs || exit 1
run_gate play-listing pnpm check:play-listing || exit 1
run_gate audit pnpm audit --audit-level high || exit 1

# Playwright only when the diff can change a page: running it otherwise wastes
# minutes and teaches nothing.
if [ "$SKIP_E2E" -eq 0 ] && git diff --name-only "origin/$BASE" -- . | grep -qE '^(src/pages/|e2e/)'; then
  run_gate e2e pnpm test:e2e || exit 1
else
  echo "── Gate 1 [skip] e2e: diff does not touch src/pages/** or e2e/**"
fi

if [ "$SKIP_ANDROID" -eq 0 ]; then
  if [ -x android-app/gradlew ]; then
    step=$((step + 1))
    log="$LOG_DIR/$(printf '%02d' "$step")-gradle-assembleDebug.log"
    echo "── Gate 1 [$step] gradle-assembleDebug (:app + :wear) + syncPlayListingText"
    # Both modules, one invocation: assembleDebug builds the whole project.
    # syncPlayListingText stages the listing text Gradle Play Publisher uploads.
    if (cd android-app && ./gradlew assembleDebug syncPlayListingText) >"$log" 2>&1; then
      echo "   green  ($log)"
    else
      code=$?
      echo "   RED    ($log, exit $code)" >&2
      tail -n 40 "$log" >&2
      exit 1
    fi

    # Validate the *staged* copy, not just the source: those are different
    # directories, and the staged one is what Play receives. A staging defect
    # would otherwise ship with every gate green.
    run_gate play-listing-staged \
      node scripts/check-play-listing.mjs \
      --listing android-app/app/src/main/play/listings --wear android-app/wear || exit 1
    run_gate play-listing-staged-wear \
      node scripts/check-play-listing.mjs \
      --listing android-app/wear/src/main/play/listings --wear android-app/wear || exit 1
  else
    echo "── Gate 1 [skip] android: no android-app/gradlew in this checkout"
  fi
else
  echo "── Gate 1 [skip] android: --skip-android"
fi

echo "── Gate 1 green. Logs in $LOG_DIR"
