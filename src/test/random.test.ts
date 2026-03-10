import { describe, it, expect } from "vitest";
import { Randomize } from "~/lib/random";

describe("Randomize", () => {
  const teams = ["Ninjas", "Gunas"];

  it("distributes all players across teams", () => {
    const players = ["Alice", "Bob", "Carlos", "Diana", "Eve", "Frank"];
    const result = Randomize(players, teams);
    const allAssigned = result.flatMap((m) => m.players.map((p) => p.name));
    expect(allAssigned.sort()).toEqual(players.sort());
  });

  it("returns one entry per team", () => {
    const result = Randomize(["A", "B"], teams);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.team)).toEqual(teams);
  });

  it("balances teams evenly for even player count", () => {
    const result = Randomize(["A", "B", "C", "D"], teams);
    expect(result[0].players).toHaveLength(2);
    expect(result[1].players).toHaveLength(2);
  });

  it("handles odd player count — one team gets extra", () => {
    const result = Randomize(["A", "B", "C"], teams);
    const sizes = result.map((m) => m.players.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it("assigns correct order values", () => {
    const result = Randomize(["A", "B", "C", "D"], teams);
    for (const match of result) {
      match.players.forEach((p, i) => expect(p.order).toBe(i));
    }
  });

  it("handles 2 players", () => {
    const result = Randomize(["A", "B"], teams);
    expect(result.flatMap((m) => m.players)).toHaveLength(2);
  });

  it("handles many players", () => {
    const players = Array.from({ length: 20 }, (_, i) => `Player${i}`);
    const result = Randomize(players, teams);
    expect(result.flatMap((m) => m.players)).toHaveLength(20);
  });

  it("works with more than 2 teams", () => {
    const result = Randomize(["A", "B", "C"], ["T1", "T2", "T3"]);
    expect(result).toHaveLength(3);
    expect(result.flatMap((m) => m.players)).toHaveLength(3);
  });

  it("produces different results across runs (shuffle is random)", () => {
    const players = Array.from({ length: 10 }, (_, i) => `P${i}`);
    const runs = new Set(
      Array.from({ length: 10 }, () =>
        Randomize(players, teams)
          .flatMap((m) => m.players)
          .map((p) => p.name)
          .join(",")
      )
    );
    // With 10 players, probability of all 10 runs being identical is astronomically low
    expect(runs.size).toBeGreaterThan(1);
  });
});
