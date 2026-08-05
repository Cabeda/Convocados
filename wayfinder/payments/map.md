# Map: Payment history, payer designation & payments page

## Destination

Web-app change to the payment system: durable per-game payment rows (each player matched to their payment per game, surviving recurrence resets), a per-game payer designation with two payment modes (tracked / untracked), and a per-event payments page — a people-first worklist of unsettled games showing who is owed (public) and who owes (owner-only), with owner/admin settle actions that stay in sync with the wallet ledger.

## Notes

- **Tracker:** local markdown — map is this file; tickets are `tickets/*.md` (child issues). Resolution → fill the ticket's `## Resolution`, append "Close this ticket.", and gist it in "Decisions so far". Frontier = open, unblocked, unclaimed tickets.
- **Skills:** `/prototype` for the UX ticket; `/grilling` + `/domain-modeling` for the semantics tickets. Implementation follows TDD, conventional commits, PRs from branches.
- **Key code:** `prisma/schema.prisma` — `GamePayment` model already exists (game-scoped, per EventPlayer) but **no write path populates it**; `GameParticipant` is the pattern to mirror. Writes today go to `PlayerPayment` (wiped on recurrence reset — `src/pages/api/events/[id]/index.ts:130`) plus frozen `GameHistory.paymentsSnapshot`. Balances come from the `WalletTransaction` ledger (`src/lib/balance.server.ts`, `src/lib/wallet.ts`); `recordReceived`/`recordSelfReported` exist in `src/lib/payments.server.ts`. Routes: `payments.ts`, `payments/bulk.ts`. UI: `src/components/PaymentSection.tsx`, `PostGameBanner.tsx`.
- **Privacy rule (locked):** receivers (who is owed) are public to event players; debtor names are owner/admin-only; players see only their own debt. Mirrors CONTEXT.md "Debt visibility".
- **CONTEXT.md:** add glossary terms "Payer" and "Payment mode (tracked/untracked)" once the model ticket resolves.
- **i18n:** new strings go to all 6 locales.

## Decisions so far

<!-- index of CLOSED tickets; one line each, gist + link. Empty at charting. -->

- [Per-game payment model & payer semantics](tickets/per-game-payment-model-payer-semantics.md) — `GamePayment` mirrors `GameParticipant` (join/leave/reset); mode + payer as `Game` columns (`paymentMode`, `payerEventPlayerId`/`payerExternalName`); share = effective cost ÷ active participants (payer counts, no-shows count); state machine unchanged, owner/admin confirms, player-payer = auto-`paid` row tagged by id; mode inherits + payer inherits only if participating; auto-settlement incl. current game; legacy owner-auto-paid in `cost.ts` deleted.

## Not yet specified

- **Android parity** — the payments page and payer flow are web-first. Whether the Android app mirrors them is deferred; don't chart until web is done.
- **Nudges & notifications** — the existing Payment Nudge Escalation and reminder flows may need to reference the payer/receivable model later. Not sharp enough to ticket yet.

## Out of scope

- **Cross-event payments dashboard** — page is per-event (Q2).
- **Cross-game netting** — amounts stay gross per game; no offsetting (Q3).
- **Full status audit trail** — durable per-game rows only, not a log of every status change (Q4).
- **Multiple payers per game** — exactly one payer when tracked (Q5).
- **Legacy game migration/backfill** — fresh start; pre-feature games never appear on the payments page (Q12).
