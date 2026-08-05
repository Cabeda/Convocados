# Grilling: Per-game payment model & payer semantics

**Type:** grilling (HITL)
**Labels:** wayfinder:grilling
**Blocked by:** none

## Question

Lock the data model and money semantics for per-game payments. Use `/grilling` + `/domain-modeling`. This is the foundational decision — the settlement API ticket is blocked on it.

Context: `GamePayment` already exists in the schema (`gameId`, `eventPlayerId`, `playerName`, `amount`, `status` pending/sent/paid, `method`, `paidAt`, `markedBy`, `createdAt`/`updatedAt`) but nothing writes it. The durable per-game payment history should mirror the `GameParticipant` pattern (rows persist per game, not wiped on recurrence reset — unlike `PlayerPayment`).

Locked decisions to work within:

- Money owed is attributed to the payer; a player-payer's own share is auto-settled.
- One payer per game when tracked; external payer = name only, no user link.
- Two modes per game: tracked (requires payer) / untracked (each pays own share, no tracking). Default tracked.
- A game is unsettled while any non-payer share is unpaid; settled automatically once all are paid.
- No status audit trail beyond the row itself; no cross-game netting; fresh start (no legacy backfill).

Decisions to resolve here:

1. **Row lifecycle:** when are `GamePayment` rows created for a game (at config time, at game start, at wrap-up)? Do they upsert on participant join/leave (mirroring `GameParticipant`)? What happens to rows when a player leaves after paying?
2. **Mode field:** where does tracked/untracked live (on `Game`, or a `GamePayment` aggregate)? How does untracked suppress pills and the payments page?
3. **Payer reference:** a payer is either an `EventPlayer` (player-payer) or an external name. One column? A separate payer record? How does a payer stay identified if the EventPlayer is renamed/merged/deleted?
4. **Share math:** per-share = effective game cost / N. Is N = `maxPlayers`, actual active participants, or participants-minus-payer when tracked? Today the code disagrees across paths (`resolveShareInfo` uses `maxPlayers`; `syncPaymentsForEvent` uses active player count) — pin one rule. Does the payer count as a participant for the denominator?
5. **Status semantics in payer mode:** does `pending → sent → paid` still hold for debtors? Does the player-payer get a distinct status (e.g. `paid` with a `payer` flag)? Is `sent` self-report even meaningful when the money goes to a named payer rather than the event?
6. **Recurrence carry-over:** when a recurring event spawns the next game, does the previous game's mode/payer carry over as a default, reset to tracked-with-no-payer, or reset to untracked?
7. **Settlement threshold:** confirm auto-settlement = "all debtor shares paid" and that the payer's own pill never gates settlement.
8. **Amount overrides:** the existing per-game cost override (`Game.costTotalAmount`) interacts with share math — confirm the share uses the effective game cost.

Deliverable: a decision summary that the settlement API ticket can build on, plus CONTEXT.md glossary additions ("Payer", "Payment mode").

## Resolution

<!-- Fill on resolution. End with "Close this ticket." -->
