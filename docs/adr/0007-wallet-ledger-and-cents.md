# 0007 — Wallet ledger as the single source of truth for money

**Status:** Accepted
**Date:** 2026-06-12

## Context

`PlayerPayment` (one row per player per event instance) and the JSON
`GameHistory.paymentsSnapshot` were the only payment artifacts. Both were
treated as both *current state* (the join gate reads them) and *history* (the
post-game banner renders them). Adding Monthly Subscriptions and a Wallet
introduces new kinds of movement (Game Units earned/redeemed/expired,
`monthly_fee`, `extras_declare`) that don't fit either table.

Keeping `PlayerPayment` as the source of truth would force us to either cram
those new movements into a column it doesn't have, or maintain two parallel
ledgers — the original "headache" the feature was supposed to remove.

## Decision

Introduce a new per-Event `WalletTransaction` ledger (integer cents, double-entry
`direction`, `reason` enum). It is the **single source of truth** for:

- The per-player transaction history (goal 4).
- The Extras Pot running balance (via `credit_expired` and `extras_declare` rows).
- Game Unit credit and redemption.
- Monthly subscription coverage (read through `MonthlySubscription`, not via
  ledger rows — see ADR 0008 / OI-1).

`PlayerPayment` and `GameHistory.paymentsSnapshot` **continue to exist** and
continue to be the **read side** of money state, for two reasons:

1. The existing `balance.server.ts` reads them and is the source of truth
   for the join gate and the post-game banner; rewriting it in the same
   change is a much larger blast radius.
2. Historical games frozen in `paymentsSnapshot` should not be re-derived
   from a ledger that didn't exist when they were played.

`recordPerGameShare` therefore **dual-writes**: it writes a `WalletTransaction`
row (the new audit trail) and updates the `PlayerPayment` row (the legacy read
side). The two are kept consistent by being written in the same code path.

The migration plan: in a follow-up PR, after `WalletTransaction` has been
the only write path for at least one full monthly cycle, the balance
functions can be re-pointed to read from the ledger and `PlayerPayment` can
be marked deprecated. Until then, both sources are authoritative and
mutually consistent.

`amountCents` is an **integer** (not `Float`) to avoid the rounding errors
already present in `balance.server.ts`'s `Math.round(amount * 100) / 100`
pattern. Existing `PlayerPayment.amount` stays `Float` for backwards compat
with the old data; new code paths only write to `WalletTransaction`.

## Consequences

- The join-gate check at `src/pages/api/events/[id]/players.ts:354` continues
  to use `getGateBalance` (which counts `pending` only) — but with one
  addition: monthly-covered players and players with auto-redeemed credit
  have a `PlayerPayment` row of `amount: 0, status: paid`, so the gate sees
  them as cleared. This works *because* `recordPerGameShare` mirrors the
  ledger decision into `PlayerPayment`.
- The cron that expires credits and credits the Extras Pot must be
  **idempotent** — running it twice the same day must not double-credit the
  pot. This is enforced by a uniqueness constraint on
  `WalletTransaction.idempotencyKey`.
- All money displays in the UI render from cents. Display-only
  `amount: number` shapes (e.g. `PlayerPayment.amount`) keep their `Float` form
  for the existing API contract, but no new code path writes them as
  authoritative state.
- Any future feature touching money (payment integrations, receipts, etc.)
  MUST write to `WalletTransaction` and not invent a third source of truth.
- The **historical** read path is now ledger-driven via ADR 0019
  (`gameHistoryId` on `WalletTransaction`, snapshot is netted against
  `payment_received` rows for that history). The **current-game** read
  path still uses `PlayerPayment` and will be migrated in a separate
  PR once the monthly cycle is complete.

## Alternatives considered

- **Keep `PlayerPayment` as the source of truth, add columns for Game Units
  and `reason`.** Rejected: `PlayerPayment` is keyed on `(eventCostId, playerName)`
  with a 1:1 relationship to a per-game row. Game Units are per-month, not
  per-game, and would not have a natural key. Forcing them in would create a
  polymorphic column or a parallel table — i.e. a second source of truth.
- **Single source of truth from day one — rewrite the balance functions in
  the same change.** Rejected: doubles the blast radius of the PR and
  changes the read path at the same time as the write path, which is the
  textbook recipe for the "kickoff at 21:00 on Monday" regression. The
  dual-write / dual-read approach is more work over two PRs but much less
  risky.
- **Rebuild `GameHistory` too — regenerate `paymentsSnapshot` from the ledger
  for old games.** Rejected: historical data should stay frozen. Re-deriving
  would change the visible history for any game that was completed under the
  old system, which is a user-facing regression.
- **Use an external payments provider (Stripe Treasury, etc.) and a third-party
  ledger.** Rejected: out of scope; the organizer pays the court out of pocket
  and the app's job is to track who-owes-what, not move money.
