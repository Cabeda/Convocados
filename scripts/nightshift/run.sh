#!/usr/bin/env bash
# Nightshift — the local auto-merge loop.
#
# Runs until the stop time (NIGHTSHIFT_UNTIL) or until FACTORY_PAUSED=true. Every
# iteration: one merge pass over what is already ready, then up to
# NIGHTSHIFT_WORKERS Issues worked in parallel. Merging deploys (release.yml fires
# on green main), so the guards live in scripts/nightshift/merge-eligibility.ts and
# this script only schedules.
#
# Usage:
#   NIGHTSHIFT_WORKERS=3 NIGHTSHIFT_UNTIL=07:00 bash scripts/nightshift/run.sh
#   NIGHTSHIFT_DRY_RUN=1 bash scripts/nightshift/run.sh      # select + report only
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || exit 1

WORKERS=${NIGHTSHIFT_WORKERS:-2}
UNTIL=${NIGHTSHIFT_UNTIL:-07:00}
SLEEP=${NIGHTSHIFT_SLEEP:-60}
DRY_RUN=${NIGHTSHIFT_DRY_RUN:-0}
NODE=$(command -v node)

log() { printf '[nightshift] %s\n' "$*" >&2; }

paused() { [ "${FACTORY_PAUSED:-}" = "true" ]; }

# Minutes since local midnight when the loop started.
START_MIN=$((10#$(date +%H) * 60 + 10#$(date +%M)))

# UNTIL is a time of day (default 07:00) and overnight runs are the normal
# case: a loop started at 23:00 must stop at 07:00, not on its first
# iteration. Measure elapsed minutes since start against the stop point,
# wrapping midnight once. Stops immediately when started exactly at UNTIL.
past_stop() {
  local now until_h until_m until stop_at elapsed
  now=$((10#$(date +%H) * 60 + 10#$(date +%M)))
  until=$(printf '%s' "$UNTIL" | tr -d ':')
  until_h=$((10#${until:0:2}))
  until_m=$((10#${until:2:2}))
  until=$((until_h * 60 + until_m))
  [ "$until" -eq "$START_MIN" ] && return 0
  if [ "$until" -gt "$START_MIN" ]; then
    stop_at=$until
  else
    stop_at=$((until + 1440))
  fi
  elapsed=$(( (now - START_MIN + 1440) % 1440 ))
  [ "$elapsed" -ge $((stop_at - START_MIN)) ]
}

# JSON array of issue numbers on stdin -> space-separated, at most $1 of them.
take_numbers() {
  "$NODE" -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        const n = Number(process.env.NIGHTSHIFT_TAKE || "0");
        process.stdout.write(JSON.parse(s).slice(0, n).join(" "));
      } catch {
        process.stdout.write("");
      }
    });
  '
}

log "starting: workers=$WORKERS until=$UNTIL dry_run=$DRY_RUN repo=$ROOT"

while true; do
  if paused; then
    log "FACTORY_PAUSED=true — stopping"
    exit 0
  fi
  if [ "$DRY_RUN" != "1" ] && past_stop; then
    log "past stop time $UNTIL — stopping"
    exit 0
  fi

  # 1. Approve what an independent review passes, so the merge pass sees it.
  "$NODE" scripts/nightshift/review.ts || log "review pass errored"

  # 2. Merge whatever is already green and reviewed.
  if [ "$DRY_RUN" = "1" ]; then
    DRY_RUN=1 NIGHTSHIFT_DRY_RUN=1 "$NODE" scripts/nightshift/merge.ts || log "merge pass errored"
  else
    "$NODE" scripts/nightshift/merge.ts || log "merge pass errored"
  fi

  # 3. Pick and work up to WORKERS Issues.
  SELECTED=$("$NODE" scripts/nightshift/select.ts 2>/dev/null || echo '[]')
  log "workable issues: $SELECTED"

  if [ "$DRY_RUN" = "1" ]; then
    log "dry run: not starting workers"
  else
    read -r -a NUMS <<< "$(NIGHTSHIFT_TAKE="$WORKERS" take_numbers <<< "$SELECTED")"
    for n in "${NUMS[@]}"; do
      [ -z "$n" ] && continue
      log "worker: issue #$n"
      "$NODE" scripts/nightshift/worker.ts "$n" &
    done
    wait
  fi

  log "sleeping ${SLEEP}s"
  sleep "$SLEEP"
done
