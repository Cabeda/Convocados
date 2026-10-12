#!/usr/bin/env bash
# Relax `main`'s branch protection so the Nightshift loop can merge unattended.
#
# THIS IS THE IRREVERSIBLE STEP. On this repository branch protection is what
# makes CODEOWNERS a guarantee ("no Change reaches main without Cabeda"). Running
# this removes the required review and the self-approval block, so a machine can
# merge — and merging deploys. It prints exactly what it will change and does
# nothing without --yes.
#
# What stays: required status checks (CI, Analyze). What changes: a review is no
# longer *required*, and the loop's identities are allowed to merge.
#
# Usage:
#   bash scripts/nightshift/relax-protection.sh            # dry run, show diff
#   bash scripts/nightshift/relax-protection.sh --yes      # apply
#
# Undo:
#   bash scripts/nightshift/relax-protection.sh --restore
set -uo pipefail

REPO=${GITHUB_REPOSITORY:-Cabeda/Convocados}
BRANCH=${NIGHTSHIFT_BRANCH:-main}
MODE="dry"
[ "${1:-}" = "--yes" ] && MODE="apply"
[ "${1:-}" = "--restore" ] && MODE="restore"

log() { printf '[protect] %s\n' "$*" >&2; }

show() {
  gh api "repos/$REPO/branches/$BRANCH/protection" 2>/dev/null \
    | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d));
      process.stdin.on("end", () => {
        try {
          const p = JSON.parse(s);
          console.log(JSON.stringify({
            requiredApprovingReviewCount: p.required_pull_request_reviews?.required_approving_review_count ?? null,
            dismissStaleReviews: p.required_pull_request_reviews?.dismiss_stale_reviews ?? null,
            requiredStatusChecks: p.required_status_checks?.contexts ?? null,
            enforceAdmins: p.enforce_admins?.enabled ?? null,
          }, null, 2));
        } catch { console.log("(could not read protection)"); }
      });
    '
}

case "$MODE" in
  dry)
    log "current protection on $REPO@$BRANCH:"
    show
    cat >&2 <<'EOF'

[dry run] --yes would:
  - set required_approving_review_count to 0 (no review required)
  - keep required status checks (CI, Analyze) in place
  - keep enforce_admins as-is

This lets a machine merge. Merging deploys. Re-run with --yes to apply.
EOF
    ;;
  apply)
    log "relaxing required reviews on $REPO@$BRANCH"
    gh api -X PATCH "repos/$REPO/branches/$BRANCH/protection/required_pull_request_reviews" \
      -F required_approving_review_count=0 \
      -F dismiss_stale_reviews=false \
      && log "required reviews disabled" || log "failed to disable required reviews"
    log "done. required status checks are untouched."
    show
    ;;
  restore)
    log "restoring required reviews (1) on $REPO@$BRANCH"
    gh api -X PATCH "repos/$REPO/branches/$BRANCH/protection/required_pull_request_reviews" \
      -F required_approving_review_count=1 \
      -F dismiss_stale_reviews=true \
      && log "required reviews restored" || log "failed to restore"
    show
    ;;
esac
