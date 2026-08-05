# Grilling: Settlement API, privacy & ledger dual-write

**Type:** grilling (HITL)
**Labels:** wayfinder:grilling
**Blocked by:** per-game-payment-model-payer-semantics (closed 2026-08-05 — unblocked)
**Status:** claimed (2026-08-05) — in progress

## Question

Design the API contract for the payments page and the settlement actions, including authz/privacy and keeping the wallet ledger in sync. Use `/grilling` + `/domain-modeling`.

Locked decisions to work within:

- Payments page is per-event, people-first, no netting; receivers public, debtor names owner/admin-only, player sees own debt only; owner/admin can settle from the page.
- Settle actions dual-write to the wallet ledger so the join-gate/outstanding-balance stays consistent (reuse `recordReceived`).
- External payer = name only; anonymous players (no `userId`) have no ledger rows.
- Fresh start: page covers games settled under the new model only.

Decisions to resolve here:

1. **Read endpoint:** one settlement-summary endpoint (people rollup + games) or two (people + games separately)? What data per person (owed, owed-to, per-game breakdown) and per game (mode, payer, paid/unpaid counts)?
2. **Write endpoints:** shape of "settle share" (single player pill → paid), "bulk settle game", and "set payer / set mode". PUT vs PATCH. Idempotency (`Idempotency-Key` middleware exists — reuse?).
3. **Authz matrix:** who may call each endpoint — owner/admin for settle/payer/mode; self-report `sent` still allowed for the debtor (mirror `payments.ts`)? How is a player-payer's auto-settled pill handled on the write side (no-op, or a dedicated transition)?
4. **Privacy enforcement:** how does the read endpoint trim to role — receivers public to any logged-in player; debtor names only for owner/admin; anonymous visitor rejected. How does this interact with `showDebtorNames` (which can reveal debtors to the group)?
5. **Ledger dual-write semantics:** on settle, `recordReceived` writes a `payment_received` credit at the share amount. Confirm amount consistency with the share-math rule from the model ticket; handle anonymous debtors (no ledger write, GamePayment row still flips). Does the payer need any ledger row for "receives" (or is that derived purely from `GamePayment`)? Is bulk-settle mirrored to `payments/bulk.ts` behaviour?
6. **Mode/payer change after settlement:** can the owner flip a settled game to untracked, or change the payer, once shares are paid? What ledger rows (if any) result — `cost_adjustment`-style corrections, or no ledger effect?

Deliverable: endpoint contract (paths, verbs, request/response shapes, status codes, authz matrix) plus the dual-write rules, ready for TDD implementation.

## Resolution

<!-- Fill on resolution. End with "Close this ticket." -->
