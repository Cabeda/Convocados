# 0019 — Wallet ledger as the single source of truth for payments

**Status:** Accepted
**Date:** 2026-07-09

## Context

Pre-ADR-0019, the payment read path (`src/lib/balance.server.ts`) computed
the Outstanding Balance by summing `pending`/`sent` entries from two
sources:

1. `PlayerPayment` — one row per `(eventCostId, playerName)`. Only the
   **current game** had a live row.
2. `GameHistory.paymentsSnapshot` — JSON `[ {playerName, amount, status} ]`
   frozen at game end. Immutable, append-only.

ADR 0007 added a `WalletTransaction` ledger (per-Event, integer cents,
double-entry `direction`, `reason` enum) as the **write-side** audit trail
for monthly subscriptions, Game Units, and the Extras Pot. The read path
was left untouched, with a deferred plan to migrate it after a monthly
cycle of production data. The `payment_received` reason was added but
not connected to anything.

In practice, the deferred plan never landed and the legacy read path
stayed in use. The new wallet writes were invisible to the balance
function, the join gate, and the post-game banner. The chip toggle in
`PaymentSection` (which edited `PlayerPayment`) was the only way to mark
a game as paid; for **historical** games frozen in the snapshot there
was no UI at all.

**Real-world trigger:** a 5-a-side football organizer (Gonçalo's group
in Porto) reported that one player shows a 10€ outstanding balance even
though he paid in cash. The two historical games (2026-04-20 and
2026-05-11) are frozen in the snapshot as `pending`; the organizer has
no way to mark them paid from the existing UI. The same problem affects
any organizer whose players pay in person and whose pre-existing
`PlayerPayment` rows were wiped by a recurrence reset.

A secondary issue: `GameHistory.paymentsSnapshot.playerName` is a free-text
field. The same person can appear as `Gonçalo` in one game and
`Gonçalo Silva` in another (we saw this in production data for the
Gonçalo event). The read path matches by exact string, so a rename or
typo orphans the row from the new ledger.

## Decision

We are in beta. Do everything in a single PR.

### 1. Schema: `gameHistoryId` + `playerName` on `WalletTransaction`

Add two nullable columns:

- `gameHistoryId` — FK to `GameHistory.id`. A `payment_received` row with
  `gameHistoryId` set is a **Historical Settlement** — a record that a
  specific frozen snapshot entry has been cleared in real life.
- `playerName` — snapshot of the player's name at write time, for
  ghost players whose `User` is a synthetic `ghost:{eventPlayerId}`
  account. The read path joins on `userId`, not on name; the column is
  for the activity-tab display and for the backfill keying.

The migration is additive: nullable columns + three indexes. No
destructive changes.

### 2. Backfill: `npm run wallet:backfill`

`scripts/wallet-backfill.ts` is an idempotent CLI that:

1. For every `Player` row, ensures an `EventPlayer` exists with the same
   `(eventId, name)`.
2. For every ghost `Player` (no `userId`), creates a real `User` with
   `id = "ghost:{eventPlayerId}"` and email
   `ghost-{eventPlayerId}@system.local`, then links the `EventPlayer`
   to it.
3. For every `PlayerPayment` row, writes a `payment_received` or
   `payment_self_reported` `WalletTransaction` row with
   `idempotencyKey = backfill:playerPayment:{id}`.
4. For every `GameHistory.paymentsSnapshot` entry with status
   `paid`/`sent`, writes the corresponding `WalletTransaction` row
   with `gameHistoryId` set and
   `idempotencyKey = backfill:snapshot:{gameHistoryId}:{playerName}`.
5. For every `GameHistory.teamsSnapshot` member, writes a
   `per_game_share` debit with `gameHistoryId` set and
   `idempotencyKey = backfill:perGameShare:{gameHistoryId}:{name}`.

The script is safe to re-run: every write is keyed on an
`idempotencyKey` (which has a `@@unique` constraint). On the second
run, 0 rows are created, all are skipped. Confirmed in
`src/test/wallet-backfill.test.ts`.

### 3. Read path: feature-flagged, instant rollback

`src/lib/balance.server.ts` checks the new env var:

```ts
WALLET_READ_PATH_ENABLED=true   // read from the ledger (the new path)
WALLET_READ_PATH_ENABLED=false  // read from PlayerPayment + snapshot (legacy)
```

Default: `false` on first deploy. Set to `true` after the backfill
completes and the operator is satisfied. Rollback = flip to `false`.
No schema change, no deploy needed.

The legacy functions are extracted to `src/lib/balance.legacy.server.ts`
and unchanged. The new path computes the Outstanding Balance as:

```
owed = Σ per_game_share debits − Σ payment_received credits
gamesOwed = number of distinct gameHistoryIds with an outstanding debit
```

The post-game banner now reads from the ledger. The recurrence reset
in `src/pages/api/events/[id]/index.ts` builds the next `paymentsSnapshot`
from the ledger rows scoped to the current `Game.id` (so the snapshot
captures the state at game end, not "now").

### 4. Write path: ledger is canonical, `PlayerPayment` is read-cache

`PlayerPayment` is no longer the write target. `recordPerGameShare` and
`syncPaymentsForEvent` still upsert a `PlayerPayment` row for backwards
compat (the existing tests rely on it), but the canonical state is in
the ledger. The chip toggle in `PaymentSection` is gone from the web
UI; the underlying `PUT /api/events/[id]/payments` endpoint still works
for the Android app and external callers, and writes to **both**
`PlayerPayment` and `WalletTransaction` so the legacy read path stays
in sync during the transition.

`GameHistory.paymentsSnapshot` continues to be written by the recurrence
reset, but **only from the ledger**. New games no longer write
`PlayerPayment` rows; the live state is read from the ledger via
`getOutstandingBalance` (which uses `_unscoped_` for the current game).

### 5. New API surface for historical settlement

| Method | Path | Auth | Body | Effect |
|---|---|---|---|---|
| GET | `/api/events/[id]/payments/all` | Owner/Admin | — | Returns the per-player × per-game matrix for the whole event |
| POST | `/api/events/[id]/payments/historical` | Owner/Admin | `{gameHistoryId, playerName, amountCents?, method?}` | Writes a `payment_received` Historical Settlement for one (player, game) |
| POST | `/api/events/[id]/payments/historical/bulk` | Owner/Admin | `{playerName}` | Settles EVERY pending/sent historical game for the player; one row per game |
| POST | `/api/events/[id]/payments/remind` | Owner/Admin | `{playerName}` | Sends the existing `payment_reminder` push (Tier 2, ADR 0017) to the player |

The bulk endpoint creates N ledger rows (one per historical game), not
a single settlement row. Each row is idempotent on `(gameHistoryId,
playerName)` so the activity tab shows them individually and re-runs
are safe.

### 6. New UI: "Payments" tab in `/settle`

`src/components/SettleUpPage.tsx` adds a 4th tab "Payments" (visible
to Owner/Admin). It contains two sub-tabs:

- **By game** (`PaymentsMatrixTab.tsx`) — the per-player × per-game
  matrix. Each `pending`/`sent` cell is a button that opens a
  confirmation modal and writes a Historical Settlement. Settled cells
  show a green ✓ chip. Cells for `absent` players in that game show
  a dash.
- **By player** (`PlayerDebtsTab.tsx`) — one card per player with
  outstanding historical debts, listing the games. Each card has a
  bell icon (sends `payment_reminder`) and a "Mark all paid" button
  (calls the bulk endpoint).

The `PaymentSection` chip toggle and the "Mark all paid" button are
gone. A "Manage all payments" link points to the new tab.

### 7. Operator deploy runbook

1. Deploy new code (with `WALLET_READ_PATH_ENABLED=false`).
2. `npm run wallet:backfill` (idempotent, can be re-run).
3. Smoke-test the event: `GET /events/{id}/settle` → check that the
   Outstanding Balance for a known player matches the legacy view.
4. Set `WALLET_READ_PATH_ENABLED=true` and redeploy.
5. Rollback: set `WALLET_READ_PATH_ENABLED=false` and redeploy. The
   `PlayerPayment` and `paymentsSnapshot` writes are still happening,
   so the legacy read path returns fresh data instantly.

## Consequences

- Gonçalo's scenario (and any equivalent) is fixable in two clicks:
  open the Payments tab, mark the two pending rows paid, balance
  drops to 0. The Historical Settlements live in the ledger and are
  visible in the per-player activity feed.
- The frozen `GameHistory.paymentsSnapshot` is not edited. ADR 0007's
  "rebuild would change visible history" property is preserved.
- The `PlayerPayment` and `paymentsSnapshot` writes continue for one
  release so the legacy read path can serve the rollback case. A
  follow-up PR can stop writing them and the read path can be
  deleted. This ADR explicitly defers that step.
- Ghost players now have a stable `User.id = "ghost:{eventPlayerId}"`
  that survives renames. The rename-tolerant name drift is fixed at
  the source: the ledger rows are joined on `userId`, not on name.
- The `notifyPaymentReminder` translation key is new in all 6 locales.
- A 4th "Payments" tab is added to `/settle`. The other tabs are
  unchanged.

## Alternatives considered

- **Partial netting (write Historical Settlement, add netting rule).**
  Considered and rejected. Keeps the dual-source-of-truth problem
  alive (the read path is more complex; netting is easy to get wrong)
  and complicates the join gate. We have the budget to do the full
  switch in beta.
- **Keep `PlayerPayment` writes for the chip, write ledger only for
  the new APIs.** Rejected: the chip endpoint is the same code path
  the user uses today; the dual-write is needed to keep the legacy
  read path correct during the transition.
- **Stop writing `PlayerPayment` entirely.** Rejected: the existing
  tests rely on it; the legacy read path's "instant rollback" depends
  on it; and a follow-up PR can clean it up once the flag has been
  `true` in production for a full month.
- **Edit the frozen snapshot when a payment is recorded.** Rejected:
  destroys immutability. ADR 0007 calls this out as the reason not to
  re-derive snapshots.
- **Add a new column to `GameHistory` for "settled" overrides.**
  Rejected: pollutes the legacy table; the new ledger is the cleaner
  place.

## Migration safety net

The migration is reversible in two ways:

1. **Env-var rollback** (instant). Set `WALLET_READ_PATH_ENABLED=false`
   and the read path uses the legacy `PlayerPayment + snapshot` impl
   in `balance.legacy.server.ts`. The legacy data is still being
   written, so the legacy read path returns fresh data. No deploy
   needed (just a config change + restart).
2. **Git revert** (full). The migration is additive (new column, new
   rows, new files). A `git revert` of the merge commit removes the
   new code, drops the new column, and rolls back to the pre-migration
   state. The `WalletTransaction` rows written by the new code are
   not used by the legacy read path, so they don't pollute anything.

The backfill script is itself idempotent and can be re-run after a
revert if needed.
