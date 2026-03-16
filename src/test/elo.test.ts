import { describe, it, expect } from "vitest";
import { balanceTeams } from "~/lib/elo.server";

// We can't easily test processGame/recalculateAllRatings without a DB,
// but we can test the pure functions: ELO math is embedded in processGame,
// so we test the expected-score formula and balanceTeams directly.

describe("ELO expected score", () => {
  // Replicate the formula used in elo.server.ts
  const expectedScore = (a: number, b: number) => 1 / (1 + Math.pow(10, (b - a) / 400));

  it("equal ratings give 0.5 expected score", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
  });

  it("higher-rated player has > 0.5 expected score", () => {
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
  });

  it("lower-rated player has < 0.5 expected score", () => {
    expect(expectedScore(800, 1000)).toBeLessThan(0.5);
  });

  it("400-point difference gives ~0.91 expected score", () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 2);
  });

  it("is symmetric: E(a,b) + E(b,a) = 1", () => {
    const a = expectedScore(1100, 900);
    const b = expectedScore(900, 1100);
    expect(a + b).toBeCloseTo(1);
  });
});

describe("balanceTeams", () => {
  const teamNames: [string, string] = ["Ninjas", "Gunas"];

  it("assigns all players to two teams", () => {
    const players = [
      { name: "A", rating: 1200 },
      { name: "B", rating: 1100 },
      { name: "C", rating: 1000 },
      { name: "D", rating: 900 },
    ];
    const result = balanceTeams(players, teamNames);
    const all = result.flatMap((t) => t.players.map((p) => p.name)).sort();
    expect(all).toEqual(["A", "B", "C", "D"]);
  });

  it("returns correct team names", () => {
    const players = [{ name: "A", rating: 1000 }, { name: "B", rating: 1000 }];
    const result = balanceTeams(players, teamNames);
    expect(result.map((t) => t.team)).toEqual(teamNames);
  });

  it("balances teams by ELO — best and worst on same team", () => {
    const players = [
      { name: "Best", rating: 1400 },
      { name: "Good", rating: 1200 },
      { name: "Mid", rating: 1000 },
      { name: "Low", rating: 800 },
    ];
    const result = balanceTeams(players, teamNames);
    // Snake draft: Best→T1, Good→T2, Mid→T2, Low→T1
    // T1: Best(1400) + Low(800) = 2200
    // T2: Good(1200) + Mid(1000) = 2200
    const t1Names = result[0].players.map((p) => p.name);
    const t2Names = result[1].players.map((p) => p.name);
    expect(t1Names).toContain("Best");
    expect(t1Names).toContain("Low");
    expect(t2Names).toContain("Good");
    expect(t2Names).toContain("Mid");
  });

  it("minimizes ELO difference between teams", () => {
    const players = [
      { name: "A", rating: 1300 },
      { name: "B", rating: 1200 },
      { name: "C", rating: 1100 },
      { name: "D", rating: 1000 },
      { name: "E", rating: 900 },
      { name: "F", rating: 800 },
    ];
    const result = balanceTeams(players, teamNames);
    const sum = (t: { players: { name: string }[] }) =>
      t.players.reduce((s, p) => s + players.find((x) => x.name === p.name)!.rating, 0);
    const diff = Math.abs(sum(result[0]) - sum(result[1]));
    // With snake draft, difference should be small
    expect(diff).toBeLessThanOrEqual(200);
  });

  it("handles odd number of players", () => {
    const players = [
      { name: "A", rating: 1200 },
      { name: "B", rating: 1100 },
      { name: "C", rating: 1000 },
    ];
    const result = balanceTeams(players, teamNames);
    const sizes = result.map((t) => t.players.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it("handles equal ratings", () => {
    const players = [
      { name: "A", rating: 1000 },
      { name: "B", rating: 1000 },
      { name: "C", rating: 1000 },
      { name: "D", rating: 1000 },
    ];
    const result = balanceTeams(players, teamNames);
    expect(result[0].players).toHaveLength(2);
    expect(result[1].players).toHaveLength(2);
  });

  it("assigns correct order values", () => {
    const players = [
      { name: "A", rating: 1200 },
      { name: "B", rating: 1100 },
      { name: "C", rating: 1000 },
      { name: "D", rating: 900 },
    ];
    const result = balanceTeams(players, teamNames);
    for (const team of result) {
      team.players.forEach((p, i) => {
        expect(p.order).toBe(i);
      });
    }
  });
});
