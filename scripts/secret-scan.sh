#!/bin/sh
# Shared secret scanner used by the git hooks.
#
#   secret-scan.sh staged  → scan staged changes (pre-commit)
#   secret-scan.sh push    → scan the commits being pushed, refs on stdin (pre-push)
#
# Exits non-zero when a secret is found so the calling hook aborts. A missing
# gitleaks binary is a warning, not a failure, so contributors without it are
# not blocked.
#
# Do NOT put `gitleaks protect --staged` back in the pre-push path: at push time
# the index is empty, so it scans nothing while reporting success.

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "⚠ gitleaks not installed, skipping secrets scan (brew install gitleaks)"
  exit 0
fi

config=""
[ -f .gitleaks.toml ] && config=".gitleaks.toml"

case "$1" in
  staged)
    echo "→ Secrets scan (gitleaks, staged changes)..."
    if [ -n "$config" ]; then
      gitleaks git --staged --verbose --redact --no-banner --config "$config"
    else
      gitleaks git --staged --verbose --redact --no-banner
    fi
    ;;
  push)
    echo "→ Secrets scan (gitleaks, pushed commits)..."
    zero="0000000000000000000000000000000000000000"
    log_opts=""
    while read -r local_ref local_sha remote_ref remote_sha; do
      [ -z "$local_sha" ] && continue
      [ "$local_sha" = "$zero" ] && continue
      if [ "$remote_sha" = "$zero" ]; then
        # New branch: scan everything not already on a remote.
        range="$local_sha --not --remotes"
      else
        range="$remote_sha..$local_sha"
      fi
      if [ -z "$log_opts" ]; then
        log_opts="$range"
      else
        log_opts="$log_opts $range"
      fi
    done
    if [ -n "$log_opts" ]; then
      if [ -n "$config" ]; then
        gitleaks git --redact --no-banner --config "$config" --log-opts "$log_opts"
      else
        gitleaks git --redact --no-banner --log-opts "$log_opts"
      fi
    elif [ -n "$config" ]; then
      gitleaks git --redact --no-banner --config "$config"
    else
      gitleaks git --redact --no-banner
    fi
    ;;
  *)
    echo "secret-scan.sh: unknown mode '$1' (expected 'staged' or 'push')" >&2
    exit 2
    ;;
esac

status=$?
if [ "$status" -ne 0 ]; then
  echo "✗ Secrets detected. Review .gitleaks.toml allowlist or remove the secret."
fi
exit "$status"
