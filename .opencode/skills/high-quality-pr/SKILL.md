---
name: High-quality PR
description: The bar a Fixer Change must clear before a human sees it — a reproduction that failed first, the smallest fix, and evidence in the body. Load before writing any Change.
---

# A Change a human can merge in one sitting

A Change is read by someone deciding whether to ship it to production, not by someone grading the
code. Everything below serves that reader. If a section would not change their decision, cut it.

## The one question, answered out loud

> Does this let people play more, with less administration?

The PR body opens with the answer in one sentence. "No" is a valid answer only for a defect fix
that removes administration; if the sentence is hard to write, the Change is probably not worth
reviewing.

## The body

```markdown
## Summary

<one sentence: the mission answer>

Closes #<issue>

<the smallest view that makes the failure and the fix legible: a diff sketch,
 call tree, or 3-line explanation — not a file-by-file tour>

## Reproduction

`pnpm vitest run src/test/<file> -t "<test name>"`

Before the fix (<commit-or-main>):

    <the failing assertion, verbatim>

After:

    <the same command passing>

## Evidence

- Gates: <the gate.sh result, and any job the diff could have moved>
- <any screenshot pair, before/after, for a UI change; both, never after-only>

## Merge Danger

**Door:** <one-way or two-way>
**Blast Radius:** <one word, then what it touches if it is wrong>
```

The reproduction is the section a reviewer uses to decide whether the Change addresses the Issue
at all. An empty or invented reproduction is worse than an honest "no test was possible, here is
what I ran instead". `Closes #<issue>` is what closes the Issue on merge and stops the next agent
reading solved work as live; a body without it fails the `PR Links Issue` check.

## The diff

- **Reproduce first.** The test is written before the fix and fails for the stated reason. A test
  added after the fact proves the new code runs, not that the defect existed.
- **One seam.** Fix the shared code once rather than guarding four call sites. If the same
  question is answered in two places, the fix belongs in the answer.
- **Smallest complete change.** Callers, fixtures, i18n (all 6 locales), and parity
  (web / `:app` / `:wear`) are part of the change, not follow-ups. Anything else is not in scope.
- **Nothing that games a gate.** No deleted or skipped tests, no new coverage `exclude`, no
  relaxed assertion, no raised threshold without the tests that justify it, no smaller input to a
  benchmark. A green number reached by changing the measurement is a defect (AGENTS.md, Core
  Principle 6).
- **A comment only for the why the code cannot show**, one line.

## Sent back, every time

- No test that would have failed before the change.
- A test that passes on `main` — it does not reproduce anything.
- A threshold, assertion, or load changed to make a Gate pass.
- Work outside the Issue, or an Issue's work truncated to fit the size cap.
- A UI change with no before/after pair.
- A body that describes a different change from the diff.
