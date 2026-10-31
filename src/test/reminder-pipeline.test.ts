/**
 * GH-1404 — one reminder pipeline. The cron window scan and the scheduled job
 * are two triggers, not two implementations: both deliver through
 * `deliverReminder`, and a repeat send for the same (Event, type) is a no-op
 * rather than a unique-constraint throw or a second email.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { deliverReminder, markReminderSent } from "~/lib/reminders.server";
import { processJob, scheduleEventReminders } from "~/lib/scheduler.server";

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
  drainNotificationQueue: vi.fn().mockResolvedValue(0),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

const { sendReminder } = await import("~/lib/email.server");
const { enqueueNotification } = await import("~/lib/notificationQueue.server");

beforeEach(async () => {
  vi.clearAllMocks();
  resetRateLimitStore();
  resetApiRateLimitStore();
  await prisma.notificationPreferences.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.scheduledJob.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

/** A one-player Event `hoursFromNow` away, whose player wants the email reminder. */
async function seedEvent(hoursFromNow: number, suffix = "1") {
  const dateTime = new Date(Date.now() + hoursFromNow * 3600_000);
  const userId = `u-pipe-${suffix}`;
  const user = await prisma.user.create({
    data: { id: userId, name: `Player ${suffix}`, email: `pipe-${suffix}@test.com`, emailVerified: true },
  });
  await prisma.notificationPreferences.create({
    data: { userId: user.id, emailEnabled: true, gameReminderEmail: true, reminder24h: true },
  });
  const event = await prisma.event.create({
    data: { title: "Pipeline Game", location: "Pitch", dateTime, maxPlayers: 10, durationMinutes: 60 },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  await prisma.player.create({ data: { eventId: event.id, name: `Player ${suffix}`, userId: user.id, order: 0 } });
  return { event, dateTime };
}

/** Add [count] more email-enabled players to [event]. */
async function seedPlayers(event: { id: string }, count: number, prefix: string) {
  for (let i = 0; i < count; i++) {
    const userId = `${prefix}-extra-${i}`;
    await prisma.user.create({
      data: { id: userId, name: `${prefix} ${i}`, email: `${userId}@test.com`, emailVerified: true },
    });
    await prisma.notificationPreferences.create({
      data: { userId, emailEnabled: true, gameReminderEmail: true, reminder24h: true },
    });
    await prisma.player.create({
      data: { eventId: event.id, name: `${prefix} ${i}`, userId, order: i + 1 },
    });
  }
}

async function runCron() {
  process.env.CRON_SECRET = "test-cron-secret";
  try {
    const { POST } = await import("~/pages/api/cron/reminders");
    await POST({
      request: new Request("http://localhost/api/cron/reminders", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
      params: {},
    } as never);
  } finally {
    delete process.env.CRON_SECRET;
  }
}

describe("deliverReminder", () => {
  it("is idempotent for the same (event, type): a repeat sends no second email and does not throw", async () => {
    const { event } = await seedEvent(24);

    await deliverReminder(event.id, "24h");
    await markReminderSent(event.id, "24h");

    await expect(deliverReminder(event.id, "24h")).resolves.toBe("already-sent");
    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.count({ where: { eventId: event.id, type: "24h" } })).toBe(1);
  });

  it("caps concurrent reminder emails at 10 across two concurrent deliveries", async () => {
    const a = await seedEvent(24, "a");
    const b = await seedEvent(24, "b");
    await seedPlayers(a.event, 7, "a");
    await seedPlayers(b.event, 7, "b");

    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(sendReminder).mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight--;
    });

    try {
      await Promise.all([deliverReminder(a.event.id, "24h"), deliverReminder(b.event.id, "24h")]);
      // 2 events x 8 players = 16 sends; the module-level limiter must keep 10.
      expect(maxInFlight).toBeLessThanOrEqual(10);
      expect(maxInFlight).toBeGreaterThanOrEqual(2);
    } finally {
      vi.mocked(sendReminder).mockResolvedValue(undefined);
    }
  });

  it("reports an email provider failure instead of claiming delivery", async () => {
    const { event } = await seedEvent(24, "fail");
    vi.mocked(sendReminder).mockRejectedValueOnce(new Error("provider down"));
    try {
      await expect(deliverReminder(event.id, "24h")).resolves.toBe("delivered-with-failures");
    } finally {
      vi.mocked(sendReminder).mockResolvedValue(undefined);
    }
  });

  it("marks the same reminder twice without throwing and keeps one log row", async () => {
    const { event } = await seedEvent(24);

    await markReminderSent(event.id, "24h");
    await expect(markReminderSent(event.id, "24h")).resolves.toBeUndefined();

    expect(await prisma.reminderLog.count({ where: { eventId: event.id, type: "24h" } })).toBe(1);
  });

  it("a job processed after the cron swept the same reminder delivers nothing", async () => {
    const { event, dateTime } = await seedEvent(24);
    await scheduleEventReminders(event.id, dateTime, 60);

    await runCron();
    expect(sendReminder).toHaveBeenCalledTimes(1);

    const job = await prisma.scheduledJob.findFirstOrThrow({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    await processJob(job.id);

    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.count({ where: { eventId: event.id, type: "24h" } })).toBe(1);
  });

  it("delivers the post-game push through the same seam, with the recurring key", async () => {
    const { event } = await seedEvent(-2);
    await prisma.event.update({ where: { id: event.id }, data: { isRecurring: true } });

    await expect(deliverReminder(event.id, "post-game")).resolves.toBe("delivered");

    expect(enqueueNotification).toHaveBeenCalledWith(
      event.id,
      "post_game",
      expect.objectContaining({ key: "postGameNotificationRecurring", url: `/events/${event.id}?action=add-score` }),
    );
    expect(sendReminder).not.toHaveBeenCalled();
  });

  it("delivers nothing for an archived Event", async () => {
    const { event } = await seedEvent(24);
    await prisma.event.update({ where: { id: event.id }, data: { archivedAt: new Date() } });

    await expect(deliverReminder(event.id, "24h")).resolves.toBe("archived");

    expect(sendReminder).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(await prisma.reminderLog.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("keeps the stored row's auto-enabled email for a verified Google account", async () => {
    const { event } = await seedEvent(24);
    await prisma.account.create({
      data: { id: "acc-pipe-1", accountId: "google-1", providerId: "google", userId: "u-pipe-1" },
    });
    await prisma.notificationPreferences.update({
      where: { userId: "u-pipe-1" },
      data: { emailEnabled: false, gameReminderEmail: true },
    });

    await deliverReminder(event.id, "24h");

    expect(sendReminder).toHaveBeenCalledTimes(1);
  });
});
