import { describe, it, expect } from "vitest";
import { recommendCrews } from "~/lib/crewRecommendation";
import { calculateLeaderboard, filterLeaderboardGames, type LeaderboardGame, type SeasonMember } from "~/lib/leaderboard";
import {
  authorizeSeasonRequest,
  requireSeasonAdmin,
  seasonAttendanceWindow,
  seasonCompetitiveWindow,
  seasonWindowsOverlapByDay,
  seasonWindowByDay,
  isSeasonCurrent,
} from "~/lib/seasonSetup.server";

function game(overrides: Partial<LeaderboardGame> = {}): LeaderboardGame {
  return {
    id: overrides.id ?? "game-1",
    dateTime: overrides.dateTime ?? new Date("2026-01-10T10:00:00.000Z"),
    status: overrides.status ?? "played",
    isFriendly: overrides.isFriendly ?? false,
    scoreOne: overrides.scoreOne ?? 1,
    scoreTwo: overrides.scoreTwo ?? 0,
    teams: overrides.teams ?? [{ name: "A", players: ["Alice"] }, { name: "B", players: ["Bob"] }],
  };
}

function member(overrides: Partial<SeasonMember> & { name: string }): SeasonMember {
  return {
    membershipId: overrides.membershipId ?? overrides.name,
    name: overrides.name,
    crewId: overrides.crewId ?? null,
    crewName: overrides.crewName ?? null,
    withdrawnAt: overrides.withdrawnAt ?? null,
  };
}

describe("recommendCrews edge cases", () => {
  it("breaks rating ties within a previous Crew by membership id", () => {
    const players = ["a", "b", "c", "d", "e", "f"].map((id) => ({
      membershipId: `m-${id}`,
      name: id.toUpperCase(),
      rating: 1000,
      gamesPlayed: 1,
      previousCrewId: Number(id.charCodeAt(0)) % 2 === 0 ? "crew-even" : "crew-odd",
    }));

    const result = recommendCrews(players, 2);

    expect(result.errors).toEqual([]);
    expect(result.crews.flatMap((crew) => crew.membershipIds)).toHaveLength(6);
  });

  it("splits an uneven roster across Crews with an extra slot", () => {
    const players = Array.from({ length: 7 }, (_, index) => ({
      membershipId: `m-${index}`,
      name: `P${index}`,
      rating: 1000 + index,
    }));

    const result = recommendCrews(players, 2);

    expect(result.errors).toEqual([]);
    expect(result.crews.map((crew) => crew.membershipIds.length).sort()).toEqual([3, 4]);
  });
});

describe("leaderboard edge cases", () => {
  it("treats an unparseable window bound as unbounded", () => {
    const result = calculateLeaderboard([game()], undefined, { startsAt: "not-a-date", endsAt: "also-bad" });
    expect(result.players).toHaveLength(2);
  });

  it("filters malformed lineups and blank player names", () => {
    const malformedLength = game({ id: "g1", teams: [{ name: "A", players: ["Alice"] }] as unknown as LeaderboardGame["teams"] });
    const blankName = game({ id: "g2", teams: [{ name: "A", players: ["  ", "Alice"] }, { name: "B", players: ["Bob"] }] });
    const good = game({ id: "g3" });

    const filtered = filterLeaderboardGames([malformedLength, blankName, good]);

    expect(filtered.map((entry) => entry.id)).toEqual(["g2", "g3"]);
  });

  it("collapses duplicate member names into one player row", () => {
    const members = [
      member({ membershipId: "m1", name: "Alice" }),
      member({ membershipId: "m2", name: "alice" }),
      member({ membershipId: "m3", name: "Bob" }),
    ];
    const result = calculateLeaderboard([game()], members);
    expect(result.players.map((player) => player.name.toLowerCase())).toEqual(["alice", "bob"]);
  });

  it("breaks a Crew tie on the Crew name", () => {
    const members = [
      member({ membershipId: "alice", name: "Alice", crewId: "alpha", crewName: "Alpha" }),
      member({ membershipId: "bob", name: "Bob", crewId: "beta", crewName: "Beta" }),
      member({ membershipId: "carol", name: "Carol", crewId: "beta2", crewName: "Zeta" }),
      member({ membershipId: "dave", name: "Dave", crewId: "alpha2", crewName: "Omega" }),
    ];
    const games = [
      game({ id: "g1", teams: [{ name: "A", players: ["Alice"] }, { name: "B", players: ["Carol"] }] }),
      game({ id: "g2", teams: [{ name: "A", players: ["Bob"] }, { name: "B", players: ["Dave"] }] }),
    ];

    const result = calculateLeaderboard(games, members);

    expect(result.crews.map((crew) => crew.name)).toEqual(["Alpha", "Beta", "Omega", "Zeta"]);
    expect(result.crews[0].points).toBe(result.crews[1].points);
  });
});

describe("seasonSetup authorization edge cases", () => {
  it("denies a request when the Season is missing", async () => {
    const request = new Request("http://localhost/api/events/test");
    const authz = await authorizeSeasonRequest(null, null, request);
    const required = await requireSeasonAdmin(null, null, request);
    expect(authz).toMatchObject({ allowed: false, isAdmin: false, isOwner: false });
    expect(required).toMatchObject({ allowed: false, isAdmin: false });
  });
});

describe("season window coexistence by day", () => {
  const window = (opens: string, closes: string) => ({
    registrationOpensAt: new Date(opens),
    registrationClosesAt: new Date(closes),
  });

  it("treats a shared boundary day as adjacency, not overlap", () => {
    expect(seasonWindowsOverlapByDay(
      window("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z"),
      window("2026-01-31T00:00:00.000Z", "2026-02-28T00:00:00.000Z"),
    )).toBe(false);
  });

  it("ignores time-of-day on the boundary day", () => {
    expect(seasonWindowsOverlapByDay(
      window("2026-01-01T23:00:00.000Z", "2026-01-31T01:00:00.000Z"),
      window("2026-01-31T15:00:00.000Z", "2026-02-28T00:00:00.000Z"),
    )).toBe(false);
  });

  it("detects a shared month as overlap", () => {
    expect(seasonWindowsOverlapByDay(
      window("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z"),
      window("2026-01-15T00:00:00.000Z", "2026-02-15T00:00:00.000Z"),
    )).toBe(true);
  });

  it("marks the window containing today as current, except when cancelled", () => {
    const now = new Date("2026-03-10T12:00:00.000Z");
    expect(isSeasonCurrent({ status: "registration", ...window("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z") }, now)).toBe(true);
    expect(isSeasonCurrent({ status: "registration", ...window("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z") }, now)).toBe(false);
    expect(isSeasonCurrent({ status: "cancelled", ...window("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z") }, now)).toBe(false);
  });
});

describe("day-granular competitive window", () => {
  const window = (opens: string, closes: string) => ({
    registrationOpensAt: new Date(opens),
    registrationClosesAt: new Date(closes),
  });

  it("spans full opening and closing calendar days, ignoring time-of-day", () => {
    const { startsAt, endsAt } = seasonWindowByDay(window("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z"));
    expect(startsAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });

  it("caps the window at completion/cancellation when the Season ends early", () => {
    const completedAt = new Date("2026-01-20T12:00:00.000Z");
    const capped = seasonCompetitiveWindow({ ...window("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z"), completedAt, cancelledAt: null });
    expect(capped.endsAt).toEqual(completedAt);
    const cancelled = seasonCompetitiveWindow({ ...window("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z"), completedAt: null, cancelledAt: completedAt });
    expect(cancelled.endsAt).toEqual(completedAt);
  });

  it("attendance window runs from the opening day to now, never past the close of day", () => {
    const season = window("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z");
    const mid = seasonAttendanceWindow(season, new Date("2026-01-15T09:00:00.000Z"));
    expect(mid.gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(mid.lte.toISOString()).toBe("2026-01-15T09:00:00.000Z");
    const after = seasonAttendanceWindow(season, new Date("2026-03-01T00:00:00.000Z"));
    expect(after.lte.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });
});
