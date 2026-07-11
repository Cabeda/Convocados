# 0020 — Extras Pot: rich model with categories, allocation, and deficit

**Status:** Accepted
**Date:** 2026-07-11
**Supersedes:** 0009 (partially — the ledger concept stays; the data model changes)

## Context

The original Extras Pot (ADR 0009) was a single running integer
(`EventCost.organizerExtrasCents`) with a free-text label per expense.
The pot is per-event, fed by `credit_expired` and overpayment receipts,
debited by organizer-declared expenses. The model worked but was too
implicit: organizers couldn't categorize expenses, attach receipts, or
allocate costs to specific players. The pot could also go negative with
no clear signal of who owed what.

The user has now asked for "a simple and transparent way of managing
what is to be payed as expense and the remanescent that goes to the
pot". This requires:
- categories on expenses (court, equipment, refreshments, admin)
- receipts (URL field)
- per-player allocation (organizer absorbs, allocate to specific players, split equally)
- explicit deficit handling
- transparent UI on the SettleUp page

## Decision

**Extras Pot** (per-event, in Event currency):
- **Credited** by `credit_expired` (ADR 0008) and by overpayment receipts
  (drop-in overpayment, drop-in absorbs the cent).
- **Debited** by `extras_declare` `WalletTransaction` rows.
- May go negative — the organizer owes the difference; auto-clears on the
  next positive delta. UI shows the deficit explicitly.

**Expense** (table `ExtrasDeclaration`, extended):
- `amountCents` Int
- `currency` String
- `label` String (free text, e.g. "Apple Developer fee", "ball")
- `category` ExtrasCategory enum: `court_rental`, `equipment`, `refreshments`, `admin`
- `receiptUrl` String? (optional URL to uploaded file)
- `allocation` Json? — see Allocation
- `declaredAt` DateTime
- `declaredBy` String (userId of organizer)

**Allocation** (jsonb on Expense, three modes):
1. `organizer_absorbs` (default) — pot shrinks, no per-player change.
2. `allocate_to_players` — expense split among named players; their
   per-player owed balance goes up; pot does **not** shrink.
3. `split_equally` — expense split equally among all current players;
   per-player owed balance goes up; pot does **not** shrink.

**Deficit** (organizer's debt to the event):
- A player who uses more than their subscription covers has an "overage"
  added to their per-player owed balance (separate from the pot).
- The next payment from that player auto-deducts from the deficit first.

**Visibility** (on the SettleUp page, per-event only):
1. Current balance.
2. This event's feeds (credit_expired, overpayment receipts) — who/when/why.
3. This event's spends (extras_declare) — what/by-whom/when.

## Consequences

- The pot remains an honest ledger, not a real money account.
- Categories enable reporting ("how much did we spend on court this year").
- Receipts give the group the social pressure to verify expenses.
- Per-player allocation lets the organizer pass costs to specific players
  (e.g. "Bruno's no-show fee €5 allocated to Bruno") without affecting
  the pot.
- Deficit is explicit and recoverable.
- The 3-section UI on SettleUp page gives the requested transparency.

## Alternatives considered

- **Keep ADR 0009 verbatim** — rejected: too implicit, no categories, no
  receipts, no allocation. Doesn't meet the "simple and transparent"
  requirement.
- **Cross-event organizer pot** — rejected: out of scope; the per-event
  pot matches the existing `EventCost` model and ADR 0009's stance.
- **Real money integration** — rejected: still out of scope; the app
  tracks cents, not money.
- **Auto-conversion of the pot when Event currency changes** — rejected:
  historic `credit_expired` rows carry value-at-expiry; re-converting
  would be more confusing than helpful. Same as ADR 0009.

## Migration

- The `ExtrasDeclaration.category`, `receiptUrl`, `allocation` columns
  are new and nullable. Existing rows get `null` (default = "absorbed
  by organizer", which is how the old free-text label worked).
- `organizerAbsorbs` is the default allocation: `allocation: { mode:
  "organizer_absorbs" }`. Existing expenses pre-migration are
  `organizer_absorbs` by default (the pot shrunk).
- No data migration needed for `organizerExtrasCents` — the integer
  counter is unchanged.
</content>
