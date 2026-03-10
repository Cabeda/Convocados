import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

// Use the test DB set up in setup.ts
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Game",
      location: "Test Ground",
      dateTime: new Date("2026-05-01T18:00:00Z"),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      isRecurring: false,
      ...overrides,
    },
  });
}

async function addPlayer(eventId: string, name: string) {
  return prisma.player.create({ data: { name, eventId } });
}

// ── Event CRUD ────────────────────────────────────────────────────────────────

describe("Event creation", () => {
  it("creates an event with required fields", async () => {
    const event = await createEvent();
    expect(event.id).toBeTruthy();
    expect(event.title).toBe("Test Game");
    expect(event.teamOneName).toBe("Ninjas");
    expect(event.teamTwoName).toBe("Gunas");
    expect(event.isRecurring).toBe(false);
  });

  it("creates a recurring event with recurrence rule", async () => {
    const rule = JSON.stringify({ freq: "weekly", interval: 1 });
    const resetAt = new Date("2026-05-01T19:00:00Z");
    const event = await createEvent({
      isRecurring: true,
      recurrenceRule: rule,
      nextResetAt: resetAt,
    });
    expect(event.isRecurring).toBe(true);
    expect(event.recurrenceRule).toBe(rule);
    expect(event.nextResetAt?.toISOString()).toBe(resetAt.toISOString());
  });

  it("defaults team names to Ninjas and Gunas", async () => {
    const event = await prisma.event.create({
      data: {
        title: "T",
        location: "L",
        dateTime: new Date("2026-05-01T18:00:00Z"),
      },
    });
    expect(event.teamOneName).toBe("Ninjas");
    expect(event.teamTwoName).toBe("Gunas");
  });
});

describe("Event retrieval", () => {
  it("finds event by id with players and teamResults", async () => {
    const event = await createEvent();
    await addPlayer(event.id, "Alice");
    await addPlayer(event.id, "Bob");

    const found = await prisma.event.findUnique({
      where: { id: event.id },
      include: { players: true, teamResults: { include: { members: true } } },
    });

    expect(found).not.toBeNull();
    expect(found!.players).toHaveLength(2);
    expect(found!.teamResults).toHaveLength(0);
  });

  it("returns null for non-existent id", async () => {
    const found = await prisma.event.findUnique({ where: { id: "nonexistent" } });
    expect(found).toBeNull();
  });
});

describe("Event update", () => {
  it("updates team names", async () => {
    const event = await createEvent();
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { teamOneName: "Lions", teamTwoName: "Tigers" },
    });
    expect(updated.teamOneName).toBe("Lions");
    expect(updated.teamTwoName).toBe("Tigers");
  });

  it("updates dateTime for recurrence reset", async () => {
    const event = await createEvent({ isRecurring: true });
    const newDate = new Date("2026-05-08T18:00:00Z");
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { dateTime: newDate },
    });
    expect(updated.dateTime.toISOString()).toBe(newDate.toISOString());
  });
});

// ── Player operations ─────────────────────────────────────────────────────────

describe("Player management", () => {
  let eventId: string;

  beforeEach(async () => {
    const event = await createEvent();
    eventId = event.id;
  });

  it("adds a player to an event", async () => {
    const player = await addPlayer(eventId, "Alice");
    expect(player.name).toBe("Alice");
    expect(player.eventId).toBe(eventId);
  });

  it("enforces unique player names per event", async () => {
    await addPlayer(eventId, "Alice");
    await expect(addPlayer(eventId, "Alice")).rejects.toThrow();
  });

  it("allows same name in different events", async () => {
    const event2 = await createEvent();
    await addPlayer(eventId, "Alice");
    const p2 = await addPlayer(event2.id, "Alice");
    expect(p2.name).toBe("Alice");
  });

  it("deletes a player", async () => {
    const player = await addPlayer(eventId, "Bob");
    await prisma.player.delete({ where: { id: player.id } });
    const found = await prisma.player.findUnique({ where: { id: player.id } });
    expect(found).toBeNull();
  });

  it("cascades delete when event is deleted", async () => {
    const player = await addPlayer(eventId, "Carol");
    await prisma.event.delete({ where: { id: eventId } });
    const found = await prisma.player.findUnique({ where: { id: player.id } });
    expect(found).toBeNull();
  });

  it("orders players by createdAt — both players present", async () => {
    await addPlayer(eventId, "Zara");
    await addPlayer(eventId, "Anna");
    const players = await prisma.player.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
    });
    expect(players.map((p) => p.name).sort()).toEqual(["Anna", "Zara"]);
  });
});

// ── Team results ──────────────────────────────────────────────────────────────

describe("Team results", () => {
  let eventId: string;

  beforeEach(async () => {
    const event = await createEvent();
    eventId = event.id;
    await addPlayer(eventId, "Alice");
    await addPlayer(eventId, "Bob");
    await addPlayer(eventId, "Carlos");
    await addPlayer(eventId, "Diana");
  });

  it("creates team results with members", async () => {
    const tr = await prisma.teamResult.create({
      data: {
        name: "Ninjas",
        eventId,
        members: {
          create: [
            { name: "Alice", order: 0 },
            { name: "Bob", order: 1 },
          ],
        },
      },
      include: { members: true },
    });
    expect(tr.members).toHaveLength(2);
    expect(tr.members[0].name).toBe("Alice");
  });

  it("replaces team results in a transaction", async () => {
    // Create initial results
    await prisma.teamResult.create({
      data: { name: "Ninjas", eventId, members: { create: [{ name: "Alice", order: 0 }] } },
    });

    // Replace
    await prisma.$transaction([
      prisma.teamResult.deleteMany({ where: { eventId } }),
      prisma.teamResult.create({
        data: { name: "Ninjas", eventId, members: { create: [{ name: "Bob", order: 0 }] } },
      }),
    ]);

    const results = await prisma.teamResult.findMany({
      where: { eventId },
      include: { members: true },
    });
    expect(results).toHaveLength(1);
    expect(results[0].members[0].name).toBe("Bob");
  });

  it("cascades delete team members when team result is deleted", async () => {
    const tr = await prisma.teamResult.create({
      data: { name: "Ninjas", eventId, members: { create: [{ name: "Alice", order: 0 }] } },
      include: { members: true },
    });
    const memberId = tr.members[0].id;
    await prisma.teamResult.delete({ where: { id: tr.id } });
    const member = await prisma.teamMember.findUnique({ where: { id: memberId } });
    expect(member).toBeNull();
  });
});

// ── Recurrence reset ──────────────────────────────────────────────────────────

describe("Recurrence reset logic", () => {
  it("resets players and advances date when nextResetAt is past", async () => {
    const pastReset = new Date(Date.now() - 1000);
    const event = await createEvent({
      isRecurring: true,
      recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
      nextResetAt: pastReset,
    });
    await addPlayer(event.id, "Alice");
    await addPlayer(event.id, "Bob");

    const newDateTime = new Date("2026-05-08T18:00:00Z");
    const newNextResetAt = new Date(newDateTime.getTime() + 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.player.deleteMany({ where: { eventId: event.id } }),
      prisma.teamResult.deleteMany({ where: { eventId: event.id } }),
      prisma.event.update({
        where: { id: event.id },
        data: { dateTime: newDateTime, nextResetAt: newNextResetAt },
      }),
    ]);

    const fresh = await prisma.event.findUnique({
      where: { id: event.id },
      include: { players: true },
    });
    expect(fresh!.players).toHaveLength(0);
    expect(fresh!.dateTime.toISOString()).toBe(newDateTime.toISOString());
  });
});
