import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET as getLeaderboard } from "~/pages/api/events/[id]/history/leaderboard/index";

function context(eventId: string, query = "") {
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/history/leaderboard${query}`),
  } as any;
}

describe("GET /api/events/:id/history/leaderboard", () => {
  beforeEach(async () => {
    await prisma.crewProposalMember.deleteMany();
    await prisma.crewProposal.deleteMany();
    await prisma.seasonMembership.deleteMany();
    await prisma.crew.deleteMany();
    await prisma.season.deleteMany();
    await prisma.gameHistory.deleteMany();
    await prisma.eventPlayer.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns player and Crew football standings for the selected Season", async () => {
    const event = await prisma.event.create({ data: { title: "League", location: "Pitch", dateTime: new Date("2026-02-01") } });
    const alice = await prisma.user.create({ data: { id: "leader-alice", name: "Alice", email: "leader-alice@test.com" } });
    const bob = await prisma.user.create({ data: { id: "leader-bob", name: "Bob", email: "leader-bob@test.com" } });
    const alicePlayer = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: alice.id } });
    const bobPlayer = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Bob", userId: bob.id } });
    const season = await prisma.season.create({
      data: {
        eventId: event.id,
        name: "Winter League",
        status: "completed",
        registrationOpensAt: new Date("2025-12-01"),
        registrationClosesAt: new Date("2025-12-31"),
        startsAt: new Date("2026-01-01"),
        completedAt: new Date("2026-01-31"),
      },
    });
    const red = await prisma.crew.create({ data: { seasonId: season.id, name: "Red", sortOrder: 0 } });
    const blue = await prisma.crew.create({ data: { seasonId: season.id, name: "Blue", sortOrder: 1 } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: alicePlayer.id, userId: alice.id, crewId: red.id, joinedAt: new Date("2025-12-01") } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: bobPlayer.id, userId: bob.id, crewId: blue.id, joinedAt: new Date("2025-12-01") } });
    const snapshot = JSON.stringify([
      { team: "Ninjas", players: [{ name: "Alice", order: 0 }] },
      { team: "Gunas", players: [{ name: "Bob", order: 0 }] },
    ]);
    await prisma.gameHistory.createMany({
      data: [
        { eventId: event.id, dateTime: new Date("2026-01-05"), status: "played", scoreOne: 3, scoreTwo: 1, teamOneName: "Ninjas", teamTwoName: "Gunas", teamsSnapshot: snapshot },
        { eventId: event.id, dateTime: new Date("2026-01-12"), status: "played", scoreOne: 2, scoreTwo: 2, teamOneName: "Ninjas", teamTwoName: "Gunas", teamsSnapshot: snapshot },
      ],
    });

    const response = await getLeaderboard(context(event.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toMatchObject({ type: "season", seasonId: season.id, name: "Winter League" });
    expect(body.gamesCount).toBe(2);
    expect(body.players[0]).toMatchObject({ name: "Alice", points: 4, wins: 1, draws: 1, goalDifference: 2 });
    expect(body.crews[0]).toMatchObject({ name: "Red", points: 4, roundsRepresented: 2 });
  });

  it("returns event-wide player standings and no invented Crews without a Season", async () => {
    const event = await prisma.event.create({ data: { title: "Pickup", location: "Pitch", dateTime: new Date("2026-02-01") } });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2026-01-05"),
        status: "played",
        scoreOne: 1,
        scoreTwo: 0,
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice", order: 0 }] }, { team: "B", players: [{ name: "Bob", order: 0 }] }]),
      },
    });

    const response = await getLeaderboard(context(event.id, "?seasonId=all"));
    const body = await response.json();
    expect(body.scope).toMatchObject({ type: "event", seasonId: null });
    expect(body.players).toHaveLength(2);
    expect(body.crews).toEqual([]);
  });

  it("does not infer standings from a live Game without an immutable team snapshot", async () => {
    const event = await prisma.event.create({ data: { title: "Live game", location: "Pitch", dateTime: new Date("2026-02-01") } });
    await prisma.game.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2026-01-05"),
        status: "played",
        scoreOne: 3,
        scoreTwo: 0,
        teamOneName: "Current A",
        teamTwoName: "Current B",
      },
    });

    const response = await getLeaderboard(context(event.id));
    const body = await response.json();
    expect(body.gamesCount).toBe(0);
    expect(body.players).toEqual([]);
  });

  it("keeps withdrawn members eligible for matches before withdrawal", async () => {
    const event = await prisma.event.create({ data: { title: "Withdrawals", location: "Pitch", dateTime: new Date("2026-02-01") } });
    const alice = await prisma.user.create({ data: { id: "withdrawn-alice", name: "Alice", email: "withdrawn-alice@test.com" } });
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: alice.id } });
    const season = await prisma.season.create({
      data: {
        eventId: event.id,
        name: "Winter League",
        status: "completed",
        registrationOpensAt: new Date("2025-12-01"),
        registrationClosesAt: new Date("2025-12-31"),
        startsAt: new Date("2026-01-01"),
        completedAt: new Date("2026-02-01"),
      },
    });
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "Red", sortOrder: 0 } });
    await prisma.seasonMembership.create({
      data: {
        seasonId: season.id,
        eventPlayerId: player.id,
        userId: alice.id,
        crewId: crew.id,
        status: "withdrawn",
        joinedAt: new Date("2025-12-01"),
        withdrawnAt: new Date("2026-01-15"),
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2026-01-10"),
        status: "played",
        scoreOne: 2,
        scoreTwo: 0,
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice" }] }, { team: "B", players: [{ name: "Guest" }] }]),
      },
    });

    const response = await getLeaderboard(context(event.id));
    const body = await response.json();
    expect(body.players.find((player: { name: string }) => player.name === "Alice")).toMatchObject({ points: 3, played: 1 });
    expect(body.crews[0]).toMatchObject({ name: "Red", points: 3, roundsRepresented: 1 });
  });

  it("does not let later non-competitive records change the default Season", async () => {
    const event = await prisma.event.create({ data: { title: "Scopes", location: "Pitch", dateTime: new Date("2026-03-01") } });
    const seasonData = {
      eventId: event.id,
      status: "active",
      registrationOpensAt: new Date("2025-12-01"),
      registrationClosesAt: new Date("2025-12-31"),
    };
    const season = await prisma.season.create({ data: { ...seasonData, name: "January League", startsAt: new Date("2026-01-01") } });
    await prisma.gameHistory.createMany({
      data: [
        { eventId: event.id, dateTime: new Date("2026-01-05"), status: "played", scoreOne: 1, scoreTwo: 0, teamOneName: "A", teamTwoName: "B", teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice" }] }, { team: "B", players: [{ name: "Bob" }] }]) },
        { eventId: event.id, dateTime: new Date("2026-02-05"), status: "played", isFriendly: true, scoreOne: 9, scoreTwo: 0, teamOneName: "A", teamTwoName: "B", teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice" }] }, { team: "B", players: [{ name: "Bob" }] }]) },
        { eventId: event.id, dateTime: new Date("2026-03-05"), status: "cancelled", scoreOne: 9, scoreTwo: 0, teamOneName: "A", teamTwoName: "B", teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice" }] }, { team: "B", players: [{ name: "Bob" }] }]) },
      ],
    });

    const response = await getLeaderboard(context(event.id));
    const body = await response.json();
    expect(body.scope).toMatchObject({ type: "season", seasonId: season.id, name: "January League" });
    expect(body.gamesCount).toBe(1);
  });

  it("counts distinct games that share a timestamp", async () => {
    const event = await prisma.event.create({ data: { title: "Double header", location: "Pitch", dateTime: new Date("2026-02-01") } });
    const snapshot = JSON.stringify([{ team: "A", players: [{ name: "Alice" }] }, { team: "B", players: [{ name: "Bob" }] }]);
    await prisma.gameHistory.createMany({
      data: [
        { eventId: event.id, dateTime: new Date("2026-01-05T10:00:00Z"), status: "played", scoreOne: 1, scoreTwo: 0, teamOneName: "A", teamTwoName: "B", teamsSnapshot: snapshot },
        { eventId: event.id, dateTime: new Date("2026-01-05T10:00:00Z"), status: "played", scoreOne: 2, scoreTwo: 0, teamOneName: "A", teamTwoName: "B", teamsSnapshot: snapshot },
      ],
    });

    const response = await getLeaderboard(context(event.id, "?seasonId=all"));
    const body = await response.json();
    expect(body.gamesCount).toBe(2);
    expect(body.players.find((player: { name: string }) => player.name === "Alice")).toMatchObject({ points: 6, played: 2, goalsFor: 3 });
  });

  it("does not turn an empty Season roster into event-wide standings", async () => {
    const event = await prisma.event.create({ data: { title: "Empty Season", location: "Pitch", dateTime: new Date("2026-02-01") } });
    const season = await prisma.season.create({
      data: {
        eventId: event.id,
        name: "Empty League",
        status: "active",
        registrationOpensAt: new Date("2025-12-01"),
        registrationClosesAt: new Date("2025-12-31"),
        startsAt: new Date("2026-01-01"),
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2026-01-05"),
        status: "played",
        scoreOne: 1,
        scoreTwo: 0,
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice" }] }, { team: "B", players: [{ name: "Bob" }] }]),
      },
    });

    const response = await getLeaderboard(context(event.id));
    const body = await response.json();
    expect(body.scope).toMatchObject({ type: "season", seasonId: season.id });
    expect(body.players).toEqual([]);
  });

  it("does not count malformed snapshots with partially invalid players", async () => {
    const event = await prisma.event.create({ data: { title: "Malformed", location: "Pitch", dateTime: new Date("2026-02-01") } });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2026-01-05"),
        status: "played",
        scoreOne: 1,
        scoreTwo: 0,
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice" }, {}] }, { team: "B", players: [{ name: "Bob" }] }]),
      },
    });

    const response = await getLeaderboard(context(event.id, "?seasonId=all"));
    const body = await response.json();
    expect(body.gamesCount).toBe(0);
    expect(body.players).toEqual([]);
  });

  it("returns 404 for an unknown seasonId scope", async () => {
    const event = await prisma.event.create({ data: { title: "Scope 404", location: "Pitch", dateTime: new Date("2026-02-01") } });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: new Date("2026-01-05"), status: "played", scoreOne: 1, scoreTwo: 0,
        teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice" }] }, { team: "B", players: [{ name: "Bob" }] }]),
      },
    });
    const response = await getLeaderboard(context(event.id, "?seasonId=does-not-exist"));
    expect(response.status).toBe(404);
  });

  it("hides standings for anonymous viewers of ownerless private events", async () => {
    const event = await prisma.event.create({ data: { title: "Private", location: "Pitch", dateTime: new Date("2026-02-01"), showCompetitiveData: false } });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2026-01-05"),
        status: "played",
        scoreOne: 1,
        scoreTwo: 0,
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Alice" }] }, { team: "B", players: [{ name: "Bob" }] }]),
      },
    });

    const response = await getLeaderboard(context(event.id));
    const body = await response.json();
    expect(body).toMatchObject({ hidden: true, gamesCount: 0, players: [], crews: [] });
  });
});
