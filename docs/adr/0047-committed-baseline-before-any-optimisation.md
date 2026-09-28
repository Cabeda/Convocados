# A committed Baseline must exist before any agent optimises against it

No performance work — human or machine — begins until the measurement it will be judged
against is committed to the repository, recorded with zero code changes. The first
Performance Change is therefore a Change that publishes numbers and asserts nothing about
them: k6 scenarios and their thresholds, the Lighthouse budgets, and whatever else the Target
will be measured against.

This is not ceremony; it is the difference between optimising and guessing. Without a
committed Baseline, "1.2x faster" cannot be falsified, the pre-change state cannot be
recovered once the Change lands, and every performance argument in review becomes a matter
of opinion. With one, the Target is checkable by anyone, and a regression is a fact rather
than a disagreement.

The rule extends past the baseline itself. Targets must be modest and pass/fail, because a
large target invites reckless rewrites; measurements run sequentially, because parallel
benchmarks contend and produce numbers that mean nothing; and no metric may be made to pass
by changing the measurement rather than the code. The standing hazard is that agents
"optimise" by disabling the thing being measured — an agent once reported a 34,500x speedup
that turned out to be a physics engine switched off, caught by reading a diff rather than by
any gate. Suspiciously good numbers are treated as a bug report.

Baselines are refreshed in their own Change, never in the same Change that consumes them,
for the same reason the coverage ratchet may only move upward: a number edited by whoever
benefits from it is not a gate.
