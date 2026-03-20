import { describe, it, expect } from "vitest";
import { calculateAttendance } from "~/lib/attendance";

function makeSnapshot(teamOnePlayers: string[], teamTwoPlayers: string[]): string {
  return JSON.stringify([
    { team: "Team A", players: teamOnePlayers.map((name, i) => ({ name, order: i })) },
    { team: "Team B", players: teamTwoPlayers.map((name, i) => ({ name, order: i })) },
  ]);
}

function makeEntry(dateTime: string, teamOne: string[], teamTwo: string[], status = "played") {
  return {
    status,
    dateTime: new Date(dateTime),
    teamsSnapshot: makeSnapshot(teamOne, teamTwo),
  };
}

describe("calculateAttendance", () => {
  it("returns empty result for no history", () => {
    const result = calculateAttendance([]);
    expect(result.totalGames).toBe(0);
    expect(result.players).toHaveLength(0);
  });

  it("returns empty result when all games are cancelled", () => {
    const result = calculateAttendance([
      { status: "cancelled", dateTime: new Date("2026-01-01"), teamsSnapshot: makeSnapshot(["A"], ["B"]) },
    ]);
    expect(result.totalGames).toBe(0);
    expect(result.players).toHaveLength(0);
  });

  it("calculates 100% attendance for a player in all games", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice", "Bob"], ["Charlie"]),
      makeEntry("2026-01-08", ["Alice", "Bob"], ["Charlie"]),
    ]);
    expect(result.totalGames).toBe(2);
    const alice = result.players.find((p) => p.name === "Alice")!;
    expect(alice.gamesPlayed).toBe(2);
    expect(alice.attendanceRate).toBe(1);
    expect(alice.currentStreak).toBe(2);
  });

  it("calculates partial attendance correctly", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice", "Bob"], ["Charlie"]),
      makeEntry("2026-01-08", ["Alice"], ["Charlie"]),
      makeEntry("2026-01-15", ["Alice", "Bob"], ["Charlie"]),
    ]);
    expect(result.totalGames).toBe(3);

    const bob = result.players.find((p) => p.name === "Bob")!;
    expect(bob.gamesPlayed).toBe(2);
    expect(bob.attendanceRate).toBe(0.67);
    expect(bob.currentStreak).toBe(1); // only last game
  });

  it("calculates current streak correctly", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice"], ["Bob"]),
      makeEntry("2026-01-08", ["Alice"], ["Charlie"]), // Bob missed
      makeEntry("2026-01-15", ["Alice", "Bob"], ["Charlie"]),
      makeEntry("2026-01-22", ["Alice", "Bob"], ["Charlie"]),
    ]);

    const bob = result.players.find((p) => p.name === "Bob")!;
    expect(bob.currentStreak).toBe(2); // last 2 games

    const alice = result.players.find((p) => p.name === "Alice")!;
    expect(alice.currentStreak).toBe(4); // all games
  });

  it("streak resets to 0 when player missed the last game", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice", "Bob"], ["Charlie"]),
      makeEntry("2026-01-08", ["Alice"], ["Charlie"]), // Bob missed last game
    ]);

    const bob = result.players.find((p) => p.name === "Bob")!;
    expect(bob.currentStreak).toBe(0);
  });

  it("sets lastPlayed to the most recent game date", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice", "Bob"], ["Charlie"]),
      makeEntry("2026-01-08", ["Alice"], ["Charlie"]),
    ]);

    const bob = result.players.find((p) => p.name === "Bob")!;
    expect(bob.lastPlayed).toBe(new Date("2026-01-01").toISOString());

    const alice = result.players.find((p) => p.name === "Alice")!;
    expect(alice.lastPlayed).toBe(new Date("2026-01-08").toISOString());
  });

  it("skips entries with null teamsSnapshot", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice"], ["Bob"]),
      { status: "played", dateTime: new Date("2026-01-08"), teamsSnapshot: null },
    ]);
    expect(result.totalGames).toBe(1);
  });

  it("skips entries with malformed JSON in teamsSnapshot", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice"], ["Bob"]),
      { status: "played", dateTime: new Date("2026-01-08"), teamsSnapshot: "not json" },
    ]);
    expect(result.totalGames).toBe(1);
  });

  it("sorts players by attendance rate descending", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice", "Bob"], ["Charlie"]),
      makeEntry("2026-01-08", ["Alice"], ["Charlie"]),
      makeEntry("2026-01-15", ["Alice"], ["Charlie"]),
    ]);

    expect(result.players[0].name).toBe("Alice"); // 100%
    expect(result.players[1].name).toBe("Charlie"); // 100%
    expect(result.players[2].name).toBe("Bob"); // 33%
  });

  it("handles games sorted in reverse chronological order", () => {
    // Input is reverse-chronological — function should still sort correctly
    const result = calculateAttendance([
      makeEntry("2026-01-15", ["Alice"], ["Charlie"]),
      makeEntry("2026-01-01", ["Alice", "Bob"], ["Charlie"]),
      makeEntry("2026-01-08", ["Alice", "Bob"], ["Charlie"]),
    ]);

    const bob = result.players.find((p) => p.name === "Bob")!;
    // Bob played games 1 and 2 (chronologically), missed game 3
    expect(bob.gamesPlayed).toBe(2);
    expect(bob.currentStreak).toBe(0); // missed the last game
  });

  it("handles single game correctly", () => {
    const result = calculateAttendance([
      makeEntry("2026-03-01", ["Alice", "Bob"], ["Charlie", "Dave"]),
    ]);
    expect(result.totalGames).toBe(1);
    expect(result.players).toHaveLength(4);
    for (const p of result.players) {
      expect(p.gamesPlayed).toBe(1);
      expect(p.attendanceRate).toBe(1);
      expect(p.currentStreak).toBe(1);
    }
  });

  it("handles player appearing in different teams across games", () => {
    const result = calculateAttendance([
      makeEntry("2026-01-01", ["Alice"], ["Bob"]),
      makeEntry("2026-01-08", ["Bob"], ["Alice"]), // swapped teams
    ]);
    const alice = result.players.find((p) => p.name === "Alice")!;
    expect(alice.gamesPlayed).toBe(2);
    expect(alice.attendanceRate).toBe(1);
  });
});
