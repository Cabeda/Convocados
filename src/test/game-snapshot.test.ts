import { describe, it, expect } from "vitest";
import { parseTeamsSnapshot, toLeaderboardGame } from "~/lib/gameSnapshot";

const valid = JSON.stringify([
  { team: "Ninjas", players: [{ name: "Alice" }, { name: "Bob" }] },
  { team: "Gunas", players: [{ name: "Cara" }, { name: "Dan" }] },
]);

describe("gameSnapshot", () => {
  describe("parseTeamsSnapshot", () => {
    it("parses a valid two-team snapshot", () => {
      expect(parseTeamsSnapshot(valid)).toEqual([
        { name: "Ninjas", players: ["Alice", "Bob"] },
        { name: "Gunas", players: ["Cara", "Dan"] },
      ]);
    });

    it("returns null for null or malformed input", () => {
      expect(parseTeamsSnapshot(null)).toBeNull();
      expect(parseTeamsSnapshot("not json")).toBeNull();
      expect(parseTeamsSnapshot(JSON.stringify([{ team: "Only", players: [{ name: "A" }] }]))).toBeNull();
    });

    it("rejects a snapshot with an empty team or player name", () => {
      expect(
        parseTeamsSnapshot(
          JSON.stringify([
            { team: "  ", players: [{ name: "A" }] },
            { team: "Gunas", players: [{ name: "B" }] },
          ]),
        ),
      ).toBeNull();
      expect(
        parseTeamsSnapshot(
          JSON.stringify([
            { team: "Ninjas", players: [{ name: "  " }] },
            { team: "Gunas", players: [{ name: "B" }] },
          ]),
        ),
      ).toBeNull();
    });

    it("rejects a team with no players", () => {
      expect(
        parseTeamsSnapshot(
          JSON.stringify([
            { team: "Ninjas", players: [] },
            { team: "Gunas", players: [{ name: "B" }] },
          ]),
        ),
      ).toBeNull();
    });
  });

  describe("toLeaderboardGame", () => {
    const row = {
      id: "g1",
      dateTime: new Date("2026-01-01T10:00:00Z"),
      status: "played",
      isFriendly: false,
      scoreOne: 3,
      scoreTwo: 2,
      teamsSnapshot: valid,
    };

    it("maps a history row to a replay game", () => {
      expect(toLeaderboardGame(row)).toMatchObject({
        id: "g1",
        status: "played",
        scoreOne: 3,
        scoreTwo: 2,
        teams: [
          { name: "Ninjas", players: ["Alice", "Bob"] },
          { name: "Gunas", players: ["Cara", "Dan"] },
        ],
      });
    });

    it("returns null when the snapshot is unusable", () => {
      expect(toLeaderboardGame({ ...row, teamsSnapshot: null })).toBeNull();
    });
  });
});
