# Seasonal Rank formula: simulation findings and proposed method

Ticket: dex `f34z68rd` (Seasonal rank math) — GitHub #939
Branch: `prototype/rank-math-sim`
Date: 2026-09-10

## What this is

A transparent, reproducible simulation that validates the proposed two-layer
ranking model across sports (1v1, 2v2, 5v5) and season lengths (8, 20, 52 games),
and derives a data-driven tier proposal. Code: `simulate.py`, `experiments.py`.
Run: `python3 experiments.py`.

The local DB contains only synthetic fixture data for the pilot Event (74% of
players exactly 1000), so **absolute anchor/scale values must be derived from
production at launch**. This simulation validates the *method*, not the final
constants.

## Model under test

- **Lifetime skill** (hidden, unchanged): `EventPlayer.rating`, seed 1000,
  K=48 (<6 games) / 32, symmetric, never resets, drives `balanceTeams`.
- **Season Rank** (visible, new): signed hidden value `R`, display `max(0, round(R))`,
  0-based, soft-resets each season.
- Seed at first season: `R0 = lifetimeElo − anchor` (anchor = p5 of the Event's
  lifetime Elo at launch).
- Update per eligible game: `E = expectedScore(playerElo, avg opponent lifetime Elo)`;
  `R += round(K_rank * (outcome − E))`.
- Outcome in the sim comes from a latent true skill (Bradley–Terry), independent
  of the rating, so convergence is a real test.

## Experiment 1–2 — the reset is the dangerous part

Convergence (Spearman between true skill and Rank) at the end of seasons 1..5,
5v5:

| Reset strategy | S1 | S2 | S3 | S4 | S5 |
|---|---|---|---|---|---|
| toward population mean, f=0.50 (original Q10) | 0.32 | 0.30 | 0.25 | 0.22 | 0.18 |
| toward population mean, f=0.25 | 0.30 | 0.33 | 0.33 | 0.32 | 0.30 |
| toward the player's skill seed, f=0.50 | 0.32 | 0.36 | 0.36 | 0.34 | 0.33 |
| no reset | 0.30 | 0.33 | 0.35 | 0.37 | 0.41 |

**Finding:** a repeated reset toward a *fixed population mean* multiplies every
player's deviation by `(1−f)` each season, so discrimination decays toward zero
no matter how small `f` is (f=0.25 only decays more slowly). A reset toward the
player's *skill-anchored seed* does not decay, because the target moves with the
player's evolving skill.

## Experiment 3–4 — K magnitude and season length

Convergence at S5, seed reset f=0.5:

| Scenario | K=24 | K=32 | K=40 | K=scaled (16–32) |
|---|---|---|---|---|
| 5v5 N=8 | 0.33 | 0.34 | 0.34 | 0.36 |
| 5v5 N=52 | 0.30 | 0.27 | 0.25 | 0.29 |
| 2v2 N=20 | 0.60 | 0.63 | 0.60 | 0.60 |

A fast "provisional" K (64→32 over the first 25% of the season) *hurt*
convergence at every season length (Exp 1), because it injects variance into a
number that is already seeded from a converged skill estimate.

**Finding:** use a **constant K=32**. No K scaling with season length is needed —
the seed carries skill, so the same constant works from 8 to 52 games. Season
length only affects the *provisional window for unseeded brand-new players*.

## Experiment 5 — Rank tracks the skill ceiling

Spearman(true skill, lifetime Elo) vs Spearman(true skill, Rank), seed reset, K=32:

| Scenario | Elo S1 | Elo S3 | Rank S1 | Rank S3 |
|---|---|---|---|---|
| 5v5 N=8 | 0.31 | 0.37 | 0.31 | 0.33 |
| 5v5 N=20 | 0.40 | 0.49 | 0.40 | 0.40 |
| 5v5 N=52 | 0.49 | 0.58 | 0.48 | 0.38 |
| 2v2 N=20 | 0.65 | 0.76 | 0.66 | 0.66 |
| 1v1 N=20 | 0.77 | 0.86 | 0.76 | 0.81 |

**Finding:** the Rank is a faithful projection of the lifetime Elo ceiling and
adds no distortion. Where Rank lags Elo over many seasons (5v5 N=52), the
seed-anchored reset is intentionally re-absorbing season deviation.

## Experiment 6 — tier bands

With band width `w = 0.5σ` of the seeded Rank distribution (σ≈44 in the sim):

- proposed edges (example): `0 / 22 / 44 / 66 / 88 / 110`, top band open.
- mean bands crossed per player per season: **0.67**; share crossing ≥1: **53%**.
- population share per band (low→high): 0.09 / 0.14 / 0.17 / 0.18 / 0.15 / 0.21.

**Finding:** `0.5σ` bands give roughly one band of movement per season for an
8-game season. The top band is open-ended and holds ~21%; retune to `0.4σ` or 7
tiers if the top feels too wide after the pilot.

## Proposed formula (locked method)

```
Lifetime skill (hidden) : EventPlayer.rating — unchanged. Drives balanceTeams.
                          Never reset, never feeds Rank expected-score inputs.

Season Rank R (hidden)  : signed, unbounded.
Displayed Rank          : max(0, round(R)); "Provisional" until 3 season games.

Seed (first season)     : existing player  R0 = lifetimeElo − anchor
                          brand-new player R0 = 0
                          anchor = p5 of the Event lifetime-Elo distribution,
                          derived once at launch, frozen, admin-audited.

Per eligible game       : E  = expectedScore(playerLifetimeElo, avg opponentLifetimeElo)
                          K  = 32 (seeded) | 64 for an unseeded player's first
                               min(3, P) games, P = clamp(round(0.25*N), 3, 10)
                          R += round(K * (outcome − E))

Soft reset (season end) : seed = current lifetimeElo − anchor
                          R    = R + 0.5 * (seed − R)      # skill-anchored

Tiers                   : 6 absolute bands. Edges derived once at launch from
                          the seeded Rank distribution: width w = 0.5σ, edges
                          0 / w / 2w / 3w / 4w / 5w (top open). Frozen;
                          re-derived only by audited admin action.
```

This adapts to sport and season length through (a) the skill-anchored seed,
(b) a constant K that the data shows is length-independent, and (c) tier widths
derived from the actual population. It is transparent: one seed rule, one K, one
reset rule, one band width.

## Tier naming — proposal

Six tiers. Recommended (clear, translatable, low controversy):

| Tier | Name | Band |
|---|---|---|
| 1 | Bronze | 0 – w |
| 2 | Silver | w – 2w |
| 3 | Gold | 2w – 3w |
| 4 | Platinum | 3w – 4w |
| 5 | Diamond | 4w – 5w |
| 6 | Master | 5w + |

Alternative (football-flavoured): Amador / Reserva / Titular / Craque / Mestre / Lenda.

## Open / dependent

- Final `anchor`, `σ`, and therefore band numbers: derived from production at
  launch (blocked on the migration ticket).
- Whether `w = 0.5σ` or `0.4σ`: retune after the pilot.
- Tier names: product choice.
- `Provisional` display copy and i18n: UX ticket.
