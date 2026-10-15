import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { splitRoster } from "~/lib/rosterCapacity";
import { getRosterCapacity } from "~/lib/roster.server";
import { seedRecurringEvent, addGameParticipant, clearRosterTables } from "./helpers/rosterFixtures";

beforeEach(async () => {
  await clearRosterTables();
});

describe("splitRoster — the Roster's active/bench rule", () => {
  it("reads full capacity from an empty Roster", () => {
    const split = splitRoster([], 8);

    expect(split).toEqual({
      active: [],
      bench: [],
      activeCount: 0,
      benchCount: 0,
      totalCount: 0,
      spotsLeft: 8,
      hasBench: false,
    });
  });

  it("reads zero remaining capacity from a full Roster with no bench", () => {
    const roster = ["Ana", "Bia", "Cau", "Dani"];

    const split = splitRoster(roster, 4);

    expect(split.active).toEqual(["Ana", "Bia", "Cau", "Dani"]);
    expect(split.bench).toEqual([]);
    expect(split.activeCount).toBe(4);
    expect(split.benchCount).toBe(0);
    expect(split.spotsLeft).toBe(0);
    expect(split.hasBench).toBe(false);
  });

  it("puts every member past maxPlayers on the bench and reports no spots left", () => {
    const roster = ["Ana", "Bia", "Cau", "Dani", "Edi", "Fabi"];

    const split = splitRoster(roster, 4);

    expect(split.active).toEqual(["Ana", "Bia", "Cau", "Dani"]);
    expect(split.bench).toEqual(["Edi", "Fabi"]);
    expect(split.activeCount).toBe(4);
    expect(split.benchCount).toBe(2);
    expect(split.totalCount).toBe(6);
    expect(split.spotsLeft).toBe(0);
    expect(split.hasBench).toBe(true);
  });

  it("leaves the rest of the Event's spots unclaimed when the Roster is short", () => {
    const split = splitRoster(["Ana", "Bia"], 8);

    expect(split.activeCount).toBe(2);
    expect(split.spotsLeft).toBe(6);
    expect(split.hasBench).toBe(false);
  });
});

describe("getRosterCapacity — the query form", () => {
  it("answers exactly what splitRoster answers for the same Roster", async () => {
    const event = await seedRecurringEvent(4);
    for (let i = 1; i <= 6; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Player ${i}`, i);
    }

    const queried = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    // The query form filters, then delegates — so it is splitRoster of the survivors.
    expect(queried).toEqual(
      splitRoster(
        [1, 2, 3, 4, 5, 6].map((i) => ({ name: `Player ${i}`, userId: null })),
        event.maxPlayers,
      ),
    );
    expect(queried.active.map((m) => m.name)).toEqual(["Player 1", "Player 2", "Player 3", "Player 4"]);
    expect(queried.bench.map((m) => m.name)).toEqual(["Player 5", "Player 6"]);
  });

  it("excludes archived rows, invite ghosts and legacy Player accumulation alike", async () => {
    const event = await seedRecurringEvent(4);
    for (let i = 1; i <= 4; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Active ${i}`, i);
    }
    // A player who left this Game, an invite ghost sitting between real members, and a
    // legacy Player row left over from a previous Game — none of them hold an active spot.
    await addGameParticipant(event.currentGameId!, event.id, "Leaver", 0, new Date());
    await addGameParticipant(event.currentGameId!, event.id, "Invited Guest", 0, null, "pending");
    await addGameParticipant(event.currentGameId!, event.id, "Bench Member", 5);
    const legacy = await prisma.player.create({ data: { eventId: event.id, name: "From Last Month", order: 0 } });

    const capacity = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    expect(capacity.totalCount).toBe(5);
    expect(capacity.active.map((m) => m.name)).toEqual(["Active 1", "Active 2", "Active 3", "Active 4"]);
    expect(capacity.bench.map((m) => m.name)).toEqual(["Bench Member"]);
    expect(capacity.spotsLeft).toBe(0);
    expect(capacity.hasBench).toBe(true);
    expect(capacity.active.some((m) => m.name === legacy.name)).toBe(false);
  });

  it("reads the legacy Player rows only when the Event has no current Game", async () => {
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

    const capacity = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    expect(capacity.activeCount).toBe(8);
    expect(capacity.benchCount).toBe(2);
    expect(capacity.spotsLeft).toBe(0);
    expect(capacity.hasBench).toBe(true);
  });

  it("reads full capacity from an Event whose current Game has an empty Roster", async () => {
    const event = await seedRecurringEvent(8);
    // Legacy rows exist, but the current Game's Roster is authoritative and empty.
    await prisma.player.create({ data: { eventId: event.id, name: "From Last Month", order: 0 } });

    const capacity = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    expect(capacity.activeCount).toBe(0);
    expect(capacity.benchCount).toBe(0);
    expect(capacity.spotsLeft).toBe(8);
    expect(capacity.hasBench).toBe(false);
  });
});