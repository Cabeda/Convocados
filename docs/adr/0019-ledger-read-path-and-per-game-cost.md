# 0019 — Ledger read-path switch and per-Game cost override

**Status:** Accepted
**Date:** 2026-07-20

## Context

ADR 0007 introduced `WalletTransaction` as the single source of truth for money,
with a dual-write to `PlayerPayment` for backwards compatibility. The plan was to
switch the read path (balance functions) to the ledger after one full monthly
cycle of dual-writes. That cycle has passed (ADR dated 2026-06-12, now 2026-07-20).

Meanwhile, several API routes (`payments.ts`, `payments/bulk.ts`) mutate
`PlayerPayment.status` without writing corresponding ledger rows — breaking the
"ledger is authoritative" invariant. `recordSelfReported` and `recordReceived`
exist in `payments.server.ts` but are never called by the route handlers.

Additionally, cost changes (`cost.ts`) apply uniformly to all occurrences with no
mechanism for per-Game overrides or scoped changes.

## Decisions

### 1. Switch balance reads to the ledger

`balance.server.ts` (`getGateBalance`, `getOutstandingBalance`,
`getEventBalanceSummary`) will compute balances from `WalletTransaction` rows
instead of `PlayerPayment` + `GameHistory.paymentsSnapshot`.

**Formula (pure, in `wallet.ts`):**

```typescript
MONEY_CHARGING_REASONS = { "per_game_share", "cost_adjustment" }

// Gate balance — "sent" clears the gate (ADR 0006)
getGateBalance: sum(charging debits) - sum(MONEY_CLEARING_REASONS credits)
  where MONEY_CLEARING_REASONS = { payment_received, payment_self_reported, credit_redeemed }

// Outstanding balance — "sent" does NOT clear (player still owes until organizer confirms)
getOutstandingBalance: sum(charging debits) - sum(OUTSTANDING_CLEARING_REASONS credits)
  where OUTSTANDING_CLEARING_REASONS = { payment_received, credit_redeemed }
```

### 2. Wire payment status mutations to the ledger

- `POST /api/events/[id]/payments` (status → "sent"): call `recordSelfReported`
- `POST /api/events/[id]/payments` (status → "paid"): call `recordReceived`
- `POST /api/events/[id]/payments/bulk` (mark all paid): call `recordReceived`
  per player

All routes continue to write `PlayerPayment` (dual-write preserved until Phase 3
cleanup of ADR 0016).

### 3. Fix `eventInstanceId` semantics

`eventInstanceId` on `WalletTransaction` will store `Game.id` (the occurrence)
going forward, not `Event.id`. This enables per-game aggregates
(`getEventBalanceSummary` scoped to `currentGameId`).

Legacy rows (where `eventInstanceId = eventId`) are handled by fallback: if the
value matches `Event.id` (not found in the Game table), treat as "game unknown"
and include in overall balance but not per-game aggregates.

### 4. Cost change scope

When an organizer changes event cost, the UI offers two options:

- **This game only** — sets `Game.costTotalAmount` (per-Game override). Future
  games inherit from `EventCost` template unchanged.
- **This and all future** — updates `EventCost.totalAmount` (the template).
  Past games are unaffected.

No retroactive "all games" bulk change. Individual past-game corrections are
handled via the history edit UI (see §5).

### 5. Per-Game cost snapshot

Add to `Game` model:

```prisma
costTotalAmount Float?   // null = inherit from EventCost template
costCurrency    String?  // null = inherit from EventCost.currency
```

Read logic: `effectiveCost = game.costTotalAmount ?? eventCost.totalAmount`

New Games are created with `costTotalAmount: null` — the one-off override never
propagates to the next occurrence.

### 6. Past-game cost correction via ledger

When an organizer edits a past Game's cost in the history UI:

- **Post-migration games** (have `WalletTransaction` debits): write
  `cost_adjustment` correction rows (debit or credit) for each affected player.
  Delta = newShareCents − originalShareCents.
- **Legacy games** (no ledger rows): update `GamePayment`/`PlayerPayment`
  amounts only. No ledger correction possible.

### 7. Schema comment fix

`PlayerPayment.status` comment updated to `// "pending" | "sent" | "paid"`.

## Consequences

- `balance.server.ts` no longer parses JSON (`paymentsSnapshot`). Faster,
  simpler, no JSON-related bugs.
- The join gate and debt display are both derived from the same ledger — one
  source of truth, two projections.
- `PlayerPayment` remains as a write-through cache for UI components that
  haven't migrated (PostGameBanner, payment status pills). Removal is Phase 3.
- `cost_adjustment` is a new `reason` enum value on `WalletTransaction`.
- Per-game cost overrides enable flexible organizer workflows without
  retroactive accounting chaos.

## Alternatives rejected

- **"All games" retroactive cost change** — violates immutable ledger principle,
  creates disputes over already-settled debts, diverges from frozen
  `paymentsSnapshot`.
- **Remove `PlayerPayment` writes now** — too much blast radius; UI still reads
  them directly in several places.
- **Correlate per-game aggregates by timestamp instead of fixing
  `eventInstanceId`** — fragile (games can overlap, timestamps can drift).
  Explicit FK is cleaner.
- **Option A (per-player amount edits without per-Game cost)** — can't handle
  the common case of "total changed, recalculate evenly" without N manual edits.
