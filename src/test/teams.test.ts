import { describe, expect, it } from "vitest";
import { movePlayer, placePlayer, setFormation, normalizeSlots } from "~/lib/teams";
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

describe("placePlayer", () => {
  function withSlots(): Imatch[] {
    return [
      {
        team: "Blue",
        formation: "2-2",
        players: [
          { name: "Alice", order: 0, slot: 0 },
          { name: "Carol", order: 1, slot: 1 },
        ],
      },
      {
        team: "Red",
        formation: "2-2",
        players: [
          { name: "Bob", order: 0, slot: 0 },
          { name: "Dan", order: 1, slot: 1 },
        ],
      },
    ];
  }

  it("swaps two players' slots within the same team", () => {
    const result = placePlayer(withSlots(), "Alice", "Blue", "Blue", 1);
    const blue = result.find((m) => m.team === "Blue")!;
    expect(blue.players.find((p) => p.name === "Alice")!.slot).toBe(1);
    expect(blue.players.find((p) => p.name === "Carol")!.slot).toBe(0);
  });

  it("moves a player into an empty slot in the same team", () => {
    const matches = withSlots();
    matches[0].players[1].slot = null;
    const result = placePlayer(matches, "Carol", "Blue", "Blue", 1);
    const blue = result.find((m) => m.team === "Blue")!;
    expect(blue.players.find((p) => p.name === "Carol")!.slot).toBe(1);
  });

  it("swaps a player into a slot on the other team and sends the occupant back", () => {
    const result = placePlayer(withSlots(), "Alice", "Blue", "Red", 0);
    const blue = result.find((m) => m.team === "Blue")!;
    const red = result.find((m) => m.team === "Red")!;

    expect(blue.players.map((p) => p.name)).toEqual(["Carol", "Bob"]);
    expect(blue.players.find((p) => p.name === "Bob")!.slot).toBe(0);
    expect(red.players.map((p) => p.name)).toEqual(["Dan", "Alice"]);
    expect(red.players.find((p) => p.name === "Alice")!.slot).toBe(0);
  });

  it("moves a player onto the other team without an occupant", () => {
    const matches = withSlots();
    matches[1].players = [{ name: "Bob", order: 0, slot: 0 }];
    const result = placePlayer(matches, "Alice", "Blue", "Red", 1);
    const red = result.find((m) => m.team === "Red")!;
    expect(red.players.find((p) => p.name === "Alice")!.slot).toBe(1);
    expect(result.find((m) => m.team === "Blue")!.players.map((p) => p.name)).toEqual(["Carol"]);
  });

  it("returns the same reference for an unknown player", () => {
    const matches = withSlots();
    expect(placePlayer(matches, "Nobody", "Blue", "Red", 0)).toBe(matches);
  });
});

describe("setFormation", () => {
  it("reassigns players to sequential slots and sets the formation id", () => {
    const matches: Imatch[] = [
      {
        team: "Blue",
        players: [
          { name: "Alice", order: 0, slot: 2 },
          { name: "Carol", order: 1, slot: 0 },
          { name: "Eve", order: 2, slot: null },
        ],
      },
    ];
    const result = setFormation(matches, "Blue", "3-1", 4);
    const blue = result[0];
    expect(blue.formation).toBe("3-1");
    expect(blue.players.find((p) => p.name === "Carol")!.slot).toBe(0);
    expect(blue.players.find((p) => p.name === "Alice")!.slot).toBe(1);
    expect(blue.players.find((p) => p.name === "Eve")!.slot).toBe(2);
  });

  it("unplaces players beyond the new slot count", () => {
    const matches: Imatch[] = [
      {
        team: "Blue",
        players: [
          { name: "A", order: 0, slot: 0 },
          { name: "B", order: 1, slot: 1 },
          { name: "C", order: 2, slot: 2 },
        ],
      },
    ];
    const result = setFormation(matches, "Blue", "2", 2);
    expect(result[0].players.find((p) => p.name === "C")!.slot).toBeNull();
  });
});

describe("normalizeSlots", () => {
  it("keeps unique valid slots and fills the rest by order", () => {
    const result = normalizeSlots(
      [
        { name: "A", order: 0, slot: 2 },
        { name: "B", order: 1, slot: 2 },
        { name: "C", order: 2 },
      ],
      3,
    );
    expect(result.find((p) => p.name === "A")!.slot).toBe(2);
    expect(result.find((p) => p.name === "B")!.slot).toBe(0);
    expect(result.find((p) => p.name === "C")!.slot).toBe(1);
  });

  it("does not mutate the input", () => {
    const input = [{ name: "A", order: 0, slot: 5 }];
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeSlots(input, 2);
    expect(input).toEqual(snapshot);
  });
});
