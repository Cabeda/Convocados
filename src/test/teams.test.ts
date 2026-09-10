import { describe, expect, it } from "vitest";
import { movePlayer } from "~/lib/teams";
import type { Imatch } from "~/lib/random";

function makeMatches(): Imatch[] {
  return [
    { team: "Blue", players: [{ name: "Alice", order: 0 }, { name: "Carol", order: 1 }] },
    { team: "Red", players: [{ name: "Bob", order: 0 }] },
  ];
}

describe("movePlayer", () => {
  it("moves a player from one team to another and reindexes order", () => {
    const result = movePlayer(makeMatches(), "Alice", "Blue", "Red");

    const blue = result.find((m) => m.team === "Blue")!;
    const red = result.find((m) => m.team === "Red")!;

    expect(blue.players.map((p) => p.name)).toEqual(["Carol"]);
    expect(blue.players.map((p) => p.order)).toEqual([0]);
    expect(red.players.map((p) => p.name)).toEqual(["Bob", "Alice"]);
    expect(red.players.map((p) => p.order)).toEqual([0, 1]);
  });

  it("returns the same reference when the source and destination team match", () => {
    const matches = makeMatches();
    expect(movePlayer(matches, "Alice", "Blue", "Blue")).toBe(matches);
  });

  it("returns the same reference when the player is not on the source team", () => {
    const matches = makeMatches();
    expect(movePlayer(matches, "Nobody", "Blue", "Red")).toBe(matches);
  });

  it("returns the same reference when the source team does not exist", () => {
    const matches = makeMatches();
    expect(movePlayer(matches, "Alice", "Green", "Red")).toBe(matches);
  });

  it("returns the same reference when the destination team does not exist", () => {
    const matches = makeMatches();
    expect(movePlayer(matches, "Alice", "Blue", "Green")).toBe(matches);
  });

  it("does not mutate the original matches", () => {
    const matches = makeMatches();
    const snapshot = JSON.parse(JSON.stringify(matches));

    movePlayer(matches, "Alice", "Blue", "Red");

    expect(matches).toEqual(snapshot);
  });
});
