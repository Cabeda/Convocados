#!/bin/sh
# Run a Gradle Play publish/promote task, tolerating Google Play's daily save
# quota.
#
# The Release workflow runs on every merge to main, and each run performs ~10
# Play API writes (publish to internal, promote across tracks, for both apps).
# A burst of merges exhausts Play's "save" quota for the day, after which the
# API returns 403 "Daily save quota exceeded". That is an external, self-healing
# rate limit, not a defect in the app or the workflow, so it should not mark the
# whole release — GitHub release, APK assets and the web deploy — as failed.
#
# On quota exhaustion this wrapper logs a warning, records it in the step
# summary, and exits 0. Every other failure still propagates. Once the quota is
# hit, later invocations in the same job short-circuit, so the promotion steps
# don't fail for the knock-on reason (there is nothing on internal to promote).
#
# Backfill the skipped Play writes with the "Promote Play Release" workflow once
# the quota resets.
set -eu

log=$(mktemp)
trap 'rm -f "$log"' EXIT

flag="${RUNNER_TEMP:-/tmp}/play-quota-exceeded"

if [ -f "$flag" ]; then
  echo "Google Play writes skipped: the daily save quota was already exceeded in this run."
  echo "  skipped: $*"
  exit 0
fi

if "$@" >"$log" 2>&1; then
  cat "$log"
  exit 0
fi

cat "$log"

if grep -q "Daily save quota exceeded" "$log"; then
  : > "$flag"
  echo "::warning::Google Play daily save quota exceeded — this Play write was skipped. Backfill it with the 'Promote Play Release' workflow once the quota resets."
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### ⚠️ Google Play quota exceeded"
      echo ""
      echo "Google Play rejected a write with **403 Daily save quota exceeded**."
      echo "The rest of the release completed; the Play upload for this version is"
      echo "pending and must be backfilled with the **Promote Play Release** workflow"
      echo "once the quota resets (daily)."
      echo ""
      echo '```'
      echo "$*"
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

exit 1
