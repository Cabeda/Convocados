# Prototype: Payments page & settlement UX prototype

**Type:** prototype (HITL)
**Labels:** wayfinder:prototype
**Blocked by:** none

## Question

What should the three payment surfaces look like, keeping the UI simple, with role-aware rendering? Sketch a cheap, rough artifact to react to (use `/prototype`; link the prototype as the asset in the Resolution).

Locked decisions this prototype must honor:

- **Per-game payment modes:** *tracked* (one payer designated; everyone else's share owed to the payer; player-payer's own pill auto-settled) or *untracked* ("each player pays their own share" — no payer, no pills, invisible to the payments page). Default tracked.
- **Ahead-of-time config:** the owner sets mode + payer before the game (the user reports the current "Split the cost" section is not useful as-is — this replaces it). Cost template (`EventCost`) stays event-level; mode/payer is per-game.
- **Post-game wrap-up:** if config is set, show a one-line summary then the pills; if not set, ask mode + payer first, then show pills. Player-payer pill renders as auto-settled.
- **Payments page (per-event, people-first, no netting):** rollup "X owes €Y" / "X is owed €Y", each person expandable to the games behind it; unsettled past games = tracked games with ≥1 unpaid share (auto-settled when all paid). Receiver list public to all players; debtor names owner/admin-only; a player sees only their own debt line. Owner/admin has settle actions from the page (mark share received), plus edit payer/mode.
- **Role-aware rendering:** owner/admin full view; payer sees "you're owed €X by [names]"; debtor sees own pill + own debt; anonymous guest/visitor gets no payments page (login-gated), only the existing aggregate/wrap-up behaviour.

Design open questions to resolve in the prototype:

1. Where the ahead-of-time "Cost & payment" config sits on the upcoming-game UI without cluttering it.
2. The wrap-up confirmation step's shape (inline step vs dialog) and when it's skipped.
3. How the payments page presents a person who is both a payer and a debtor (gross, both lines — no netting).
4. Where "untracked" shows in each surface (and how the wrap-up communicates it back).
5. Navigation entry point(s) to the payments page.

Deliverable: low-fi sketch/mockup of the three surfaces + the role variants, as a linkable asset. The model ticket (`Per-game payment model & payer semantics`) decides the data shape this renders; keep the prototype decoupled from that choice where possible.

## Resolution

<!-- Fill on resolution. Link the prototype asset. End with "Close this ticket." -->
