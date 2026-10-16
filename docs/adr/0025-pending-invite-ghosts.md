# 0025 — Pending invite ghosts are excluded from roster math

**Status:** Accepted
**Date:** 2026-07-15

## Context

Proactive invites (`PlayerInvite`) create an `EventPlayer` + a `GameParticipant`
with `status = "pending"` for the targeted user, so the invitee can be shown
on the roster as "invited" before they accept. Because a pending row is
physically present in `GameParticipant`, every place that counts players,
computes bench positions, or draws teams could naively include it and report a
fuller roster than actually is — e.g. treating an unaccepted invite as a
confirmed player.

## Decision

A `GameParticipant` with `status = "pending"` is an **invite ghost**, not a
player:

1. **Roster/bench math.** Pending rows are excluded from active and bench
   counts, `spotsLeft`, `isFull`, and any capacity arithmetic. Only `status
   != "pending"` (and non-archived) rows count.
2. **Payments.** Pending rows do not generate a `GamePayment` and are never
   billed.
3. **Team draws.** Pending rows are never auto-assigned to a team and are
   excluded from any drawn formation.
4. **Stats.** Pending rows do not increment `gamesPlayed` or feed ELO/season
   rank calculations.
5. **UI.** Pending rows are surfaced separately as "invited" (with delivery
   channels and resend/retract controls) and never appear inside the active
   roster list nor the bench.

`activeParticipants.server.ts#activeParticipantsWhere` is the single source of
truth for this exclusion; every roster/capacity/payment/team path must filter
through it rather than re-deriving the rule locally. A pending invite becomes
a real player only on acceptance, when its status flips to `active`.

## Consequences

- "How many players are in tonight's game?" always means people who actually
  said yes — pending invites are tracked but never counted.
- Invite delivery and resend/retract flows work against the ghost row without
  disturbing roster math.
- Any new code path that reads `GameParticipant` must decide explicitly
  whether ghosts belong; defaulting to "include" is a bug.
