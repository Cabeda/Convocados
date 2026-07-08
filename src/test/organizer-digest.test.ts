import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const mockSendPush = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/push.server", () => ({ sendPushToUser: (...args: unknown[]) => mockSendPush(...args) }));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { processOrganizerDigests } from "~/lib/organizerDigest.server";

function uid() { return `u-${Math.random().toString(36).slice(2, 8)}`; }
function eid() { return `e-${Math.random().toString(36).slice(2, 8)}`; }

async function seedUser(overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { id: uid(), name: "Owner", email: `${uid()}@t.com`, emailVerified: true, ...overrides },
  });
}

async function seedEvent(ownerId: string | null, overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      id: eid(),
      title: "Friday Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 7 * 86400_000),
      maxPlayers: 10,
      ownerId,
      ...overrides,
    },
  });
}

beforeEach(async () => {
  mockSendPush.mockClear();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.player.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("processOrganizerDigests", () => {
  it("sends digest to a user within the time window", async () => {
    const user = await seedUser();
    const now = new Date();
    const digestTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    await prisma.notificationPreferences.create({
      data: { userId: user.id, digestMode: true, digestTime },
    });
    const event = await seedEvent(user.id);
    await prisma.player.createMany({
      data: [
        { eventId: event.id, name: "P1", order: 0 },
        { eventId: event.id, name: "P2", order: 1 },
      ],
    });

    const result = await processOrganizerDigests();

    expect(result.sent).toContain(user.id);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    const [userId, title, body, url] = mockSendPush.mock.calls[0];
    expect(userId).toBe(user.id);
    expect(title).toContain("Daily summary");
    expect(body).toContain("Friday Game");
    expect(body).toContain("2/10");
    expect(body).toContain("8 open");
    expect(url).toBe("/dashboard");
  });

  it("skips users outside the 30-min window", async () => {
    const user = await seedUser();
    const now = new Date();
    // Set digestTime 2 hours away
    const offsetHour = (now.getHours() + 2) % 24;
    const digestTime = `${String(offsetHour).padStart(2, "0")}:00`;

    await prisma.notificationPreferences.create({
      data: { userId: user.id, digestMode: true, digestTime },
    });
    await seedEvent(user.id);

    const result = await processOrganizerDigests();

    expect(result.sent).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("skips users with no upcoming events", async () => {
    const user = await seedUser();
    const now = new Date();
    const digestTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    await prisma.notificationPreferences.create({
      data: { userId: user.id, digestMode: true, digestTime },
    });
    // Create only a past event
    await seedEvent(user.id, { dateTime: new Date(Date.now() - 86400_000) });

    const result = await processOrganizerDigests();

    expect(result.sent).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("includes events where user is admin (not owner)", async () => {
    const admin = await seedUser();
    const owner = await seedUser();
    const now = new Date();
    const digestTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    await prisma.notificationPreferences.create({
      data: { userId: admin.id, digestMode: true, digestTime },
    });
    const event = await seedEvent(owner.id, { title: "Admin Event" });
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: admin.id } });

    const result = await processOrganizerDigests();

    expect(result.sent).toContain(admin.id);
    expect(mockSendPush.mock.calls[0][2]).toContain("Admin Event");
  });

  it("includes pending and sent payment counts in digest body", async () => {
    const user = await seedUser();
    const now = new Date();
    const digestTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    await prisma.notificationPreferences.create({
      data: { userId: user.id, digestMode: true, digestTime },
    });
    const event = await seedEvent(user.id, { title: "Paid Game" });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50 },
    });
    await prisma.playerPayment.createMany({
      data: [
        { eventCostId: cost.id, playerName: "A", amount: 5, status: "pending" },
        { eventCostId: cost.id, playerName: "B", amount: 5, status: "pending" },
        { eventCostId: cost.id, playerName: "C", amount: 5, status: "sent" },
      ],
    });

    const result = await processOrganizerDigests();

    expect(result.sent).toContain(user.id);
    const body: string = mockSendPush.mock.calls[0][2];
    expect(body).toContain("2 pending");
    expect(body).toContain("1 to confirm");
  });

  it("deduplicates events that are both owned and admin'd", async () => {
    const user = await seedUser();
    const now = new Date();
    const digestTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    await prisma.notificationPreferences.create({
      data: { userId: user.id, digestMode: true, digestTime },
    });
    const event = await seedEvent(user.id, { title: "Duped Event" });
    // Also make user an admin of same event
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: user.id } });

    const result = await processOrganizerDigests();

    expect(result.sent).toContain(user.id);
    const body: string = mockSendPush.mock.calls[0][2];
    // Should appear only once
    expect(body.split("Duped Event").length - 1).toBe(1);
  });

  it("handles sendPushToUser failure gracefully", async () => {
    mockSendPush.mockRejectedValueOnce(new Error("push failed"));
    const user = await seedUser();
    const now = new Date();
    const digestTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    await prisma.notificationPreferences.create({
      data: { userId: user.id, digestMode: true, digestTime },
    });
    await seedEvent(user.id);

    const result = await processOrganizerDigests();

    // Not in sent because push threw
    expect(result.sent).not.toContain(user.id);
  });
});
