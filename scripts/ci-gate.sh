#!/bin/sh
# The CI gate: the single required status check for branch protection.
#
# Input: the `needs` context as JSON on stdin (the workflow's `toJSON(needs)`).
#        CI_GATE_ON_MAIN=true when the run is a push to main.
#
# It names the blocker it found. A red "CI" that does not say which job went
# red sends whoever is reading it hunting through twenty green rows to find the
# one that is not — the gate's whole job is to name the blocker.
#
# Lives in a script, not inline in the workflow, so `src/test/ci-gate.test.ts`
# can exercise it before a push. A gate that only ever runs on the runner is a
# gate nobody can test.
set -eu

needs="$(cat)"
on_main="${CI_GATE_ON_MAIN:-false}"

failed="$(printf '%s' "$needs" | jq -r 'to_entries[] | select(.value.result == "failure") | .key')"
if [ -n "$failed" ]; then
  echo "Required job(s) failed:"
  printf '  %s\n' $failed
  exit 1
fi

cancelled="$(printf '%s' "$needs" | jq -r 'to_entries[] | select(.value.result == "cancelled") | .key')"
if [ -n "$cancelled" ]; then
  echo "Required job(s) were cancelled:"
  printf '  %s\n' $cancelled
  # A push cancels the previous run's jobs, so this run is the one that was
  # superseded. The gate that decides is the newest run's: read the check run
  # for the PR's head SHA, not this one.
  echo "This run was superseded by a newer push. The gate that decides is the newest run's —"
  echo "read the check run for the PR's head SHA."
  exit 1
fi

# On main the Android jobs are mandatory, so a skip is a silent hole rather
# than an optimisation — fail loudly instead of going green.
if [ "$on_main" = "true" ]; then
  skipped_android="$(printf '%s' "$needs" | jq -r 'to_entries[] | select(.key == "android" or .key == "android-wear") | select(.value.result == "skipped") | .key')"
  if [ -n "$skipped_android" ]; then
    echo "Android Build / Wear OS Build were skipped on main — main must compile"
    exit 1
  fi
fi

echo "All required jobs passed"
