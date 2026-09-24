import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { occurrenceRoster, occurrenceRosterNamesMap, withRosterNames } from "~/lib/gameRoster.server";
import { calculateAttendance } from "~/lib/attendance";

async function seedEvent() {
  return prisma.event.create({
    data: {
      title: "Roster",
      location: "Pitch",
      dateTime: new Date(Date.now() - 7200_000),
      maxPlayers: 10,
    },
  });
}

async function seedGame(eventId: string, at: Date, status = "played") {
  return prisma.game.create({ data: { eventId, dateTime: at, status } });
}

async function addParticipant(gameId: string, eventId: string, name: string, order: number, status = "active") {
  const ep = await prisma.eventPlayer.upsert({
    where: { eventId_name: { eventId, name } },
    create: { eventId, name },
    update: {},
  });
  return prisma.gameParticipant.create({
    data: { gameId, eventPlayerId: ep.id, order, status },
  });
}

beforeEach(async () => {
  await prisma.gameParticipant.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("occurrenceRoster", () => {
  it("prefers durable GameParticipant names over a poisoned snapshot", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id, event.dateTime);
    await addParticipant(game.id, event.id, "Real Rita", 0);

    const roster = await occurrenceRoster(event.id, {
      dateTime: event.dateTime,
      teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Ghost Gary", order: 0 }] }]),
    });
    expect(roster.fromGame).toBe(true);
    expect(roster.names).toEqual(["Real Rita"]);
  });

  it("falls back to the snapshot when no GameParticipant rows exist", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id, event.dateTime);
    void game;

    const roster = await occurrenceRoster(event.id, {
      dateTime: event.dateTime,
      teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Snap Sam", order: 0 }] }]),
    });
    expect(roster.fromGame).toBe(false);
    expect(roster.names).toEqual(["Snap Sam"]);
  });

  it("returns empty names when neither GP nor snapshot has a roster", async () => {
    const event = await seedEvent();
    const roster = await occurrenceRoster(event.id, { dateTime: event.dateTime, teamsSnapshot: null });
    expect(roster.names).toEqual([]);
  });

  it("excludes pending (invite ghost) participants", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id, event.dateTime);
    await addParticipant(game.id, event.id, "Confirmed Cleo", 0);
    await addParticipant(game.id, event.id, "Ghost Gina", 1, "pending");

    const roster = await occurrenceRoster(event.id, { gameId: game.id });
    expect(roster.names).toEqual(["Confirmed Cleo"]);
  });

  it("occurrenceRosterNamesMap keys names per occurrence", async () => {
    const event = await seedEvent();
    const older = new Date(Date.now() - 14 * 86400_000);
    const g1 = await seedGame(event.id, older);
    const g2 = await seedGame(event.id, event.dateTime);
    await addParticipant(g1.id, event.id, "Old Olga", 0);
    await addParticipant(g2.id, event.id, "New Nia", 0);

    const map = await occurrenceRosterNamesMap(event.id, [
      { key: "g1", gameId: g1.id },
      { key: "g2", gameId: g2.id },
    ]);
    expect(map.get("g1")).toEqual(["Old Olga"]);
    expect(map.get("g2")).toEqual(["New Nia"]);
  });

  it("excludes archived participants", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id, event.dateTime);
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Archived Ana" } });
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: ep.id, order: 0, archivedAt: new Date() },
    });

    const roster = await occurrenceRoster(event.id, { gameId: game.id, teamsSnapshot: null });
    expect(roster.names).toEqual([]);
  });
});

describe("calculateAttendance with injected roster names", () => {
  it("uses playerNames over a poisoned snapshot", async () => {
    const history = [
      {
        status: "played",
        dateTime: new Date("2026-01-01"),
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Ghost Gary", order: 0 }] }]),
        playerNames: ["Real Rita"],
      },
    ];
    const result = calculateAttendance(history);
    expect(result.players.map((p) => p.name)).toEqual(["Real Rita"]);
  });

  it("still reads the snapshot when playerNames is absent", async () => {
    const history = [
      {
        status: "played",
        dateTime: new Date("2026-01-01"),
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Snap Sam", order: 0 }] }]),
      },
    ];
    const result = calculateAttendance(history);
    expect(result.players.map((p) => p.name)).toEqual(["Snap Sam"]);
  });

  it("withRosterNames enriches rows with durable names", async () => {
    const event = await seedEvent();
    const game = await seedGame(event.id, event.dateTime);
    await addParticipant(game.id, event.id, "Real Rita", 0);
    const history = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Ghost Gary", order: 0 }] }]),
      },
    });

    const enriched = await withRosterNames(event.id, [history]);
    expect(enriched[0].playerNames).toEqual(["Real Rita"]);
  });
});
