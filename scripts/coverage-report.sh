#!/bin/sh
# Print per-file coverage report when the coverage threshold fails.
# Reads coverage/coverage-summary.json (produced by vitest --coverage).
# Surfaces the specific files below threshold and their line ranges so the
# developer knows exactly what to cover before pushing.
#
# COVERAGE_DIR exists so the script can be tested against a fixture; the gate
# calls it with no argument and gets ./coverage.
COVERAGE_DIR="${COVERAGE_DIR:-coverage}"
SUMMARY="$COVERAGE_DIR/coverage-summary.json"
LCOV="$COVERAGE_DIR/lcov.info"
THRESH_LINES="${1:-94}"

if [ ! -f "$SUMMARY" ]; then
  echo "  (no coverage-summary.json found — re-run vitest run --coverage)"
  exit 1
fi

echo ""
echo "Files below ${THRESH_LINES}% line coverage:"
python3 - "$SUMMARY" "$THRESH_LINES" "$LCOV" <<'EOF'
import json
import os
import sys

summary_path, thresh, lcov_path = sys.argv[1], float(sys.argv[2]), sys.argv[3]
data = json.load(open(summary_path))
files = [(name, f["lines"]["pct"]) for name, f in data.items() if name != "total"]
below = sorted([f for f in files if f[1] < thresh], key=lambda f: f[1])
if not below:
    print("  none — all files at or above threshold.")
    sys.exit(0)

for name, pct in below:
    print(f"  {pct:5.1f}%  {name}")

# Show uncovered line ranges for the worst offender. lcov.info is written on
# every coverage run; its DA records are line -> hit count, which is exactly
# the question, and it does not need a second (large) JSON artifact.
worst = below[0][0]
if not os.path.exists(lcov_path):
    print(f"\n  ({lcov_path} not found — no line ranges to show)")
    sys.exit(1)

uncovered = []
for block in open(lcov_path).read().split("end_of_record"):
    lines = block.strip().splitlines()
    source = next((l[3:] for l in lines if l.startswith("SF:")), None)
    if source is None or not (source == worst or source.endswith(os.path.basename(worst))):
        continue
    uncovered = [int(l[3:].split(",")[0]) for l in lines if l.startswith("DA:") and l[3:].split(",")[1] == "0"]
    break

ranges = []
lines = sorted(set(uncovered))
if lines:
    start = prev = lines[0]
    for ln in lines[1:]:
        if ln == prev + 1:
            prev = ln
        else:
            ranges.append(f"{start}-{prev}" if start != prev else str(start))
            start = prev = ln
    ranges.append(f"{start}-{prev}" if start != prev else str(start))
print(f"\n  Uncovered line ranges in {worst}: {', '.join(ranges) if ranges else 'none'}")
sys.exit(1)
EOF
