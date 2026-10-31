#!/usr/bin/env bash
# Install (or remove) the daily senior review systemd user timer.
#
#   scripts/daily-review/install.sh
#   scripts/daily-review/install.sh --uninstall
#
# The timer runs scripts/daily-review/run.sh once a day. The units are rendered
# with this checkout's absolute path, so moving the repo requires re-installing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/convocados"
ENV_FILE="$ENV_DIR/daily-review.env"
UNIT_NAME="convocados-daily-review"
SOURCE_DIR="$REPO_ROOT/systemd/user"

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl --user disable --now "$UNIT_NAME.timer" 2>/dev/null || true
  rm -f "$UNIT_DIR/$UNIT_NAME.service" "$UNIT_DIR/$UNIT_NAME.timer"
  systemctl --user daemon-reload
  echo "Removed $UNIT_DIR/$UNIT_NAME.{service,timer}. Kept $ENV_FILE and the logs."
  exit 0
fi

for file in "$SOURCE_DIR/$UNIT_NAME.service" "$SOURCE_DIR/$UNIT_NAME.timer"; do
  [[ -f "$file" ]] || { echo "missing unit template: $file" >&2; exit 1; }
done

mkdir -p "$UNIT_DIR" "$ENV_DIR"

sed "s|@REPO@|$REPO_ROOT|g" "$SOURCE_DIR/$UNIT_NAME.service" >"$UNIT_DIR/$UNIT_NAME.service"
cp "$SOURCE_DIR/$UNIT_NAME.timer" "$UNIT_DIR/$UNIT_NAME.timer"

if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<'EOF'
# Daily senior review (systemd user timer).
# Higher depth costs more per run: e.g. opencode-go/gpt-5.6-luna.
DAILY_REVIEW_MODEL=opencode-go/deepseek-v4.1-flash
DAILY_REVIEW_MAX_ISSUES=6
DAILY_REVIEW_MAX_PER_ROLE=2
DAILY_REVIEW_DIGEST=discussion
DAILY_REVIEW_DISCUSSION_CATEGORY=General
EOF
  echo "Wrote $ENV_FILE (change the model there to trade cost for depth)."
fi

chmod +x "$REPO_ROOT/scripts/daily-review/run.sh" "$REPO_ROOT/scripts/daily-review/install.sh"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME.timer"

echo
systemctl --user list-timers "$UNIT_NAME.timer" --no-pager || true
echo
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]]; then
  echo "WARNING: user lingering is off. The timer will not run while you are logged out."
  echo "Enable it once with: sudo loginctl enable-linger $USER"
fi
echo "Logs: ${XDG_STATE_HOME:-$HOME/.local/state}/convocados/daily-review/"
echo "Manual run: $REPO_ROOT/scripts/daily-review/run.sh"
