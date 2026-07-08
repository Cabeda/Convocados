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
mapfile -t routes < <(find src/pages/api -name "*.ts" \
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
  if [ ${#untested[@]} -gt 0 ]; then
    echo "Untested routes:"
    for r in "${untested[@]}"; do
      echo "  - $r"
    done
  fi
fi
