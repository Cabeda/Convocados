import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { getUpcomingReminders, getPostGameReminders, markReminderSent } from "~/lib/reminders.server";

// Seed helpers
async function seedUser(id = "user-rem-1") {
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: { id, name: "Reminder User", email: `${id}@test.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  });
  return id;
}

async function seedEvent(ownerId: string, dateTime: Date, id = "evt-rem-1") {
  await prisma.event.upsert({
    where: { id },
    update: { dateTime },
    create: {
      id, title: "Reminder Game", location: "Test Field", dateTime,
      maxPlayers: 10, ownerId, createdAt: new Date(), updatedAt: new Date(),
    },
  });
  return id;
}

beforeEach(async () => {
  await prisma.reminderLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

describe("getUpcomingReminders", () => {
  it("returns events needing 24h reminder", async () => {
    const userId = await seedUser();
    const inAbout24h = new Date(Date.now() + 23.5 * 60 * 60 * 1000);
    const eventId = await seedEvent(userId, inAbout24h);
    await prisma.player.create({ data: { name: "Player1", eventId, userId } });

    const reminders = await getUpcomingReminders("24h");
    expect(reminders.length).toBeGreaterThanOrEqual(1);
    expect(reminders.some((r) => r.eventId === eventId)).toBe(true);
  });

  it("skips events already reminded", async () => {
    const userId = await seedUser();
    const inAbout24h = new Date(Date.now() + 23.5 * 60 * 60 * 1000);
    const eventId = await seedEvent(userId, inAbout24h);
    await prisma.player.create({ data: { name: "Player1", eventId, userId } });
    await markReminderSent(eventId, "24h");

    const reminders = await getUpcomingReminders("24h");
    expect(reminders.every((r) => r.eventId !== eventId)).toBe(true);
  });

  it("returns events needing 2h reminder", async () => {
    const userId = await seedUser();
    const inAbout2h = new Date(Date.now() + 1.5 * 60 * 60 * 1000);
    const eventId = await seedEvent(userId, inAbout2h, "evt-rem-2h");
    await prisma.player.create({ data: { name: "Player1", eventId, userId } });

    const reminders = await getUpcomingReminders("2h");
    expect(reminders.some((r) => r.eventId === eventId)).toBe(true);
  });

  it("ignores past events", async () => {
    const userId = await seedUser();
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await seedEvent(userId, past, "evt-past");

    const reminders = await getUpcomingReminders("24h");
    expect(reminders.every((r) => r.eventId !== "evt-past")).toBe(true);
  });
});

describe("markReminderSent", () => {
  it("creates a reminder log entry", async () => {
    const userId = await seedUser();
    const eventId = await seedEvent(userId, new Date(Date.now() + 24 * 60 * 60 * 1000));

    await markReminderSent(eventId, "24h");

    const log = await prisma.reminderLog.findFirst({ where: { eventId, type: "24h" } });
    expect(log).not.toBeNull();
  });
});

describe("getPostGameReminders", () => {
  it("returns events where the game has ended", async () => {
    const userId = await seedUser();
    // Game started 2h ago with 60min duration → ended 1h ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const eventId = await seedEvent(userId, twoHoursAgo, "evt-post-game");
    await prisma.player.create({ data: { name: "Player1", eventId, userId } });

    const reminders = await getPostGameReminders();
    expect(reminders.some((r) => r.eventId === eventId)).toBe(true);
  });

  it("does not return future events", async () => {
    const userId = await seedUser();
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await seedEvent(userId, future, "evt-future");

    const reminders = await getPostGameReminders();
    expect(reminders.every((r) => r.eventId !== "evt-future")).toBe(true);
  });

  it("does not return events where game is still in progress", async () => {
    const userId = await seedUser();
    // Game started 30min ago with 60min duration → still in progress
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    await seedEvent(userId, thirtyMinAgo, "evt-in-progress");

    const reminders = await getPostGameReminders();
    expect(reminders.every((r) => r.eventId !== "evt-in-progress")).toBe(true);
  });

  it("does not return events where post-game reminder was already sent", async () => {
    const userId = await seedUser();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const eventId = await seedEvent(userId, twoHoursAgo, "evt-already-sent");
    await markReminderSent(eventId, "post-game");

    const reminders = await getPostGameReminders();
    expect(reminders.every((r) => r.eventId !== eventId)).toBe(true);
  });

  it("does not return events older than 4 hours", async () => {
    const userId = await seedUser();
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await seedEvent(userId, fiveHoursAgo, "evt-old");

    const reminders = await getPostGameReminders();
    expect(reminders.every((r) => r.eventId !== "evt-old")).toBe(true);
  });

  it("includes player data in the reminder", async () => {
    const userId = await seedUser();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const eventId = await seedEvent(userId, twoHoursAgo, "evt-with-players");
    await prisma.player.create({ data: { name: "Alice", eventId, userId } });
    await prisma.player.create({ data: { name: "Bob", eventId, order: 1 } });

    const reminders = await getPostGameReminders();
    const reminder = reminders.find((r) => r.eventId === eventId);
    expect(reminder).toBeDefined();
    expect(reminder!.players).toHaveLength(2);
    expect(reminder!.players.map((p) => p.name)).toContain("Alice");
    expect(reminder!.players.map((p) => p.name)).toContain("Bob");
  });
});
