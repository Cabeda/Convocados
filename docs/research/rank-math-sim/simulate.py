#!/usr/bin/env python3
"""
Seasonal Rank formula simulation (Convocados).

Validates a two-layer model:
  - Lifetime Elo (hidden): 1000 seed, symmetric, K=48 (<6 games) / 32, never resets.
  - Seasonal Rank (visible): 0-based, display-floored, soft-reset via (old+mean)/2.

Question this answers: is the Rank formula stable and transparent across
sports (team sizes) and season lengths (8 .. 52 games), and what tier
thresholds fall out of a realistic population?

Pure stdlib. Run:  python3 simulate.py
"""

import math
import random
import statistics as st
from dataclasses import dataclass

# ── Lifetime Elo engine (mirrors src/lib/elo.ts) ──────────────────────────────

DEFAULT_RATING = 1000
K_STANDARD = 32
K_PROVISIONAL = 48
PROVISIONAL_GAMES = 6


def expected(player, opponent):
    return 1.0 / (1.0 + 10 ** ((opponent - player) / 400.0))


def lifetime_k(games_played):
    return K_PROVISIONAL if games_played < PROVISIONAL_GAMES else K_STANDARD


# ── Seasonal Rank K policies ──────────────────────────────────────────────────

def k_fixed(_n, _N):
    return 32


def k_adaptive(n, N):
    """Transparent, season-length-aware schedule.

    Provisional window P = clamp(round(0.25 * N), 3, 10) games.
    K decays linearly from K_PROV to K_BASE across P, then stays K_BASE.
    For an 8-game season: P=3, K 64->32. For a 52-game season: P=10, K 64->32.
    """
    K_PROV, K_BASE = 64.0, 32.0
    P = min(10, max(3, round(0.25 * N)))
    if n >= P:
        return K_BASE
    return K_PROV - (K_PROV - K_BASE) * (n / P)


# ── Stats helpers ─────────────────────────────────────────────────────────────

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
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    va = math.sqrt(sum((v - ma) ** 2 for v in a))
    vb = math.sqrt(sum((v - mb) ** 2 for v in b))
    if va == 0 or vb == 0:
        return 0.0
    return cov / (va * vb)


def spearman(x, y):
    return pearson(rankdata(x), rankdata(y))


def percentile(xs, p):
    s = sorted(xs)
    if not s:
        return 0.0
    idx = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return s[idx]


# ── One simulated game ────────────────────────────────────────────────────────

@dataclass
class Player:
    skill: float          # latent true skill
    elo: float = DEFAULT_RATING
    games: int = 0
    R: float = 0.0        # hidden seasonal rank (signed)
    season_games: int = 0


def play_game(players, team_size, rng):
    """Pick 2*team_size players, balance teams by lifetime Elo, resolve outcome
    from true skill, update lifetime Elo and seasonal Rank."""
    need = 2 * team_size
    roster = rng.sample(players, need)
    roster.sort(key=lambda p: p.elo, reverse=True)
    t1, t2 = [], []
    for i, p in enumerate(roster):  # snake draft by lifetime Elo
        (t1 if i % 2 == 0 else t2).append(p)

    s1 = sum(p.skill for p in t1) / team_size
    s2 = sum(p.skill for p in t2) / team_size
    p1 = 1.0 / (1.0 + math.exp(-(s1 - s2) / 0.6))
    outcome = 1.0 if rng.random() < p1 else 0.0

    e1 = sum(p.elo for p in t1) / team_size
    e2 = sum(p.elo for p in t2) / team_size

    for team, opp_avg, out in ((t1, e2, outcome), (t2, e1, 1.0 - outcome)):
        for p in team:
            # lifetime Elo
            delta = round(lifetime_k(p.games) * (out - expected(p.elo, opp_avg)))
            p.elo += delta
            p.games += 1
            # seasonal Rank: expected score vs opponents' LIFETIME Elo
            e = expected(p.elo, opp_avg)
            p.R += k_adaptive(p.season_games, _CURRENT_N) * (out - e)
            p.season_games += 1


# ── One season ────────────────────────────────────────────────────────────────

_CURRENT_N = 8  # season length, set per scenario


def run_season(players, team_size, N, rng):
    global _CURRENT_N
    _CURRENT_N = N
    for p in players:
        p.season_games = 0
    for _ in range(N):
        play_game(players, team_size, rng)


def seed_rank(players, anchor, scale=1.0):
    for p in players:
        p.R = max(0.0, (p.elo - anchor) / scale)


def soft_reset(players, mean):
    for p in players:
        p.R = (p.R + mean) / 2.0


# ── Scenario ──────────────────────────────────────────────────────────────────

@dataclass
class Scenario:
    name: str
    players: int
    team_size: int
    season_games: int
    seasons: int = 3
    warmup_games: int = 12   # games to establish lifetime Elo before rank layer
    sims: int = 150


def simulate(sc):
    conv1, conv3, floor0, means = [], [], [], []
    for _ in range(sc.sims):
        rng = random.Random()
        players = [Player(skill=rng.gauss(0, 1)) for _ in range(sc.players)]
        # warmup: establish lifetime Elo (hidden), no rank yet
        for _ in range(sc.warmup_games):
            play_game(players, sc.team_size, rng)
        elos = [p.elo for p in players]
        anchor = percentile(elos, 5)
        seed_rank(players, anchor)
        mean = st.median([p.R for p in players])

        for s in range(sc.seasons):
            run_season(players, sc.team_size, sc.season_games, rng)
            true = [p.skill for p in players]
            hidden = [p.R for p in players]
            conv = spearman(true, hidden)
            if s == 0:
                conv1.append(conv)
            if s == sc.seasons - 1:
                conv3.append(conv)
                floor0.append(sum(1 for p in players if p.R < 0) / sc.players)
                means.append(st.median([p.R for p in players]))
            soft_reset(players, mean)
    return {
        "conv1": st.mean(conv1),
        "conv3": st.mean(conv3),
        "floor0": st.mean(floor0),
        "mean": st.mean(means),
    }


def main():
    scenarios = [
        Scenario("futsal 5v5, 8-game season (pilot)", 40, 5, 8),
        Scenario("futsal 5v5, 20-game season", 40, 5, 20),
        Scenario("futsal 5v5, 52-game year", 40, 5, 52),
        Scenario("padel 2v2, 20-game season", 16, 2, 20),
        Scenario("tennis 1v1, 20-game season", 12, 1, 20),
        Scenario("small group 5v5, 8-game", 12, 5, 8),
    ]
    print("| Scenario | n | team | N | conv S1 | conv S3 | frac hidden<0 | median R |")
    print("|---|---|---|---|---|---|---|---|")
    for sc in scenarios:
        r = simulate(sc)
        print(f"| {sc.name} | {sc.players} | {sc.team_size} | {sc.season_games} "
              f"| {r['conv1']:.3f} | {r['conv3']:.3f} | {r['floor0']:.2f} | {r['mean']:.0f} |")


if __name__ == "__main__":
    main()
