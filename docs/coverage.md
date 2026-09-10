# Test coverage: Crew Seasons pass

The opt-in Crew Seasons feature (season lifecycle, leaderboards, crew scoring,
activation gate, non-overlapping periods) shipped a large branch surface. This
document records the coverage pass that closed the systematic gap and the paths
that are intentionally left uncovered.

## Measured result

`vitest run --coverage` on this branch. The "before" column is the baseline
measured at the start of this pass (the prior config comment only named the
2026-08-27 pass, not its numbers). "After" is the full-suite run with the new
tests.

| Metric     | Before | After  | Gate |
|------------|--------|--------|------|
| Lines      | 94.32  | 94.96  | 94   |
| Statements | 90.87  | 92.14  | 92   |
| Functions  | 90.79  | 91.22  | 91   |
| Branches   | 81.21  | 83.60  | 83   |

Coverage only counts `src/lib/**` and `src/pages/api/**` (see
`vitest.config.ts`). React components are covered by behavior tests but are not
part of the threshold, per the existing configuration.

## Tests added

- `src/test/season-api-edge.test.ts` — seasons index (locked access, admin
  `canManage`, membership state, create validation, P2002 mapping), season
  detail (invite-token access, rating fallbacks, empty-crew average, activation
  gate, dissolving undersized crews) and membership (access/close windows,
  conflicting EventPlayers, idempotent withdrawal, rate limits).
- `src/test/season-membership-edge.test.ts` — single/bulk enrollment and
  candidate listing edge cases (auth, scope, rate limits, invalid bodies,
  empty candidate sets, non-admin rejection).
- `src/test/crew-api-edge.test.ts` — crew setup validation and proposal
  protection, recommendation branches, proposal create/review/invite/claim
  paths, error mapping and rethrow behavior.
- `src/test/season-lib-edge.test.ts` — `recommendCrews` tie-breaking and uneven
  splits, `calculateLeaderboard` malformed input/window handling and Crew
  tie-breaks, and `seasonSetup` authorization guards.
- `src/test/components/SeasonConditionalStates.test.tsx` — loading, error,
  unauthorized, locked, empty and no-access conditional states for
  `SeasonPage`, `SeasonListPage`, `CrewProposalPanel` and `LeaderboardTables`.

## Intentionally excluded paths

These branches are defensive or structurally unreachable through the public
interfaces, so no test asserts them:

- `seasons/[seasonId]/membership.ts` — `eventAccessAllowed`/`isEventAdmin`
  null-session fallbacks. Handlers reject anonymous callers (401) before these
  helpers run, so `session?.user?.id ?? null` and `if (!userId) return false`
  never take the null branch. The second condition in the "player has no
  account" check (`!user`) is guaranteed false by the `EventPlayer.userId`
  foreign key.
- `crew-proposals/index.ts` — `serializeProposal(null)`, the `rating … ?? 0`
  rating-map fallbacks (the map is built from every player), and the
  "Event not found" invite branch (a Season cascades from its Event, so the
  Event always exists).
- `crews/index.ts` — `savedCrew.membershipIds.length > 0` (crews are validated
  to hold 3–5 members before persistence).
- `crews/recommend.ts` — the `membersById` miss when expanding recommended
  memberships (ids always originate from the input membership set).
- `crewRecommendation.ts` / `leaderboard.ts` — `?? 0` rating lookups and the
  in-loop re-validation of games/scores that `filterLeaderboardGames` has
  already normalized. Keeping the guards makes the functions safe for direct
  callers; they are documented here instead of forcing tests through impossible
  states.

## Teams field / formations pass (2026-09-10)

The team field view added two counted `src/lib/**` modules — `formations.ts`
(sport formation presets) and the slot helpers in `teams.ts` (`placePlayer`,
`setFormation`, `normalizeSlots`, `firstFreeSlot`, `applyFormationLayout`) —
covered by `src/test/formations.test.ts` and `src/test/teams.test.ts`.

| Metric     | Previous | After  | Gate |
|------------|----------|--------|------|
| Lines      | 94.96    | 94.99  | 94   |
| Statements | 92.14    | 92.21  | 92   |
| Functions  | 91.22    | 91.49  | 91   |
| Branches   | 83.60    | 83.65  | 83   |

No threshold was lowered; all gates held.

