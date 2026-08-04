#!/bin/sh
# Print per-file coverage report when the coverage threshold fails.
# Reads coverage/coverage-summary.json (produced by vitest --coverage).
# Surfaces the specific files below threshold and their line ranges so the
# developer knows exactly what to cover before pushing.

SUMMARY="coverage/coverage-summary.json"
THRESH_LINES="${1:-94}"

if [ ! -f "$SUMMARY" ]; then
  echo "  (no coverage-summary.json found — re-run vitest run --coverage)"
  exit 1
fi

echo ""
echo "Files below ${THRESH_LINES}% line coverage:"
python3 - "$SUMMARY" "$THRESH_LINES" <<'EOF'
import json
import sys

summary_path, thresh = sys.argv[1], float(sys.argv[2])
data = json.load(open(summary_path))
files = [(name, f["lines"]["pct"]) for name, f in data.items() if name != "total"]
below = sorted([f for f in files if f[1] < thresh], key=lambda f: f[1])
if not below:
    print("  none — all files at or above threshold.")
    sys.exit(0)

for name, pct in below:
    print(f"  {pct:5.1f}%  {name}")

# Show uncovered line ranges for the worst offender
if below:
    worst = below[0][0]
    cov = json.load(open("coverage/coverage-final.json"))
    for path, info in cov.items():
        if path == worst:
            uncovered = {}
            for idx, count in info["s"].items():
                if count == 0:
                    uncovered[info["statementMap"][idx]["start"]["line"]] = 1
            ranges = []
            lines = sorted(uncovered)
            if lines:
                start = prev = lines[0]
                for ln in lines[1:]:
                    if ln == prev + 1:
                        prev = ln
                    else:
                        ranges.append(f"{start}-{prev}" if start != prev else str(start))
                        start = prev = ln
                ranges.append(f"{start}-{prev}" if start != prev else str(start))
            print(f"\n  Uncovered line ranges in {worst}: {', '.join(ranges)}")
            break
sys.exit(1)
EOF
