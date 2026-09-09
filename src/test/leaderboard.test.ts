import { describe, expect, it } from "vitest";
import { calculateLeaderboard, filterLeaderboardGames, type LeaderboardGame, type SeasonMember } from "~/lib/leaderboard";

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
      { name: "Ninjas", players: teamOne },
      { name: "Gunas", players: teamTwo },
    ],
  };
}

describe("calculateLeaderboard", () => {
  it("awards football points and aggregates player match statistics", () => {
    const result = calculateLeaderboard([
      game("g1", "2026-01-01", 3, 1, ["Alice", "Bob"], ["Carol"]),
      game("g2", "2026-01-08", 2, 2, ["Carol"], ["Alice"]),
      game("friendly", "2026-01-15", 8, 0, ["Alice"], ["Carol"], { isFriendly: true }),
      game("cancelled", "2026-01-22", 4, 0, ["Alice"], ["Carol"], { status: "cancelled" }),
      game("incomplete", "2026-01-29", null, null, ["Alice"], ["Carol"]),
    ]);

    expect(result.gamesCount).toBe(2);
    expect(result.players.map((player) => player.name)).toEqual(["Alice", "Bob", "Carol"]);
    expect(result.players[0]).toMatchObject({
      rank: 1,
      name: "Alice",
      points: 4,
      played: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      goalsFor: 5,
      goalsAgainst: 3,
      goalDifference: 2,
    });
    expect(result.players[2]).toMatchObject({ points: 1, played: 2, wins: 0, draws: 1, losses: 1 });
  });

  it("builds Crew standings from effective Season members and ranks ties deterministically", () => {
    const members: SeasonMember[] = [
      { membershipId: "m-alice", name: "Alice", crewId: "red", crewName: "Red", joinedAt: new Date("2025-12-01"), withdrawnAt: null },
      { membershipId: "m-bob", name: "Bob", crewId: "red", crewName: "Red", joinedAt: new Date("2025-12-01"), withdrawnAt: null },
      { membershipId: "m-carol", name: "Carol", crewId: "blue", crewName: "Blue", joinedAt: new Date("2025-12-01"), withdrawnAt: null },
    ];

    const result = calculateLeaderboard([
      game("g1", "2026-01-01", 3, 1, ["Alice", "Bob"], ["Carol"]),
      game("g2", "2026-01-08", 2, 2, ["Carol"], ["Alice"]),
    ], members);

    expect(result.crews.map((crew) => crew.name)).toEqual(["Red", "Blue"]);
    // season-v1: Crew score is the mean of participating members' own-side
    // points, summed over the best six games. Red: g1 (Alice+Bob win) mean 3,
    // g2 (Alice draw) mean 1 → 4. Blue: g1 (Carol loss) mean 0, g2 (Carol
    // draw) mean 1 → 1.
    expect(result.crews[0]).toMatchObject({ name: "Red", points: 4, roundsRepresented: 2, roundsCounted: 2 });
    expect(result.crews[1]).toMatchObject({ name: "Blue", points: 1, roundsRepresented: 2, roundsCounted: 2 });
  });

  it("does not count a member before joining or after withdrawing", () => {
    const members: SeasonMember[] = [
      { membershipId: "m-alice", name: "Alice", crewId: "red", crewName: "Red", joinedAt: new Date("2026-01-05"), withdrawnAt: new Date("2026-01-15") },
    ];
    const result = calculateLeaderboard([
      game("before", "2026-01-01", 3, 0, ["Alice"], ["Guest"]),
      game("during", "2026-01-10", 3, 0, ["Alice"], ["Guest"]),
      game("after", "2026-01-20", 3, 0, ["Alice"], ["Guest"]),
    ], members);

    expect(result.gamesCount).toBe(3);
    expect(result.players.find((player) => player.name === "Alice")).toMatchObject({ played: 1, points: 3 });
    expect(result.crews[0]).toMatchObject({ roundsRepresented: 1, points: 3 });
  });

  it("supports an explicit season window and keeps zero-appearance members visible", () => {
    const members: SeasonMember[] = [
      { membershipId: "m-alice", name: "Alice", crewId: "red", crewName: "Red", joinedAt: new Date("2026-01-01"), withdrawnAt: null },
      { membershipId: "m-bob", name: "Bob", crewId: "blue", crewName: "Blue", joinedAt: new Date("2026-01-01"), withdrawnAt: null },
    ];
    const result = calculateLeaderboard(
      [game("g1", "2026-01-01", 1, 0, ["Alice"], ["Guest"]), game("g2", "2026-02-01", 0, 1, ["Alice"], ["Guest"])],
      members,
      { startsAt: new Date("2026-01-15"), endsAt: new Date("2026-03-01") },
    );

    expect(result.gamesCount).toBe(1);
    expect(result.players.find((player) => player.name === "Bob")).toMatchObject({ played: 0, points: 0 });
  });
});


  it("skips malformed matches with the same player on both sides", () => {
    const result = calculateLeaderboard([
      game("duplicate", "2026-01-01", 3, 0, ["Alice"], ["alice"]),
    ]);

    expect(result.gamesCount).toBe(0);
    expect(result.players).toEqual([]);
  });

  it("skips negative scores as malformed matches", () => {
    const result = calculateLeaderboard([
      game("negative", "2026-01-01", -1, 2, ["Alice"], ["Bob"]),
    ]);

    expect(result.gamesCount).toBe(0);
    expect(result.players).toEqual([]);
  });

  it("uses the same qualifying records for scope selection and standings", () => {
    const eligible = filterLeaderboardGames([
      game("played", "2026-01-01", 1, 0, ["Alice"], ["Bob"]),
      game("friendly", "2026-02-01", 9, 0, ["Alice"], ["Bob"], { isFriendly: true }),
      game("cancelled", "2026-03-01", 9, 0, ["Alice"], ["Bob"], { status: "cancelled" }),
      game("incomplete", "2026-04-01", null, null, ["Alice"], ["Bob"]),
      game("negative", "2026-05-01", -1, 0, ["Alice"], ["Bob"]),
    ]);

    expect(eligible.map((match) => match.id)).toEqual(["played"]);
  });


  it("keeps an explicit empty Season membership scope empty", () => {
    const result = calculateLeaderboard([
      game("season-game", "2026-01-01", 3, 0, ["Alice"], ["Bob"]),
    ], []);

    expect(result.gamesCount).toBe(1);
    expect(result.players).toEqual([]);
  });

  it("skips matches with duplicate players on one side", () => {
    const result = calculateLeaderboard([
      game("same-side-duplicate", "2026-01-01", 3, 0, ["Alice", "alice"], ["Bob"]),
    ]);

    expect(result.gamesCount).toBe(0);
    expect(result.players).toEqual([]);
  });