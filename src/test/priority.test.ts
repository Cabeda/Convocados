import { describe, it, expect } from "vitest";
import {
  gamesInWindow,
  calculateEligibility,
  rankAndCap,
  confirmationDeadline,
  type PrioritySettings,
  type PriorityCandidate,
} from "~/lib/priority";

// Helper: create a game history entry with specific players
function makeGame(dateTime: string, playerNames: string[], status = "played") {
  const teams = [
    { team: "A", players: playerNames.slice(0, Math.ceil(playerNames.length / 2)).map((n, i) => ({ name: n, order: i })) },
    { team: "B", players: playerNames.slice(Math.ceil(playerNames.length / 2)).map((n, i) => ({ name: n, order: i })) },
  ];
  return { status, dateTime: new Date(dateTime), teamsSnapshot: JSON.stringify(teams) };
}

function makePlayer(overrides: Partial<{
  userId: string; name: string; optedIn: boolean;
  declineStreak: number; noShowStreak: number; accountCreatedAt: Date;
}> = {}) {
  return {
    userId: overrides.userId ?? "user-1",
    name: overrides.name ?? "Alice",
    optedIn: overrides.optedIn ?? true,
    declineStreak: overrides.declineStreak ?? 0,
    noShowStreak: overrides.noShowStreak ?? 0,
    accountCreatedAt: overrides.accountCreatedAt ?? new Date("2025-01-01"),
  };
}

const defaultSettings: PrioritySettings = {
  threshold: 3,
  window: 4,
  minGames: 3,
  maxPercent: 70,
};

// ─── gamesInWindow ───────────────────────────────────────────────────────────

describe("gamesInWindow", () => {
  it("counts games in the last N games", () => {
    const history = [
      makeGame("2026-01-01", ["Alice", "Bob"]),
      makeGame("2026-01-08", ["Alice", "Bob"]),
      makeGame("2026-01-15", ["Bob", "Charlie"]),
      makeGame("2026-01-22", ["Alice", "Bob"]),
      makeGame("2026-01-29", ["Alice", "Bob"]),
    ];
    // Alice played games 1,2,4,5 — in last 4 games (2,3,4,5): played 3,4,5 = 3
    expect(gamesInWindow("Alice", history, 4)).toBe(3);
    // Bob played all 5 — in last 4: 4
    expect(gamesInWindow("Bob", history, 4)).toBe(4);
    // Charlie played game 3 only — in last 4 (2,3,4,5): 1
    expect(gamesInWindow("Charlie", history, 4)).toBe(1);
  });

  it("returns 0 for empty history", () => {
    expect(gamesInWindow("Alice", [], 4)).toBe(0);
  });

  it("handles window larger than total games", () => {
    const history = [
      makeGame("2026-01-01", ["Alice"]),
      makeGame("2026-01-08", ["Alice"]),
    ];
    expect(gamesInWindow("Alice", history, 10)).toBe(2);
  });

  it("ignores cancelled games", () => {
    const history = [
      makeGame("2026-01-01", ["Alice"], "played"),
      makeGame("2026-01-08", ["Alice"], "cancelled"),
      makeGame("2026-01-15", ["Alice"], "played"),
    ];
    expect(gamesInWindow("Alice", history, 4)).toBe(2);
  });
});

// ─── calculateEligibility ────────────────────────────────────────────────────

describe("calculateEligibility", () => {
  const history = [
    makeGame("2026-01-01", ["Alice", "Bob", "Charlie", "Dave"]),
    makeGame("2026-01-08", ["Alice", "Bob", "Charlie", "Dave"]),
    makeGame("2026-01-15", ["Alice", "Bob", "Dave"]),
    makeGame("2026-01-22", ["Alice", "Bob", "Charlie", "Dave"]),
    makeGame("2026-01-29", ["Alice", "Bob", "Charlie"]),
  ];

  it("marks players eligible when they meet all criteria", () => {
    const players = [
      makePlayer({ userId: "u1", name: "Alice" }),
      makePlayer({ userId: "u2", name: "Bob" }),
    ];
    const result = calculateEligibility(history, players, defaultSettings);
    expect(result.eligible).toHaveLength(2);
    expect(result.eligible.map((e) => e.name)).toContain("Alice");
    expect(result.eligible.map((e) => e.name)).toContain("Bob");
  });

  it("rejects players below minGames threshold", () => {
    const shortHistory = [
      makeGame("2026-01-01", ["Alice", "NewPlayer"]),
      makeGame("2026-01-08", ["Alice", "NewPlayer"]),
    ];
    const players = [
      makePlayer({ userId: "u1", name: "Alice" }),
      makePlayer({ userId: "u2", name: "NewPlayer" }),
    ];
    const result = calculateEligibility(shortHistory, players, defaultSettings);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible).toHaveLength(2);
    expect(result.ineligible[0].reason).toContain("needs 3 games");
  });

  it("rejects players who opted out", () => {
    const players = [
      makePlayer({ userId: "u1", name: "Alice", optedIn: false }),
    ];
    const result = calculateEligibility(history, players, defaultSettings);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0].reason).toBe("opted out");
  });

  it("rejects players with 3+ consecutive declines (decay)", () => {
    const players = [
      makePlayer({ userId: "u1", name: "Alice", declineStreak: 3 }),
    ];
    const result = calculateEligibility(history, players, defaultSettings);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0].reason).toContain("3 consecutive declines");
  });

  it("rejects players with 2+ consecutive no-shows", () => {
    const players = [
      makePlayer({ userId: "u1", name: "Alice", noShowStreak: 2 }),
    ];
    const result = calculateEligibility(history, players, defaultSettings);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0].reason).toContain("2 consecutive no-shows");
  });

  it("rejects players below attendance threshold in window", () => {
    // Dave played 4 of 5 total but only need to check window
    // In last 4 games (2,3,4,5): Dave played 2,3,4 = 3 — meets threshold
    // Charlie played 1,2,4,5 — in last 4 (2,3,4,5): played 2,4,5 = 3 — meets threshold
    // Create a player who only played early games
    const sparseHistory = [
      makeGame("2026-01-01", ["Alice", "Sparse"]),
      makeGame("2026-01-08", ["Alice", "Sparse"]),
      makeGame("2026-01-15", ["Alice", "Sparse"]),
      makeGame("2026-01-22", ["Alice"]),
      makeGame("2026-01-29", ["Alice"]),
      makeGame("2026-02-05", ["Alice"]),
      makeGame("2026-02-12", ["Alice"]),
    ];
    const players = [
      makePlayer({ userId: "u1", name: "Sparse" }),
    ];
    const result = calculateEligibility(sparseHistory, players, defaultSettings);
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0].reason).toContain("attended 0/4 in window");
  });
});

// ─── rankAndCap ──────────────────────────────────────────────────────────────

describe("rankAndCap", () => {
  it("sorts by attendance rate, then streak, then account age", () => {
    const candidates: PriorityCandidate[] = [
      { userId: "u1", name: "Low", attendanceRate: 0.5, gamesInWindow: 2, totalGames: 4, currentStreak: 1, accountCreatedAt: new Date("2025-01-01") },
      { userId: "u2", name: "High", attendanceRate: 1.0, gamesInWindow: 4, totalGames: 4, currentStreak: 4, accountCreatedAt: new Date("2025-06-01") },
      { userId: "u3", name: "Mid", attendanceRate: 0.75, gamesInWindow: 3, totalGames: 4, currentStreak: 3, accountCreatedAt: new Date("2025-03-01") },
    ];
    const result = rankAndCap(candidates, 10, 70);
    expect(result.map((c) => c.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("caps to maxPercent of maxPlayers", () => {
    const candidates: PriorityCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      userId: `u${i}`, name: `P${i}`, attendanceRate: 1.0, gamesInWindow: 4,
      totalGames: 10, currentStreak: 4, accountCreatedAt: new Date(`2025-0${i + 1}-01`),
    }));
    // maxPlayers=10, maxPercent=70 → 7 slots
    const result = rankAndCap(candidates, 10, 70);
    expect(result).toHaveLength(7);
  });

  it("returns empty when maxPercent is 0", () => {
    const candidates: PriorityCandidate[] = [
      { userId: "u1", name: "A", attendanceRate: 1.0, gamesInWindow: 4, totalGames: 4, currentStreak: 4, accountCreatedAt: new Date("2025-01-01") },
    ];
    expect(rankAndCap(candidates, 10, 0)).toHaveLength(0);
  });

  it("uses account creation as tiebreaker", () => {
    const candidates: PriorityCandidate[] = [
      { userId: "u1", name: "Newer", attendanceRate: 1.0, gamesInWindow: 4, totalGames: 4, currentStreak: 4, accountCreatedAt: new Date("2026-01-01") },
      { userId: "u2", name: "Older", attendanceRate: 1.0, gamesInWindow: 4, totalGames: 4, currentStreak: 4, accountCreatedAt: new Date("2025-01-01") },
    ];
    const result = rankAndCap(candidates, 10, 70);
    expect(result[0].name).toBe("Older");
    expect(result[1].name).toBe("Newer");
  });
});

// ─── confirmationDeadline ────────────────────────────────────────────────────

describe("confirmationDeadline", () => {
  it("calculates deadline N hours before game", () => {
    const game = new Date("2026-03-25T20:00:00Z");
    const deadline = confirmationDeadline(game, 48);
    expect(deadline).toEqual(new Date("2026-03-23T20:00:00Z"));
  });

  it("handles 0 hours (deadline = game time)", () => {
    const game = new Date("2026-03-25T20:00:00Z");
    const deadline = confirmationDeadline(game, 0);
    expect(deadline).toEqual(game);
  });
});
