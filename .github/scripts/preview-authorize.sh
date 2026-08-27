#!/bin/sh
# Shared authorization gate for preview deployments (ADR 0022).
#
# Allowlist: the repository owner, or any username listed in
# .github/CODEOWNERS (usernames only — teams and emails are not resolved).
#
# Usage environment:
#   PR_NUMBER              - pull request number to authorize
#   REQUESTED_BY           - GitHub login of the person who issued the command
#   GITHUB_REPOSITORY      - set by Actions
#   GITHUB_REPOSITORY_OWNER- set by Actions
#   GH_TOKEN               - token with read access (github.token works)
#
# Both the PR author AND the requester must pass the gate.
# Outputs (GITHUB_OUTPUT): pr_number, app_name, app_url

set -e

REPO="${GITHUB_REPOSITORY:?}"
PR_NUMBER="${PR_NUMBER:?}"
REQUESTED_BY="${REQUESTED_BY:?}"

allowed_by() {
    user="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
    if [ -z "$user" ]; then
        return 1
    fi
    owner="$(printf '%s' "${GITHUB_REPOSITORY_OWNER:-}" | tr '[:upper:]' '[:lower:]')"
    if [ "$user" = "$owner" ]; then
        return 0
    fi
    entries="$(grep -vE '^[[:space:]]*#' .github/CODEOWNERS 2>/dev/null |
        grep -oE '@[a-zA-Z0-9][a-zA-Z0-9_-]*' |
        tr -d '@' | tr '[:upper:]' '[:lower:]' | sort -u)"
    printf '%s\n' "$entries" | grep -qx -- "$user"
}

author="$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq '.user.login')"

if allowed_by "$author" && allowed_by "$REQUESTED_BY"; then
    echo "pr_number=$PR_NUMBER" >> "$GITHUB_OUTPUT"
    echo "app_name=convocados-pr-$PR_NUMBER" >> "$GITHUB_OUTPUT"
    echo "app_url=https://convocados-pr-$PR_NUMBER.fly.dev" >> "$GITHUB_OUTPUT"
    echo "[preview-gate] authorized author=$author requester=$REQUESTED_BY"
else
    echo "::error::[preview-gate] denied: author=$author requester=$REQUESTED_BY (see .github/CODEOWNERS)"
    exit 1
fi
