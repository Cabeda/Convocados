# 0006 — Payment status lifecycle and player self-report

**Status:** Accepted
**Date:** 2026-06-10

## Context

Payment tracking was strictly per-game and organizer-driven: `PlayerPayment.status`
was `pending` | `paid`, and only the Owner/Admin could set it (`PUT /api/events/[id]/payments`
returns 403 otherwise). Unpaid amounts survive recurrence resets because the reset
snapshots all payments into `GameHistory.paymentsSnapshot` before clearing live rows.

We want to nudge players to settle previous games before joining the next one. The
nudge's payoff is a "done" moment for the payer — but money moves outside the app
(Revolut / MB Way deep links), so the app cannot truthfully mark `paid` without the
organizer confirming receipt. Requiring organizer-confirmed `paid` to clear a join
gate would also strand players minutes before kickoff if the organizer is offline.

## Decision

Introduce a three-state lifecycle for `PlayerPayment.status` (and snapshot entries):

- **pending** — owed, no action. Counts toward the Outstanding Balance.
- **sent** — the Player self-reported paying. Still counts toward the balance; does
  not clear the debt. Only the Player acting on their own behalf may move `pending → sent`.
- **paid** — Owner/Admin confirmed receipt. The only status that clears the balance.
  Only Owner/Admin may set `paid`.

`status` remains a free-text column, so no schema migration is required to add `sent`.
The `PUT /api/events/[id]/payments` authorization is relaxed for exactly one transition:
the authenticated user whose linked `Player.name` matches may set their own `pending → sent`.
All other writes remain Owner/Admin-only.

A payment **join gate** (hard_gate enforcement) is cleared by `paid` **or** `sent`, so an
offline organizer cannot strand a player; the organizer reconciles unconfirmed `sent`
entries via a "confirm received" worklist.

### Alternatives considered

- **Redirect-only (no `sent`):** Open the deep link and join, leaving status `pending`.
  Zero new state, but the payer still appears to owe immediately after paying, blunting
  the nudge and giving no closure.
- **Let players self-mark `paid`:** Simplest UX, but destroys the organizer as source of
  truth for received money and invites "I paid" abuse — the exact problem we're solving.

## Consequences

- The Outstanding Balance counts both `pending` and `sent` as owed; only `paid` clears it.
- A narrow, identity-checked write path exists for players (`pending → sent` on their own
  linked payment). All other payment writes stay Owner/Admin-only.
- Organizers gain a reconciliation worklist (confirm `sent → paid`), and can socially catch
  dishonest `sent` reports because unconfirmed sends are visible.
- Historical `paymentsSnapshot` entries may now carry `sent`; balance and post-game logic
  must treat `sent` as not-yet-cleared.
