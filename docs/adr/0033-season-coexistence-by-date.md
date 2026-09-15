# ADR 0033 — Season Coexistence by Date

Status: accepted (2026-09-14)

## Context

Seasons used a single-non-terminal rule: one `registration`/`active`/`review`
Season per Event, enforced in the POST handler *and* by a partial unique DB
index (`Season_one_open_per_event_key … WHERE status NOT IN
('completed','cancelled')`). Registration windows were compared by exact
timestamp with inclusive edges (`newStart <= otherEnd && otherStart <=
newEnd`).

Three problems followed:

1. **No future prep, no past recording.** An admin could not prepare the next
   Season while one was open, nor record a Season in the past, without first
   completing/cancelling the current one.
2. **Misleading error.** Any second non-terminal creation failed with "This
   event already has an active Season." — even when the existing Season was
   merely in `registration`.
3. **Time-of-day false overlaps.** Back-to-back Seasons sharing a boundary
   instant counted as overlapping.

## Decision

1. **Coexistence.** An Event may hold one `active`/`review` Season plus any
   number of `registration` Seasons (past recording, future prep), as long as
   no two non-cancelled registration windows overlap. Creation always lands in
   `registration`, regardless of dates; past Seasons backfill via pure replay
   (ADR-0031.9).
2. **Date-only, exclusive-edge overlap.** Windows compare by UTC calendar day;
   `A.closes == B.opens` (same day) is adjacency, not overlap. Time-of-day is
   ignored. Cancelled Seasons are excluded (window freed for reuse).
3. **Single live competition stays.** Activation (`registration → active`)
   stays manual behind the existing Crew gate (≥3 Crews of 3–5, ≥9
   participants) and is now guarded: activating while another `active`/`review`
   Season exists fails with 409. The DB partial index narrows to `WHERE status
   IN ('active','review')` so concurrent activations still cannot create two
   live competitions.
4. **Derived `isCurrent` for display.** Season GETs expose `isCurrent`
   (date-only today ∈ window, never for cancelled). `status` remains the
   lifecycle source of truth (review, cancellation reason, crew lock, Rank
   calibration anchor).
5. **Error copy.** Conflicts with a non-terminal Season name it: "This event
   already has an open Season ("<name>", <status>). …".

## Consequences

- Succession prep works: register the next Season while the current one runs.
- At most one Season's window contains a given day, so "current" display is
   unambiguous.
- Admin checklist UI (requirements line + disabled Activate) is unchanged; the
   new activate guard surfaces through the existing error alert.
- Migration `20260914160000_season_coexistence` narrows the partial index;
   application checks own the window rule.
