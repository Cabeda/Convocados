# 0009 — Extras Pot: a public, integer ledger, never real money

**Status:** Accepted
**Date:** 2026-06-12

## Context

The Monthly Subscription + credit-expiry mechanism generates a small
forfeited surplus (organizer's stated target: ~€100/yr). The organizer wants
to use this surplus for things like the Apple Developer Program fee, a
ball, a team dinner, etc., and wants the group to be able to see how the
money is used (transparency goal).

The Extras Pot is a *social* construct, not a financial product. The app
does not move money — payments are still collected by the organizer
externally (Revolut, MB Way, cash) per the existing `paymentMethods` flow.

## Decision

`EventCost.organizerExtrasCents` is the **single running integer** (cents,
in Event currency) that is the Extras Pot. It is:

- **Credited** by `credit_expired` `WalletTransaction` rows (see ADR 0008)
  — the expiry job increments it as it writes those rows.
- **Debited** by `extras_declare` `WalletTransaction` rows the organizer
  enters via `POST /api/events/[id]/settle/extras`. Each declaration has
  a free-text `label` (e.g. `"Apple Developer fee"`, `"ball"`,
  `"team dinner"`), a `declaredAt` timestamp, and the organizer who
  declared it.
- **Read** by everyone with access to the Event (Owner, Admins, Followers,
  Players). The current balance and the full declaration log are
  public-readable.
- **Currency** is the Event's `EventCost.currency` — the pot never mixes
  currencies across Events.
- **A negative value is allowed but flagged** in the UI as
  "balance went negative — you declared more than the pot held." The
  organizer is the source of truth for what's actually in their pocket; the
  pot is the organizer's *declared* ledger, not a real account.

The app **never** requests, holds, moves, or refunds real money through the
Extras Pot. The `ExtrasDeclaration.label` is a free-text note; if the
organizer mis-labels or lies, the social transparency is the only check.

## Consequences

- The Extras tab on the Settle Up page is the only public-facing view of
  organizer-only state. The total and the log are visible to all members.
- The Organizer's personal expenses (e.g. "I bought myself lunch with the
  pot") cannot be distinguished from group expenses by the app. The
  `label` field is the only signal. We rely on the organizer's good faith
  and the group's social pressure to keep this honest.
- The Extras Pot cannot go below zero **structurally** (we decrement by
  the declared amount, the value can wrap if the math is wrong), but the UI
  flags a negative value as a likely mistake and prompts the organizer to
  confirm.
- Cross-Event use of the pot is not supported. Each Event has its own pot.
  If the organizer runs two groups, the surplus is not pooled.

## Alternatives considered

- **External payments integration** (Stripe Connect, etc.) with real
  distributions. Rejected: out of scope; the app's job is tracking, not
  moving money. The organizer pays the court out of pocket and decides
  independently what to do with the surplus.
- **Hide the pot from non-admins.** Rejected: the stated goal of the
  feature is transparency. If the organizer wants to keep the spending
  log private, they can write vague labels.
- **Per-Event currency conversion** when the Event's `currency` changes.
  Rejected: rare event, and the snapshot semantics in ADR 0008 already mean
  historic `credit_expired` rows carry the value-at-expiry. Re-converting
  would be more confusing than helpful.
- **Cap the Extras Pot at the total of Monthly fees ever collected.**
  Rejected: the pot can legitimately grow beyond Monthly fees in a group
  with many non-Monthly payers (the surcharge), and capping would make
  the bookkeeping less honest.
