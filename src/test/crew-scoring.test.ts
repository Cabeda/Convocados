import { describe, expect, it } from "vitest";
import { calculateLeaderboard, type LeaderboardGame, type SeasonMember } from "~/lib/leaderboard";

/**
 * Spec: docs/friendly-competition-pilot.md
 *
 * Crew scoring (season-v1):
 * - A member earns 3 for a win, 1 for a draw, 0 for a loss, from THEIR OWN
 *   match side — even when crewmates play on the opposite side.
 * - A Crew's per-game score is the arithmetic mean of every member who
 *   participated in that game. A game with no participant is not a
 *   represented round and contributes nothing.
 * - A Crew's total counts its best six per-game scores from the eight
 *   eligible games. Missing represented games count as nothing (they are
 *   simply absent from the best-six sum); crews with fewer than six
 *   represented games remain ranked.
 * - Ranking is on the unrounded best-six total. Ties break on the total
 *   across ALL represented games (including dropped scores), then by name.
 */

function game(
  id: string,
  dateTime: string,
  scoreOne: number | null,
  scoreTwo: number | null,
  teamOne: string[],
  teamTwo: string[],
  options: Partial<Pick<LeaderboardGame, "status" | "isFriendly">> = {},
): LeaderboardGame {
  return {
    id,
    dateTime: new Date(dateTime),
    status: options.status ?? "played",
    isFriendly: options.isFriendly ?? false,
    scoreOne,
    scoreTwo,
    teams: [
      { name: "Team One", players: teamOne },
      { name: "Team Two", players: teamTwo },
    ],
  };
}

function member(id: string, name: string, crewId: string, crewName: string): SeasonMember {
  return { membershipId: id, name, crewId, crewName, joinedAt: new Date("2025-01-01"), withdrawnAt: null };
}

function crewByName(result: ReturnType<typeof calculateLeaderboard>, name: string) {
  const crew = result.crews.find((entry) => entry.name === name);
  if (!crew) throw new Error(`Crew ${name} not found`);
  return crew;
}

describe("crew scoring (season-v1 mean-of-members)", () => {
  it("scores a Crew as the mean of its participating members' own-side points", () => {
    const members = [
      member("m-a", "Alice", "red", "Red"),
      member("m-b", "Bob", "red", "Red"),
    ];
    // Alice wins (3), Bob loses (0) on opposite sides → Red mean = 1.5
    const result = calculateLeaderboard(
      [game("g1", "2026-01-01", 3, 1, ["Alice"], ["Bob"])],
      members,
    );
    const red = crewByName(result, "Red");
    expect(red.points).toBeCloseTo(1.5, 5);
    expect(red.roundsRepresented).toBe(1);
    expect(red.roundsCounted).toBe(1);
  });

  it("counts a member's own-side result even when crewmates are opponents", () => {
    const members = [
      member("m-a", "Alice", "red", "Red"),
      member("m-b", "Bob", "red", "Red"),
      member("m-c", "Carol", "red", "Red"),
    ];
    // Alice+Bob win (3 each), Carol loses (0) → Red mean = (3+3+0)/3 = 2
    const result = calculateLeaderboard(
      [game("g1", "2026-01-01", 2, 0, ["Alice", "Bob"], ["Carol"])],
      members,
    );
    expect(crewByName(result, "Red").points).toBeCloseTo(2, 5);
  });

  it("sums only the best six of eight eligible per-game scores", () => {
    const members = [member("m-a", "Alice", "red", "Red")];
    // 8 games: six wins (3) and two losses (0). Best six = 6*3 = 18.
    const games = [
      game("g1", "2026-01-01", 1, 0, ["Alice"], ["X"]),
      game("g2", "2026-01-02", 1, 0, ["Alice"], ["X"]),
      game("g3", "2026-01-03", 1, 0, ["Alice"], ["X"]),
      game("g4", "2026-01-04", 1, 0, ["Alice"], ["X"]),
      game("g5", "2026-01-05", 1, 0, ["Alice"], ["X"]),
      game("g6", "2026-01-06", 1, 0, ["Alice"], ["X"]),
      game("g7", "2026-01-07", 0, 1, ["Alice"], ["X"]),
      game("g8", "2026-01-08", 0, 1, ["Alice"], ["X"]),
    ];
    const red = crewByName(calculateLeaderboard(games, members), "Red");
    expect(red.points).toBeCloseTo(18, 5);
    expect(red.roundsRepresented).toBe(8);
    expect(red.roundsCounted).toBe(6);
  });

  it("keeps a Crew ranked with fewer than six represented games", () => {
    const members = [member("m-a", "Alice", "red", "Red")];
    const games = [
      game("g1", "2026-01-01", 1, 0, ["Alice"], ["X"]),
      game("g2", "2026-01-02", 1, 0, ["Alice"], ["X"]),
    ];
    const red = crewByName(calculateLeaderboard(games, members), "Red");
    expect(red.points).toBeCloseTo(6, 5);
    expect(red.roundsRepresented).toBe(2);
    expect(red.roundsCounted).toBe(2);
  });

  it("breaks a best-six tie using the total across all represented games", () => {
    const members = [
      member("m-a", "Alice", "red", "Red"),
      member("m-b", "Bob", "blue", "Blue"),
    ];
    // Both crews have best-six total 18 (six wins). In the two dropped games
    // Alice (Red) draws while Bob (Blue) loses, so Red's all-games total (20)
    // beats Blue's (18) and Red ranks first on the tie-break.
    const games = [
      game("g1", "2026-01-01", 1, 0, ["Alice", "Bob"], ["X"]),
      game("g2", "2026-01-02", 1, 0, ["Alice", "Bob"], ["X"]),
      game("g3", "2026-01-03", 1, 0, ["Alice", "Bob"], ["X"]),
      game("g4", "2026-01-04", 1, 0, ["Alice", "Bob"], ["X"]),
      game("g5", "2026-01-05", 1, 0, ["Alice", "Bob"], ["X"]),
      game("g6", "2026-01-06", 1, 0, ["Alice", "Bob"], ["X"]),
      // dropped seventh/eighth: Alice draws (Team One), Bob loses (Team Two)
      game("g7", "2026-01-07", 1, 1, ["Alice"], ["Y"]),
      game("g8", "2026-01-08", 2, 0, ["Alice"], ["Bob"]),
    ];
    const result = calculateLeaderboard(games, members);
    expect(result.crews.map((crew) => crew.name)).toEqual(["Red", "Blue"]);
    expect(result.crews[0]).toMatchObject({ name: "Red", rank: 1 });
    expect(result.crews[1]).toMatchObject({ name: "Blue", rank: 2 });
  });

  it("exposes per-game scores marking which count toward the best six", () => {
    const members = [member("m-a", "Alice", "red", "Red")];
    const games = [
      game("g1", "2026-01-01", 1, 0, ["Alice"], ["X"]),
      game("g2", "2026-01-02", 0, 1, ["Alice"], ["X"]),
    ];
    const red = crewByName(calculateLeaderboard(games, members), "Red");
    expect(red.gameScores).toHaveLength(2);
    expect(red.gameScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gameId: "g1", score: 3, counted: true }),
        expect.objectContaining({ gameId: "g2", score: 0, counted: true }),
      ]),
    );
  });

  it("ignores a Crew with no participating member in any eligible game", () => {
    const members = [
      member("m-a", "Alice", "red", "Red"),
      member("m-ghost", "Ghost", "blue", "Blue"),
    ];
    const result = calculateLeaderboard(
      [game("g1", "2026-01-01", 1, 0, ["Alice"], ["X"])],
      members,
    );
    expect(result.crews.map((crew) => crew.name)).toEqual(["Red"]);
  });
});
