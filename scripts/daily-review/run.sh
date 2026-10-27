#!/usr/bin/env bash
# Daily senior review runner.
#
# One OpenCode session per day, unattended. It loads the `daily-review` agent,
# which dispatches the six read-only lenses and files only findings that clear
# the bar. Logs live under ~/.local/state/convocados/daily-review/.
#
# Manual run:   scripts/daily-review/run.sh
# Dry run:      scripts/daily-review/run.sh --dry-run
# Installed by: scripts/daily-review/install.sh (systemd user timer)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/convocados/daily-review"
DATE="$(date +%F)"
LOG="$STATE_DIR/$DATE.log"
LOCK="$STATE_DIR/run.lock"
PREFLIGHT="$STATE_DIR/preflight.txt"
mkdir -p "$STATE_DIR"

export PATH="$HOME/.opencode/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# One run at a time. A second timer tick (or a manual run) exits quietly.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "daily review already running; exiting" >&2
  exit 0
fi

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=true; fi

for cmd in opencode gh git flock; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "daily review: missing required command: $cmd" >&2
    exit 3
  fi
done

# ── Skills preflight ─────────────────────────────────────────────────────────
# The agents rely on the global skills installed by dotfiles/install-skills.sh.
# A missing skill is a warning, not a stop: the repo still carries the review
# contract, but the digest should say the run was degraded.
{
  echo "date=$DATE"
  echo "repo=$REPO_ROOT"
  for root in "$HOME/.agents/skills" "$HOME/.config/opencode/skills"; do
    if [[ -d "$root" ]]; then
      count="$(find -L "$root" -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')"
      echo "skills_root=$root count=$count"
    else
      echo "skills_root=$root MISSING"
    fi
  done
  if [[ -f "$HOME/.agents/.skill-lock.json" ]] && command -v jq >/dev/null 2>&1; then
    missing=0
    while IFS= read -r id; do
      [[ -e "$HOME/.agents/skills/$id" ]] || { echo "missing_skill=$id"; missing=$((missing + 1)); }
    done < <(jq -r '.skills | keys[]' "$HOME/.agents/.skill-lock.json" 2>/dev/null || true)
    echo "missing_skills=$missing"
  fi
  gh auth status >/dev/null 2>&1 && echo "gh_auth=ok" || echo "gh_auth=FAILED"
} >"$PREFLIGHT" 2>&1

if [[ "$DRY_RUN" == true ]]; then
  echo "daily review dry run"
  echo "  repo: $REPO_ROOT"
  echo "  date: $DATE"
  echo "  log:  $LOG"
  echo "  model: ${DAILY_REVIEW_MODEL:-<opencode default>}"
  echo "  skills:"
  sed 's/^/    /' "$PREFLIGHT"
  exit 0
fi

# ── Context refresh ──────────────────────────────────────────────────────────
# Offline is not fatal: the lenses can review the local checkout, and the digest
# should say the fetch failed.
if ! timeout 60 git -C "$REPO_ROOT" fetch --quiet origin; then
  echo "daily review: git fetch failed; continuing with the local checkout" | tee -a "$LOG" >&2
fi

PROMPT="$(cat <<EOF
Run the daily senior review for $DATE.

Repository: $REPO_ROOT
Follow .opencode/agents/daily-review.md and the daily-review skill exactly.

The six lenses are subagents: daily/ux, daily/architecture, daily/qa,
daily/security, daily/sre, daily/product.

Build one shared brief from the last 36 hours of origin/main, open Changes and
open issues, then dispatch the lenses with that brief. File only findings that
pass the bar, through scripts/daily-review/file-issue.mjs. Post the digest
through scripts/daily-review/digest.mjs.

Preflight notes are in $PREFLIGHT. If a skill root is missing or the lock file
shows missing_skills > 0, say so in the digest as "degraded: skills".

Do not ask questions. Do not edit or commit code. Do not merge or deploy.
Stop after the digest.
EOF
)"

MODEL_ARGS=()
if [[ -n "${DAILY_REVIEW_MODEL:-}" ]]; then
  MODEL_ARGS=(--model "$DAILY_REVIEW_MODEL")
fi

TITLE="Daily review $DATE"
set +e
opencode run \
  --standalone \
  --agent daily-review \
  --auto \
  --format json \
  "${MODEL_ARGS[@]}" \
  --title "$TITLE" \
  "$PROMPT" >"$LOG" 2>&1
STATUS=$?
set -e

if [[ $STATUS -ne 0 ]]; then
  {
    echo "date=$DATE"
    echo "status=failed"
    echo "exit=$STATUS"
    echo "finished=$(date -Is)"
    echo "--- tail ---"
    tail -40 "$LOG" 2>/dev/null || true
  } >"$STATE_DIR/last-failure.txt"
  echo "daily review failed (exit $STATUS); see $LOG" >&2
  exit "$STATUS"
fi

rm -f "$STATE_DIR/last-failure.txt"
{
  echo "date=$DATE"
  echo "status=ok"
  echo "finished=$(date -Is)"
} >"$STATE_DIR/last-run.txt"

# Keep a month of logs; the digest is the durable record.
find "$STATE_DIR" -maxdepth 1 -name '*.log' -mtime +30 -delete 2>/dev/null || true
echo "daily review complete: $LOG"
