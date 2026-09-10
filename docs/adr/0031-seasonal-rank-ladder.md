# ADR 0031 — Seasonal Rank Ladder

Status: accepted (2026-09-10)

## Context

Convocados tracks a lifetime Elo per Event (`EventPlayer.rating`, today backed by the legacy `PlayerRating` store) used for team balancing. The friendly-competition pilot added optional Seasons — a Crew best-six points competition — but no individual ladder. Players want a CS:GO / League-style visible, tiered, seasonal rank that rewards climbing and gives every game a stake, **without** turning the weekly casual game serious, resetting the balancing Elo, or pressuring attendance.

## Decision

Add a second, **visible** rating — **Season Rank** — layered on top of the unchanged lifetime **Skill Rating**.

1. **Two ratings.** Skill Rating is hidden, symmetric (seed 1000, K=48 <6 games / 32 after), unbounded, and **never resets**; it drives team balancing. Season Rank is visible, 0-based, display-floored at 0, per-Event, and **soft-resets each Season**.
2. **Skill Rating is the only balancing/matchmaking input.** Season Rank never feeds `balanceTeams` or expected-score math (which uses opponents' Skill Rating).
3. **Rank rides the existing Season.** Rank moves only while a Season is `active`, and only for active participants assigned to an immutable lineup. The qualifying-game set is the same one the standings use (`filterLeaderboardGames`).
4. **Seeding.** Existing players `R0 = SkillRating − anchor`; brand-new players `R0 = 0`. `anchor` = a low percentile of the Event's Skill Rating at its first activation, frozen.
5. **Per game.** `E = expected(playerSkill, avg opponentSkill)`; `R += round(K · (outcome − E))`. `K = 32`, or `64` for an unseeded player's first ≤ 3 season games.
6. **Soft reset.** On the next Season's **activation** (one per activation): `R = R + 0.5 · (seed − R)`, where `seed = current SkillRating − anchor`. Skill-anchored, **not** population-mean (a mean-anchored reset decays discrimination to zero across seasons — see the simulation).
7. **Tiers.** Six absolute bands with **percentile-derived (equal-count)** edges, frozen at launch (re-derived only by audited admin action): Bronze, Silver, Gold, Platinum, Diamond, Master. Thin-signal players (< 3 games) start at 0 and are excluded from calibration.
8. **Provisional.** No Tier is shown until a player has 3 season games.
9. **Pure replay.** Season Rank is a pure function of (Season periods, qualifying Games, seeds). Any period/eligibility edit recomputes the affected Season **forward** through later Seasons. Cancel reverts; reopen recomputes.
10. **History.** Freeze a completion snapshot (Crew standings + Season Rank + badges), refreshed only on an audited reopen.
11. **Visibility.** Individual Rank is visible to Event members; the Crew ladder is public. Non-participants are frozen; withdrawn/inactive default to Freeze (owner-configurable).
12. **Settings.** One master **"Competitive rankings"** bundles Elo + balancing + Rank + MVP-rating; decay and inactive-Rank behaviour live under Advanced; all locked while a Season is active/review.
13. **Canonical skill seam.** Rank reads Elo through a single `getLifetimeSkill()` accessor, so the GH-522 migration (`PlayerRating` → `EventPlayer.rating`) does not change Rank code.

## Considered Options (rejected)

- **Single rating that resets** — breaks balancing and contradicts "the Elo never resets".
- **Population-mean soft reset** — simulations show discrimination decays to zero over seasons; skill-anchored stays flat.
- **Uniform σ tier bands** — leave empty tiers, killing the goal gradient; percentile edges keep every tier populated.
- **A separate Rank period entity** — reuse the existing Season instead.
- **A stored, incrementally-mutated Rank** — the active Season Rank derives on read; only completion snapshots persist, so the ~7 Elo recompute callers need no Rank-aware changes.

## Consequences

- The weekly casual game stays casual: opt-in, no attendance pressure, individual Rank private to members.
- Casual owners see **one** switch; advanced controls are hidden.
- Tier transitions use a full-screen modal: an earned-competence celebration up, a calm fresh-start message down.
- History depends on completion snapshots; cancelling a Season leaves no ladder footprint.
- Until GH-522 lands, Rank reads the legacy `PlayerRating` store behind the seam.
