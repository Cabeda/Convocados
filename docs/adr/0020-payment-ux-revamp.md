# 0020 — Payment UX revamp: phase-aware event page + Settle page as admin surface

**Status:** Accepted  
**Date:** 2026-07-09

## Context

The event page had a full-featured "Split the cost" accordion (`PaymentSection`) that mixed player-facing information (what do I owe?) with organizer-facing admin controls (set cost, manage payment methods, toggle paid/pending per player). The `PostGameBanner` duplicated the payment edit surface after game end. The new Settle page (`/events/:id/settle`, ADR 0019) covers all admin payment management better, making the dual surfaces confusing and inconsistent.

## Decision

Split the payment UI into two distinct surfaces with non-overlapping responsibilities:

**Event page — player-facing, read-mostly:**
- The section is renamed from "Split the cost" to **"Payments"**.
- Content adapts to the viewer's state: "You owe €5 — pay now" (debtor), "Paid ✓" (cleared), "€5/player" (not on the list).
- Phase-aware urgency following the game phase table (AGENTS.md):
  - **>24h before**: subtle price pill `€5/player · 3/10 paid`.
  - **<24h before**: section auto-expands; yellow "You owe €5" chip with inline payment method buttons.
  - **<2h / live**: same but orange/red prominence.
  - **Post-game**: read-only `X/Y paid` summary + "View payments" link to Settle page.
- Player self-report ("I paid") writes `PlayerPayment.status = "sent"` — unchanged from ADR 0006.
- Admin controls (set cost, manage methods, confirm payments) are **removed** from the event page entirely.

**Settle page — organizer-facing, full control:**
- All admin payment management lives here.
- Reachable via the "..." More menu on the event page (already present).
- Non-playing group members can navigate here from the More menu to see the full group payment status.

**PostGameBanner — read-only after game end:**
- The inline payment edit chips (cycle paid/pending + save) are removed.
- Replaced with a read-only `X/Y paid` summary and a "View payments" button linking to the Settle page.

## Per-player amount

`totalAmount / count(players on payment list)`. Before the list exists, the UI previews `totalAmount / maxPlayers`. Who is on the list is the organizer's decision — no-show exclusion is manual, not automatic.

## Considered options

- **Keep PaymentSection as-is**: two admin surfaces (event page + Settle) with diverging write paths (`PlayerPayment` vs `WalletTransaction`). Rejected — state divergence is inevitable.
- **Remove PaymentSection entirely**: players must navigate to Settle to see/report payment. Rejected — players land on the event page; removing their "I paid" CTA from that page kills the self-report nudge at the highest-traffic moment.

## Consequences

- `Event.splitCostsEnabled` toggle is superseded. The Payments section is always shown when a cost is set. The toggle is kept in the DB for backward compat but the UI ignores it.
- The `PostGameBanner` write path to `GameHistory.paymentsSnapshot` is removed from the banner; organizers reconcile via Settle only.
- The More menu "Settle Up" entry (already present) is the bridge for both organizers and curious group members.
- Self-report write path stays on `PlayerPayment` for now. Migration to `WalletTransaction` is deferred (separate ADR).
