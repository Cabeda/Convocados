import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { getActiveRosterState } from "~/lib/roster.server";

beforeEach(async () => {
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

/** Recurring event with a current (upcoming) Game — ADR 0016 game-scoped roster. */
async function seedRecurringEvent(maxPlayers: number) {
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers,
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY",
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

async function addGameParticipant(gameId: string, eventId: string, name: string, order: number, archivedAt: Date | null = null, status: string = "active") {
  const ep = await prisma.eventPlayer.create({ data: { eventId, name } });
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: ep.id, order, archivedAt, status } });
}

describe("getActiveRosterState — game-scoped (ADR 0016)", () => {
  it("caps activeCount at maxPlayers and exposes bench info for a full roster", async () => {
    const event = await seedRecurringEvent(8);
    for (let i = 1; i <= 10; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Player ${i}`, i);
    }

    const state = await getActiveRosterState(event.id, event.maxPlayers, event.currentGameId);

    expect(state.activeCount).toBe(8);
    expect(state.totalCount).toBe(10);
    expect(state.hasBench).toBe(true);
    expect(state.firstBenchName).toBe("Player 9");
    expect(state.activeNames).toEqual(new Set([...Array(8)].map((_, i) => `Player ${i + 1}`)));
    expect(state.members).toHaveLength(10);
  });

  it("reports no bench and firstBenchName null when the roster is not full", async () => {
    const event = await seedRecurringEvent(8);
    for (let i = 1; i <= 4; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Player ${i}`, i);
    }

    const state = await getActiveRosterState(event.id, event.maxPlayers, event.currentGameId);

    expect(state.activeCount).toBe(4);
    expect(state.totalCount).toBe(4);
    expect(state.hasBench).toBe(false);
    expect(state.firstBenchName).toBeNull();
  });

  it("ignores archived GameParticipants (players who left)", async () => {
    const event = await seedRecurringEvent(8);
    for (let i = 1; i <= 6; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Active ${i}`, i);
    }
    // Leaver from a previous occurrence — soft-archived, must not count
    await addGameParticipant(event.currentGameId!, event.id, "Leaver", 7, new Date());

    const state = await getActiveRosterState(event.id, event.maxPlayers, event.currentGameId);

    expect(state.activeCount).toBe(6);
    expect(state.totalCount).toBe(6);
    expect(state.activeNames.has("Leaver")).toBe(false);
  });

  it("ignores pending invite GameParticipants (ADR 0025 roster ghosts)", async () => {
    const event = await seedRecurringEvent(4);
    for (let i = 1; i <= 3; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Active ${i}`, i);
    }
    // Pending invite — occupies a queue slot in the DB but counts toward nothing
    await addGameParticipant(event.currentGameId!, event.id, "Invited Guest", 3, null, "pending");

    const state = await getActiveRosterState(event.id, event.maxPlayers, event.currentGameId);

    expect(state.totalCount).toBe(3);
    expect(state.activeCount).toBe(3);
    expect(state.activeNames).toEqual(new Set(["Active 1", "Active 2", "Active 3"]));
    expect(state.hasBench).toBe(false);
    expect(state.firstBenchName).toBeNull();
    expect(state.members.map((m) => m.name)).not.toContain("Invited Guest");
  });

  it("pending ghost must not push real players onto the bench", async () => {
    const event = await seedRecurringEvent(4);
    for (let i = 1; i <= 4; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Active ${i}`, i);
    }
    // Ghost sits between real players by order — with the bug, "Player 5" reads as bench
    await addGameParticipant(event.currentGameId!, event.id, "Invited Guest", 2, null, "pending");
    await addGameParticipant(event.currentGameId!, event.id, "Real Bench Player", 4);

    const state = await getActiveRosterState(event.id, event.maxPlayers, event.currentGameId);

    expect(state.totalCount).toBe(5);
    expect(state.activeNames).toEqual(new Set(["Active 1", "Active 2", "Active 3", "Active 4"]));
    expect(state.firstBenchName).toBe("Real Bench Player");
  });
});

describe("getActiveRosterState — legacy fallback (non-recurring)", () => {
  it("derives the same state from Player rows when there is no current game", async () => {
    const event = await prisma.event.create({
      data: {
        title: "One-off",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 8,
        isRecurring: false,
      },
    });
    for (let i = 0; i < 10; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `Player ${i + 1}`, order: i } });
    }

    const state = await getActiveRosterState(event.id, event.maxPlayers, null);

    expect(state.activeCount).toBe(8);
    expect(state.totalCount).toBe(10);
    expect(state.hasBench).toBe(true);
    expect(state.firstBenchName).toBe("Player 9");
  });
});
