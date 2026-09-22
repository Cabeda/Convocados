# Match Events attach to GameHistory; team score is derived from goals

## Status

accepted

## Context

We want per-player goals and assists (parity with Omby's Match Center), but Convocados has no
live match capture, and the canonical score already lives in the immutable `GameHistory`
snapshot — the live `Game` does not persist team assignments or scores.

## Decision

Introduce a **Match Event** — a single recorded occurrence in a settled Game's timeline,
keyed on **`GameHistory`** (the same home as `MvpVote` and the score):

- v1 types are **Goal** and **Assist**; the model is general (`goal | assist | sub | note`)
  so substitutions and cards can be added later without a migration.
- Each Goal carries an optional assister, optional minute, a team side, and `ownGoal` /
  `penalty` flags. Attribution is to the persistent **EventPlayer** (`scorerEventPlayerId`),
  with a free-text name fallback for unlinked guests.
- Match Events are recorded **after** the Game ends — there is no live capture.
- For goal-scoring sports, a team's score is **derived** by counting its Goals once at least
  one Match Event exists; if none exist, the manually entered score stands. Own goals credit
  the opposing side. Set-based sports (tennis, padel) are unaffected and keep their set score.
- A new per-Event **Statistician** role (`EventAdmin.role`, default `admin`) may log Match
  Events without any other admin power.

## Consequences

- Goals and assists are post-game only; a live clock and real-time feed are explicitly deferred
  to a separate feature.
- Per-player goals/assists and the top-scorer view are computed by **replaying** Match Events,
  not by denormalized counters on `EventPlayer`.
- v1 ships the API plus the Android app; web and iOS follow as parity debt.
