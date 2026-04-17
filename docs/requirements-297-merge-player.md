# Requirements: Merge Logged-In User with Anonymous Player (#297)

## Problem

The current "It's me" (`POST /api/events/[id]/claim-player`) flow performs a simple reassignment — it renames the anonymous player and links the `userId`. This works when the anonymous player has no history, but fails when **both** the anonymous player and the logged-in user already have records (game stats, Elo ratings, payment records, team snapshots). A simple claim either loses the anonymous player's history or creates duplicates.

## Scope

Extend the claim-player endpoint with an optional **merge** mode that consolidates two player identities into one.

---

## Functional Requirements

### FR-1: Merge Detection (Preview)

**`POST /api/events/[id]/claim-player/preview`**

Before executing a claim, the user can request a preview of what will happen.

- Input: `{ playerId: string }`
- Output:
  ```json
  {
    "canSimpleClaim": true,
    "mergeRequired": false,
    "preview": {
      "anonymousPlayer": { "name": "João", "hasRating": true, "gamesPlayed": 5 },
      "loggedInPlayer": null,
      "conflicts": []
    }
  }
  ```
- When the logged-in user already has a `Player` record in the event with history (ratings, team snapshots, payments), set `mergeRequired: true` and populate `conflicts`.
- Conflict types:
  - `"duplicate_rating"` — both identities have a `PlayerRating` row
  - `"duplicate_payment"` — both have `PlayerPayment` rows for the same `eventCostId`
  - `"overlapping_snapshot"` — both names appear in the same `GameHistory.teamsSnapshot`

### FR-2: Simple Claim (Existing Behavior)

**`POST /api/events/[id]/claim-player`** with `{ playerId, mode: "claim" }` (default)

- Unchanged from current behavior.
- Blocked (409) if the user already has a linked player in the event.

### FR-3: Merge Mode

**`POST /api/events/[id]/claim-player`** with `{ playerId, mode: "merge" }`

- Only allowed when the user already has a linked player in the event (the opposite of simple claim).
- Requires the target player (`playerId`) to be anonymous (`userId: null`).
- Executes inside a single Prisma `$transaction`:

#### FR-3.1: Player Record Consolidation
- Delete the anonymous `Player` row.
- Keep the user's existing `Player` row (already has `userId`).
- If the anonymous player had a lower `order`, update the user's player to use that order (preserve queue position).

#### FR-3.2: PlayerRating Merge (Recalculation)
- If only the anonymous player has a `PlayerRating`: rename it to the user's name and set `userId`.
- If only the user has a `PlayerRating`: no change needed.
- If both exist:
  1. Delete both `PlayerRating` rows.
  2. Create a fresh `PlayerRating` for the user (default 1000 Elo).
  3. Collect all `GameHistory` entries for the event where either name appears in `teamsSnapshot`.
  4. Replay all games in chronological order through `processGame()` (from `elo.server.ts`) to derive the honest combined rating.
  5. This is manipulation-proof — the rating is always a function of actual match results, not stored numbers. Cherry-picking anonymous players provides no benefit because the Elo is recalculated from scratch.
- Mark all affected `GameHistory` entries as `eloProcessed: false` before replay, then `true` after.

#### FR-3.3: TeamMember Rename
- Update all `TeamMember` rows where `name` matches the anonymous player's name (within the event's `TeamResult`s) to the user's name.

#### FR-3.4: GameHistory teamsSnapshot Rename
- In all `GameHistory` rows for the event, replace the anonymous name with the user's name in the `teamsSnapshot` JSON.
- If both names appear in the same snapshot (conflict), keep only the user's name and remove the duplicate entry.

#### FR-3.5: PlayerPayment Merge
- If only the anonymous player has payments: rename `playerName` to the user's name.
- If both have payments for the same `eventCostId`: sum the amounts into the user's payment, keep the latest `status` and `paidAt`, delete the anonymous one.
- If they have payments for different cost records: just rename the anonymous ones.

#### FR-3.6: EventLog Entry
- Create an `EventLog` entry with:
  - `action: "player_merged"`
  - `actor`: user's name
  - `actorId`: user's ID
  - `details`: `{ fromName, toName, ratingBefore, ratingAfter, anonymousRating, gamesMerged }`
- This entry also serves as the one-merge-per-event guard (see FR-6.1).

### FR-4: Race Condition Protection

- The merge transaction must use `updateMany` with `userId: null` guard on the anonymous player (same pattern as current claim).
- If the anonymous player is claimed by someone else mid-merge, return 409.
- The transaction must be atomic — partial merges are not acceptable.

### FR-5: Authorization

- Only the authenticated user can merge into their own identity.
- Event owner/admin cannot merge on behalf of another user.

### FR-6: Anti-Gaming Protection

A user could abuse the merge flow to cherry-pick high-rated anonymous players and inflate their Elo. Mitigations:

#### FR-6.1: One Merge Per Event
- Each user is allowed **at most one merge** per event (lifetime, not per session).
- Track this via the `EventLog`: before executing a merge, check if an `action: "player_merged"` entry already exists for this `actorId` + `eventId`. If so, return 409 with `"You have already merged a player in this event."`.
- This covers the primary abuse vector: a user cannot repeatedly absorb anonymous players' ratings.

#### FR-6.2: Merge Audit Trail
- The `EventLog` entry (FR-3.6) must include enough detail to allow an admin to review and revert:
  - `fromName`: the anonymous player's original name
  - `toName`: the user's name
  - `ratingBefore`: the user's rating before merge
  - `ratingAfter`: the user's rating after merge
  - `anonymousRating`: the anonymous player's rating at merge time
  - `gamesMerged`: number of games absorbed from the anonymous player
- Event owners can view the event log and see all merges.

#### FR-6.3: Owner Override (Future)
- Reserved for a future iteration: allow event owners to revert a merge by restoring the anonymous player and undoing the rating change. Out of scope for this issue.

---

## Non-Functional Requirements

### NFR-1: Performance
- The merge transaction should complete in under 2 seconds for events with up to 500 game history entries.

### NFR-2: Backwards Compatibility
- The existing `POST /api/events/[id]/claim-player` with `{ playerId }` (no `mode`) must continue to work as before (defaults to `mode: "claim"`).
- No schema migrations required — all changes use existing tables.

### NFR-3: Rate Limiting
- Both preview and merge endpoints use the existing `"write"` rate limiter.

---

## Test Plan

### Unit Tests (in `src/test/`)

| # | Test Case | Expected |
|---|-----------|----------|
| T1 | Preview: anonymous player with no user player in event | `canSimpleClaim: true, mergeRequired: false` |
| T2 | Preview: anonymous player + user already has player with rating | `mergeRequired: true, conflicts: ["duplicate_rating"]` |
| T3 | Preview: anonymous player + user has player but no overlapping data | `mergeRequired: true, conflicts: []` |
| T4 | Merge: recalculates Elo from combined game history | Rating derived from replayed games, not averaged |
| T5 | Merge: renames TeamMember rows | All anonymous TeamMember names updated |
| T6 | Merge: renames GameHistory teamsSnapshot | JSON snapshots updated |
| T7 | Merge: consolidates PlayerPayment for same eventCostId | Amounts summed, duplicate deleted |
| T8 | Merge: renames PlayerPayment for different eventCostId | playerName updated |
| T9 | Merge: preserves lower order from anonymous player | User's player.order updated |
| T10 | Merge: creates EventLog entry with full audit trail | `action: "player_merged"` with ratingBefore/After |
| T11 | Merge: returns 409 on race condition | Anonymous player claimed mid-merge |
| T12 | Merge: returns 409 if target player already has userId | Cannot merge non-anonymous player |
| T13 | Merge: returns 409 if user has no existing player (use simple claim instead) | Error message guides to claim |
| T14 | Simple claim still works (backwards compat) | Existing tests pass unchanged |
| T15 | Merge: returns 401 for unauthenticated users | Auth required |
| T16 | Merge: blocks second merge in same event | 409: "You have already merged a player in this event." |
| T17 | Merge: Elo recalculation matches replaying all games from scratch | Rating equals fresh processGame() replay |
| T18 | Merge: cherry-picking high-rated anonymous player gives no Elo benefit | Recalculated rating reflects actual game results only |

---

## API Summary

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/events/[id]/claim-player/preview` | `{ playerId }` | Preview what claim/merge will do |
| POST | `/api/events/[id]/claim-player` | `{ playerId, mode?: "claim" \| "merge" }` | Execute claim or merge |

---

## Affected Files

- `src/pages/api/events/[id]/claim-player.ts` — add merge mode
- `src/pages/api/events/[id]/claim-player/preview.ts` — new endpoint
- `src/test/auth-api.test.ts` — extend existing claim-player tests
- `src/lib/i18n/*.ts` — add merge-related UI strings (if UI work follows)

## Out of Scope

- UI changes (separate issue — this is API-only)
- Cross-event merge (merging the same user across different events)
- Admin-initiated merge on behalf of another user
