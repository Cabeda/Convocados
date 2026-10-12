#!/bin/sh
# Make a fresh git worktree usable for agent work.
#
# Every agent run on a fresh worktree used to rediscover the same three costs
# by hand. This script pays them once, idempotently:
#
#   1. node_modules from `pnpm install` is half-broken on this machine: the
#      better-sqlite3 native build fails (broken local node-gyp) and some
#      packages ship no `.bin` link. We install with --ignore-scripts and
#      restore the native build + bin links from a healthy checkout.
#   2. The gitignored Android env files (google-services.json,
#      local.properties) do not exist in a worktree, so :app:assembleDebug
#      fails for reasons that have nothing to do with the change under test.
#   3. The Prisma client is generated output; without it `pnpm typecheck`
#      fails on the generated types.
#
# Usage (from inside the worktree):
#   scripts/worktree-bootstrap.sh
#
# SOURCE=/path/to/healthy/checkout overrides where the native build and env
# files are copied from. Defaults to the repository's main worktree.
set -e

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# The primary worktree (usually the main clone) is the healthy source; its
# node_modules and gitignored env files survive between runs.
MAIN_WT=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
SOURCE=${SOURCE:-$MAIN_WT}

echo "▶ bootstrapping worktree: $ROOT (source: $SOURCE)"

# 1. Install without running postinstall scripts (the native build is broken
#    locally; the prebuilt binary is copied below instead).
pnpm install --frozen-lockfile --ignore-scripts

# 1a. Restore the better-sqlite3 native build directory from the source.
#     Match by version directory name so the copy survives dependency bumps.
if [ -d "$SOURCE/node_modules/.pnpm" ] && [ -d node_modules/.pnpm ]; then
  for native_dir in "$SOURCE"/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build; do
    [ -d "$native_dir" ] || continue
    # .../.pnpm/better-sqlite3@X/node_modules/better-sqlite3/build ->
    # three levels up from build/ lands on the version directory X.
    version_dir=$(basename "$(dirname "$(dirname "$(dirname "$native_dir")")")")
    target="node_modules/.pnpm/$version_dir/node_modules/better-sqlite3/build"
    if [ ! -d "$target" ]; then
      echo "▶ restoring native build for $version_dir"
      mkdir -p "$(dirname "$target")"
      cp -R "$native_dir" "$target"
    fi
  done
fi

# 1b. Restore any missing .bin links from the source store.
if [ -d "$SOURCE/node_modules/.bin" ]; then
  mkdir -p node_modules/.bin
  for bin in "$SOURCE"/node_modules/.bin/*; do
    [ -e "$bin" ] || continue
    name=$(basename "$bin")
    [ -e "node_modules/.bin/$name" ] || cp -R "$bin" "node_modules/.bin/$name"
  done
fi

# 2. Gitignored Android env files.
for envfile in google-services.json local.properties; do
  for candidate in \
    "$SOURCE/android-app/app/$envfile" \
    "$SOURCE/android-app/$envfile"
  do
    if [ -f "$candidate" ]; then
      target_dir=android-app/app
      case "$candidate" in
        */app/*) target_dir=android-app/app ;;
        *) target_dir=android-app ;;
      esac
      if [ ! -f "$target_dir/$envfile" ]; then
        echo "▶ copying $envfile"
        mkdir -p "$target_dir"
        cp "$candidate" "$target_dir/$envfile"
      fi
      break
    fi
  done
done

# 3. Generated Prisma client (gitignored).
if [ ! -d src/lib/__generated__/prisma ]; then
  echo "▶ generating Prisma client"
  pnpm db:generate
fi

echo "▶ worktree ready"
