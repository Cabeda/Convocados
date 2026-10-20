# ADR 0053 — No custodial wallet: revenue comes from the application fee and organizer subscriptions

**Status:** accepted
**Date:** 2026-10-19
**Source:** spike GH-1081 (dex `y5l1k2q3`), from the Omby comparison (2026-09)

## Context

ADR 0038 settled the payment architecture — Stripe Connect destination charges, the
organizer as merchant of record, Convocados never holds funds — and deliberately deferred
one option: the custodial wallet was "rejected for now ... revisit as a deliberate spike".
The Omby comparison is what made the revisit worth scheduling. Omby's model is custody
itself (deposit, balance, IBAN withdrawal), so if custody is the real monetization lever,
the non-custodial design caps Convocados' revenue at a thin cut of every charge.

Spike questions (GH-1081):

1. What would a custodial model cost in PSD2 / e-money / payment-institution licensing in
   Portugal — authorisation, safeguarding, KYC, long financial-record retention?
2. What revenue is available short of custody?
3. Does MB Way keep working, and at what fee, under Connect destination charges?
4. Is custody worth that compliance burden against a simple application fee?

## Decision

**Decided-no on custody** (Cabeda, grilling 2026-10-19): Convocados stays non-custodial.
The spike grants no build go, and nothing in this ADR builds.

- No wallet balance, no deposits, no withdrawals. Stripe pays the organizer's bank on
  Stripe's own schedule; the organizer stays the merchant of record. ADR 0038 is unchanged.
- `Wallet` in `CONTEXT.md` stays what it already is — Game Units, a per-(User, Event) count
  of missed games — and does not become money.

Revenue comes from two levers short of custody, and each is split into its own Issue
rather than built here (per the same decision):

1. **Platform application fee on Connect charges.** ADR 0038 designs the plumbing: a
   per-transaction fee as `EventCost.platformFeeCents` (default `0`) beside a
   platform-level default, with destination charges collected via `losses_collector` /
   `fees_collector = application`. The design is settled; the code is not — no
   `platformFeeCents` column exists in `EventCost`, and no checkout call sets an
   application fee or those collector parameters (`src/lib/paymentProvider.server.ts`).
   The fee Issue therefore includes that schema and charge work, and ADR 0038 already
   records that taking a non-zero fee is a business/legal step-change on top, not a
   config flip — it must carry its own acceptance criterion (price, rollout, what
   organizers and players are told).
2. **Organizer subscriptions and premium features.** The subscription machinery exists for
   players (ADR 0008: monthly subscription, Game Units, end-of-following-month expiry); an
   organizer tier is a product decision layered on it, again its own Issue.

**MB Way** stays in v1 through hosted Checkout (ADR 0038): MB Way, cards, Apple Pay and
Google Pay are Stripe's surfaces, so the payment method list is identical under either
revenue model.

## Open questions — not researched in this spike

A factory run has no external research access, and a decision doc is the wrong place to
invent figures. The following are therefore recorded as **unverified** rather than answered;
none of them blocks the decision above, because the decision is to not need them.

- **Portuguese licensing path and cost.** ADR 0038 already names the obligation classes a
  custodial model triggers (PSD2 / e-money authorisation, fund safeguarding, KYC, long
  record retention). The costed detail — application route, own-funds requirement,
  safeguarding setup, retention periods, counsel and audit spend — is *not researched* here
  and has no source in this repository. Answer it with counsel **only if** custody is ever
  reopened.
- **MB Way fees under Connect destination charges.** Stripe's fee schedule is external and
  changes; confirm it when the application fee is priced, not from this document.
- **Terms we would need to write.** A custodial wallet needs its own wallet terms,
  safeguarding disclosures and withdrawal policy. None exist, and none are drafted here.

Reopening custody needs a demand signal (organizers waiting on payouts, asking to hold
funds) plus real answers to the three items above — never this ADR alone.

## Consequences

- The spike closes as decided-no; the record of the decision lives here instead of in a
  comment thread.
- The application-fee Issue and the organizer-subscription Issue are the revenue work. This
  ADR prices nothing and authorises neither.
- Nothing about the payments code, the ledger, or `CONTEXT.md` changes: ADR 0038 stands
  as written, and `platformFeeCents` remains what ADR 0038 records — a design commitment
  with no column behind it yet.
- The open questions stay open and unverified until a human with external access answers
  them; a later reader must not treat this file as research.
