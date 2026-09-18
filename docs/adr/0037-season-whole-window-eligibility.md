# ADR 0037 — Season Whole-Window Eligibility

Status: accepted (2026-09-18)

## Context

Season coexistence already compared windows by UTC calendar day (ADR 0033), but
scoring used exact timestamps and a membership `joinedAt` gate. Two problems
followed:

1. **Enrollment timing silently zeroed games.** `isMemberEffective` credited a
   Game to a member only if `joinedAt <= game.dateTime`, with a retroactive
   exception when `joinedAt >= registrationClosesAt`. A Season created for a
   period that already contained Games therefore scored **0** for those Games in
   the standings if the organizer enrolled members after they were played — while
   Season Rank (which ignored `joinedAt`) counted them. The two surfaces
   disagreed about the same Season.
2. **The closing day leaked.** Standings compared `dateTime <=
   registrationClosesAt`, so a Game on the closing calendar day after midnight
   was excluded, even though the overlap rule considered that day inside the
   window. Opening day was included; closing day was not.

The model has no enrollment date: a Season start and end are enough. Organizers
expected adding a member, moving a Crew, or editing the window to recompute
everything with no separate recalculation step.

## Decision

1. **Whole-window membership.** An enrolled member counts for every eligible
   Game in the Season window, regardless of when they were added. `joinedAt` is
   demoted to ordering/audit only. Only `withdrawnAt` removes a member, from the
   withdrawal instant on; re-adding re-covers the whole window (including the
   withdrawal gap).
2. **Day-granular window, one definition.** `seasonWindowByDay` spans full
   opening and closing calendar days and is shared by standings, Crew scores,
   Season Rank, attendance-based candidate selection, and (already) overlap.
   Completion/cancellation still caps the window when a Season ends early.
3. **Pure replay.** Standings, Crew Round Scores, and Season Rank recompute on
   read from the current window, membership, and Crew assignment; only a
   completed Season's snapshot is frozen, until an audited reopen.

## Considered Options (rejected)

- **Backdate `joinedAt` to `registrationOpensAt` on enrollment.** Keeps the
  field load-bearing while making its value a lie; still leaves the closing-day
  and Rank-vs-standings bugs.
- **Add an enrollment-date UI.** Reintroduces the timing gate the model does not
  need; organizers asked for dates + roster as the whole input.
- **Keep mid-season exclusion.** A genuinely new member joining an active Season
  would not score earlier Games. Rejected: it makes retroactive Season setup
  (the common case) inconsistent, and withdrawal already expresses leaving.

## Consequences

- `isMemberEffective` and the `seasonEndsAt` option are removed; eligibility is
  the single `withdrawnAt` check.
- A late-added member's earlier period Games count; a re-added member's withdrawal
  gap counts again.
- Editing a finished Season still requires Reopen before changes appear.
- `CONTEXT.md` Season/Crew entries updated; `leaderboard.test.ts` (formerly
  "excludes pre-join games while the season period is open") inverted.
