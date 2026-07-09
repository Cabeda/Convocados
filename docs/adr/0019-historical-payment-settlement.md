# 0019 — Historical payment settlement via the WalletTransaction ledger

**Status:** Accepted
**Date:** 2026-07-09

## Context

The legacy read path (`src/lib/balance.server.ts`) computes a player's
Outstanding Balance by summing `pending`/`sent` entries from two sources:

1. `PlayerPayment` — one row per `(eventCostId, playerName)`. Only the **current
   game** has a live row.
2. `GameHistory.paymentsSnapshot` — JSON `[ {playerName, amount, status} ]`
   frozen at game end. Immutable, append-only.

When a player pays in real life, the organizer has only one way to record it
in the existing UI: toggle the **current** game's `PlayerPayment` row via the
chip in `PaymentSection` (which calls `PUT /api/events/[id]/payments`). The
historical games in `paymentsSnapshot` have no `PlayerPayment` row to update
— they are frozen JSON.

`WalletTransaction` (ADR 0007) was added as the write-side audit trail for
the new monthly / wallet / extras features, but it does not currently link
back to a specific historical game. The new `recordReceived()` writes a
`payment_received` row, but `getOutstandingBalance` / `getEventBalanceSummary`
do not read it, so the settlement is invisible to the read path.

**Real-world trigger:** an organizer (Gonçalo's group, 5-a-side football in
Porto) reported that one of their players shows a 10€ outstanding balance
even though they paid in cash. The two historical games (2026-04-20 and
2026-05-11) are frozen in the snapshot as `pending`; the organizer has no UI
to mark them paid. The same problem affects any organizer whose players pay
in person and whose pre-existing `PlayerPayment` rows were wiped by a
recurrence reset.

## Decision

1. **Add `gameHistoryId`** as a nullable, indexed foreign key on
   `WalletTransaction`. A row with `reason = "payment_received"` and
   `gameHistoryId != null` is a **Historical Settlement** — a record that a
   specific `(player, historical game)` debt has been cleared in real life,
   even though the snapshot still says `pending`.

2. **Net the ledger against the snapshot** in the read path. A historical
   entry is considered **paid** when there exists a `payment_received`
   `WalletTransaction` row with `gameHistoryId` pointing at that history row
   for that user (matched by `userId`, or by `playerName` for unlinked ghost
   players — see consequences). The Outstanding Balance subtracts those
   amounts.

3. **The frozen `GameHistory.paymentsSnapshot` is not edited.** Historical
   data stays historical. The settlement lives in the ledger; the read path
   applies the netting. This preserves the "rebuild would change visible
   history" property ADR 0007 called out as the reason not to re-derive
   snapshots.

4. **One row per (player, historical game) for bulk settle.** The
   "Mark debt as settled" admin action creates N `payment_received` rows —
   one per historical game in the player's debt list — each with its own
   `gameHistoryId` and `idempotencyKey`. This keeps the per-player activity
   tab auditable (each row has its own line) and lets the netting rule
   fire per-game. Idempotency is enforced by
   `idempotencyKey = settle-historical:{gameHistoryId}:{userId}`.

5. **The live `PlayerPayment` row is not touched.** It represents the
   *current* game's status. A historical settlement lives only in the
   ledger. This is consistent with ADR 0007 OI-2 (zero-amount `paid`
   `PlayerPayment` rows for monthly-covered or fully-redeemed entries
   remain a write-time concern of `recordPerGameShare`, not a read-time
   concern of historical reconciliation).

6. **Owner/Admin only.** Marking a historical entry as paid is a money
   statement. Players can see the read-only matrix; they cannot toggle
   historical entries. They continue to be able to self-report their own
   `pending → sent` transitions on the **current** game's `PlayerPayment`
   row (ADR 0006), which is a separate code path.

7. **The "Remind" action sends the existing `payment_reminder` push**
   (Tier 2 notification, per ADR 0017) immediately, bypassing the 3-stage
   nudge escalation in CONTEXT.md (`Payment Nudge Escalation`). Admin-
   initiated reminder takes priority over the automatic sequence.

## Consequences

- The Gonçalo scenario (and any equivalent) is fixable in two clicks: open
  /events/{id}/settle → Payments tab → check the two pending rows → confirm.
  A `payment_received` row is written for each, the read path nets them
  out, the balance drops to 0.
- The `/api/events/[id]/payments/all` matrix view becomes the **canonical
  place** to see money state across the event. It reads from
  `GameHistory.paymentsSnapshot` (per-game history) joined with
  `WalletTransaction` (the net). The current `PaymentSection` chips remain
  the entry point for the **current** game's live `PlayerPayment` toggles.
- The `gameHistoryId` column makes the ledger a strictly stronger source of
  truth than it was in ADR 0007. The follow-up read-side switch ADR 0007
  promised ("after one full monthly cycle of production data") now becomes
  feasible for the historical path: the read path can be migrated
  incrementally — the live `PlayerPayment` row keeps representing the
  current game, the `gameHistoryId`-keyed ledger nets historical entries.
- Unlinked ghost players (no `userId` on the snapshot entry) are matched
  by `playerName` against the `Player` table at the time of the
  settlement. The idempotency key embeds the `gameHistoryId` so a rename
  of the EventPlayer does not break the uniqueness guarantee (a second
  settlement attempt after a rename is a no-op for the same history row).
  This is consistent with the "system user per (event, playerName)"
  pattern in `payments.server.ts:ensureSystemUserId`.
- The schema migration is small and additive: one nullable column, one
  index. No existing rows need backfill (`gameHistoryId` is `null` for
  per-game-share debits, monthly-fee credits, etc. — they do not refer
  to a specific historical game).
- This ADR supersedes the "follow-up PR will switch the read path"
  paragraph in ADR 0007 for the **historical** path only. The
  `PlayerPayment` row for the current game remains authoritative for
  join-gate reads until the monthly cycle is complete and the live path
  is migrated separately.

## Alternatives considered

- **Re-render `paymentsSnapshot` when a historical payment is recorded.**
  Rejected: destroys the immutability guarantee and changes visible
  history for any game that was completed under the old system. Same
  reason ADR 0007 rejected "rebuild `GameHistory` from the ledger."
- **Add a separate `HistoricalPaymentSettlement` table.** Rejected: a
  second money table is exactly the parallel-ledger headache ADR 0007
  was written to avoid. The existing `WalletTransaction` already has
  the columns we need (or, with one migration, will).
- **Use `idempotencyKey` with a structured key to encode the
  `(gameHistoryId, userId)` tuple and skip the schema migration.**
  Rejected: pushes a queryable link into a string field, defeats the
  index, and forces every read path to string-parse the key. A real
  column is one migration now in exchange for clarity forever.
- **Let players self-report historical payments (`pending → sent`).**
  Rejected: ADR 0006 already restricts self-report to the current
  game's `PlayerPayment` row, and only the Owner/Admin can move
  `sent → paid`. Allowing players to self-report historical entries
  would let them unilaterally clear debts the organizer hasn't seen
  money for. Historical settlement stays admin-only.
