# Research: clear TeamResult shells at recurrence reset

**Date:** 2026-10-12
**Status:** Research only — no code change. Outcome of improvement item 3 from the
team-randomize bug fix (PR #1322).
**Question:** Can `advanceOccurrence` delete `TeamResult` rows (not just their
members) when a recurring occurrence resets, instead of leaving empty shells?

## Context

The non-destructive reset (`src/lib/advanceOccurrence.server.ts`) snapshots teams
into `GameHistory.teamsSnapshot`, then clears `TeamMember` rows but keeps the
`TeamResult` shells. Those shells caused three production bugs on
`cmmkfrx8b0000o2ixrix1yp2m` (teams appearing before maxPlayers, auto-randomize
never firing, incremental placement): PR #1322 fixed them by teaching every
consumer to treat member-less teamResults as "no draw". Deleting the shells at
the source would remove the whole class instead.

## Who reads TeamResult today

| Consumer | Reads | Behaviour if rows deleted at reset |
|---|---|---|
| `advanceOccurrence.server.ts` | `event.teamResults` (include members) for the GameHistory snapshot | **Safe.** The snapshot (`teamsSnapshot`) is built and written in the same `$transaction` *before* the member clear. Deleting the rows after the snapshot loses nothing. |
| `GET /api/events/[id]` (`index.ts:314-325`) | Filters teamResults to active members; drops empty teams from the payload | **Safe.** Shells are already invisible to the API; deleting them just makes the DB match the payload. |
| `POST /randomize`, MCP `randomize_teams` | `deleteMany` + recreate | **Safe.** deleteMany on an empty set is a no-op. |
| `autoRandomizeIfFull` / `addPlayerToTeams` (`teamFormation.server.ts`) | Count/populated checks (post-#1322) | **Safe.** Zero rows is the same "no teams" branch as zero-member rows. |
| `assignTeams` (`teamAssignment.server.ts:96`) | Creates teamResults if `length < 2` | **Safe.** Zero rows triggers creation — correct after reset. |
| `syncGameFromTeamResults` (`gameDualWrite.server.ts:160`) | Early-returns on empty | **Safe.** |
| `settlement.server.ts:94` | Live teamResults for the current game's lineup | **Safe.** Post-reset the current game has no lineup either way (empty rows vs no rows). After the next draw both are populated identically. |
| `history/index.ts:75-90` | Reconstructs `teamsSnapshot` for the **live** Game from teamResults | **Needs care — the one real risk.** See below. |
| `history/[historyId].ts:31-38` | Same reconstruction for PATCH-on-demand snapshots | Same risk, narrower window. |
| `cancelEvent.server.ts:143-149` | Deletes members on cancel | **Safe.** |
| `GET /api/events/[id]/status.ts` | Maps teamResults into status payload | **Safe.** Empty array either way. |
| `teams.ts` PUT (manual drag-save) | Replaces members on existing teams | **Safe.** With zero rows the save path creates fresh teamResults (`assignTeams` branch). |

## The one real dependency: live-Game snapshot reconstruction

`history/index.ts` reconstructs `teamsSnapshot` for played-but-not-yet-snapshotted
Games from the event-level teamResults. Timeline at reset:

1. Reset wins CAS, snapshots teams → `GameHistory.teamsSnapshot` (existing snapshot
   guarded against duplicates at `advanceOccurrence.server.ts:134-136`).
2. Old Game marked `played`; new Game created.
3. Members cleared (today) / rows deleted (proposed).

After step 1 the GameHistory exists, and the history merge
(`history/index.ts:160-184`) **prefers the GameHistory over the bare Game** for the
same dateTime. So the reconstruction from teamResults only matters for a played Game
that has *no* GameHistory yet — e.g. a score saved via PATCH between the reset and
the next draw. PATCH (`history/[historyId].ts`) materialises its own GameHistory
on demand from teamResults *for the current occurrence* — and for the *old*
occurrence the reset already created the row. The gap: someone PATCHes the old
game's score in the window after the reset won the CAS but before the transaction
committed. That window is inside one SQLite transaction — not observable.

**Verdict: safe.** The snapshot write and the proposed row deletion would live in
the same `$transaction`, so there is no committed state where the GameHistory is
missing *and* the teamResults are gone.

## The other dependency: the non-destructive-reset invariant

`advanceOccurrence.server.ts:129-130` states "NO destructive deletes.
Players/Teams/RSVPs stay intact on the old Game." That invariant is about the
**Game-scoped rows** (GameParticipant, Rsvp) and legacy Player rows — they power
the "players persist across occurrences" UX. TeamResult is **event-scoped**, not
game-scoped (schema: `TeamResult.eventId` only — no `gameId`), which is exactly
why shells leak across occurrences in the first place. Making TeamResult
game-scoped (adding `gameId`) would be the structurally correct fix, but is a
schema migration touching ~15 call sites — a separate Change.

## Recommended shape (for a future Change)

In `advanceOccurrence.server.ts`'s `$transaction`, replace the per-team
`teamMember.deleteMany` fan-out (lines 162-165) with:

```ts
prisma.teamResult.deleteMany({ where: { eventId: event.id } }),
```

(`TeamMember` has `onDelete: Cascade` on `teamResultId` — schema.prisma — so
members go with the rows.)

Test updates required:
- `game-occurrence.test.ts:660-689` ("drops teamResults with no active members
  after a recurrence reset") asserts the shells *persist* in the DB while the API
  hides them. This test would flip: DB rows are gone AND API returns `[]`.
- The #1322 regression tests (`team-randomize-triggers.test.ts`) seed shells
  explicitly — they stay valid (they test consumer resilience, which remains
  required for events where shells were created by a manual randomize below full).

## Risks

1. **In-flight drag-save during reset** — an organizer dragging players while the
   reset commits could have `assignTeams` recreate teamResults mid-transaction.
   Today the same race leaves stale shells. Both outcomes are benign; the delete
   version is strictly better.
2. **Undiscovered consumers** — mitigated by the table above being produced from a
   repo-wide `teamResult` grep (2026-10-12, commit `ad85ba6a`). Any consumer added
   after that date must handle zero rows, which every existing consumer already does.

## Conclusion

Deleting TeamResult rows at reset is safe and removes the empty-shell bug class at
the source. It is a small change (~5 lines + 1 test flip) but touches the recurrence
core, so it deserves its own Change with the `advance-occurrence` and
`game-occurrence` suites green. Optional follow-up: make TeamResult game-scoped
(schema migration) so the leak cannot reappear via any future write path.
