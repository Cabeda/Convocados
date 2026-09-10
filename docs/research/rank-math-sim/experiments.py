#!/usr/bin/env python3
"""
Seasonal Rank formula experiments (Convocados).

Two-layer model:
  - Lifetime Elo (hidden): 1000 seed, symmetric, K=48 (<6 games)/32, never resets.
  - Seasonal Rank (visible): 0-based, display-floored, soft-resets each season.

Experiments:
  1. K policy: fixed 32 vs season-length-adaptive (64->32 over first 25% of games).
  2. Soft-reset strategy: toward population mean vs toward the player's own
     lifetime-Elo-implied seed, at fractions 0.5 / 0.25.
  3. Convergence across 5 seasons (does discrimination survive resets?).
  4. Tier thresholds + names from the surviving distribution.

Pure stdlib. Run: python3 simulate.py
"""

import math
import random
import statistics as st
from dataclasses import dataclass

DEFAULT_RATING = 1000
K_PROVISIONAL, K_STANDARD, PROVISIONAL_GAMES = 48, 32, 6


def expected(player, opponent):
    return 1.0 / (1.0 + 10 ** ((opponent - player) / 400.0))


def lifetime_k(g):
    return K_PROVISIONAL if g < PROVISIONAL_GAMES else K_STANDARD


def k_fixed(_n, _N):
    return 32.0


def k_adaptive(n, N):
    """Provisional window P = clamp(round(0.25N), 3, 10); K decays 64->32 across P."""
    P = min(10, max(3, round(0.25 * N)))
    if n >= P:
        return 32.0
    return 64.0 - 32.0 * (n / P)


# ── stats ─────────────────────────────────────────────────────────────────────

def rankdata(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def pearson(a, b):
    n = len(a)
    if n < 2:
        return 0.0
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    va = math.sqrt(sum((v - ma) ** 2 for v in a))
    vb = math.sqrt(sum((v - mb) ** 2 for v in b))
    return cov / (va * vb) if va and vb else 0.0


def spearman(x, y):
    return pearson(rankdata(x), rankdata(y))


def pct(xs, p):
    s = sorted(xs)
    idx = min(len(s) - 1, max(0, int(round(p / 100.0 * (len(s) - 1)))))
    return s[idx]


def iqr(xs):
    return pct(xs, 75) - pct(xs, 25)


# ── simulation ────────────────────────────────────────────────────────────────

@dataclass
class P:
    skill: float
    elo: float = DEFAULT_RATING
    games: int = 0
    R: float = 0.0
    season_games: int = 0


def play(players, team_size, N, kfn, rng):
    roster = rng.sample(players, 2 * team_size)
    roster.sort(key=lambda p: p.elo, reverse=True)
    t1, t2 = [], []
    for i, p in enumerate(roster):
        (t1 if i % 2 == 0 else t2).append(p)
    s1 = sum(p.skill for p in t1) / team_size
    s2 = sum(p.skill for p in t2) / team_size
    p1 = 1.0 / (1.0 + math.exp(-(s1 - s2) / 0.6))
    outcome = 1.0 if rng.random() < p1 else 0.0
    e1 = sum(p.elo for p in t1) / team_size
    e2 = sum(p.elo for p in t2) / team_size
    for team, opp, out, opp_elo in ((t1, e2, outcome, e2), (t2, e1, 1 - outcome, e1)):
        for p in team:
            pre = p.elo
            p.elo += round(lifetime_k(p.games) * (out - expected(pre, opp)))
            p.games += 1
            p.R += kfn(p.season_games, N) * (out - expected(pre, opp_elo))
            p.season_games += 1


def season(players, team_size, N, kfn, rng):
    for p in players:
        p.season_games = 0
    for _ in range(N):
        play(players, team_size, N, kfn, rng)


def run(sc, kfn, reset, warmup=20, seasons=5):
    """reset(players, seeds) called at end of each season. Returns per-season conv."""
    convs = []
    for _ in range(sc["sims"]):
        rng = random.Random()
        players = [P(skill=rng.gauss(0, 1)) for _ in range(sc["n"])]
        for _ in range(warmup):
            play(players, sc["team"], sc["N"], kfn, rng)
        elos = [p.elo for p in players]
        anchor = pct(elos, 5)
        for p in players:
            p.R = max(0.0, p.elo - anchor)
        seed = {id(p): max(0.0, p.elo - anchor) for p in players}
        for _ in range(seasons):
            season(players, sc["team"], sc["N"], kfn, rng)
            convs.append(spearman([p.skill for p in players], [p.R for p in players]))
            reset(players, seed)
    per_season = [st.mean(convs[i::seasons]) for i in range(seasons)]
    return per_season


def reset_mean(f):
    def r(players, _seed):
        m = st.median([p.R for p in players])
        for p in players:
            p.R += f * (m - p.R)
    return r


def reset_seed(f):
    def r(players, seed):
        for p in players:
            p.R += f * (seed[id(p)] - p.R)
    return r


def reset_none(players, _seed):
    return


SCENARIOS = {
    "5v5 N=8 (pilot)":  {"n": 40, "team": 5, "N": 8,  "sims": 120},
    "5v5 N=20":         {"n": 40, "team": 5, "N": 20, "sims": 120},
    "5v5 N=52 (year)":  {"n": 40, "team": 5, "N": 52, "sims": 120},
    "2v2 N=20":         {"n": 16, "team": 2, "N": 20, "sims": 120},
    "1v1 N=20":         {"n": 12, "team": 1, "N": 20, "sims": 120},
}


def experiment_k():
    print("\n## Experiment 1 - K policy (reset = mean 0.5)\n")
    print("| Scenario | fixed32 S1..S5 | adaptive S1..S5 |")
    print("|---|---|---|")
    for name, sc in SCENARIOS.items():
        fx = run(sc, k_fixed, reset_mean(0.5))
        ad = run(sc, k_adaptive, reset_mean(0.5))
        fxs = " ".join(f"{v:.2f}" for v in fx)
        ads = " ".join(f"{v:.2f}" for v in ad)
        print(f"| {name} | {fxs} | {ads} |")


def experiment_reset():
    print("\n## Experiment 2 - Reset strategy (adaptive K)\n")
    print("| Scenario | mean 0.5 | mean 0.25 | seed 0.5 | none |")
    print("|---|---|---|---|---|")
    for name, sc in SCENARIOS.items():
        a = run(sc, k_adaptive, reset_mean(0.5))
        b = run(sc, k_adaptive, reset_mean(0.25))
        c = run(sc, k_adaptive, reset_seed(0.5))
        d = run(sc, k_adaptive, reset_none)
        fmt = lambda r: " ".join(f"{v:.2f}" for v in r)
        print(f"| {name} | {fmt(a)} | {fmt(b)} | {fmt(c)} | {fmt(d)} |")


def experiment_distribution():
    """Final distribution + tier proposal under seed-reset 0.5, 5v5 N=8."""
    sc = {"n": 40, "team": 5, "N": 8, "sims": 400}
    pooled, per_season_cross = [], []
    for _ in range(sc["sims"]):
        rng = random.Random()
        players = [P(skill=rng.gauss(0, 1)) for _ in range(sc["n"])]
        for _ in range(20):
            play(players, 5, 8, k_adaptive, rng)
        elos = [p.elo for p in players]
        anchor = pct(elos, 5)
        seed = {id(p): max(0.0, p.elo - anchor) for p in players}
        for p in players:
            p.R = seed[id(p)]
        prev = {id(p): p.R for p in players}
        for _ in range(3):
            season(players, 5, 8, k_adaptive, rng)
            for p in players:
                per_season_cross.append(abs(p.R - prev[id(p)]))
            for p in players:
                pooled.append(p.R)
            reset_seed(0.5)(players, seed)
            prev = {id(p): p.R for p in players}
    print("\n## Experiment 3 - Distribution under seed-reset 0.5 (5v5, N=8, 3 seasons)\n")
    print(f"- median R: {st.median(pooled):.0f}")
    print(f"- p10/p25/p50/p75/p90: "
          f"{pct(pooled,10):.0f}/{pct(pooled,25):.0f}/{pct(pooled,50):.0f}/"
          f"{pct(pooled,75):.0f}/{pct(pooled,90):.0f}")
    print(f"- mean |R change| per season: {st.mean(per_season_cross):.0f}")
    print(f"- fraction display R < 0 (would show 0): {sum(1 for r in pooled if r < 0)/len(pooled):.3f}")


# ── extra experiments ─────────────────────────────────────────────────────────

def reset_blend(w_seed, f):
    """target = w*seed + (1-w)*population_median; move fraction f toward it."""
    def r(players, seed):
        m = st.median([p.R for p in players])
        for p in players:
            target = w_seed * seed[id(p)] + (1 - w_seed) * m
            p.R += f * (target - p.R)
    return r


def k_const(k):
    return lambda _n, _N: float(k)


def k_scaled():
    """K shrinks with season length so a season's total swing stays bounded."""
    return lambda _n, N: min(32.0, max(16.0, 32.0 * math.sqrt(8.0 / N)))


def experiment_reset_target():
    print("\n## Experiment 4 - Reset target blend (adaptive K, f=0.5)\n")
    print("| Scenario | mean(w=0) | blend(w=.5) | seed(w=1) |")
    print("|---|---|---|---|")
    for name in ["5v5 N=8 (pilot)", "5v5 N=20", "5v5 N=52 (year)", "2v2 N=20"]:
        sc = SCENARIOS[name]
        cols = [run(sc, k_adaptive, reset_blend(w, 0.5)) for w in (0.0, 0.5, 1.0)]
        fmt = lambda r: " ".join(f"{v:.2f}" for v in r)
        print(f"| {name} | {fmt(cols[0])} | {fmt(cols[1])} | {fmt(cols[2])} |")


def experiment_k2():
    print("\n## Experiment 5 - K magnitude (seed reset f=0.5)\n")
    print("| Scenario | K=24 | K=32 | K=40 | K=scaled |")
    print("|---|---|---|---|---|")
    for name in ["5v5 N=8 (pilot)", "5v5 N=52 (year)", "2v2 N=20"]:
        sc = SCENARIOS[name]
        cols = [run(sc, k_const(k), reset_blend(1.0, 0.5)) for k in (24, 32, 40)]
        cols.append(run(sc, k_scaled(), reset_blend(1.0, 0.5)))
        fmt = lambda r: " ".join(f"{v:.2f}" for v in r)
        print(f"| {name} | {fmt(cols[0])} | {fmt(cols[1])} | {fmt(cols[2])} | {fmt(cols[3])} |")


def experiment_ceiling():
    print("\n## Experiment 6 - Lifetime Elo ceiling vs Rank (seed reset f=0.5, K=32)\n")
    print("| Scenario | Elo after warmup | Elo after S1 | Elo after S3 | Rank S1 | Rank S3 |")
    print("|---|---|---|---|---|---|")
    for name in ["5v5 N=8 (pilot)", "5v5 N=20", "5v5 N=52 (year)", "2v2 N=20", "1v1 N=20"]:
        sc = SCENARIOS[name]
        e0, e1, e3, r1, r3 = [], [], [], [], []
        for _ in range(sc["sims"]):
            rng = random.Random()
            players = [P(skill=rng.gauss(0, 1)) for _ in range(sc["n"])]
            for _ in range(20):
                play(players, sc["team"], sc["N"], k_const(32), rng)
            e0.append(spearman([p.skill for p in players], [p.elo for p in players]))
            elos = [p.elo for p in players]
            anchor = pct(elos, 5)
            seed = {id(p): max(0.0, p.elo - anchor) for p in players}
            for p in players:
                p.R = seed[id(p)]
            for s in range(3):
                season(players, sc["team"], sc["N"], k_const(32), rng)
                if s == 0:
                    e1.append(spearman([p.skill for p in players], [p.elo for p in players]))
                    r1.append(spearman([p.skill for p in players], [p.R for p in players]))
                if s == 2:
                    e3.append(spearman([p.skill for p in players], [p.elo for p in players]))
                    r3.append(spearman([p.skill for p in players], [p.R for p in players]))
                reset_blend(1.0, 0.5)(players, seed)
        m = lambda x: st.mean(x)
        print(f"| {name} | {m(e0):.2f} | {m(e1):.2f} | {m(e3):.2f} | {m(r1):.2f} | {m(r3):.2f} |")


if __name__ == "__main__":
    experiment_k()
    experiment_reset()
    experiment_reset_target()
    experiment_k2()
    experiment_ceiling()
    experiment_distribution()


def experiment_tiers():
    """Tier crossing under sigma-based bands, seed reset f=0.5, K=32."""
    print("\n## Experiment 7 - Tier bands and crossing (5v5, N=8, seed reset 0.5, K=32)\n")
    sc = {"n": 40, "team": 5, "N": 8, "sims": 400}
    sigmas, crossings, band_counts, starts = [], [], [], []
    for _ in range(sc["sims"]):
        rng = random.Random()
        players = [P(skill=rng.gauss(0, 1)) for _ in range(sc["n"])]
        for _ in range(20):
            play(players, 5, 8, k_const(32), rng)
        elos = [p.elo for p in players]
        anchor = pct(elos, 5)
        seed = {id(p): max(0.0, p.elo - anchor) for p in players}
        seeded = list(seed.values())
        sigma = st.pstdev(seeded)
        sigmas.append(sigma)
        band = lambda r: min(5, int(r // (0.5 * sigma)))
        for p in players:
            p.R = seed[id(p)]
            starts.append(p.R)
        for _ in range(3):
            before = {id(p): band(p.R) for p in players}
            season(players, 5, 8, k_const(32), rng)
            for p in players:
                crossings.append(abs(band(p.R) - before[id(p)]))
            for p in players:
                band_counts.append(band(p.R))
            reset_blend(1.0, 0.5)(players, seed)
    m = lambda x: st.mean(x)
    print(f"- seeded sigma: {m(sigmas):.1f}  -> band width 0.5σ = {0.5*m(sigmas):.1f}")
    print(f"- proposed edges (example): 0 / {0.5*m(sigmas):.0f} / {m(sigmas):.0f} / "
          f"{1.5*m(sigmas):.0f} / {2*m(sigmas):.0f} / {2.5*m(sigmas):.0f}")
    print(f"- mean bands crossed per player per season: {m(crossings):.2f}")
    print(f"- share crossing >=1 band per season: {sum(1 for c in crossings if c>=1)/len(crossings):.2f}")
    tot = len(band_counts)
    dist = [sum(1 for b in band_counts if b == i)/tot for i in range(6)]
    print("- population share per band (0..5): " + " ".join(f"{d:.2f}" for d in dist))
    print(f"- median seeded Rank: {st.median(starts):.0f}, p90: {pct(starts,90):.0f}")


if __name__ == "__main__":
    experiment_tiers()
