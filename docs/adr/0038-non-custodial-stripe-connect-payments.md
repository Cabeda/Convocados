# Non-custodial online payments via Stripe Connect (organizer is merchant of record)

## Status

accepted

## Context

Convocados has always treated payments as a bookkeeping ledger: it records who owes and who
has paid, but never touches real funds (ADR 0007, ADR 0009). Players still have to transfer
money out-of-band (Revolut, MB Way, cash), and organizers chase the transfers.

We want players to pay in the app (card, MB Way, Apple Pay, Google Pay) and organizers to
receive the money directly, without Convocados becoming a custodian of other people's money.

## Decision

Add online payment through **Stripe Connect destination charges**:

- The organizer onboards a Stripe connected account (Accounts v2, `dashboard=express`, so
  **Stripe performs KYC**). Convocados stores only the account id and capability state.
- Each charge is a destination charge with `transfer_data.destination` = the organizer's
  connected account and `on_behalf_of` = that account, making the **organizer the merchant of
  record**. Convocados is a facilitator, not the seller.
- `losses_collector` and `fees_collector` are set to `application`, per Stripe's destination
  charge guidance.
- Convocados **never holds funds**. Stripe pays the organizer's bank on Stripe's own payout
  schedule. There are no wallet balances, deposits, or withdrawals.
- A per-transaction platform fee is modeled (`EventCost.platformFeeCents`, default `0`, plus a
  platform-level default) but is **zero** at launch.
- Checkout is the payment UI on every platform (hosted), so MB Way, cards, Apple Pay, Google
  Pay, and SCA are handled without native wallet integration.
- Payments settle in **EUR only**.

Stripe is **optional and feature-detected**: an instance with no Stripe configuration behaves
exactly as it does today — the tracked/untracked ledger, unchanged (same approach as ADR 0010).

## Considered options

- **Custodial wallet** (the model Omby uses): Convocados holds funds, users have balances and
  request withdrawals. Rejected for now — it triggers PSD2 / e-money licensing, fund
  safeguarding, KYC, and long financial-record retention. Revisit as a deliberate spike.
- **Separate charges and transfers**: rejected — a single, known destination account per charge
  is exactly the destination-charge case; separate transfers add complexity for no benefit.

## Consequences

- Supersedes the "no external payment provider" stance recorded in ADR 0007 and ADR 0009.
- Convocados becomes a **Connect platform**: a one-time platform account and platform-profile
  onboarding in Stripe is required before live charges.
- The platform (not the organizer) carries refund/dispute liability for destination charges;
  the ledger auto-confirms on the Stripe webhook, and refunds are manual in v1.
- The existing manual `pending → sent → paid` flow remains for offline/cash payments.
- Taking a non-zero platform fee later is a business/legal step-change, not just a config flip.
