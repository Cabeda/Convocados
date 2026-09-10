# Seasonal Rank Ladder — implementation spec

Companion to [ADR 0031](./adr/0031-seasonal-rank-ladder.md). Synthesises the wayfinder
map for GH-939. This is the build plan: no open decisions remain.

## 1. Model

Two layers per Event:

| Layer | Visibility | Seed | Update | Resets? | Feeds |
|---|---|---|---|---|---|
| **Skill Rating** | hidden | 1000 | Elo, K=48 (<6 games) / 32 | never | `balanceTeams`, Season Rank expected-score |
| **Season Rank** | visible | `Skill − anchor` (existing) / 0 (new) | `K·(outcome − E)`, K=32 (64 first ≤3 games) | soft, per Season | nothing |

- Season Rank hidden value `R` is signed and unbounded. Displayed = `max(0, round(R))`.
- Expected score always uses opponents' **Skill Rating**, never Season Rank.
- Qualifying game set = `filterLeaderboardGames` (played, non-friendly, valid scores, two
  valid lineups, within the Season period) — the same set standings use.

## 2. Pure module — `src/lib/seasonRank.ts`

Mirror `src/lib/elo.ts`: pure, no DB, unit-tested.

```ts
export const TIER_NAMES = ["Bronze","Silver","Gold","Platinum","Diamond","Master"];

expectedScore(playerSkill: number, opponentSkill: number): number      // reuse elo.ts
kRank(seasonGames: number, seeded: boolean): number                    // 32, or 64 while provisional
provisionalGames(N: number): number                                    // clamp(round(0.25N), 3, 10)
seedRank(skill: number, anchor: number): number                        // max(0, skill - anchor)
rankDelta(playerSkill: number, opponentAvgSkill: number, outcome: 0|0.5|1, seasonGames: number, seeded: boolean): number
applyGame(R: number, delta: number): number
softReset(R: number, seed: number): number                             // R + 0.5*(seed - R)
displayRank(R: number): number                                         // max(0, round(R))
tierOf(R: number, edges: number[]): number
tierEdges(seededRanks: number[], tiers = 6): number[]                   // percentile (equal-count) edges
computeSeasonRank(input): SeasonRankResult[]                           // replay one Season
```

`computeSeasonRank` takes: the Season period, the qualifying games (with lineups + scores),
each participant's Skill Rating (via the seam) and prior seed, and returns per-player
`{ hidden, display, tier | provisional, gamesThisSeason, perGameDeltas }`.

## 3. Data model (Prisma)

New fields on `Event`:

```prisma
rankEnabled            Boolean @default(true)   // Season Rank on/off
rankDecayEnabled       Boolean @default(false)  // inactivity decay (default off)
inactiveRankBehavior   String  @default("freeze") // "freeze" | "reset"
rankAnchor             Float?                   // derived once at first activation, frozen
rankTierEdges          String?                  // JSON: number[] derived once at launch, frozen
```

New model — completion snapshot only (the active Season derives on read):

```prisma
model SeasonRankSnapshot {
  id         String   @id @default(cuid())
  seasonId   String   @unique
  season     Season   @relation(fields: [seasonId], references: [id], onDelete: Cascade)
  payload    String   // JSON: per-player { hidden, display, tier, games }, Crew standings, winner/badges
  createdAt  DateTime @default(now())
}
```

No mutable per-player Rank table: the active Season's Rank is derived on read, so the ~7
`recalculateAllRatings` callers need no Rank-aware changes.

## 4. Canonical skill seam

```ts
// src/lib/skill.server.ts
export async function getLifetimeSkill(eventId: string, names: string[]): Promise<Map<string, number>>
```

Today it reads `PlayerRating` (the live Elo store). After GH-522 it reads `EventPlayer.rating`.
Season Rank code never reads a rating store directly; only this accessor. Manual
`initialRating` overrides are already part of the Elo values this returns.

## 5. Read / replay / recompute

- **Active Season Rank** is computed on read (server) from the qualifying games + seed,
  like standings. No write on each game.
- **On `active` activation**: derive `rankAnchor` (p5 or min of the established Skill
  distribution, frozen) + `rankTierEdges` (percentile) once; apply one **soft reset** to
  every participant carrying a Rank from the previous Season
  (`R = R + 0.5·(seed − R)`, `seed = current Skill − anchor`). Skipping a Season does not
  compound the reset.
- **On `completed`**: write `SeasonRankSnapshot` (Rank + tiers + Crew standings + winner).
- **On `reopen`**: delete + regenerate the snapshot and replay Rank forward through later
  Seasons.
- **On `cancelled`**: no snapshot; Rank reverts to pre-Season.
- **Period/eligibility edits** (e.g. GH-932 season period change): recompute the affected
  Season forward. Because Rank is a pure replay, this needs no mutation of Elo.

## 6. Tier bands

Six bands. Edges = equal-count percentiles of the **established** (≥3 games) seeded Rank
distribution at first activation; frozen in `Event.rankTierEdges`; re-derived only by an
audited admin action. Pilot example on the live Event: anchor 879, edges
`0/75/102/107/118/213/+` → Bronze/Silver/Gold/Platinum/Diamond/Master. Re-derive after
Season 1 when the distribution fills.

## 7. History

- **Seasons list** (exists) already splits current vs past.
- **Season detail**: final Crew leaderboard (reuse `/history?seasonId=`) + a **Ranking**
  section (Season Rank ladder from the snapshot) + a **Games** list (the Season's
  qualifying games).
- **Game detail**: reuse the Game history detail; add each participant's **Rank delta**.
- **Visibility**: Crew ladder + game results to anyone who can view the Event; individual
  Rank to Event members only. Cancelled Seasons are marked, with no winner and no snapshot.

## 8. Settings

Section **Competition**, master **Competitive rankings** (bundles Elo + balancing + Rank +
MVP-rating; off hides the stack). Independent top-level: **Show ratings to players**,
**MVP voting**. **Advanced** (collapsed): hide-in-teams, manual rating, **decay** (off),
**inactive-Rank behaviour** (`Freeze` default / `Reset`). Master + dependents lock
read-only while a Season is `active`/`review`.

## 9. UI surfaces

- **Ratings page** (Variant A): table with Tier chip + numeric Rank + progress-to-next
  bar. State tabs are admin-only; members see derived state. Drop/hide the progress column
  on narrow screens (overflows at 430px).
- **Tier transition** (Variant A): full-screen modal. UP = badge upgrade + confetti +
  earned-competence copy + to-go next tier. DOWN = same modal, no confetti, fresh-start
  copy + path back. Fires after the triggering game.
- **Season page**: Rank ladder + Games on the Season detail.

## 10. Platforms

- Web + Android phone: Ratings table, Season Rank ladder, tier-transition modal; Android
  UP fires a haptic.
- Wear OS: haptic on UP only; no standings UI in the pilot.

## 11. Migration

1. Add the Prisma fields + `SeasonRankSnapshot` (migration).
2. Add `getLifetimeSkill` reading `PlayerRating`; switch to `EventPlayer.rating` with GH-522.
3. Backfill `rankAnchor` / `rankTierEdges` at each Event's first Season activation.
4. No Rank data migration (Rank is new); no changes to `recalculateAllRatings`.

## 12. Testing

- Unit (`src/test/seasonRank.test.ts`): seeding, K schedule, floor, soft reset,
  percentile edges, tier boundaries, replay determinism, forward recompute.
- Integration: activation reset, completion snapshot, cancel revert, reopen recompute,
  period-edit forward recompute, visibility gating.

## 13. i18n

New keys across all six locales: section/master labels, Advanced, decay, inactive-Rank
(freeze/reset), tier names, provisional, progress-to-next, and the tier-up/tier-down copy.

## 14. Reconciliation with the pilot doc (`docs/friendly-competition-pilot.md`, #875)

**Added** (does not exist in the pilot): an individual **Season Rank** layer, its tiers, the
seasonal soft reset, Rank history, and the settings consolidation.

**Unchanged**: Skill Rating (still the balancing Elo, never reset); the Crew best-six 3/1/0
competition as the parallel team ladder; the Season lifecycle and eligible-game definition.

**Sharpened**: "individual progress is private" is now concrete — individual Rank is
Event-members-only; the Crew ladder stays public.

## 15. Not yet specified (from the map)

Anti-tanking/smurfing; cross-Event/global rank; a Crew rank/tier; rank-change webhooks;
rewards/season-pass tie-ins; Wear standings; automatic vs admin-triggered recompute on
period change.
