import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { getUpcomingReminders, markReminderSent } from "~/lib/reminders.server";

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
