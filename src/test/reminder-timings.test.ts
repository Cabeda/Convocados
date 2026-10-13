import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { processJob, scheduleEventReminders } from "~/lib/scheduler.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  cleanupStalePushTokens: vi.fn().mockResolvedValue({ appTokens: 0, webSubs: 0 }),
}));

vi.mock("~/lib/email.server", () => ({
  sendReminder: vi.fn().mockResolvedValue(undefined),
  sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

const { enqueueNotification } = await import("~/lib/notificationQueue.server");
const { fireWebhooks } = await import("~/lib/webhook.server");

beforeEach(async () => {
  await prisma.scheduledJob.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

async function seedUser(id = "u-rt-1") {
  return prisma.user.create({
    data: { id, name: "Owner", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(
  ownerId: string,
  dateTime: Date,
  timings: { reminder24h?: boolean; reminder2h?: boolean; reminder1h?: boolean } = {},
  id = "evt-rt-1",
) {
  const event = await prisma.event.create({
    data: {
      id,
      title: "Timing Game",
      location: "Test Field",
      dateTime,
      maxPlayers: 10,
      ownerId,
      durationMinutes: 60,
      ...timings,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

describe("reminder timings gate (job pipeline)", () => {
  it("a disabled timing is recorded as sent but nothing is delivered", async () => {
    const user = await seedUser();
    const eventDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, { reminder2h: false });
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, userId: user.id },
    });

    await scheduleEventReminders(event.id, eventDate, 60);
    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_2h" },
    });
    expect(job).not.toBeNull();

    await processJob(job!.id);

    const log = await prisma.reminderLog.findFirst({
      where: { eventId: event.id, type: "2h" },
    });
    expect(log).not.toBeNull();
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(fireWebhooks).not.toHaveBeenCalled();
  });

  it("an enabled timing fires a reminder webhook with lean payload", async () => {
    const user = await seedUser("u-rt-2");
    const eventDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, { reminder2h: true }, "evt-rt-2");
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, userId: user.id },
    });

    await scheduleEventReminders(event.id, eventDate, 60);
    const job = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "reminder_2h" },
    });
    expect(job).not.toBeNull();

    await processJob(job!.id);

    expect(enqueueNotification).toHaveBeenCalled();
    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "reminder", {
      reminderType: "2h",
      gameId: event.currentGameId,
      dateTime: eventDate.toISOString(),
    });
  });
});

describe("reminder timings gate (cron sweep)", () => {
  const SECRET = "test-cron-secret";

  function cronCtx() {
    return {
      request: new Request("http://localhost/api/cron/reminders", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
      }),
      params: {},
    } as any;
  }

  async function runCron() {
    process.env.CRON_SECRET = SECRET;
    try {
      const { POST } = await import("~/pages/api/cron/reminders");
      await POST(cronCtx());
    } finally {
      delete process.env.CRON_SECRET;
    }
  }

  it("a disabled timing is recorded but nothing is delivered", async () => {
    const user = await seedUser("u-rt-3");
    const eventDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, { reminder24h: false }, "evt-rt-3");
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, userId: user.id },
    });

    await runCron();

    const log = await prisma.reminderLog.findFirst({
      where: { eventId: event.id, type: "24h" },
    });
    expect(log).not.toBeNull();
    expect(enqueueNotification).not.toHaveBeenCalledWith(event.id, "reminder", expect.anything());
    expect(fireWebhooks).not.toHaveBeenCalledWith(event.id, "reminder", expect.anything());
  });

  it("an enabled timing delivers and fires the reminder webhook", async () => {
    const user = await seedUser("u-rt-4");
    const eventDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const event = await seedEvent(user.id, eventDate, { reminder24h: true }, "evt-rt-4");
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, userId: user.id },
    });

    await runCron();

    expect(enqueueNotification).toHaveBeenCalledWith(event.id, "reminder", expect.anything());
    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "reminder", {
      reminderType: "24h",
      gameId: event.currentGameId,
      dateTime: eventDate.toISOString(),
    });
  });
});
