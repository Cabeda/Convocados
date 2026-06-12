# 0008 — Monthly subscription, Game Units, and end-of-following-month expiry

**Status:** Accepted
**Date:** 2026-06-12

## Context

The organizer's stated goal is to make ~€100/yr from a €50/5-a-side group
without raising the per-player price above €5/game. The mechanism proposed by
the organizer (and the groups they know) is a **Monthly Subscription** paid
upfront for ~5 games. The subscription's leftover value (a player's missed
games) is the subsidy that funds the fee.

The mechanism only works if the leftover value is **sometimes forfeited** —
otherwise, every credit eventually gets redeemed and the organizer nets zero.
So expiry is the load-bearing part of the design, and the question is *when*
credits expire.

## Decision

A Monthly Subscription grants the player coverage of `N` non-cancelled Event
instances in a single calendar month (the **Subscription Window**) in the
Event's timezone, in exchange for a fixed `monthlyFeeCents` (snapshotted on
the subscription row). `N` defaults to 5 and is per-Event.

For each Event instance in the window the subscriber does **not** attend:

- The system writes a `missed_game_credit` `WalletTransaction` with
  `gameUnits: 1` and an informational `amountCents` locked at the
  `eventCost.totalAmount / maxPlayers` *as of the missed game's date*.
- The informational value is **never recomputed** at redemption time.
  (See `Game Unit` in `CONTEXT.md` — snapshot, not live.)

Game Units expire at the **end of the calendar month following the month
they were earned** in the Event's timezone. On expiry:

- A `credit_expired` `WalletTransaction` is written (gameUnits: -1,
  amountCents: +locked value, direction: credit to the organizer's Extras
  Pot).
- `EventCost.organizerExtrasCents` increments by the locked value.

The expiry job runs as part of the existing daily cron at
`src/pages/api/cron/reminders.ts` and is **idempotent** (uniqueness
constraint on `(eventId, userId, reason, eventInstanceId)`).

A Monthly Subscription also auto-enrolls the player in `PriorityEnrollment`
for the Event, but does **not** bypass the priority eligibility rules
(attendance threshold, no-show streak). Paying monthly qualifies, it does
not override.

A player who is Monthly for one Event and Per-game for another at the same
time is fully supported — `MonthlySubscription` is keyed on
`(eventId, userId, windowStart)`.

Extra Event instances in a window beyond `N` revert to per-game pricing for
**everyone**, including Monthly subscribers. The `N` value is the
organizer-set expectation of how many games happen that month.

Cancelled Event instances are neutral: no credit issued, no per-game charge,
`N` not decremented. (`Event.status === "cancelled"`.)

## Consequences

- A "missed game" is defined narrowly: the player was on the active player
  list for the Event instance and did not attend. A player who never
  registered for the game is not a "miss" and earns no credit.
- The locked `amountCents` on `missed_game_credit` can become stale (e.g.
  the court cost went up and `totalAmount / maxPlayers` is now €6, but the
  credit is still displayed as €5). This is **by design** — see the
  rationale in the open-question on snapshot-vs-recompute.
- Cancelling a Monthly Subscription mid-window does not refund the fee. The
  already-attended games remain covered; missed games after the cancellation
  date no longer earn credit.
- A player who pays Monthly for the first time **after** some games in the
  window have already happened: those earlier games are not retroactively
  credited. The subscription covers the window, not the prior month.

## Alternatives considered

- **Rolling N months from when the credit was earned** (e.g. 2 months).
  Rejected: harder to reason about for both the player ("when does my credit
  expire?") and the organizer ("how much surplus do I expect this month?").
  Calendar boundaries are easier to communicate and to test.
- **No expiry** — credit lives forever on the account. Rejected: makes the
  €100/yr target unreachable, since most credits would eventually be
  redeemed. The expiry is the entire mechanism by which the surplus is
  generated.
- **Recompute credit value at redemption time** to today's per-game share.
  Rejected: the credit is "one game you already paid for"; the organizer's
  pricing risk is theirs, not the player's. Snapshot also keeps the
  `credit_expired` value stable, which is required for the Extras Pot to
  be a meaningful number.
- **Refund unused Monthly Subscription value at end of month.** Rejected:
  destroys the subsidy mechanism and turns the feature into a pure
  pay-per-game with extra steps. The point is the forfeited credit.
