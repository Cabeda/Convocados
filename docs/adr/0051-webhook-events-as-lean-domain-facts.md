# 0051 — Webhook events are lean platform-agnostic domain facts

**Status:** Accepted
**Date:** 2026-10-13

## Context

WhatsApp (and any other client) needs timely, correctly-cadenced messages about a
game's life — reminders, RSVPs, payments — without the organizer hand-syncing the
group. The webhook system already delivered roster deltas; the temptation was to
extend it with ready-to-send messages and client-specific hints.

## Decision

Webhook payloads carry **semantic parameters only** — what happened, to whom, how
much, when — and never rendered copy, emoji, language, batching hints or pacing
suggestions. Event types name domain moments (`reminder`, `payment_nudge`,
`payer_check_in`), not channels. Timing and dedup live app-side ("T-24h fires once
per occurrence" is a domain fact); message wording, cadence, quiet hours and
throttling live client-side. Clients re-fetch current state (roster, venue) via the
REST API when rendering needs it.

Privacy is domain, not client: payment payloads carry debtor names only when the
event's `showDebtorNames` is enabled.

## Considered options

- **Ready-to-send message strings in the payload** (i18n'd copy): rejected —
  couples every client to app wording and tone; WhatsApp style diverges from push
  copy; redeploys to fix a typo.
- **Self-contained payloads (embedded roster snapshot)**: rejected — bloat and
  staleness; the API is the source of truth for state.

## Consequences

- Adding a client = writing templates; no app changes.
- The docs table (`src/pages/docs/api/webhooks.astro`) is the public contract —
  keep it in step with `WEBHOOK_EVENT_TYPES`.
- Occurrence-scoped events carry `gameId` + `dateTime` so recurring occurrences
  are distinguishable; everything else is fetched on demand.
