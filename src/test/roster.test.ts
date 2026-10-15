import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { getRosterCapacity, type RosterCapacity } from "~/lib/roster.server";
import { seedRecurringEvent, addGameParticipant, clearRosterTables } from "./helpers/rosterFixtures";

/** Names in the active spots — the `activeNames` Set the deleted adapter returned. */
function activeNames(c: RosterCapacity): Set<string> {
  return new Set(c.active.map((m) => m.name));
}

/** First bench name, or null when the bench is empty. */
function firstBenchName(c: RosterCapacity): string | null {
  return c.bench[0]?.name ?? null;
}

beforeEach(async () => {
  await clearRosterTables();
});

describe("getRosterCapacity — game-scoped (ADR 0016)", () => {
  it("caps activeCount at maxPlayers and exposes bench info for a full roster", async () => {
    const event = await seedRecurringEvent(8);
    for (let i = 1; i <= 10; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Player ${i}`, i);
    }

    const state = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    expect(state.activeCount).toBe(8);
    expect(state.totalCount).toBe(10);
    expect(state.benchCount).toBe(2);
    expect(state.spotsLeft).toBe(0);
    expect(state.hasBench).toBe(true);
    expect(firstBenchName(state)).toBe("Player 9");
    expect(activeNames(state)).toEqual(new Set([...Array(8)].map((_, i) => `Player ${i + 1}`)));
  });

  it("reports no bench and firstBenchName null when the roster is not full", async () => {
    const event = await seedRecurringEvent(8);
    for (let i = 1; i <= 4; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Player ${i}`, i);
    }

    const state = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    expect(state.activeCount).toBe(4);
    expect(state.totalCount).toBe(4);
    expect(state.spotsLeft).toBe(4);
    expect(state.hasBench).toBe(false);
    expect(firstBenchName(state)).toBeNull();
  });

  it("ignores archived GameParticipants (players who left)", async () => {
    const event = await seedRecurringEvent(8);
    for (let i = 1; i <= 6; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Active ${i}`, i);
    }
    // Leaver from a previous occurrence — soft-archived, must not count
    await addGameParticipant(event.currentGameId!, event.id, "Leaver", 7, new Date());

    const state = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    expect(state.activeCount).toBe(6);
    expect(state.totalCount).toBe(6);
    expect(activeNames(state).has("Leaver")).toBe(false);
  });

  it("ignores pending invite GameParticipants (ADR 0025 roster ghosts)", async () => {
    const event = await seedRecurringEvent(4);
    for (let i = 1; i <= 3; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Active ${i}`, i);
    }
    // Pending invite — occupies a queue slot in the DB but counts toward nothing
    await addGameParticipant(event.currentGameId!, event.id, "Invited Guest", 3, null, "pending");

    const state = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    expect(state.totalCount).toBe(3);
    expect(state.activeCount).toBe(3);
    expect(activeNames(state)).toEqual(new Set(["Active 1", "Active 2", "Active 3"]));
    expect(state.hasBench).toBe(false);
    expect(firstBenchName(state)).toBeNull();
    expect([...state.active, ...state.bench].map((m) => m.name)).not.toContain("Invited Guest");
  });

  it("pending ghost must not push real players onto the bench", async () => {
    const event = await seedRecurringEvent(4);
    for (let i = 1; i <= 4; i++) {
      await addGameParticipant(event.currentGameId!, event.id, `Active ${i}`, i);
    }
    // Ghost sits between real players by order — with the bug, "Player 5" reads as bench
    await addGameParticipant(event.currentGameId!, event.id, "Invited Ghost", 2, null, "pending");
    await addGameParticipant(event.currentGameId!, event.id, "Real Bench Player", 4);

    const state = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

    expect(state.totalCount).toBe(5);
    expect(activeNames(state)).toEqual(new Set(["Active 1", "Active 2", "Active 3", "Active 4"]));
    expect(firstBenchName(state)).toBe("Real Bench Player");
  });
});

describe("getRosterCapacity — legacy fallback (non-recurring)", () => {
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

    const state = await getRosterCapacity(event.id, event.maxPlayers, null);

    expect(state.activeCount).toBe(8);
    expect(state.totalCount).toBe(10);
    expect(state.hasBench).toBe(true);
    expect(firstBenchName(state)).toBe("Player 9");
  });
});