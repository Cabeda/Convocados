#!/usr/bin/env bash
# Route coverage ratio: checks which API route files have at least one test
# that imports from them. Outputs a summary and lists untested routes.
#
# Usage: ./scripts/route-coverage.sh [--json]

set -euo pipefail
cd "$(dirname "$0")/.."

json_output=false
[[ "${1:-}" == "--json" ]] && json_output=true

# Collect all API route files (excluding auth, admin, cron — per vitest.config.ts exclusions)
#
# A `while read` loop rather than `mapfile`: mapfile is a bash 4 builtin, and
# macOS still ships bash 3.2 as /bin/bash. Under 3.2 `mapfile` is not found, the
# array stays empty, `total` is 0 — and this gate would report a clean 100% while
# checking nothing. Failing loudly is the point of a gate; silently passing is
# worse than not having one.
routes=()
while IFS= read -r line; do
  [ -n "$line" ] && routes+=("$line")
done < <(find src/pages/api -name "*.ts" \
  | grep -v "src/pages/api/auth/" \
  | grep -v "src/pages/api/admin/" \
  | grep -v "src/pages/api/cron/" \
  | grep -v "src/pages/api/oauth-callback" \
  | grep -v "src/pages/api/openapi" \
  | grep -v "src/pages/api/me/api-keys" \
  | grep -v "src/pages/api/me/calendar-token" \
  | grep -v "src/pages/api/events/\[id\]/calendar.ics" \
  | grep -v "src/pages/api/users/\[id\]/calendar.ics" \
  | grep -v "src/pages/api/watch/" \
  | grep -v "src/pages/api/internal/" \
  | sort)

# An empty route list means the collection above failed, not that the API is gone.
if [ "${#routes[@]}" -eq 0 ]; then
  echo "✗ No API routes were collected — the find/read above is broken, not the API." >&2
  exit 1
fi

total=${#routes[@]}
tested=0
untested=()

for route in "${routes[@]}"; do
  # Convert route path to an import pattern tests might use
  # e.g., src/pages/api/events/[id]/players.ts -> ~/pages/api/events/[id]/players
  import_path="${route%.ts}"
  import_path="${import_path#src/}"
  # Escape brackets for grep
  escaped=$(echo "$import_path" | sed 's/\[/\\[/g; s/\]/\\]/g')

  if grep -rl "$escaped" src/test/ >/dev/null 2>&1; then
    tested=$((tested + 1))
  else
    untested+=("$route")
  fi
done

has_untested=false
[ ${#untested[@]} -gt 0 ] && has_untested=true

ratio=0
if [ "$total" -gt 0 ]; then
  ratio=$(echo "scale=1; $tested * 100 / $total" | bc)
fi

if $json_output; then
  printf '{"total":%d,"tested":%d,"untested":%d,"ratio":"%s%%","untestedRoutes":[' \
    "$total" "$tested" "${#untested[@]}" "$ratio"
  first=true
  for r in "${untested[@]}"; do
    $first || printf ","
    printf '"%s"' "$r"
    first=false
  done
  printf ']}\n'
else
  echo "=== Route Coverage Ratio ==="
  echo ""
  echo "Total API routes (non-excluded): $total"
  echo "Routes with tests:               $tested"
  echo "Routes without tests:            ${#untested[@]}"
  echo "Coverage ratio:                  ${ratio}%"
  echo ""
  if $has_untested; then
    echo "Untested routes:"
    for r in "${untested[@]}"; do
      echo "  - $r"
    done
  fi
fi

# A report nobody can fail is not a gate. This measured 100% (148/148) when the
# floor was added, and thresholds move up only (AGENTS.md — the ratio is a floor,
# never a ceiling). So an untested route is a regression: give it a test. A route
# that genuinely cannot have one belongs in `docs/coverage.md` with its reason,
# like every other documented exclusion — not silently filtered out of the list
# above (CODING_STANDARDS.md → Never cheat a gate).
if $has_untested; then
  echo ""
  echo "✗ ${#untested[@]} API route(s) have no test. Every route is covered today —" >&2
  echo "  adding one without a test is a regression. See AGENTS.md → Reviewing Checklist." >&2
  exit 1
fi
