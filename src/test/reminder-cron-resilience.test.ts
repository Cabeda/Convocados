/**
 * #1761 — one failed phase in the reminder cron must not abort the tick and
 * re-send every reminder on the next 5-minute run. The RSVP-ping query used to
 * sit outside the handler's try/catch, so a throw there skipped the end-of-tick
 * marking: reminders already delivered in that tick had no ReminderLog row and
 * were re-delivered (push + email) on the next tick.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const mockGetEventsNeedingRsvpPing = vi.fn();
const mockDrainNotificationQueue = vi.fn();
const mockCleanupStalePushTokens = vi.fn();

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/rsvp.server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventsNeedingRsvpPing: (...args: unknown[]) => mockGetEventsNeedingRsvpPing(...args),
  };
});

vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  cleanupStalePushTokens: (...args: unknown[]) => mockCleanupStalePushTokens(...args),
}));

vi.mock("~/lib/email.server", () => ({
  sendReminder: vi.fn().mockResolvedValue(undefined),
  sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: (...args: unknown[]) => mockDrainNotificationQueue(...args),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "~/pages/api/cron/reminders";

const { enqueueNotification } = await import("~/lib/notificationQueue.server");

const SECRET = "test-cron-secret";

function cronCtx() {
  return {
    request: new Request("http://localhost/api/cron/reminders", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }),
    params: {},
  } as never;
}

function runCron() {
  return POST(cronCtx());
}

async function seedEvent(id: string, hoursFromNow = 24) {
  return prisma.event.create({
    data: {
      id,
      title: "Cron Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + hoursFromNow * 3600_000),
      maxPlayers: 10,
      durationMinutes: 60,
    },
  });
}

beforeEach(async () => {
  process.env.CRON_SECRET = SECRET;
  vi.clearAllMocks();
  mockGetEventsNeedingRsvpPing.mockReset();
  mockGetEventsNeedingRsvpPing.mockResolvedValue([]);
  mockDrainNotificationQueue.mockReset();
  mockDrainNotificationQueue.mockResolvedValue(0);
  mockCleanupStalePushTokens.mockReset();
  mockCleanupStalePushTokens.mockResolvedValue({ appTokens: 0, webSubs: 0 });

  await prisma.rsvp.deleteMany().catch(() => undefined);
  await prisma.notificationJob.deleteMany().catch(() => undefined);
  await prisma.eventFollow.deleteMany().catch(() => undefined);
  await prisma.paymentNudgeStage.deleteMany().catch(() => undefined);
  await prisma.gamePayment.deleteMany().catch(() => undefined);
  await prisma.eventPlayer.deleteMany().catch(() => undefined);
  await prisma.player.deleteMany().catch(() => undefined);
  await prisma.reminderLog.deleteMany().catch(() => undefined);
  await prisma.scheduledJob.deleteMany().catch(() => undefined);
  await prisma.notificationPreferences.deleteMany().catch(() => undefined);
  await prisma.game.deleteMany().catch(() => undefined);
  await prisma.event.deleteMany().catch(() => undefined);
  await prisma.user.deleteMany().catch(() => undefined);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("reminder cron resilience (#1761)", () => {
  it("keeps the tick alive and runs later phases when the RSVP-ping query throws", async () => {
    mockGetEventsNeedingRsvpPing.mockRejectedValue(new Error("rsvp query failed"));

    const res = await runCron();

    expect(res.status).toBe(200);
    expect(mockDrainNotificationQueue).toHaveBeenCalledTimes(1);
    expect(mockCleanupStalePushTokens).toHaveBeenCalledTimes(1);
  });

  it("marks reminders delivered earlier in a tick even when a later phase throws", async () => {
    const event = await seedEvent("e-cron-mid");
    mockGetEventsNeedingRsvpPing.mockRejectedValue(new Error("rsvp query failed"));

    const first = await runCron();
    expect(first.status).toBe(200);
    expect(await prisma.reminderLog.count({ where: { eventId: event.id, type: "24h" } })).toBe(1);
    expect(enqueueNotification).toHaveBeenCalledWith(
      event.id,
      "reminder",
      expect.objectContaining({ reminderType: "24h" }),
    );

    vi.mocked(enqueueNotification).mockClear();
    const second = await runCron();
    expect(second.status).toBe(200);
    expect(await prisma.reminderLog.count({ where: { eventId: event.id, type: "24h" } })).toBe(1);
    expect(enqueueNotification).not.toHaveBeenCalledWith(event.id, "reminder", expect.anything());
  });

  it("marks each reminder sent as soon as it delivers, before later phases run", async () => {
    const event = await seedEvent("e-cron-order");
    let logCountAtDrain = -1;
    mockDrainNotificationQueue.mockImplementation(async () => {
      logCountAtDrain = await prisma.reminderLog.count({ where: { eventId: event.id, type: "24h" } });
      return 0;
    });

    const res = await runCron();

    expect(res.status).toBe(200);
    expect(logCountAtDrain).toBe(1);
  });
});
