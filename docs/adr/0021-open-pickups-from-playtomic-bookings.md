# 0021 — Open pickups from Playtomic bookings

**Status:** Accepted
**Date:** 2026-08-20

## Context

The public games listing (`/public`, `public-games` in feature-parity) is nearly empty — it
only shows real user-created public Events. The Playtomic integration (court alternatives,
court watch) already exposes which court slots are booked across clubs, and the availability
endpoint returns *free* slots per court across the whole day, so booked slots are detectable
by diffing against an inferred slot grid. Goal: surface real-world play activity so the
listing feels alive and people can organize around real slots without creating hollow
"fake" games.

## Decision

### 1. Sweep

A cron job runs twice daily (09:00 and 21:00 UTC) with a 7-day lookahead over configured
anchor cities (`SWEEP_ANCHORS` env array, defaulting to Porto and Lisbon). It detects booked
slots as isolated gaps in the inferred 30-minute grid of free slots (availability returns
only free slots; a bounded gap — free before and after — is a booking block). Failed clubs
are skipped and logged, never aborting the sweep; retried next cycle.

### 2. Open Pickups

Each detected booked slot becomes a one-off public Event+Game with `source=playtomic` and
`ownerId=null` — an **Open Pickup**. Idempotency is a natural key
(`tenantId|resourceId|slotDate|slotStart`); there is no cross-event dedup — multiple games
may legitimately exist at the same place and time (different courts, different real events).

### 3. Adopt

Any authenticated user can claim an Open Pickup via a single confirm dialog, becoming its
Owner. The event stays public by default; the new Owner may opt into privacy (password) via
the normal event settings. Followers and joiners are notified on adoption. Joining an
un-adopted pickup is blocked until someone adopts.

### 4. Lifecycle

Un-adopted pickups are soft-archived after their slot passes (~2h grace): the Game is marked
`cancelled` and the Event gets `archivedAt`. No GameHistory snapshot is written (no
participants to preserve). Rows are kept for audit but vanish from all listings.

### 5. Sports

Sports surfaced: padel, tennis, football-5v5/7v7, futsal (existing mapping) plus four new
presets: `badminton-singles` (2, 45min), `badminton-doubles` (4, 45min), `squash` (2, 40min),
`pickleball` (4, 60min). Full web + Android parity (presets, filters, i18n × 6). Wear gets
adoption notifications and adopt via deep link only — it has no public-games listing surface.

### 6. Rate limiting

The sweep reuses `PlaytomicAvailabilityCache` (10-minute TTL, grouped fetch) with concurrency
3 and 200ms pacing between upstream calls. It runs on the Fly scheduler (`convocados-scheduler`)
— Playtomic's API blocks residential IPs (verified: 403 via CloudFront), so the sweep must
run from the datacenter.

### 7. Ops

Admin dashboard gains a single stats row: beacons detected / adopted / 30-day adoption rate.

## Considered Options

- **Full auto-create without adopt-gating** — booked slots become full public games with
  join buttons immediately. Rejected: every game would be hollow (0 players, no organizer),
  making the listing feel more dead than empty.
- **Hot-slot intelligence only** — list booked slots as availability insight with no game.
  Rejected: no conversion path; weaker value than an adoptable lead.
- **Nudge-to-create prompts** — push nearby users to create a real event at a busy slot.
  Rejected: slower to fill the listing and more product complexity for the same outcome.

## Consequences

- The listing shows opportunities ("people play here — claim it") rather than fake games.
- Privacy stance: only public booking information is used; Playtomic provides no personal
  data, and the pickup is framed as an open lead, not a claim about the bookers.
- Adopted pickups become ordinary events with the full lifecycle (roster, teams, payments).